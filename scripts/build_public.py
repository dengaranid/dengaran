#!/usr/bin/env python3
"""Siapkan folder public/ untuk Cloudflare Pages dari sumber di src/.

- Minify src/styles.css dan src/app.js, lalu tulis dengan hash isi di nama file
  (styles.<hash>.min.css, app.<hash>.min.js) supaya browser mengambil versi baru
  setiap deploy.
- Salin src/index.html ke public/index.html, ganti referensi CSS/JS ke file hasil
  minify, dan sisipkan tag SEO berisi URL absolut.
- Salin ikon dan gambar preview dari assets/, lalu tulis robots.txt dan sitemap.xml.
- Salin THIRD_PARTY_NOTICES.md ke public/third-party-notices.txt.
- Tulis halaman daftar radio per kota dan genre (public/<slug>.html) dari data Radio Browser,
  lalu masukkan alamatnya ke sitemap.xml dan ke dialog Tentang di index.html.
- Sisipkan script Cloudflare Web Analytics kalau CF_ANALYTICS_TOKEN diisi.
- Tulis public/_headers berisi header keamanan dan cache.

CSS di-minify dengan Python bawaan. JS di-minify dengan `bun build --minify` kalau bun ada di
PATH (di Cloudflare Pages lewat variabel BUN_VERSION). Kalau bun tidak ada, app.js disalin tanpa
minify dan build menulis peringatan.

Jalankan dari root project:  python3 scripts/build_public.py
"""

import hashlib
import html as html_lib
import json
import os
import re
import shutil
import sys
import subprocess
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "src"
ASSETS_DIR = ROOT / "assets"
OUTPUT_DIR = ROOT / "public"

# Alamat produksi, tanpa garis miring di akhir. dengaran.pages.dev di-redirect 301 ke alamat ini
# lewat Bulk Redirects di akun Cloudflare.
SITE_URL = "https://dengaran.id"

SEO_MARKER = "<!-- seo:absolute-urls (canonical, og:url, og:image, JSON-LD) diisi scripts/build_public.py -->"
LANDING_LINKS_MARKER = "<!-- seo:landing-links diisi scripts/build_public.py -->"
# Tag <head> yang sama di semua halaman (warna, ikon, og:site_name). Ditulis sekali di
# src/index.html di antara dua penanda ini, lalu disalin ke halaman daftar radio dan 404.html.
SHARED_HEAD_START = "<!-- head:shared, disalin scripts/build_public.py ke halaman daftar radio dan 404.html -->"
SHARED_HEAD_END = "<!-- /head:shared -->"
CSS_TAG = '<link rel="stylesheet" href="styles.css" />'
JS_TAG = '<script type="module" src="app.js"></script>'
# Stasiun dan tag yang disembunyikan. Di-import app.js dan dibaca build untuk halaman daftar radio.
BLOCKLIST_FILE = "blocklist.json"
ASSET_FILES = ["favicon.svg", "favicon-48.png", "apple-touch-icon.png", "og-image.png"]
# Library pihak ketiga yang dimuat app.js saat dibutuhkan. Disalin apa adanya, tanpa minify ulang.
VENDOR_DIR = SRC_DIR / "vendor"

# Token Cloudflare Web Analytics, dari dashboard: Analytics & Logs > Web Analytics > Add a site.
# Token ini ikut tampil di HTML publik, jadi bukan secret. Kalau kosong, script analytics tidak
# disisipkan dan host-nya tidak ditambahkan ke CSP.
CF_ANALYTICS_TOKEN = "93b56a911b5f4956b159046e7cdc8931"
CF_ANALYTICS_SCRIPT_HOST = "https://static.cloudflareinsights.com"
CF_ANALYTICS_REPORT_HOST = "https://cloudflareinsights.com"

# Host API Radio Browser yang dipanggil fetch(). Harus sama dengan API_SERVER_LIST_URL dan
# API_MIRRORS di src/app.js. Server lain dari daftar all.api tetap diizinkan karena connect-src
# memuat https:.
API_HOSTS = [
    "https://all.api.radio-browser.info",
    "https://de1.api.radio-browser.info",
]


# ---------- Halaman daftar radio ----------

# Halaman statis per kota dan genre, supaya mesin pencari menemukan teks dan daftar stasiun
# tanpa menjalankan app.js. Datanya diambil saat build: stasiun Indonesia HTTPS yang tidak
# ditandai rusak, diurutkan dari jumlah klik terbanyak.
LANDING_STATIONS_QUERY = (
    "/json/stations/search?countrycode=ID&hidebroken=true&is_https=true"
    "&order=clickcount&reverse=true&limit=5000"
)
LANDING_FETCH_TIMEOUT_S = 30
LANDING_USER_AGENT = "Dengaran-build/1.0 (+https://github.com/dengaranid/dengaran)"
LANDING_MAX_STATIONS = 100
# Halaman dengan stasiun lebih sedikit dari ini tidak ditulis, dan tidak masuk sitemap.
LANDING_MIN_STATIONS = 8
# Tag yang tidak menyebut genre, jadi tidak dihitung di ringkasan halaman.
LANDING_GENERIC_TAGS = {"indonesia", "indonesian", "bahasa indonesia", "music", "musik", "radio",
                        "fm", "am", "id", "local", "online", "streaming"}
