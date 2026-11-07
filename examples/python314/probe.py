"""Exercise the Python contract as a direct PID 1 process in the final runtime."""
import bz2
import ctypes
import decimal
import encodings
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib.util
import json
import locale
import lzma
import os
from pathlib import Path
import signal
import socket
import sqlite3
import ssl
import sys
import sysconfig
import tempfile
import time
import urllib.request
import zlib


def request(host, trusted, reject):
    address = socket.gethostbyname(host)
    context = ssl.create_default_context(cafile="/fixture/server.pem" if trusted else None)
    try:
        with urllib.request.urlopen("https://" + host + ":8443/ping", context=context, timeout=5) as response:
            assert not reject and response.status == 200 and response.read() == b"python314-ok"
    except ssl.SSLCertVerificationError:
        assert reject
    except urllib.error.URLError as error:
        assert reject and isinstance(error.reason, ssl.SSLCertVerificationError), error
    else:
        assert not reject
    print(json.dumps({"host": host, "address": address, "tlsRejected": reject}))


def serve():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"python314-ok")

    server = HTTPServer(("0.0.0.0", 8443), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain("/fixture/server.pem", "/fixture/server.key")
    server.socket = context.wrap_socket(server.socket, server_side=True)

    def shutdown(signum, frame):
        print("shutdown-hook-ran", flush=True)
        raise SystemExit(143)

    signal.signal(signal.SIGTERM, shutdown)
    print("READY", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


mode = sys.argv[1] if len(sys.argv) > 1 else "check"
if mode == "exit":
    raise SystemExit(17)
if mode == "serve":
    serve()
    raise SystemExit(0)
if mode in ("tls", "hostname", "untrusted"):
    request("wrong-name" if mode == "hostname" else "tls-fixture", mode != "untrusted", mode != "tls")
    raise SystemExit(0)

assert sys.implementation.name == "cpython"
assert not sysconfig.get_config_var("Py_GIL_DISABLED")
assert os.getpid() == 1 and os.getuid() == 65532 and os.getgid() == 65532
assert os.getcwd() == "/app" and sys.dont_write_bytecode
assert sys.getfilesystemencoding().lower() == "utf-8" and locale.getencoding().upper().replace("-", "") == "UTF8"
assert os.statvfs("/").f_flag & os.ST_RDONLY
with tempfile.NamedTemporaryFile(prefix="\u00e9-\u6d4b\u8bd5-", mode="w+", encoding="utf-8") as stream:
    stream.write("\u00e9-\u6d4b\u8bd5")
    stream.seek(0)
    assert stream.read() == "\u00e9-\u6d4b\u8bd5"
assert time.tzname[0] == "UTC"
for installer in ("pip", "ensurepip", "tkinter", "idlelib"):
    assert importlib.util.find_spec(installer) is None, installer
import contract_fixture
assert Path(contract_fixture.__file__).is_relative_to("/opt/python/site-packages")
assert contract_fixture.add(19, 23) == 42
assert ctypes.CDLL("libc.so.6").getpid() == 1
text = b"stdlib compression and hashing"
assert bz2.decompress(bz2.compress(text)) == text
assert lzma.decompress(lzma.compress(text)) == text
assert zlib.decompress(zlib.compress(text)) == text
assert hashlib.sha256(text).hexdigest()
with sqlite3.connect(":memory:") as connection:
    assert connection.execute("select 19+23").fetchone()[0] == 42
roots = len(ssl.create_default_context().get_ca_certs())
assert roots >= 100
assert not list(Path("/opt/python/site-packages").rglob("__pycache__"))
print(json.dumps({"python": sys.version.split()[0], "arch": os.uname().machine, "pid": os.getpid(), "uid": os.getuid(),
    "SOABI": sysconfig.get_config_var("SOABI"), "versions": {"mpdecimal": decimal.__libmpdec_version__}, "trustAnchors": roots, "nativeAnswer": 42,
    "readOnlyRootfs": True, "bytecodeDisabled": sys.dont_write_bytecode, "installersAbsent": True, "timezone": time.tzname[0]}))
