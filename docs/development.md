# Pengembangan

Catatan untuk mengubah kode Dengaran: struktur folder, server lokal, build, halaman daftar radio, dan deploy. Cara kerja pemutaran ada di [streaming.md](streaming.md).

## Struktur folder

```
src/                     sumber aplikasi (index.html, styles.css, app.js)
src/blocklist.json       stasiun dan tag yang disembunyikan, dibaca app.js dan build
src/vendor/              library pihak ketiga yang dimuat saat dibutuhkan (hls.js)
assets/                  favicon, apple-touch-icon, gambar preview og-image
scripts/build_public.py  script build ke public/
scripts/dev_server.py    server lokal untuk bin/dev
docs/                    dokumentasi teknis, tidak ikut ke public/
bin/dev                  server preview lokal
bin/build                build ke public/
.github/workflows/       build ulang mingguan
public/                  hasil build, tidak masuk repo
THIRD_PARTY_NOTICES.md   atribusi dan lisensi pihak ketiga, disalin ke public/ saat build
```

## Server lokal

```bash
bin/dev              # sajikan src/ di http://localhost:8080
bin/dev --public     # build ke public/ lalu sajikan versi minify
bin/dev 3000         # port lain, atau PORT=3000 bin/dev
```

Halaman daftar radio hanya ada di hasil build, jadi buka dengan `bin/dev --public`. Di `src/`, `app.js` dimuat sebagai ES module yang meng-import `blocklist.json`, jadi `bin/dev` tanpa `--public` butuh browser yang mendukung import JSON (Chrome 123, Safari 17.2, Firefox 138, atau versi sesudahnya). Hasil build tidak memakai module: bun memasukkan isi JSON ke satu file `app.<hash>.min.js`. Server lokal berbeda dengan produksi dalam dua hal. Karena localhost bukan HTTPS, stasiun HTTP ikut tampil di pencarian. `public/_headers` juga tidak dibaca, jadi perubahan CSP dan cache baru bisa dicek sesudah deploy.

Output script berwarna di terminal. Isi `NO_COLOR=1` untuk menonaktifkannya.

## Build

`bin/build` menjalankan `python3 scripts/build_public.py`, yang mengisi `public/` dengan:

- CSS dan JS versi minify, dengan hash isi di nama file (`styles.<hash>.min.css`, `app.<hash>.min.js`). JS di-minify dengan Bun. Kalau Bun tidak ada di PATH, `app.js` disalin tanpa minify sebagai ES module bersama `blocklist.json`, dan build menulis peringatan. Cloudflare Pages memasang Bun lewat variabel `BUN_VERSION`.
- `index.html` dengan tag SEO berisi URL absolut dari `SITE_URL`, plus script Cloudflare Web Analytics kalau `CF_ANALYTICS_TOKEN` terisi.
- halaman daftar radio dan `404.html` dengan tag `<head>` bersama (warna tema, ikon, `og:site_name`). Tag ini ditulis sekali di `src/index.html`, di antara penanda `head:shared` dan `/head:shared`, lalu disalin oleh build.
- `sitemap.xml`, `robots.txt`, aset dari `assets/`, salinan `src/vendor/`, dan `third-party-notices.txt`.
- `_headers` berisi Content Security Policy, header keamanan lain, dan aturan cache.

Build butuh koneksi internet untuk mengambil daftar stasiun. Kalau semua server Radio Browser gagal dijawab, build berhenti dengan pesan error dan deploy sebelumnya tetap dipakai.

## Halaman daftar radio

Halaman per kota dan genre didaftarkan di `LANDING_PAGES` di `scripts/build_public.py`, lalu dilayani tanpa ekstensi, misalnya `/radio-online-jakarta`.

- Isinya stasiun Indonesia HTTPS dari Radio Browser, diurutkan dari jumlah klik terbanyak, maksimal 100 per halaman. Halaman dengan kurang dari 8 stasiun tidak ditulis.
- Entri ganda digabung kalau kata di namanya sama, tanpa melihat urutan dan huruf besar (`Jak FM 101` dan `JAK 101 FM`).
- Stasiun dan tag di `src/blocklist.json` ikut disaring.
- Paragraf ringkasan di tiap halaman dihitung dari datanya: jumlah stasiun, yang paling sering diputar, kota atau genre terbanyak, dan bitrate.

Tiap stasiun menautkan ke `/?station=<stationuuid>`. `restoreLinkedStation` di `src/app.js` menyiapkan stasiun itu di player tanpa memutarnya.

Data halaman ini diambil ulang di setiap build. Supaya tidak menunggu push, `.github/workflows/rebuild.yml` memicu build setiap Senin 06:17 WIB lewat Deploy Hook Cloudflare Pages. URL hook-nya disimpan di secret GitHub `CF_PAGES_DEPLOY_HOOK`. Workflow ini juga bisa dijalankan manual dari tab Actions.

## Deploy

Situs di-deploy oleh Cloudflare Pages yang terhubung ke repo ini, dengan build command `python3 scripts/build_public.py` dan output `public`.

- Push ke `main` di-deploy ke produksi, `https://dengaran.id`. Branch lain tidak di-deploy.
- Push yang hanya mengubah dokumentasi atau `bin/` tidak memicu build.

## Menyembunyikan stasiun

Tambahkan satu objek ke `stations` di `src/blocklist.json`, dengan `id` berisi `stationuuid` dari Radio Browser. `name`, `date`, dan `reason` tidak dibaca kode, hanya catatan. Cara mencari UUID-nya ada di komentar di atas `blockedStationIds` di `src/app.js`. Stasiun itu hilang dari app dan dari halaman daftar radio di build berikutnya. Isi file yang tidak sesuai bentuknya menghentikan build.

Stasiun dengan salah satu tag di `tags` juga disembunyikan. Tag dicocokkan persis, bukan potongan kata.
