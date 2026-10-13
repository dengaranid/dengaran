# Dengaran

Dengar radio hari ini.

Dengaran adalah aplikasi web untuk mencari dan memutar stasiun radio dari Indonesia dan negara lain langsung di browser. Data stasiun diambil dari [Radio Browser](https://www.radio-browser.info). Gratis, tanpa iklan, tanpa daftar akun, dan tanpa cookie. Jumlah kunjungan dihitung dengan Cloudflare Web Analytics.

Aplikasinya ditulis dengan HTML, CSS, dan JavaScript biasa. Tidak ada framework, tidak ada `npm install`. Script build butuh Python 3 bawaan, dan memakai [Bun](https://bun.sh) untuk minify JS kalau tersedia.

## Fitur

- Cari stasiun berdasarkan nama, saring per negara dan genre, lalu urutkan dari yang terpopuler, paling disukai, nama, atau bitrate.
- Negara awal ditebak dari zona waktu dan bahasa browser. Kalau negara itu tidak punya stasiun, daftar kembali ke Indonesia.
- Favorit dan Baru diputar (8 stasiun terakhir) disimpan di `localStorage` browser. Tidak ada data pengguna yang dikirim ke server.
- Sleep Timer 15, 30, 45, atau 60 menit, dengan volume turun bertahap 5 detik sebelum siaran berhenti.
- Volume naik bertahap selama 3 detik setiap stasiun mulai diputar.
- Pintasan keyboard: `/` cari, `Spasi` putar atau stop, `N` dan `P` pindah stasiun, `M` bisukan.
- Stream yang terputus disambung ulang otomatis sampai lima kali. Kalau perangkat offline, percobaan menunggu jaringan tersambung lagi.
- Playlist `.pls` dan `.m3u`, juga stasiun HLS (`.m3u8`) lewat [hls.js](https://github.com/video-dev/hls.js) di browser yang tidak memutar HLS sendiri. hls.js hanya diunduh saat stasiun HLS diputar.
- Media Session: putar, stop, dan pindah stasiun dari lock screen dan notifikasi perangkat.
- Di halaman HTTPS, pencarian hanya menampilkan stasiun HTTPS. Stasiun HTTP yang sudah ada di Favorit atau Baru diputar diberi label `HTTP` dan dicoba diputar lewat HTTPS.
- Halaman daftar radio per kota dan genre, misalnya `/radio-online-jakarta` dan `/radio-dangdut`.

Cara kerja pemutaran, batas waktu, dan sambung ulang dijelaskan di [docs/streaming.md](docs/streaming.md).

## Struktur folder

```
src/                     sumber aplikasi (index.html, styles.css, app.js)
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

## Menjalankan di komputer sendiri

```bash
bin/dev              # sajikan src/ di http://localhost:8080
bin/dev --public     # build ke public/ lalu sajikan versi minify
bin/dev 3000         # port lain, atau PORT=3000 bin/dev
```

Halaman daftar radio hanya ada di hasil build, jadi buka dengan `bin/dev --public`. Server lokal berbeda dengan produksi dalam dua hal. Karena localhost bukan HTTPS, stasiun HTTP ikut tampil di pencarian. `public/_headers` juga tidak dibaca, jadi perubahan CSP dan cache baru bisa dicek sesudah deploy.

Output script berwarna di terminal. Isi `NO_COLOR=1` untuk menonaktifkannya.

## Build

```bash
bin/build
```

`bin/build` menjalankan `python3 scripts/build_public.py`, yang mengisi `public/` dengan:

- CSS dan JS versi minify, dengan hash isi di nama file (`styles.<hash>.min.css`, `app.<hash>.min.js`). JS di-minify dengan Bun kalau ada. Tanpa Bun, minifier Python dipakai, dan hasilnya sekitar 2,5 KB lebih besar sesudah brotli.
- `index.html` dengan tag SEO berisi URL absolut dari `SITE_URL`, plus script Cloudflare Web Analytics kalau `CF_ANALYTICS_TOKEN` terisi.
- halaman daftar radio, `sitemap.xml`, `robots.txt`, `404.html`, aset dari `assets/`, salinan `src/vendor/`, dan `third-party-notices.txt`.
- `_headers` berisi Content Security Policy, header keamanan lain, dan aturan cache.

Build butuh koneksi internet untuk mengambil daftar stasiun. Kalau semua server Radio Browser gagal dijawab, build berhenti dengan pesan error dan deploy sebelumnya tetap dipakai.

## Halaman daftar radio

Halaman per kota dan genre didaftarkan di `LANDING_PAGES` di `scripts/build_public.py`, lalu dilayani tanpa ekstensi, misalnya `/radio-online-jakarta`.

- Isinya stasiun Indonesia HTTPS dari Radio Browser, diurutkan dari jumlah klik terbanyak, maksimal 100 per halaman. Halaman dengan kurang dari 8 stasiun tidak ditulis.
- Entri ganda digabung kalau kata di namanya sama, tanpa melihat urutan dan huruf besar (`Jak FM 101` dan `JAK 101 FM`).
- Stasiun di `BLOCKED_STATION_IDS` dan `BLOCKED_TAGS` di `src/app.js` ikut disaring.
- Paragraf ringkasan di tiap halaman dihitung dari datanya: jumlah stasiun, yang paling sering diputar, kota atau genre terbanyak, dan bitrate.

Tiap stasiun menautkan ke `/?station=<stationuuid>`. `restoreLinkedStation` di `src/app.js` menyiapkan stasiun itu di player tanpa memutarnya.

Data halaman ini diambil ulang di setiap build. Supaya tidak menunggu push, `.github/workflows/rebuild.yml` memicu build setiap Senin 06:17 WIB lewat Deploy Hook Cloudflare Pages. URL hook-nya disimpan di secret GitHub `CF_PAGES_DEPLOY_HOOK`. Workflow ini juga bisa dijalankan manual dari tab Actions.

## Deploy

Situs di-deploy oleh Cloudflare Pages yang terhubung ke repo ini, dengan build command `python3 scripts/build_public.py` dan output `public`.

- Push ke `main` di-deploy ke produksi, `https://dengaran.id`.
- Push ke `preview` di-deploy ke `https://preview.dengaran.pages.dev`, untuk mengecek perubahan sebelum masuk produksi.
- Push yang hanya mengubah dokumentasi atau `bin/` tidak memicu build.

## Menyembunyikan stasiun

Pemilik stasiun atau pemegang hak cipta bisa meminta stasiunnya tidak ditampilkan. Tambahkan `stationuuid` stasiun itu ke `BLOCKED_STATION_IDS` di `src/app.js`. Cara mencari UUID-nya ada di komentar di atas konstanta tersebut.

## Kontak

dengaranid@gmail.com

## Sumber data dan atribusi

- Data stasiun: [Radio Browser](https://www.radio-browser.info), proyek komunitas yang gratis dan open source. Siaran dan nama stasiun adalah milik masing-masing stasiun.
- Pemutar HLS: [hls.js](https://github.com/video-dev/hls.js), lisensi Apache-2.0. Teks lisensinya juga ada di [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Ikon: [Lucide](https://lucide.dev), lisensi ISC. Sebagian ikon berasal dari Feather (lisensi MIT). Teks lengkap kedua lisensi ada di [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Logo GitHub di footer: merek dagang GitHub, Inc., dari paket logo resmi GitHub, dipakai hanya sebagai link ke repo ini.
