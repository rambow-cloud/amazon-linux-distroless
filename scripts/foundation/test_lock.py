"""Check rejection of altered or non-RPM content before the staging transaction."""
import copy
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

from assemble import checksum, fetch, read_lock

lock = read_lock(sys.argv[1], foundation=True)
with TemporaryDirectory() as directory:
    bad = Path(directory) / lock["variants"]["base"]["packages"][0]["filename"]
    bad.write_bytes(b"untrusted bytes")
    try:
        fetch(lock, directory)
    except RuntimeError as error:
        if "RPM checksum mismatch" not in str(error):
            raise
    else:
        raise RuntimeError("Accepted altered bytes with a mismatched checksum")
    hostile = copy.deepcopy(lock)
    hostile["variants"]["base"]["packages"][0]["sha256"] = checksum(bad)
    try:
        fetch(hostile, directory)
    except subprocess.CalledProcessError as error:
        if tuple(error.cmd[:2]) != ("rpmkeys", "--checksig"):
            raise
    else:
        raise RuntimeError("Accepted untrusted bytes with a matching checksum")
print("Rejected altered content before staging, even with a matching hash")
