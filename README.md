# Dengaran

Dengar radio hari ini.

Dengaran adalah aplikasi web untuk mencari dan memutar stasiun radio dari Indonesia dan negara lain langsung di browser. Data stasiun diambil dari [Radio Browser](https://www.radio-browser.info). Gratis, tanpa iklan, tanpa daftar akun, dan tanpa cookie. Jumlah kunjungan dihitung dengan Cloudflare Web Analytics.

Aplikasinya ditulis dengan HTML, CSS, dan JavaScript biasa. Tidak ada framework, tidak ada `npm install`. Script build butuh Python 3 bawaan, dan memakai [Bun](https://bun.sh) untuk minify JS kalau tersedia.

## Fitur

- Cari stasiun berdasarkan nama, lalu saring per negara dan genre. Hasilnya bisa diurutkan dari yang terpopuler, paling disukai, nama, atau bitrate.
- Negara awal ditebak dari browser: Indonesia kalau zona waktunya WIB, WITA, atau WIT, kalau tidak dari bahasa browser. Kalau negara itu tidak punya stasiun, daftar kembali ke Indonesia.
- Favorit dan daftar Baru diputar (8 stasiun terakhir) disimpan di `localStorage` browser, jadi tidak ada data pengguna yang dikirim ke server.
- Pengatur waktu tidur (Sleep Timer): hentikan siaran otomatis sesudah 15, 30, 45, atau 60 menit, dengan penurunan volume bertahap (fade out) 5 detik sebelum waktu habis.
- Volume naik bertahap selama 3 detik tiap kali stasiun mulai diputar, supaya suara tidak langsung keras kalau volume sistem masih tinggi.
- Pintasan keyboard: `/` cari, `Spasi` putar atau stop, `N` dan `P` pindah stasiun, `M` bisukan.
- Stream yang terputus saat sedang diputar disambung ulang otomatis sampai lima kali, dengan jeda 1, 2, 4, 8, lalu 15 detik. Selama menyambung ulang, sisa audio di buffer tetap diputar. Kalau perangkat offline, percobaan ditunda sampai jaringan tersambung lagi.
- Mendukung playlist `.pls` dan `.m3u` audio biasa yang diekstrak langsung ke URL stream siarannya.
- Stasiun HLS (`.m3u8`) diputar lewat [hls.js](https://github.com/video-dev/hls.js) di browser yang tidak memutar HLS sendiri, misalnya Firefox. hls.js memilih bitrate otomatis kalau stasiunnya menyediakan beberapa bitrate, dan menargetkan latensi 3 segmen di belakang siaran live, dengan batas 6 segmen. File hls.js hanya diunduh saat stasiun HLS diputar.
- Integrasi Media Session: kontrol putar, stop, stasiun sebelumnya/berikutnya, serta durasi mendengar di lock screen dan notifikasi perangkat.
- Di halaman HTTPS, pencarian hanya menampilkan stasiun dengan stream HTTPS. Stasiun HTTP lama yang masih ada di Favorit atau Baru diputar diberi label `HTTP`. Saat diputar, stream-nya dicoba lewat HTTPS di host dan port yang sama, dan gagal kalau versi HTTPS tidak bisa diputar.

Cara kerja pemutaran, batas waktu, dan sambung ulang dijelaskan di [docs/streaming.md](docs/streaming.md).

## Struktur folder

```
src/                     sumber aplikasi (index.html, styles.css, app.js)
src/vendor/              library pihak ketiga yang dimuat saat dibutuhkan (hls.js)
assets/                  favicon, apple-touch-icon, gambar preview og-image
scripts/build_public.py  script build ke public/
docs/                    dokumentasi teknis, tidak ikut ke public/
bin/dev                  server preview lokal
bin/build                build ke public/
public/                  hasil build, tidak masuk repo
THIRD_PARTY_NOTICES.md   atribusi dan lisensi pihak ketiga, disalin ke public/ saat build
```

## Menjalankan di komputer sendiri

```bash
bin/dev              # sajikan src/ di http://localhost:8080
bin/dev --public     # build ke public/ lalu sajikan versi minify
bin/dev 3000         # port lain, atau PORT=3000 bin/dev
```

Script ini menjalankan `python3 -m http.server`, jadi tidak perlu dependensi lain. Karena localhost bukan HTTPS, stasiun HTTP juga ikut tampil di hasil pencarian. Server ini tidak membaca `public/_headers`, jadi CSP dan aturan cache baru bisa dicek sesudah deploy.

Output `bin/dev`, `bin/build`, dan `scripts/build_public.py` berwarna kalau dijalankan di terminal. Warna tidak dipakai saat output di-pipe atau ditulis ke log, termasuk log build Cloudflare Pages. Untuk menonaktifkannya di terminal, isi `NO_COLOR=1`.

## Build

```bash
bin/build
```

`bin/build` menjalankan `python3 scripts/build_public.py`. Script ini mengisi folder `public/` dengan:

- `styles.<hash>.min.css` dan `app.<hash>.min.js`, versi minify dengan hash isi di nama file supaya browser selalu mengambil versi terbaru setelah deploy. CSS di-minify dengan Python. JS di-minify dengan `bun build --minify` kalau `bun` ada di PATH; kalau tidak, dengan minifier Python yang tidak memperpendek nama variabel, jadi hasilnya sekitar 2,5 KB lebih besar sesudah brotli. Baris output build menyebut minifier mana yang dipakai.
- `index.html` yang sudah merujuk ke file minify, plus tag SEO dengan URL absolut
- salinan `src/vendor/` apa adanya
- script Cloudflare Web Analytics di `index.html`, kalau `CF_ANALYTICS_TOKEN` di `scripts/build_public.py` terisi. Token ini tampil di HTML publik, jadi bukan secret. Kalau kosong, script tidak disisipkan dan host-nya tidak masuk CSP.
- ikon dan gambar preview dari `assets/`, `robots.txt`, `sitemap.xml`, dan `404.html`
- halaman daftar radio per kota dan genre (`radio-online-jakarta.html`, `radio-dangdut.html`, dan seterusnya), dilayani Cloudflare Pages tanpa ekstensi di `/radio-online-jakarta`. Daftarnya di `LANDING_PAGES` di `scripts/build_public.py`. Isinya stasiun Indonesia HTTPS dari Radio Browser, diambil saat build dan diurutkan dari jumlah klik terbanyak, maksimal 100 per halaman. Halaman dengan kurang dari 8 stasiun tidak ditulis. Link ke halaman-halaman ini ada di `sitemap.xml` dan di dialog Tentang
- `third-party-notices.txt`, salinan `THIRD_PARTY_NOTICES.md`
- `_headers` untuk Cloudflare Pages: Content Security Policy, header keamanan lain, dan aturan cache

Build membutuhkan koneksi internet untuk mengambil daftar stasiun. Kalau semua server API Radio Browser gagal dijawab, build berhenti dengan pesan error, dan Cloudflare Pages tetap memakai deploy sebelumnya. Stasiun di `BLOCKED_STATION_IDS` dan `BLOCKED_TAGS` di `src/app.js` ikut disaring; script membaca kedua daftar itu langsung dari `src/app.js`. Daftar stasiun di halaman ini hanya diperbarui saat ada build baru.

Tiap stasiun di halaman daftar radio menautkan ke `/?station=<stationuuid>`. `restoreLinkedStation` di `src/app.js` mengambil stasiun itu dari API, menyiapkannya di player tanpa memutar, lalu menghapus parameter dari alamat.

`SITE_URL` di bagian atas `scripts/build_public.py` berisi alamat produksi (`https://dengaran.pages.dev`) dan dipakai untuk URL absolut di tag SEO, `robots.txt`, dan `sitemap.xml`. Ubah nilainya kalau situs pindah ke domain lain.

## Deploy ke Cloudflare Pages

Ada dua cara, dan pilihannya harus ditentukan saat membuat project, karena project Upload assets tidak bisa diubah ke integrasi Git belakangan.

1. Upload assets: jalankan build, lalu upload isi folder `public/` lewat dashboard Cloudflare setiap ada perubahan.
2. Integrasi Git: hubungkan repo ini ke Cloudflare Pages dengan build command `python3 scripts/build_public.py` dan build output directory `public`. Build image Cloudflare Pages sudah berisi Bun. Isi environment variable `BUN_VERSION` dengan versi yang sama dengan Bun di komputer sendiri (`bun --version`), supaya hasil minify di lokal dan di Cloudflare sama.

Project Dengaran memakai cara kedua, dengan pengaturan berikut:

- Push ke `main` di-deploy ke produksi, `https://dengaran.pages.dev`.
- Push ke `preview` di-deploy ke `https://preview.dengaran.pages.dev`, untuk mengecek perubahan sebelum masuk produksi. Branch lain tidak di-deploy (Preview branch: Custom branches, include `preview`).
- Build watch paths berisi `src/*`, `assets/*`, `scripts/*`, dan `THIRD_PARTY_NOTICES.md`. Push yang hanya mengubah file lain, misalnya `README.md`, `docs/`, atau `bin/`, tidak memicu build. Push berisi 20 commit atau lebih tetap di-build.

Plan Free Cloudflare Pages memberi 500 build per bulan.

## Menyembunyikan stasiun

Pemilik stasiun atau pemegang hak cipta bisa meminta stasiunnya tidak ditampilkan. Tambahkan `stationuuid` stasiun itu ke `BLOCKED_STATION_IDS` di `src/app.js`. Cara mencari UUID-nya ada di komentar di atas konstanta tersebut.

## Kontak

dengaranid@gmail.com

## Sumber data dan atribusi

- Data stasiun: [Radio Browser](https://www.radio-browser.info), proyek komunitas yang gratis dan open source. Siaran dan nama stasiun adalah milik masing-masing stasiun.
- Pemutar HLS: [hls.js](https://github.com/video-dev/hls.js), lisensi Apache-2.0. Teks lisensinya juga ada di [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Ikon: [Lucide](https://lucide.dev), lisensi ISC. Sebagian ikon berasal dari Feather (lisensi MIT). Teks lengkap kedua lisensi ada di [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Logo GitHub di footer: merek dagang GitHub, Inc., dari paket logo resmi GitHub, dipakai hanya sebagai link ke repo ini.