LANDING_OPEN_HINT = (
    "Pilih stasiun untuk membukanya di pemutar Dengaran, lalu tekan Putar. Urutannya dari stasiun "
    "yang paling sering diputar pendengar Radio Browser."
)

# kind "city": dicocokkan dengan nama dan kolom state stasiun (regex, awal kata).
# kind "genre": dicocokkan dengan tag persis. kind "all": semua stasiun.
# "tab": label pendek di baris tab navigasi antar halaman.
LANDING_PAGES = [
    {"slug": "radio-online-indonesia", "tab": "Semua", "kind": "all", "heading": "Radio Online Indonesia",
     "intro": "Radio online dan radio streaming dari seluruh Indonesia yang bisa didengar gratis di browser."},
    {"slug": "radio-online-jakarta", "tab": "Jakarta", "kind": "city", "heading": "Radio Online Jakarta",
     "pattern": r"\bjakarta",
     "intro": "Stasiun radio Jakarta yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-bandung", "tab": "Bandung", "kind": "city", "heading": "Radio Online Bandung dan Jawa Barat",
     "pattern": r"\bbandung|\bjawa barat|\bwest java",
     "intro": "Stasiun radio dari Bandung dan kota lain di Jawa Barat yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-yogyakarta", "tab": "Yogyakarta", "kind": "city", "heading": "Radio Online Yogyakarta",
     "pattern": r"\byogya|\bjogja|ꦗꦺꦴꦒ꧀ꦗꦏꦂꦠ",
     "intro": "Stasiun radio Yogyakarta yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-bali", "tab": "Bali", "kind": "city", "heading": "Radio Online Bali",
     "pattern": r"\bbali\b|\bdenpasar",
     "intro": "Stasiun radio dari Bali yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-surabaya", "tab": "Surabaya", "kind": "city", "heading": "Radio Online Surabaya",
     "pattern": r"\bsurabaya",
     "intro": "Stasiun radio Surabaya yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-semarang", "tab": "Semarang", "kind": "city", "heading": "Radio Online Semarang",
     "pattern": r"\bsemarang",
     "intro": "Stasiun radio Semarang yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-pop", "tab": "Pop", "kind": "genre", "heading": "Radio Pop Online",
     "tags": {"pop", "pop music", "hits", "top 40", "contemporary hits radio"},
     "intro": "Radio streaming musik pop, top 40, dan lagu hits dari stasiun Indonesia."},
    {"slug": "radio-rock", "tab": "Rock", "kind": "genre", "heading": "Radio Rock Online",
     "tags": {"rock", "pop rock", "alternative", "metal"},
     "intro": "Radio streaming rock, alternative, dan metal dari stasiun Indonesia."},
    {"slug": "radio-berita", "tab": "Berita", "kind": "genre", "heading": "Radio Berita Online",
     "tags": {"news", "local news", "talk", "talk show radio"},
     "intro": "Radio berita dan talk show Indonesia: berita nasional, berita lokal, dan siaran bincang-bincang."},
    {"slug": "radio-daerah", "tab": "Daerah", "kind": "genre", "heading": "Radio Budaya dan Musik Daerah",
     "tags": {"sunda", "jawa", "javanese", "campursari", "local music", "culture"},
     "intro": "Radio dengan siaran budaya dan musik daerah: Sunda, Jawa, campursari, dan musik lokal lain."},
    {"slug": "radio-dangdut", "tab": "Dangdut", "kind": "genre", "heading": "Radio Dangdut Online",
     "tags": {"dangdut", "koplo", "campursari"},
     "intro": "Radio streaming dangdut, dangdut koplo, dan campursari dari stasiun Indonesia."},
    {"slug": "radio-nostalgia", "tab": "Nostalgia", "kind": "genre", "heading": "Radio Nostalgia Online",
     "tags": {"70s", "80s", "90s", "oldies", "nostalgia", "classic hits"},
     "intro": "Radio yang memutar lagu lawas dari era 70-an, 80-an, dan 90-an."},
    {"slug": "radio-rohani", "tab": "Rohani", "kind": "genre", "heading": "Radio Rohani Online",
     "tags": {"religious", "religion", "islam", "islamic", "quran", "dakwah", "christian"},
     "intro": "Radio rohani dan religi dari stasiun Indonesia, termasuk siaran Islam dan Kristen."},
]

MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus",
             "September", "Oktober", "November", "Desember"]


# ---------- Warna output terminal ----------

# Kode ANSI hanya dipakai kalau output masuk ke terminal dan NO_COLOR (https://no-color.org) kosong,
# jadi log build Cloudflare Pages dan output yang di-pipe tetap teks biasa.
def paint(text, code, stream=sys.stdout):
    if not stream.isatty() or os.environ.get("NO_COLOR") or os.environ.get("TERM") == "dumb":
        return text
    return f"\033[{code}m{text}\033[0m"


