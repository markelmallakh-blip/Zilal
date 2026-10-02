#!/usr/bin/env python3
"""Local preview server that never lets the browser cache.

Python's plain `http.server` lets browsers reuse pages heuristically, so a
rebuilt page can keep showing the old version until a hard reload. This one
sends `Cache-Control: no-store` with every response.

Run:  python3 tools/serve.py [port]     (default 8080)
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"Serving {ROOT} at http://localhost:{port} (no-cache)")
        httpd.serve_forever()
