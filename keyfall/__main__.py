"""`keyfall` command: serve the bundled web app on localhost and open it in the browser."""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path

from . import __version__

STATIC = Path(__file__).parent / "static"
SCORES = (".mid", ".midi", ".musicxml", ".xml", ".mxl")


class Handler(http.server.SimpleHTTPRequestHandler):
    songs: Path | None = None  # the player's own folder of MIDI / MusicXML files

    def log_message(self, *args):  # keep the terminal quiet
        pass

    def my_files(self) -> list[str]:
        d = self.songs
        if not d or not d.is_dir():
            return []
        return sorted(f.name for f in d.iterdir() if f.is_file() and f.suffix.lower() in SCORES and not f.name.startswith("."))

    def do_GET(self):
        path = urllib.parse.unquote(self.path.split("?")[0])
        if not path.startswith("/my-songs/"):
            return super().do_GET()
        name = path[len("/my-songs/"):]
        if name == "index.json":
            body, ctype = json.dumps(self.my_files()).encode(), "application/json"
        elif name in self.my_files():  # only files listed above – never a path outside the folder
            body, ctype = (self.songs / name).read_bytes(), "application/octet-stream"
        else:
            return self.send_error(404)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # hashed asset files never change; everything else should be re-checked
        self.send_header("Cache-Control", "max-age=31536000, immutable" if self.path.startswith("/assets/") else "no-cache")
        super().end_headers()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def _count(d: Path) -> list[str]:
    return [f.name for f in d.iterdir() if f.is_file() and f.suffix.lower() in SCORES] if d.is_dir() else []


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="keyfall", description="Keyfall – learn piano pieces with falling notes.")
    ap.add_argument("--port", type=int, default=8765, help="port to serve on (default 8765; 0 picks a free one)")
    ap.add_argument("--host", default="127.0.0.1", help="address to bind (default 127.0.0.1 – this computer only)")
    ap.add_argument("--songs", type=Path, default=Path.home() / "Keyfall", help="folder with your own MIDI / MusicXML files (default ~/Keyfall)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the browser")
    ap.add_argument("--version", action="version", version=f"keyfall {__version__}")
    args = ap.parse_args(argv)

    if not (STATIC / "index.html").is_file():
        print("The web app is missing from this install (keyfall/static). In a source checkout run: npm install && npm run build:py", file=sys.stderr)
        return 1

    Handler.songs = args.songs.expanduser()
    handler = functools.partial(Handler, directory=str(STATIC))
    try:
        server = Server((args.host, args.port), handler)
    except OSError as e:
        print(f"Could not start on port {args.port}: {e}. Try: keyfall --port 0", file=sys.stderr)
        return 1

    # the microphone and MIDI only work on localhost (or https), so always point the browser there
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0", "::") else args.host
    url = f"http://{shown}:{server.server_address[1]}/"
    print(f"Keyfall is running at {url}  (Ctrl+C to stop)")
    n = len(_count(Handler.songs))
    print(f"Your own pieces: {n} file(s) in {Handler.songs}" if n else f"Your own pieces: put MIDI or MusicXML files in {Handler.songs} (or upload them in the app)")
    if not args.no_browser:
        threading.Timer(0.4, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