def fail(message):
    sys.exit(paint("Build gagal: ", "1;31", sys.stderr) + message)


# ---------- Minify CSS ----------

def minify_css(css):
    # Lindungi isi string (termasuk SVG di data URI) supaya tidak ikut diubah.
    strings = []

    def keep(match):
        strings.append(match.group(0))
        return f"\x00{len(strings) - 1}\x00"

    css = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', keep, css)
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    # Spasi di sekitar tanda ini tidak berarti. Spasi sebelum ":" sengaja dibiarkan,
    # karena di selector "a :hover" spasi itu mengubah arti.
    css = re.sub(r"\s*([{};,>])\s*", r"\1", css)
    css = re.sub(r":\s+", ":", css)
    css = css.replace(";}", "}")
    css = re.sub(r"\x00(\d+)\x00", lambda m: strings[int(m.group(1))], css)
    return css.strip() + "\n"


# ---------- Minify JS ----------

def minify_js_bun(path):
    """Minify dengan bun. Mengembalikan None kalau bun tidak ada di PATH. Gagalnya bun build
    menaikkan ValueError, supaya JS yang tidak bisa di-parse menghentikan build.

    app.js hanya meng-import blocklist.json, jadi bun memasukkan isi JSON itu ke satu file tanpa
    node_modules. Format iife membungkus semua deklarasi top-level; aman karena index.html tidak
    punya handler inline.
    """
    bun = shutil.which("bun")
    if bun is None:
        return None
    result = subprocess.run(
        [bun, "build", str(path), "--minify", "--target=browser", "--format=iife"],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise ValueError(f"bun build gagal (exit {result.returncode}): {result.stderr.strip()}")
    return result.stdout.strip() + "\n"


# ---------- SEO, CSP, header ----------

def seo_tags(html):
    """Tag yang butuh URL absolut, jadi baru bisa ditulis saat alamat situs diketahui."""
    title = re.search(r"<title>(.*?)</title>", html, re.DOTALL).group(1).strip()
    description = re.search(r'name="description"\s+content="(.*?)"', html, re.DOTALL).group(1).strip()
    page_url = SITE_URL + "/"
    image_url = SITE_URL + "/og-image.png"

    website_id = page_url + "#website"
    # WebSite dipakai Google untuk nama situs di hasil pencarian. SearchAction tidak ditulis
    # karena pencarian di aplikasi tidak punya URL sendiri.
    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebSite",
                "@id": website_id,
                "name": "Dengaran",
                "url": page_url,
                "inLanguage": "id",
            },
            {
                "@type": "WebApplication",
                "name": "Dengaran",
                "url": page_url,
                "description": description,
                "applicationCategory": "MultimediaApplication",
                "operatingSystem": "Web",
                "inLanguage": "id",
                "isAccessibleForFree": True,
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "IDR"},
                "isPartOf": {"@id": website_id},
            },
        ],
    }

    return "\n".join(
        [
            f'<link rel="canonical" href="{page_url}" />',
            f'  <meta property="og:url" content="{page_url}" />',
            f'  <meta property="og:image" content="{image_url}" />',
            '  <meta property="og:image:width" content="1200" />',
            '  <meta property="og:image:height" content="630" />',
            f'  <meta property="og:image:alt" content="{title}" />',
            f'  <meta name="twitter:image" content="{image_url}" />',
            '  <script type="application/ld+json">'
            + json.dumps(json_ld, ensure_ascii=False)
            + "</script>",
        ]
    )


def last_modified():
    """Tanggal commit terakhir yang mengubah src/index.html, untuk lastmod di sitemap.

    Tanggal build berubah di setiap deploy walau isinya sama, dan Google mengabaikan lastmod
    yang terbukti tidak akurat. Kalau git tidak tersedia, tanggal hari ini dipakai.
    """
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", "src/index.html"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return date.today().isoformat()
    return result.stdout.strip() or date.today().isoformat()


def shared_head(html):
    """Isi di antara SHARED_HEAD_START dan SHARED_HEAD_END di src/index.html, tanpa penandanya.
    Indentasi tiap baris dipertahankan, jadi bisa langsung ditempel di <head> berindentasi 2."""
    start = html.index(SHARED_HEAD_START) + len(SHARED_HEAD_START)
    end = html.find(SHARED_HEAD_END, start)
    if end == -1:
        fail(f"{SHARED_HEAD_END} tidak ditemukan sesudah {SHARED_HEAD_START} di src/index.html")
    block = html[start:end].strip("\n").rstrip()
    if not block.strip():
        fail("Blok head:shared di src/index.html kosong.")
    return block.lstrip()


