# Dengaran

Cari dan putar radio dari Indonesia dan negara lain langsung di browser: [dengaran.id](https://dengaran.id)

Gratis, tanpa iklan, tanpa daftar akun, dan tanpa cookie. Data stasiun berasal dari [Radio Browser](https://www.radio-browser.info), dan jumlah kunjungan dihitung dengan Cloudflare Web Analytics. Aplikasinya ditulis dengan HTML, CSS, dan JavaScript biasa, tanpa framework dan tanpa `npm install`.

## Fitur

- Cari stasiun per nama, negara, dan genre, lalu urutkan dari yang terpopuler, paling disukai, nama, atau bitrate.
- Favorit dan Baru diputar disimpan di browser, tidak dikirim ke server.
- Sleep Timer, pintasan keyboard, dan kontrol dari lock screen.
- Stream yang terputus disambung ulang otomatis.
- Mendukung playlist `.pls`, `.m3u`, dan stream HLS.
- Halaman daftar radio per kota dan genre, misalnya [/radio-online-jakarta](https://dengaran.id/radio-online-jakarta).

## Menjalankan

Butuh Python 3. [Bun](https://bun.sh) dipakai untuk minify JS. Tanpa Bun, JS disalin tanpa minify.

```bash
bin/dev              # server lokal di http://localhost:8080
bin/dev --public     # build dulu, lalu sajikan hasil build
bin/build            # build ke public/
```

## Dokumentasi

- [docs/development.md](docs/development.md): struktur folder, build, halaman daftar radio, dan deploy
- [docs/streaming.md](docs/streaming.md): cara kerja pemutaran dan sambung ulang

## Kontak

dengaranid@gmail.com. Pemilik stasiun atau pemegang hak cipta bisa meminta stasiunnya tidak ditampilkan lewat alamat ini.

## Atribusi

- Data stasiun: [Radio Browser](https://www.radio-browser.info). Siaran dan nama stasiun milik masing-masing stasiun.
- Pemutar HLS: [hls.js](https://github.com/video-dev/hls.js), lisensi Apache-2.0.
- Ikon: [Lucide](https://lucide.dev), lisensi ISC, sebagian dari Feather (MIT).
- Logo GitHub di footer: merek dagang GitHub, Inc., dipakai hanya sebagai link ke repo ini.

Teks lisensi pihak ketiga ada di [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
