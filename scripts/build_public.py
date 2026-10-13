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

Minify JS memakai `bun build --minify` kalau bun ada di PATH: nama variabel ikut
diperpendek, hasilnya sekitar 19% lebih kecil sesudah brotli. Kalau bun tidak ada, JS dan CSS
di-minify dengan Python bawaan: komentar, indentasi, dan spasi berlebih dibuang; isi string,
template literal, dan regex tidak diubah; nama variabel tidak diperpendek.

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

# Placeholder: ganti dengan alamat Cloudflare Pages (atau domain sendiri), tanpa garis miring di akhir.
SITE_URL = "https://dengaran.pages.dev"

SEO_MARKER = "<!-- seo:absolute-urls (canonical, og:url, og:image, JSON-LD) diisi scripts/build_public.py -->"
LANDING_LINKS_MARKER = "<!-- seo:landing-links diisi scripts/build_public.py -->"
CSS_TAG = '<link rel="stylesheet" href="styles.css" />'
JS_TAG = '<script defer src="app.js"></script>'
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
LANDING_OPEN_HINT = (
    "Pilih stasiun untuk membukanya di pemutar Dengaran, lalu tekan Putar. Urutannya dari stasiun "
    "yang paling sering diputar pendengar Radio Browser."
)

# kind "city": dicocokkan dengan nama dan kolom state stasiun (regex, awal kata).
# kind "genre": dicocokkan dengan tag persis. kind "all": semua stasiun.
LANDING_PAGES = [
    {"slug": "radio-online-indonesia", "kind": "all", "heading": "Radio Online Indonesia",
     "intro": "Radio online dan radio streaming dari seluruh Indonesia yang bisa didengar gratis di browser."},
    {"slug": "radio-online-jakarta", "kind": "city", "heading": "Radio Online Jakarta",
     "pattern": r"\bjakarta",
     "intro": "Stasiun radio Jakarta yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-bandung", "kind": "city", "heading": "Radio Online Bandung dan Jawa Barat",
     "pattern": r"\bbandung|\bjawa barat|\bwest java",
     "intro": "Stasiun radio dari Bandung dan kota lain di Jawa Barat yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-yogyakarta", "kind": "city", "heading": "Radio Online Yogyakarta",
     "pattern": r"\byogya|\bjogja|ꦗꦺꦴꦒ꧀ꦗꦏꦂꦠ",
     "intro": "Stasiun radio Yogyakarta yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-bali", "kind": "city", "heading": "Radio Online Bali",
     "pattern": r"\bbali\b|\bdenpasar",
     "intro": "Stasiun radio dari Bali yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-surabaya", "kind": "city", "heading": "Radio Online Surabaya",
     "pattern": r"\bsurabaya",
     "intro": "Stasiun radio Surabaya yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-online-semarang", "kind": "city", "heading": "Radio Online Semarang",
     "pattern": r"\bsemarang",
     "intro": "Stasiun radio Semarang yang siarannya bisa didengar langsung di browser."},
    {"slug": "radio-pop", "kind": "genre", "heading": "Radio Pop Online",
     "tags": {"pop", "pop music", "hits", "top 40", "contemporary hits radio"},
     "intro": "Radio streaming musik pop, top 40, dan lagu hits dari stasiun Indonesia."},
    {"slug": "radio-rock", "kind": "genre", "heading": "Radio Rock Online",
     "tags": {"rock", "pop rock", "alternative", "metal"},
     "intro": "Radio streaming rock, alternative, dan metal dari stasiun Indonesia."},
    {"slug": "radio-berita", "kind": "genre", "heading": "Radio Berita Online",
     "tags": {"news", "local news", "talk", "talk show radio"},
     "intro": "Radio berita dan talk show Indonesia: berita nasional, berita lokal, dan siaran bincang-bincang."},
    {"slug": "radio-daerah", "kind": "genre", "heading": "Radio Budaya dan Musik Daerah",
     "tags": {"sunda", "jawa", "javanese", "campursari", "local music", "culture"},
     "intro": "Radio dengan siaran budaya dan musik daerah: Sunda, Jawa, campursari, dan musik lokal lain."},
    {"slug": "radio-dangdut", "kind": "genre", "heading": "Radio Dangdut Online",
     "tags": {"dangdut", "koplo", "campursari"},
     "intro": "Radio streaming dangdut, dangdut koplo, dan campursari dari stasiun Indonesia."},
    {"slug": "radio-nostalgia", "kind": "genre", "heading": "Radio Nostalgia Online",
     "tags": {"70s", "80s", "90s", "oldies", "nostalgia", "classic hits"},
     "intro": "Radio yang memutar lagu lawas dari era 70-an, 80-an, dan 90-an."},
    {"slug": "radio-rohani", "kind": "genre", "heading": "Radio Rohani Online",
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

# Sesudah token ini, "/" berarti awal regex, bukan pembagian.
REGEX_PREFIX_CHARS = set("(,=:[!&|?{};+-*%<>~^")
REGEX_PREFIX_WORDS = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw"}


def minify_js(source):
    out = []
    i = 0
    n = len(source)
    pending_space = False
    pending_newline = False

    def last_significant():
        for chunk in reversed(out):
            stripped = chunk.rstrip()
            if stripped:
                return stripped
        return ""

    def regex_allowed():
        prev = last_significant()
        if not prev:
            return True
        if prev[-1] in REGEX_PREFIX_CHARS:
            return True
        word = re.search(r"[A-Za-z_$][\w$]*$", prev)
        return bool(word and word.group(0) in REGEX_PREFIX_WORDS)

    def flush_whitespace(next_char):
        nonlocal pending_space, pending_newline
        if out:
            prev = out[-1][-1] if out[-1] else ""
            both_words = bool(re.match(r"[\w$]", prev) and re.match(r"[\w$]", next_char))
            same_sign = prev in "+-" and next_char == prev
            # Baris baru boleh dibuang hanya di posisi yang tidak pernah memicu automatic
            # semicolon insertion: sesudah pembuka/operator, atau sebelum penutup/titik.
            # "/" tidak termasuk karena bisa akhir regex.
            newline_droppable = prev in "{[(,;:=+-*%&|?!<>" or next_char in "})],.;:?"
            if pending_newline and not newline_droppable:
                out.append("\n")
            elif (pending_newline or pending_space) and (both_words or same_sign):
                out.append(" ")
        pending_space = False
        pending_newline = False

    def read_string(start, quote):
        j = start + 1
        while j < n:
            c = source[j]
            if c == "\\":
                j += 2
                continue
            if c == quote:
                return j + 1
            j += 1
        raise ValueError(f"string tidak ditutup di posisi {start}")

    def read_template(start):
        j = start + 1
        while j < n:
            c = source[j]
            if c == "\\":
                j += 2
                continue
            if c == "`":
                return j + 1
            if c == "$" and j + 1 < n and source[j + 1] == "{":
                j = read_template_expression(j + 2)
                continue
            j += 1
        raise ValueError(f"template literal tidak ditutup di posisi {start}")

    def read_template_expression(start):
        depth = 1
        j = start
        while j < n:
            c = source[j]
            if c in "'\"":
                j = read_string(j, c)
                continue
            if c == "`":
                j = read_template(j)
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return j + 1
            j += 1
        raise ValueError(f"ekspresi ${{}} tidak ditutup di posisi {start}")

    def read_regex(start):
        j = start + 1
        in_class = False
        while j < n:
            c = source[j]
            if c == "\\":
                j += 2
                continue
            if c == "[":
                in_class = True
            elif c == "]":
                in_class = False
            elif c == "/" and not in_class:
                j += 1
                while j < n and re.match(r"[a-z]", source[j]):
                    j += 1
                return j
            elif c == "\n":
                raise ValueError(f"regex tidak ditutup di posisi {start}")
            j += 1
        raise ValueError(f"regex tidak ditutup di posisi {start}")

    while i < n:
        c = source[i]

        if c in " \t\r":
            pending_space = True
            i += 1
            continue
        if c == "\n":
            pending_newline = True
            i += 1
            continue
        if source.startswith("//", i):
            end = source.find("\n", i)
            i = n if end == -1 else end
            continue
        if source.startswith("/*", i):
            end = source.find("*/", i + 2)
            if end == -1:
                raise ValueError(f"komentar blok tidak ditutup di posisi {i}")
            i = end + 2
            pending_space = True
            continue

        flush_whitespace(c)

        if c in "'\"":
            end = read_string(i, c)
        elif c == "`":
            end = read_template(i)
        elif c == "/" and regex_allowed():
            end = read_regex(i)
        else:
            end = i + 1

        out.append(source[i:end])
        i = end

    text = "".join(out)
    # Baris kosong beruntun dirapatkan; spasi di sekitar baris baru dibuang.
    text = re.sub(r"[ \t]*\n[ \t\n]*", "\n", text)
    return text.strip() + "\n"


def minify_js_bun(path):
    """Minify dengan bun. Mengembalikan None kalau bun tidak ada di PATH.

    app.js tidak punya import, jadi bun hanya me-minify satu file tanpa node_modules. Format iife
    membungkus semua deklarasi top-level; aman karena index.html tidak punya handler inline.
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


def not_found_page(css_name):
    """Halaman 404. Tanpa 404.html, Cloudflare Pages menjawab semua path dengan index.html
    dan status 200, sehingga URL yang tidak ada terbaca sebagai duplikat beranda (soft 404)."""
    return f"""<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Halaman tidak ditemukan | Dengaran</title>
  <meta name="robots" content="noindex" />
  <meta name="theme-color" content="#0f1113" />
  <meta name="color-scheme" content="dark" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
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


def js_string_list(js_source, start_pattern):
    """Isi string dari array literal di app.js. Dipakai supaya daftar blokir hanya ditulis di satu
    tempat (src/app.js).

    Dibaca karakter per karakter, bukan dengan regex: komentar // boleh memuat "]" atau tanda kutip,
    dan string boleh memakai kutip tunggal atau ganda. Array yang tidak ditutup menghentikan build,
    karena daftar blokir yang terbaca kosong akan menampilkan stasiun yang seharusnya disembunyikan.
    """
    match = re.search(start_pattern + r"\s*\[", js_source)
    if match is None:
        fail(f"{start_pattern} tidak ditemukan di src/app.js")

    values = set()
    i = match.end()
    while i < len(js_source):
        char = js_source[i]
        if js_source.startswith("//", i):
            newline = js_source.find("\n", i)
            i = len(js_source) if newline == -1 else newline
        elif js_source.startswith("/*", i):
            end = js_source.find("*/", i + 2)
            if end == -1:
                break
            i = end + 2
        elif char in "'\"":
            end = js_source.find(char, i + 1)
            if end == -1:
                break
            values.add(js_source[i + 1:end].lower())
            i = end + 1
        elif char == "]":
            return values
        else:
            i += 1
    fail(f"Array sesudah {start_pattern} di src/app.js tidak bisa dibaca sampai tanda ] penutup.")


def station_tags(station):
    return [tag.strip().lower() for tag in (station.get("tags") or "").split(",") if tag.strip()]


def fetch_landing_stations(js_source):
    """Stasiun untuk halaman daftar radio. Build berhenti kalau semua server API gagal: deploy
    sebelumnya di Cloudflare Pages tetap dipakai, daripada halaman ini hilang dari situs."""
    blocked_ids = js_string_list(js_source, r"const BLOCKED_STATION_IDS =")
    blocked_tags = js_string_list(js_source, r"const BLOCKED_TAGS = new Set\(")

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
        # Radio Browser memuat banyak entri ganda bernama sama: yang kliknya terbanyak dipakai.
        # Kalau entri itu tidak mengisi state, state dari entri ganda dipakai, supaya stasiunnya
        # tetap masuk halaman kotanya.
        key = name.lower()
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
        pages.append({**page, "stations": matched[:LANDING_MAX_STATIONS], "total": len(matched)})
    return pages


def station_meta(station):
    """Kota, tiga tag pertama, codec, dan bitrate, dipisah titik tengah."""
    parts = []
    state = (station.get("state") or "").strip()
    if state:
        parts.append(state)
    # Tag di Radio Browser bebas diisi; tag yang sangat panjang biasanya bukan genre.
    tags = [tag for tag in station_tags(station) if len(tag) <= 24][:3]
    if tags:
        parts.append(", ".join(tags))
    codec = (station.get("codec") or "").strip().upper()
    quality = " ".join(
        part for part in [codec if codec and codec != "UNKNOWN" else "",
                          f"{station['bitrate']} kbps" if station.get("bitrate") else ""] if part
    )
    if quality:
        parts.append(quality)
    return " · ".join(parts)


def landing_nav_html(pages, current_slug=None, heading_tag="h2"):
    """Link antar halaman daftar radio, dikelompokkan kota dan genre."""
    def links(kinds):
        # Mengembalikan "" kalau semua halaman kelompok ini dilewati karena stasiunnya terlalu sedikit.
        items = []
        for page in pages:
            if page["kind"] not in kinds:
                continue
            label = html_lib.escape(page["heading"])
            if page["slug"] == current_slug:
                items.append(f'<li><a href="/{page["slug"]}" aria-current="page">{label}</a></li>')
            else:
                items.append(f'<li><a href="/{page["slug"]}">{label}</a></li>')
        return "\n".join(items)

    groups = [("Radio online per kota", {"all", "city"}), ("Radio streaming per genre", {"genre"})]
    parts = []
    for title, kinds in groups:
        items = links(kinds)
        if items:
            parts.append(f'<{heading_tag}>{title}</{heading_tag}>\n<ul class="landing-links">\n{items}\n</ul>')
    return "\n".join(parts)


def landing_page_html(page, pages, css_name, built_on):
    page_url = f"{SITE_URL}/{page['slug']}"
    heading = html_lib.escape(page["heading"])
    title = f"{page['heading']}: Dengar Gratis di Browser | Dengaran"
    shown = len(page["stations"])
    description = (
        f"Dengar {page['heading']} gratis di browser: {shown} stasiun, "
        "tanpa iklan, tanpa cookie, tanpa daftar akun."
    )
    if page["total"] > shown:
        count_text = f"{shown} dari {page['total']} stasiun yang paling sering diputar."
    else:
        count_text = f"{shown} stasiun."
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
  <meta name="theme-color" content="#0f1113" />
  <meta name="color-scheme" content="dark" />
  <link rel="canonical" href="{page_url}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon-48.png" sizes="48x48" type="image/png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Dengaran" />
  <meta property="og:locale" content="id_ID" />
  <meta property="og:title" content="{html_lib.escape(title)}" />
  <meta property="og:description" content="{html_lib.escape(description)}" />
  <meta property="og:url" content="{page_url}" />
  <meta property="og:image" content="{SITE_URL}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">{json.dumps(json_ld, ensure_ascii=False)}</script>
  <link rel="stylesheet" href="/{css_name}" />{analytics}
</head>
<body class="landing-body">
  <header class="landing-header">
    <a class="landing-brand" href="/">Dengaran</a>
    <a class="landing-open" href="/">Buka pemutar</a>
  </header>

  <main class="landing">
    <nav class="landing-breadcrumb" aria-label="Lokasi halaman">
      <a href="/">Dengaran</a> <span aria-hidden="true">/</span> <span>{heading}</span>
    </nav>
    <h1>{heading}</h1>
    <p class="landing-intro">{html_lib.escape(page["intro"])} {LANDING_OPEN_HINT}</p>
    <p class="landing-count">{count_text} Data dari Radio Browser, diperbarui {updated}.</p>

    <ol class="landing-list">
{chr(10).join(rows)}
    </ol>

    <nav class="landing-nav" aria-label="Daftar radio lain">
{landing_nav_html(pages, page["slug"])}
    </nav>
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
{landing_nav_html(pages, heading_tag="h3")}
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

    html = (SRC_DIR / "index.html").read_text(encoding="utf-8")
    css_source = (SRC_DIR / "styles.css").read_text(encoding="utf-8")
    js_source = (SRC_DIR / "app.js").read_text(encoding="utf-8")

    for marker, label in [
        (SEO_MARKER, "penanda SEO"),
        (LANDING_LINKS_MARKER, "penanda link halaman daftar radio"),
        (CSS_TAG, "tag CSS"),
        (JS_TAG, "tag JS"),
    ]:
        if marker not in html:
            fail(f"{label} tidak ditemukan di src/index.html: {marker}")

    css = minify_css(css_source)
    try:
        js = minify_js_bun(SRC_DIR / "app.js")
        js_minifier = "bun"
        # bun tidak ada di PATH: pakai minifier Python, hasilnya lebih besar tapi tetap benar.
        if js is None:
            js = minify_js(js_source)
            js_minifier = "Python"
    except ValueError as error:
        fail(f"Minify JS gagal: {error}")

    built_on = date.today()
    landing_pages = landing_pages_with_stations(fetch_landing_stations(js_source))

    css_name = f"styles.{content_hash(css)}.min.css"
    js_name = f"app.{content_hash(js)}.min.js"

    html = html.replace(SEO_MARKER, seo_tags(html))
    html = html.replace(LANDING_LINKS_MARKER, landing_links_section(landing_pages))
    html = html.replace(CSS_TAG, f'<link rel="stylesheet" href="{css_name}" />')
    js_tags = f'<script defer src="{js_name}"></script>'
    if CF_ANALYTICS_TOKEN:
        js_tags += "\n  " + analytics_tag()
    html = html.replace(JS_TAG, js_tags)

    # Hapus hasil build lama supaya file CSS/JS dengan hash lama tidak ikut ter-upload.
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir()

    (OUTPUT_DIR / "index.html").write_text(html, encoding="utf-8")
    (OUTPUT_DIR / "404.html").write_text(not_found_page(css_name), encoding="utf-8")
    (OUTPUT_DIR / css_name).write_text(css, encoding="utf-8")
    # <slug>.html dilayani Cloudflare Pages di /<slug>, tanpa ekstensi.
    for page in landing_pages:
        (OUTPUT_DIR / f"{page['slug']}.html").write_text(
            landing_page_html(page, landing_pages, css_name, built_on), encoding="utf-8"
        )
    (OUTPUT_DIR / js_name).write_text(js, encoding="utf-8")

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
    print(f"  {paint('public/' + js_name, '36')}  {size(js_source)} -> {js_size} byte  {saved(size(js_source), js_size)}, minify {js_minifier}")
    print(f"  {paint('public/', '36')}index.html, 404.html, _headers, aset, robots.txt, sitemap.xml, third-party-notices.txt")
    print(f"  {paint('public/<slug>.html', '36')}  {len(landing_pages)} halaman daftar radio: "
          + ", ".join(f"{page['slug']} ({page['total']})" for page in landing_pages))
    if CF_ANALYTICS_TOKEN:
        print("  Cloudflare Web Analytics: " + paint("disisipkan", "32"))
    else:
        print("  Cloudflare Web Analytics: " + paint("tidak disisipkan, CF_ANALYTICS_TOKEN kosong", "33"))

if __name__ == "__main__":
    main()
