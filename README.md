# Dengaran

Dengar radio hari ini.

Dengaran adalah aplikasi web untuk mencari dan memutar stasiun radio dari Indonesia dan negara lain langsung di browser. Data stasiun diambil dari [Radio Browser](https://www.radio-browser.info). Gratis, tanpa iklan, tanpa daftar akun, dan tanpa cookie. Jumlah kunjungan dihitung dengan Cloudflare Web Analytics.

Aplikasinya ditulis dengan HTML, CSS, dan JavaScript biasa. Tidak ada framework, tidak ada `npm install`. Script build hanya butuh Python 3 bawaan.

## Fitur

- Cari stasiun berdasarkan nama, lalu saring per negara dan genre. Hasilnya bisa diurutkan dari yang terpopuler, paling disukai, nama, atau bitrate.
- Favorit dan daftar Baru diputar (8 stasiun terakhir) disimpan di `localStorage` browser, jadi tidak ada data pengguna yang dikirim ke server.
- Pintasan keyboard: `/` cari, `Spasi` putar atau stop, `N` dan `P` pindah stasiun, `M` bisukan.
- Stream yang putus saat sedang diputar disambung ulang otomatis sampai lima kali, dengan jeda 1, 2, 4, 8, lalu 15 detik. Selama perangkat offline, percobaan ditahan sampai jaringan tersambung lagi.
- Stasiun HLS (`.m3u8`) diputar lewat [hls.js](https://github.com/video-dev/hls.js) di browser yang tidak memutar HLS sendiri, misalnya Firefox. hls.js memilih bitrate otomatis kalau stasiunnya menyediakan beberapa bitrate, dan menjaga latensi ke siaran live di 3 sampai 6 segmen. File hls.js hanya diunduh saat stasiun HLS diputar.
- Di halaman HTTPS, pencarian hanya menampilkan stasiun dengan stream HTTPS. Stasiun HTTP lama yang masih ada di Favorit atau Baru diputar diberi label `HTTP`, karena browser bisa memblokirnya.

## Struktur folder

```
src/                     sumber aplikasi (index.html, styles.css, app.js)
src/vendor/              library pihak ketiga yang dimuat saat dibutuhkan (hls.js)
assets/                  favicon, apple-touch-icon, gambar preview og-image
scripts/build_public.py  script build ke public/
bin/dev                  server preview lokal
bin/build                build ke public/
public/                  hasil build, tidak masuk repo
```

## Menjalankan di komputer sendiri

```bash
bin/dev              # sajikan src/ di http://localhost:8080
bin/dev --public     # build ke public/ lalu sajikan versi minify
bin/dev 3000         # port lain, atau PORT=3000 bin/dev
```

Script ini menjalankan `python3 -m http.server`, jadi tidak perlu dependensi lain. Karena localhost bukan HTTPS, stasiun HTTP juga ikut tampil di hasil pencarian. Server ini tidak membaca `public/_headers`, jadi CSP dan aturan cache baru bisa dicek sesudah deploy.

## Build

```bash
bin/build
```

`bin/build` menjalankan `python3 scripts/build_public.py`. Script ini mengisi folder `public/` dengan:

- `styles.<hash>.min.css` dan `app.<hash>.min.js`, versi minify dengan hash isi di nama file supaya browser selalu mengambil versi terbaru setelah deploy
- `index.html` yang sudah merujuk ke file minify, plus tag SEO dengan URL absolut
- salinan `src/vendor/` apa adanya
- ikon dan gambar preview dari `assets/`, `robots.txt`, dan `sitemap.xml`
- `_headers` untuk Cloudflare Pages: Content Security Policy, header keamanan lain, dan aturan cache

Sebelum build untuk produksi, ganti `SITE_URL` di bagian atas `scripts/build_public.py` dengan alamat situs yang dipakai.

## Deploy ke Cloudflare Pages

Ada dua cara, dan pilihannya harus ditentukan saat membuat project, karena project Upload assets tidak bisa diubah ke integrasi Git belakangan.

1. Upload assets: jalankan build, lalu upload isi folder `public/` lewat dashboard Cloudflare setiap ada perubahan.
2. Integrasi Git: hubungkan repo ini ke Cloudflare Pages dengan build command `python3 scripts/build_public.py` dan build output directory `public`. Setiap push ke branch utama di-deploy ulang otomatis.

## Menyembunyikan stasiun

Pemilik stasiun atau pemegang hak cipta bisa meminta stasiunnya tidak ditampilkan. Tambahkan `stationuuid` stasiun itu ke `BLOCKED_STATION_IDS` di `src/app.js`. Cara mencari UUID-nya ada di komentar di atas konstanta tersebut.

## Kontak

dengaranid@gmail.com

## Sumber data dan atribusi

- Data stasiun: [Radio Browser](https://www.radio-browser.info), proyek komunitas yang gratis dan open source. Siaran dan nama stasiun adalah milik masing-masing stasiun.
- Pemutar HLS: [hls.js](https://github.com/video-dev/hls.js), lisensi Apache-2.0. Teks lisensinya juga ada di [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Ikon: [Lucide](https://lucide.dev), lisensi ISC. Sebagian ikon berasal dari Feather (lisensi MIT). Teks lengkap kedua lisensi ada di [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
