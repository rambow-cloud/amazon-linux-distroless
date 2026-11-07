"""Build an architecture/ABI-specific wheel from project-owned fixture source."""
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import sysconfig
import zipfile

assert sys.version_info[:2] == (3, 14)
out = Path("/fixture")
out.mkdir()
suffix = sysconfig.get_config_var("EXT_SUFFIX")
native = out / ("_nativefixture" + suffix)
subprocess.run(["gcc", "-shared", "-fPIC", "-O2", "-I" + sysconfig.get_path("include"), "/src/native.c", "-o", str(native)], check=True)
platform = sysconfig.get_platform().replace("-", "_").replace(".", "_")
tag = "cp314-cp314-" + platform
wheel = out / ("contract_fixture-1.0.0-" + tag + ".whl")
dist = "contract_fixture-1.0.0.dist-info/"
entries = {
    "contract_fixture/__init__.py": b"from ._nativefixture import add\n",
    "contract_fixture/__main__.py": b"from . import add\nimport json\nprint(json.dumps({'nativeAnswer': add(19,23)}))\n",
    "contract_fixture/" + native.name: native.read_bytes(),
    dist + "METADATA": b"Metadata-Version: 2.1\nName: contract-fixture\nVersion: 1.0.0\nLicense: Apache-2.0\n",
    dist + "WHEEL": ("Wheel-Version: 1.0\nGenerator: project-native-fixture\nRoot-Is-Purelib: false\nTag: " + tag + "\n").encode(),
}
record = io.StringIO()
writer = csv.writer(record)
for name, data in sorted(entries.items()):
    writer.writerow((name, "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("="), len(data)))
writer.writerow((dist + "RECORD", "", ""))
entries[dist + "RECORD"] = record.getvalue().encode()
with zipfile.ZipFile(wheel, "w", zipfile.ZIP_DEFLATED) as archive:
    for name, data in sorted(entries.items()):
        info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        archive.writestr(info, data)
subprocess.run([sys.executable, "-m", "pip", "install", "--no-index", "--no-deps", "--no-compile", "--target", str(out / "site"), str(wheel)], check=True)
(out / "build.json").write_text(json.dumps({"version": sys.version, "SOABI": sysconfig.get_config_var("SOABI"), "wheel": wheel.name,
    "wheelSHA256": hashlib.sha256(wheel.read_bytes()).hexdigest(), "nativeSHA256": hashlib.sha256(native.read_bytes()).hexdigest(),
    "source": "Project-owned C extension compiled on the native AL2023 builder and installed with builder-only pip"}, indent=2) + "\n")
