#!/usr/bin/env python3
"""Siapkan folder public/ untuk Cloudflare Pages dari sumber di src/.

- Minify src/styles.css dan src/app.js, lalu tulis dengan hash isi di nama file
  (styles.<hash>.min.css, app.<hash>.min.js) supaya browser mengambil versi baru
  setiap deploy.
- Salin src/index.html ke public/index.html, ganti referensi CSS/JS ke file hasil
  minify, dan sisipkan tag SEO berisi URL absolut.
- Salin ikon dan gambar preview dari assets/, lalu tulis robots.txt dan sitemap.xml.
- Salin THIRD_PARTY_NOTICES.md ke public/third-party-notices.txt.
- Sisipkan script Cloudflare Web Analytics kalau CF_ANALYTICS_TOKEN diisi.
- Tulis public/_headers berisi header keamanan dan cache.

Minify JS memakai `bun build --minify` kalau bun ada di PATH: nama variabel ikut
diperpendek, hasilnya sekitar 19% lebih kecil sesudah brotli. Kalau bun tidak ada, JS dan CSS
di-minify dengan Python bawaan: komentar, indentasi, dan spasi berlebih dibuang; isi string,
template literal, dan regex tidak diubah; nama variabel tidak diperpendek.

Jalankan dari root project:  python3 scripts/build_public.py
"""

import hashlib
import json
import re
import shutil
import sys
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "src"
ASSETS_DIR = ROOT / "assets"
OUTPUT_DIR = ROOT / "public"

# Placeholder: ganti dengan alamat Cloudflare Pages (atau domain sendiri), tanpa garis miring di akhir.
SITE_URL = "https://dengaran.pages.dev"

SEO_MARKER = "<!-- seo:absolute-urls (canonical, og:url, og:image, JSON-LD) diisi scripts/build_public.py -->"
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
            sys.exit(f"File sumber tidak ditemukan: {SRC_DIR / name}")

    html = (SRC_DIR / "index.html").read_text(encoding="utf-8")
    css_source = (SRC_DIR / "styles.css").read_text(encoding="utf-8")
    js_source = (SRC_DIR / "app.js").read_text(encoding="utf-8")

    for marker, label in [(SEO_MARKER, "penanda SEO"), (CSS_TAG, "tag CSS"), (JS_TAG, "tag JS")]:
        if marker not in html:
            sys.exit(f"{label} tidak ditemukan di src/index.html: {marker}")

    css = minify_css(css_source)
    try:
        js = minify_js_bun(SRC_DIR / "app.js")
        js_minifier = "bun"
        # bun tidak ada di PATH: pakai minifier Python, hasilnya lebih besar tapi tetap benar.
        if js is None:
            js = minify_js(js_source)
            js_minifier = "Python"
    except ValueError as error:
        sys.exit(f"Minify JS gagal: {error}")

    css_name = f"styles.{content_hash(css)}.min.css"
    js_name = f"app.{content_hash(js)}.min.js"

    html = html.replace(SEO_MARKER, seo_tags(html))
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
    (OUTPUT_DIR / js_name).write_text(js, encoding="utf-8")

    for name in ASSET_FILES:
        source = ASSETS_DIR / name
        if not source.exists():
            sys.exit(f"Aset tidak ditemukan: {source}")
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
        "</urlset>\n",
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

    print(f"public/{css_name}  {size(css_source)} -> {size(css)} byte")
    print(f"public/{js_name}  {size(js_source)} -> {size(js)} byte, minify {js_minifier}")
    print(f"public/index.html, 404.html, _headers, aset, robots.txt, sitemap.xml, third-party-notices.txt untuk {SITE_URL}")
    if CF_ANALYTICS_TOKEN:
        print("Cloudflare Web Analytics: disisipkan")
    else:
        print("Cloudflare Web Analytics: tidak disisipkan, CF_ANALYTICS_TOKEN kosong")


if __name__ == "__main__":
    main()
