"""Audit the exact final image layer against the foundation inventory."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile

archive, tag, inventory = sys.argv[1:]
files = json.loads(Path(inventory).read_text())["files"]
expected = {entry["path"]: entry for entry in files}
seen = set()
with tarfile.open(archive) as image:
    manifests = [m for m in json.load(image.extractfile("manifest.json")) if tag in (m.get("RepoTags") or [])]
    if len(manifests) != 1 or len(manifests[0]["Layers"]) != 1:
        raise ValueError("Expected one scratch image with one payload layer")
    with tarfile.open(fileobj=image.extractfile(manifests[0]["Layers"][0]), mode="r|*") as layer:
        for member in layer:
            name = member.name.removeprefix("./").rstrip("/")
            if name in ("", ".") and member.isdir():
                continue
            if name not in expected or name in seen:
                raise ValueError("Unexpected final image path: " + name)
            entry = expected[name]
            if (member.uid, member.gid, member.mode) != (entry["uid"], entry["gid"], int(entry["mode"], 8)):
                raise ValueError("Final image mode/ownership differs: " + name)
            kind = entry["kind"]
            if kind == "file":
                if not member.isfile() or hashlib.file_digest(layer.extractfile(member), "sha256").hexdigest() != entry["sha256"]:
                    raise ValueError("Final image file differs: " + name)
            elif kind == "symlink":
                if not member.issym() or member.linkname != entry["target"]:
                    raise ValueError("Final image link differs: " + name)
            elif kind != "directory" or not member.isdir():
                raise ValueError("Unexpected final image path type: " + name)
            seen.add(name)
if seen != set(expected):
    raise ValueError("Missing final image entries: " + ", ".join(sorted(set(expected) - seen)))
print(f"{tag}: {len(seen)} entries match the final image")
