"""Verify the retained source RPM archive against the exact shipped owners."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile


def load(path):
    return json.loads(path.read_text())


root = Path(sys.argv[1])
lock = load(root / "lock.json")
owners = set()
for variant in ("static", "base"):
    report = load(root / (variant + "-inventory.json"))
    owners.update(package["source_rpm"] for package in report["packages"])
sources = {entry["filename"]: entry for entry in lock["sources"] if entry["filename"] in owners}
if set(sources) != owners:
    raise ValueError("Incomplete pinned source RPM records")
seen = set()
with tarfile.open(root / "sources.tar.gz", "r:gz") as archive:
    for item in archive:
        if item.name == "sources" and item.isdir():
            continue
        if not item.isfile() or not item.name.startswith("sources/"):
            raise ValueError("Unexpected archive entry: " + item.name)
        name = item.name.removeprefix("sources/")
        if name in seen or name not in sources:
            raise ValueError("Unexpected or duplicate source RPM: " + name)
        if hashlib.file_digest(archive.extractfile(item), "sha256").hexdigest() != sources[name]["sha256"]:
            raise ValueError("Source RPM differs from the pinned checksum: " + name)
        seen.add(name)
if seen != owners:
    raise ValueError("Missing source RPMs: " + ", ".join(sorted(owners - seen)))
print("Verified corresponding source RPMs: " + ", ".join(sorted(seen)))