def not_found_page(css_name, head):
    """Halaman 404. Tanpa 404.html, Cloudflare Pages menjawab semua path dengan index.html
    dan status 200, sehingga URL yang tidak ada terbaca sebagai duplikat beranda (soft 404)."""
    return f"""<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Halaman tidak ditemukan | Dengaran</title>
  <meta name="robots" content="noindex" />
  {head}
  <link rel="stylesheet" href="/{css_name}" />
</head>
<body>
  <main class="not-found">
    <h1>Halaman tidak ditemukan</h1>
    <p>Alamat ini tidak ada di Dengaran. Mungkin link-nya salah ketik atau sudah tidak dipakai.</p>
    <p><a href="/">Buka Dengaran</a></p>
  </main>
</body>
</html>
"""


def load_blocklist():
    """UUID stasiun dan tag dari src/blocklist.json, huruf kecil semua. Isi yang tidak sesuai
    bentuknya menghentikan build: daftar blokir yang terbaca kosong akan menampilkan stasiun yang
    seharusnya disembunyikan di halaman daftar radio."""
    path = SRC_DIR / BLOCKLIST_FILE
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        fail(f"{path} tidak bisa dibaca: {error}")

    stations = data.get("stations") if isinstance(data, dict) else None
    tags = data.get("tags") if isinstance(data, dict) else None
    if not isinstance(stations, list) or not isinstance(tags, list):
        fail(f'{path} harus berupa objek dengan array "stations" dan "tags".')

    ids = set()
    for index, station in enumerate(stations):
        station_id = station.get("id") if isinstance(station, dict) else None
        if not isinstance(station_id, str) or not station_id.strip():
            fail(f'{path}: stations[{index}] tidak punya "id" berisi stationuuid.')
        ids.add(station_id.strip().lower())

    blocked_tags = set()
    for index, tag in enumerate(tags):
        if not isinstance(tag, str) or not tag.strip():
            fail(f"{path}: tags[{index}] harus string yang tidak kosong.")
        blocked_tags.add(tag.strip().lower())
    return ids, blocked_tags


def station_tags(station):
    return [tag.strip().lower() for tag in (station.get("tags") or "").split(",") if tag.strip()]


def station_name_key(name):
    """Kunci entri ganda: kata dan angka di nama, tanpa membedakan huruf besar dan urutan kata,
    jadi "Jak FM 101" dan "JAK 101 FM" dianggap satu stasiun. Nama tanpa huruf atau angka
    sama sekali (misalnya hanya emoji) memakai namanya sendiri sebagai kunci."""
    words = re.findall(r"\w+", name.lower())
    return " ".join(sorted(set(words))) if words else name.lower()


def station_state(station):
    """Kolom state yang bisa ditampilkan, atau "" kalau kosong atau isinya nama negara.
    Isi kolom ini bebas diisi pengguna Radio Browser, jadi dirapikan supaya penulisan berbeda
    untuk tempat yang sama terhitung satu: bagian sesudah koma dibuang ("Bandung, West Java"),
    awalan DKI dan Daerah Istimewa dibuang ("DKI Jakarta"), dan yang ditulis huruf kecil semua
    ("parepare") diubah ke huruf kapital di awal kata."""
    state = " ".join((station.get("state") or "").split(",")[0].split())
    state = re.sub(r"^(dki|daerah istimewa)\s+", "", state, flags=re.IGNORECASE)
    if state.lower() == "indonesia":
        return ""
    return state.title() if state.islower() else state


