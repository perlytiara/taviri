#!/usr/bin/env python3
"""Catch-all mail server for test instances: accepts every message and saves it to a folder.

    smtp_sink.py 1025 /tmp/mail      (listens on 127.0.0.1 only)
"""
import socketserver
import sys
import time
from pathlib import Path

PORT = int(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)


class Handler(socketserver.StreamRequestHandler):
    def reply(self, line):
        self.wfile.write((line + "\r\n").encode())

    def handle(self):
        self.reply("220 sink ready")
        while True:
            line = self.rfile.readline()
            if not line:
                return
            verb = line.decode(errors="replace").strip().upper()
            if verb.startswith(("EHLO", "HELO")):
                self.reply("250 sink")
            elif verb.startswith("DATA"):
                self.reply("354 go on")
                body = b""
                while True:
                    chunk = self.rfile.readline()
                    if chunk in (b".\r\n", b".\n", b""):
                        break
                    body += chunk
                (OUT / f"mail-{time.time():.3f}.eml").write_bytes(body)
                self.reply("250 saved")
            elif verb.startswith("QUIT"):
                self.reply("221 bye")
                return
            else:
                self.reply("250 ok")


socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler).serve_forever()
