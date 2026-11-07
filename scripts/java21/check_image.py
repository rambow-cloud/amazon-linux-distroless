"""Validate saved image layers against selected files, before runtime mounts."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile
sys.path.insert(0, "/tools")
from assemble import FORBIDDEN

archive, image_tag, inventory_path = sys.argv[1:4]
runtime = sys.argv[4] if len(sys.argv) > 4 else "java"
if runtime not in ("java", "python", "nodejs"):
    raise ValueError("Unsupported language audit")
allowed = {"usr/bin/python3"} if runtime == "python" else set()
expected = {f["path"]: f for f in json.loads(Path(inventory_path).read_text())["files"]}
seen = set()
with tarfile.open(archive) as saved:
    manifests = [m for m in json.load(saved.extractfile("manifest.json")) if image_tag in (m.get("RepoTags") or [])]
    if len(manifests) != 1:
        raise RuntimeError("Expected one saved Java image")
    for layer_path in manifests[0]["Layers"]:
        with tarfile.open(fileobj=saved.extractfile(layer_path), mode="r|*") as layer:
            for member in layer:
                name = member.name.removeprefix("./").rstrip("/")
                if not name:
                    continue
                if member.isdir():
                    if member.mode & 0o6000 or (name == "tmp" and member.mode != 0o1777):
                        raise RuntimeError("Unsafe directory mode: " + name)
                    continue
                if (Path(name).name in FORBIDDEN and name not in allowed) or name.endswith((".jmod", ".whl")) or name.startswith(("var/lib/rpm/", "usr/lib/sysimage/rpm/", "usr/include/")):
                    raise RuntimeError("Forbidden runtime artifact: " + name)
                if name not in expected or name in seen:
                    raise RuntimeError("Unexpected/duplicate final file: " + name)
                file = expected[name]
                if member.uid != 0 or member.gid != 0 or member.mode != int(file["mode"], 8):
                    raise RuntimeError("Final owner/mode mismatch: " + name)
                if file["kind"] == "symlink":
                    if not member.issym() or member.linkname != file["target"]:
                        raise RuntimeError("Final symlink mismatch: " + name)
                else:
                    if not member.isfile():
                        raise RuntimeError("Unexpected file type: " + name)
                    digest = hashlib.sha256()
                    stream = layer.extractfile(member)
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                    if digest.hexdigest() != file["sha256"]:
                        raise RuntimeError("Final content mismatch: " + name)
                seen.add(name)
if seen != set(expected):
    raise RuntimeError("Final image is missing inventory files")
print("Java image: {} files match the selected manifest".format(len(seen)))