def fetch_landing_stations(blocked_ids, blocked_tags):
    """Stasiun untuk halaman daftar radio. Build berhenti kalau semua server API gagal: deploy
    sebelumnya di Cloudflare Pages tetap dipakai, daripada halaman ini hilang dari situs."""

    errors = []
    for host in API_HOSTS:
        request = urllib.request.Request(
            host + LANDING_STATIONS_QUERY, headers={"User-Agent": LANDING_USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=LANDING_FETCH_TIMEOUT_S) as response:
                stations = json.load(response)
            break
        except (OSError, ValueError) as error:
            errors.append(f"{host}: {error}")
    else:
        fail("Daftar stasiun untuk halaman daftar radio tidak bisa diambil.\n  " + "\n  ".join(errors))

    if not isinstance(stations, list):
        fail("Jawaban API daftar stasiun bukan array.")

    result = []
    kept_by_name = {}
    for station in stations:
        # Elemen yang bukan objek tidak bisa dibaca sebagai stasiun.
        if not isinstance(station, dict):
            continue
        uuid = (station.get("stationuuid") or "").lower()
        name = (station.get("name") or "").strip()
        # Tanpa uuid link ke pemutar tidak bisa dibuat; tanpa nama baris tidak bisa dibaca.
        if not uuid or not name or uuid in blocked_ids:
            continue
        if blocked_tags.intersection(station_tags(station)):
            continue
        # Radio Browser memuat banyak entri ganda: yang kliknya terbanyak dipakai. Kalau entri itu
        # tidak mengisi state, state dari entri ganda dipakai, supaya stasiunnya tetap masuk
        # halaman kotanya.
        key = station_name_key(name)
        kept = kept_by_name.get(key)
        if kept is not None:
            if not (kept.get("state") or "").strip() and (station.get("state") or "").strip():
                kept["state"] = station["state"]
            continue
        kept_by_name[key] = station
        result.append(station)
    return result


def landing_matches(page, station):
    if page["kind"] == "all":
        return True
    if page["kind"] == "genre":
        return bool(page["tags"].intersection(station_tags(station)))
    text = f"{station.get('name') or ''} {station.get('state') or ''}".lower()
    return re.search(page["pattern"], text) is not None


def landing_pages_with_stations(stations):
    pages = []
    for page in LANDING_PAGES:
        matched = [station for station in stations if landing_matches(page, station)]
        if len(matched) < LANDING_MIN_STATIONS:
            print(paint(f"  Halaman /{page['slug']} dilewati: hanya {len(matched)} stasiun", "33"))
            continue
        pages.append({**page, "stations": matched[:LANDING_MAX_STATIONS], "matched": matched,
                      "total": len(matched)})
    return pages


# Sama dengan bitrateKbps di src/app.js: bitrate yang ditulis dalam bps dibagi 1000, dan nilai
# di atas batas audio (biasanya total stream HLS berisi video) dianggap tidak diketahui.
MAX_AUDIO_KBPS = 4608


def bitrate_kbps(station):
    kbps = station.get("bitrate") or 0
    if kbps > MAX_AUDIO_KBPS and kbps % 1000 == 0:
        kbps //= 1000
    return kbps if 0 < kbps <= MAX_AUDIO_KBPS else 0


def station_meta(station):
    """Kota, tiga tag pertama, codec, dan bitrate, dipisah titik tengah."""
    parts = []
    state = station_state(station)
    if state:
        parts.append(state)
    # Tag di Radio Browser bebas diisi; tag yang sangat panjang biasanya bukan genre.
    tags = [tag for tag in station_tags(station) if len(tag) <= 24][:3]
    if tags:
        parts.append(", ".join(tags))
    codec = (station.get("codec") or "").strip().upper()
    quality = " ".join(
        part for part in [codec if codec and codec != "UNKNOWN" else "",
                          f"{bitrate_kbps(station)} kbps" if bitrate_kbps(station) else ""] if part
    )
    if quality:
        parts.append(quality)
    return " · ".join(parts)


def join_id(items):
    """["A", "B", "C"] menjadi "A, B, dan C"."""
    if len(items) <= 2:
        return " dan ".join(items)
    return ", ".join(items[:-1]) + ", dan " + items[-1]


def top_counts(values, limit=3, minimum=2):
    """Nilai yang paling sering muncul, tanpa membedakan huruf besar, dengan ejaan yang paling
    sering dipakai. Nilai yang muncul kurang dari `minimum` kali tidak ikut."""
    counts, spelling = {}, {}
    for value in values:
        key = value.lower()
        counts[key] = counts.get(key, 0) + 1
        spelling.setdefault(key, {})
        spelling[key][value] = spelling[key].get(value, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [(max(spelling[key], key=spelling[key].get), count)
            for key, count in ranked if count >= minimum][:limit]


def landing_summary(page):
    """Paragraf ringkasan yang dihitung dari data stasiun halaman ini, supaya tiap halaman
    punya teks sendiri, bukan hanya kalimat pembuka dan daftar link."""
    stations = page["matched"]
    total = len(stations)
    names = [station["name"].strip() for station in stations[:3]]
    sentences = [f"Halaman ini memuat {total} stasiun. Yang paling sering diputar: {join_id(names)}."]

    # Halaman kota tidak menyebut kota lagi; halaman genre tidak menyebut genre lagi.
    if page["kind"] != "city":
        cities = top_counts(state for state in map(station_state, stations) if state)
        if cities:
            listed = [f"{name} ({count} stasiun)" if i == 0 else f"{name} ({count})"
                      for i, (name, count) in enumerate(cities)]
            sentences.append(f"Kota dan provinsi yang paling banyak muncul: {join_id(listed)}.")
    if page["kind"] != "genre":
        # Minimal 3: tag yang hanya muncul di 2 stasiun sering berupa slogan, bukan genre.
        genres = top_counts(
            (tag for station in stations for tag in station_tags(station)
             if len(tag) <= 24 and tag not in LANDING_GENERIC_TAGS),
            minimum=3,
        )
        if genres:
            sentences.append(
                "Genre yang paling sering ditulis: "
                + join_id([f"{name} ({count})" for name, count in genres]) + "."
            )

    # bitrate 0 atau kosong berarti tidak diketahui, jadi tidak dihitung di kedua sisi.
    known = [station for station in stations if bitrate_kbps(station)]
    high = sum(1 for station in known if bitrate_kbps(station) >= 128)
    codecs = top_counts(
        codec for codec in ((station.get("codec") or "").strip().upper() for station in stations)
        if codec and codec != "UNKNOWN"
    )
    if known and codecs:
        sentences.append(
            f"Dari {len(known)} stasiun yang mencantumkan bitrate, {high} siaran pada 128 kbps "
            f"atau lebih. Format yang paling banyak dipakai: {codecs[0][0]}."
        )
    return " ".join(sentences)


def landing_tabs_html(pages, current_slug):
    """Baris tab Kota dan Genre di atas daftar stasiun. Tiap tab adalah link biasa ke halaman
    lain, jadi bisa dibaca mesin pencari tanpa JS. Tab halaman yang sedang dibuka ditandai
    aria-current."""
    rows = []
    for label, kinds in [("Kota", {"all", "city"}), ("Genre", {"genre"})]:
        items = []
        for page in pages:
            if page["kind"] not in kinds:
                continue
            tab = html_lib.escape(page["tab"])
            current = ' aria-current="page"' if page["slug"] == current_slug else ""
            items.append(f'<li><a class="landing-tab" href="/{page["slug"]}"{current}>{tab}</a></li>')
        # Kelompok yang semua halamannya dilewati karena stasiunnya terlalu sedikit tidak ditulis.
        if items:
            rows.append(
                f'      <div class="landing-tab-row">\n'
                f'        <span class="landing-tab-label">{label}</span>\n'
                f'        <ul class="landing-tab-list">\n          '
                + "\n          ".join(items)
                + "\n        </ul>\n      </div>"
            )
    return "\n".join(rows)


def landing_nav_html(pages):
    """Link antar halaman daftar radio di dialog Tentang, dikelompokkan kota dan genre."""
    def links(kinds):
        # Mengembalikan "" kalau semua halaman kelompok ini dilewati karena stasiunnya terlalu sedikit.
        return "\n".join(
            f'<li><a href="/{page["slug"]}">{html_lib.escape(page["heading"])}</a></li>'
            for page in pages if page["kind"] in kinds
        )

    groups = [("Radio online per kota", {"all", "city"}), ("Radio streaming per genre", {"genre"})]
    parts = []
    for title, kinds in groups:
        items = links(kinds)
        if items:
            parts.append(f'<h3>{title}</h3>\n<ul class="landing-links">\n{items}\n</ul>')
    return "\n".join(parts)


def landing_page_html(page, pages, css_name, built_on, head):
    page_url = f"{SITE_URL}/{page['slug']}"
    heading = html_lib.escape(page["heading"])
    title = f"{page['heading']}: Dengar Gratis di Browser | Dengaran"
    shown = len(page["stations"])
    top_names = join_id([station["name"].strip() for station in page["stations"][:2]])
    description = (
        f"Dengar {page['heading']} gratis di browser: {shown} stasiun, termasuk {top_names}. "
        "Tanpa iklan, tanpa cookie, tanpa daftar akun."
    )
    # Jumlah semua stasiun sudah disebut di ringkasan; di sini hanya batas daftar kalau terpotong.
    if page["total"] > shown:
        count_text = f"Daftar di bawah memuat {shown} yang paling sering diputar. "
    else:
        count_text = ""
    updated = f"{built_on.day} {MONTHS_ID[built_on.month - 1]} {built_on.year}"

    rows = []
    for station in page["stations"]:
        uuid = html_lib.escape(station["stationuuid"])
        name = html_lib.escape(station["name"].strip())
        meta = html_lib.escape(station_meta(station))
        rows.append(
            f'      <li><a class="landing-station" href="/?station={uuid}">'
            f'<span class="landing-station-name">{name}</span>'
            f'<span class="landing-station-meta">{meta}</span></a></li>'
        )

    json_ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "CollectionPage",
                "@id": page_url + "#page",
                "name": page["heading"],
                "url": page_url,
                "description": description,
                "inLanguage": "id",
                "isPartOf": {"@id": SITE_URL + "/#website"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Dengaran", "item": SITE_URL + "/"},
                    {"@type": "ListItem", "position": 2, "name": page["heading"], "item": page_url},
                ],
            },
        ],
    }
    analytics = f"\n  {analytics_tag()}" if CF_ANALYTICS_TOKEN else ""

    return f"""<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>{html_lib.escape(title)}</title>
  <meta name="description" content="{html_lib.escape(description)}" />
  <link rel="canonical" href="{page_url}" />
  {head}
  <meta property="og:title" content="{html_lib.escape(title)}" />
  <meta property="og:description" content="{html_lib.escape(description)}" />
  <meta property="og:url" content="{page_url}" />
  <meta property="og:image" content="{SITE_URL}/og-image.png" />
  <script type="application/ld+json">{json.dumps(json_ld, ensure_ascii=False)}</script>
  <link rel="stylesheet" href="/{css_name}" />{analytics}
</head>
<body class="landing-body">
  <header class="landing-header">
    <a class="landing-brand" href="/">Dengaran</a>
    <a class="landing-open" href="/">Buka pemutar</a>
  </header>

  <main class="landing">
    <!-- Tab di atas judul: tiap tab membuka halaman lain, jadi semua yang ikut berubah (judul,
         teks, dan daftar) ada di bawahnya. Breadcrumb hanya ditulis di JSON-LD. -->
    <nav class="landing-tabs" aria-label="Daftar radio per kota dan genre">
{landing_tabs_html(pages, page["slug"])}
    </nav>

    <h1>{heading}</h1>
    <p class="landing-intro">{html_lib.escape(page["intro"])} {LANDING_OPEN_HINT}</p>
    <p class="landing-summary">{html_lib.escape(landing_summary(page))}</p>
    <p class="landing-count">{count_text}Data dari Radio Browser, diperbarui {updated}.</p>

    <ol class="landing-list">
{chr(10).join(rows)}
    </ol>
  </main>

  <footer class="landing-footer">
    <p>
      Dengaran memutar radio online gratis di browser, tanpa iklan, tanpa cookie, dan tanpa daftar akun.
      Daftar stasiun berasal dari <a href="https://www.radio-browser.info" rel="noopener">Radio Browser</a>.
      Siaran dan merek stasiun milik masing-masing stasiun.
    </p>
  </footer>
</body>
</html>
"""


