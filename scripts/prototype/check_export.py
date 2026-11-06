"""Compare saved scratch-image layers, before runtime-injected mounts/devices."""
import hashlib
import json
from pathlib import Path
import tarfile
from assemble import FORBIDDEN

directory = Path("/workspace/out/prototype")
with tarfile.open(directory / "images.tar") as saved:
    manifest = json.load(saved.extractfile("manifest.json"))
    for variant in ("base", "java"):
        tag = "al2023-distroless-" + variant + ":prototype"
        matches = [entry for entry in manifest if tag in (entry.get("RepoTags") or [])]
        if len(matches) != 1:
            raise RuntimeError("Expected exactly one saved image for " + tag)
        inventory = json.loads((directory / (variant + "-inventory.json")).read_text())
        expected = {file["path"]: file for file in inventory["files"]}
        seen = set()
        for layer_name in matches[0]["Layers"]:
            with tarfile.open(fileobj=saved.extractfile(layer_name), mode="r|*") as layer:
                for member in layer:
                    name = member.name.removeprefix("./").rstrip("/")
                    if member.isdir() or not name:
                        continue
                    if Path(name).name in FORBIDDEN:
                        raise RuntimeError("Forbidden final-image tool: " + name)
                    if name not in expected:
                        raise RuntimeError("Unexpected final-image file: " + name)
                    file = expected[name]
                    if member.uid != 0 or member.gid != 0:
                        raise RuntimeError("Unexpected ownership: " + name)
                    if member.mode != int(file["mode"], 8):
                        raise RuntimeError("Final-image mode differs: " + name)
                    if file["kind"] == "symlink":
                        if not member.issym() or member.linkname != file["target"]:
                            raise RuntimeError("Final-image symlink differs: " + name)
                    elif not member.isfile():
                        raise RuntimeError("Unexpected final-image file type: " + name)
                    else:
                        digest = hashlib.sha256()
                        stream = layer.extractfile(member)
                        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                            digest.update(chunk)
                        if digest.hexdigest() != file["sha256"]:
                            raise RuntimeError("Final-image contents differ: " + name)
                    seen.add(name)
        if seen != set(expected):
            raise RuntimeError("Final image is missing inventory files")
        print("Verified final {} image: {} files match inventory".format(variant, len(seen)))
