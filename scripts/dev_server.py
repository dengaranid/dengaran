#!/usr/bin/env python3
"""Server preview lokal yang memetakan alamat seperti Cloudflare Pages.

http.server bawaan hanya menyajikan nama file persis. Cloudflare Pages juga menyajikan
/<nama> dari <nama>.html (halaman daftar radio memakai alamat ini), dan menjawab path yang
tidak ada dengan 404.html. Server ini menerapkan dua aturan yang sama. Header di public/_headers tetap
tidak dibaca.

Pemakaian (dipanggil bin/dev):  python3 scripts/dev_server.py <port> <direktori>
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class PagesHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        url = urlsplit(self.path)
        root = Path(self.directory)
        # /radio-pop disajikan dari radio-pop.html, kalau radio-pop sendiri tidak ada.
        if url.path != "/" and not url.path.endswith("/") and "." not in Path(url.path).name:
            if not (root / url.path.lstrip("/")).exists() and (root / (url.path.lstrip("/") + ".html")).is_file():
                self.path = url.path + ".html" + (f"?{url.query}" if url.query else "")
        return super().send_head()

    def send_error(self, code, message=None, explain=None):
        not_found = Path(self.directory) / "404.html"
        if code != 404 or not not_found.is_file():
            return super().send_error(code, message, explain)
        body = not_found.read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


def main():
    port, directory = int(sys.argv[1]), sys.argv[2]
    handler = partial(PagesHandler, directory=directory)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