def landing_links_section(pages):
    """Bagian dialog Tentang yang menautkan halaman daftar radio, supaya Google menemukannya
    dari beranda, tidak hanya dari sitemap."""
    return f"""<div class="dialog-section">
{landing_nav_html(pages)}
        </div>"""


def analytics_tag():
    beacon = json.dumps({"token": CF_ANALYTICS_TOKEN})
    return (
        f'<script defer src="{CF_ANALYTICS_SCRIPT_HOST}/beacon.min.js" '
        f"data-cf-beacon='{beacon}'></script>"
    )


def build_csp():
    script_hosts = [CF_ANALYTICS_SCRIPT_HOST] if CF_ANALYTICS_TOKEN else []
    connect_hosts = API_HOSTS + ([CF_ANALYTICS_REPORT_HOST] if CF_ANALYTICS_TOKEN else [])
    directives = [
        "default-src 'none'",
        # CSS dan JS dari file di situs sendiri; tidak ada script atau style inline yang dijalankan.
        # JSON-LD adalah blok data, bukan script yang dieksekusi, jadi tidak perlu diizinkan.
        # Script analytics Cloudflare hanya diizinkan kalau CF_ANALYTICS_TOKEN diisi.
        " ".join(["script-src 'self'"] + script_hosts),
        "style-src 'self'",
        # Gambar hanya dari situs sendiri (logo stasiun tidak lagi ditampilkan); data: untuk ikon di CSS.
        "img-src 'self' data:",
        # Stream audio dari server stasiun mana pun. Halaman HTTPS hanya bisa memutar https:.
        # blob: untuk stream HLS yang diputar hls.js lewat Media Source Extensions.
        "media-src https: blob:",
        # 'self' supaya Lighthouse bisa mengambil /robots.txt dari dalam halaman (audit SEO).
        # https: karena hls.js mengambil playlist dan segmen HLS (lewat XHR) dari server stasiun
        # mana pun. Pembatasan per host sengaja dilepas untuk itu: API Radio Browser dan endpoint
        # analytics tetap ditulis hanya sebagai daftar host yang dipanggil app.js.
        " ".join(["connect-src 'self' https:"] + connect_hosts),
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
    ]
    return "; ".join(directives)


def content_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10]


def main():
    for name in ["index.html", "styles.css", "app.js"]:
        if not (SRC_DIR / name).exists():
            fail(f"File sumber tidak ditemukan: {SRC_DIR / name}")

    blocked_ids, blocked_tags = load_blocklist()
    html = (SRC_DIR / "index.html").read_text(encoding="utf-8")
    css_source = (SRC_DIR / "styles.css").read_text(encoding="utf-8")
    js_source = (SRC_DIR / "app.js").read_text(encoding="utf-8")

    for marker, label in [
        (SEO_MARKER, "penanda SEO"),
        (SHARED_HEAD_START, "penanda head:shared"),
        (LANDING_LINKS_MARKER, "penanda link halaman daftar radio"),
        (CSS_TAG, "tag CSS"),
        (JS_TAG, "tag JS"),
    ]:
        if marker not in html:
            fail(f"{label} tidak ditemukan di src/index.html: {marker}")

    css = minify_css(css_source)
    try:
        js = minify_js_bun(SRC_DIR / "app.js")
    except ValueError as error:
        fail(f"Minify JS gagal: {error}")
    # bun tidak ada di PATH: app.js dipakai apa adanya sebagai module, dan blocklist.json ikut
    # disalin karena di-import app.js. Hasilnya benar, hanya lebih besar.
    js_minified = js is not None
    if not js_minified:
        js = js_source

    head = shared_head(html)
    built_on = date.today()
    landing_pages = landing_pages_with_stations(fetch_landing_stations(blocked_ids, blocked_tags))

    css_name = f"styles.{content_hash(css)}.min.css"
    # Akhiran .min.js tetap dipakai tanpa bun, supaya aturan cache di _headers tetap berlaku.
    js_name = f"app.{content_hash(js)}.min.js"

    html = html.replace(SEO_MARKER, seo_tags(html))
    html = html.replace(LANDING_LINKS_MARKER, landing_links_section(landing_pages))
    html = html.replace(CSS_TAG, f'<link rel="stylesheet" href="{css_name}" />')
    if js_minified:
        js_tags = f'<script defer src="{js_name}"></script>'
    else:
        js_tags = f'<script type="module" src="{js_name}"></script>'
    if CF_ANALYTICS_TOKEN:
        js_tags += "\n  " + analytics_tag()
    html = html.replace(JS_TAG, js_tags)

    # Hapus hasil build lama supaya file CSS/JS dengan hash lama tidak ikut ter-upload.
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir()

    (OUTPUT_DIR / "index.html").write_text(html, encoding="utf-8")
    (OUTPUT_DIR / "404.html").write_text(not_found_page(css_name, head), encoding="utf-8")
    (OUTPUT_DIR / css_name).write_text(css, encoding="utf-8")
    # <slug>.html dilayani Cloudflare Pages di /<slug>, tanpa ekstensi.
    for page in landing_pages:
        (OUTPUT_DIR / f"{page['slug']}.html").write_text(
            landing_page_html(page, landing_pages, css_name, built_on, head), encoding="utf-8"
        )
    (OUTPUT_DIR / js_name).write_text(js, encoding="utf-8")
    if not js_minified:
        shutil.copyfile(SRC_DIR / BLOCKLIST_FILE, OUTPUT_DIR / BLOCKLIST_FILE)

    for name in ASSET_FILES:
        source = ASSETS_DIR / name
        if not source.exists():
            fail(f"Aset tidak ditemukan: {source}")
        shutil.copyfile(source, OUTPUT_DIR / name)

    if VENDOR_DIR.exists():
        shutil.copytree(VENDOR_DIR, OUTPUT_DIR / "vendor")

    # Lisensi ikon pihak ketiga wajib ikut di setiap salinan, termasuk situs yang di-deploy.
    shutil.copyfile(ROOT / "THIRD_PARTY_NOTICES.md", OUTPUT_DIR / "third-party-notices.txt")

    (OUTPUT_DIR / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8"
    )
    (OUTPUT_DIR / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"  <url><loc>{SITE_URL}/</loc><lastmod>{last_modified()}</lastmod></url>\n"
        # Tanpa lastmod: isi halaman ini berubah di setiap build mengikuti data Radio Browser.
        + "".join(f"  <url><loc>{SITE_URL}/{page['slug']}</loc></url>\n" for page in landing_pages)
        + "</urlset>\n",
        encoding="utf-8",
    )

    headers = "\n".join(
        [
            "/*",
            "  Content-Security-Policy: " + build_csp(),
            "  X-Content-Type-Options: nosniff",
            "  X-Frame-Options: DENY",
            "  Referrer-Policy: strict-origin-when-cross-origin",
            "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
            "",
            # Nama file berisi hash isi, jadi aman di-cache lama: isi baru selalu nama baru.
            # Termasuk vendor/*.min.js: versi library ditulis di nama filenya.
            "/*.min.js",
            "  Cache-Control: public, max-age=31536000, immutable",
            "",
            "/*.min.css",
            "  Cache-Control: public, max-age=31536000, immutable",
            "",
        ]
    )
    (OUTPUT_DIR / "_headers").write_text(headers, encoding="utf-8")

    def size(text):
        return len(text.encode("utf-8"))

    # Sumber kosong tidak menghasilkan persentase, bukan ZeroDivisionError.
    def saved(before, after):
        if not before:
            return ""
        return paint(f"-{round((1 - after / before) * 100)}%", "32")

    css_size, js_size = size(css), size(js)
    print(paint("Build selesai", "1;32") + paint(f" untuk {SITE_URL}", "2"))
    print(f"  {paint('public/' + css_name, '36')}  {size(css_source)} -> {css_size} byte  {saved(size(css_source), css_size)}")
    if js_minified:
        print(f"  {paint('public/' + js_name, '36')}  {size(js_source)} -> {js_size} byte  {saved(size(js_source), js_size)}")
    else:
        print(f"  {paint('public/' + js_name, '36')}  {js_size} byte  "
              + paint("tanpa minify, bun tidak ada di PATH", "33"))
    print(f"  {paint('public/', '36')}index.html, 404.html, _headers, aset, robots.txt, sitemap.xml, third-party-notices.txt")
    print(f"  {paint('public/<slug>.html', '36')}  {len(landing_pages)} halaman daftar radio: "
          + ", ".join(f"{page['slug']} ({page['total']})" for page in landing_pages))
    if CF_ANALYTICS_TOKEN:
        print("  Cloudflare Web Analytics: " + paint("disisipkan", "32"))
    else:
        print("  Cloudflare Web Analytics: " + paint("tidak disisipkan, CF_ANALYTICS_TOKEN kosong", "33"))

if __name__ == "__main__":
    main()
