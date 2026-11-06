"""Compare the exported final container filesystem with its assembly inventory."""
import hashlib
import json
from pathlib import Path
import tarfile
from assemble import FORBIDDEN

directory = Path("/workspace/out/prototype")
for variant in ("base", "java"):
    inventory = json.loads((directory / (variant + "-inventory.json")).read_text())
    expected = {file["path"]: file for file in inventory["files"]}
    seen = set()
    with tarfile.open(directory / (variant + "-rootfs.tar")) as archive:
        for member in archive:
            name = member.name.removeprefix("./").rstrip("/")
            if member.isdir() or not name:
                continue
            if name in ("etc/hostname", "etc/hosts", "etc/resolv.conf", ".dockerenv"):
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
                stream = archive.extractfile(member)
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
                if digest.hexdigest() != file["sha256"]:
                    raise RuntimeError("Final-image contents differ: " + name)
            seen.add(name)
    if seen != set(expected):
        raise RuntimeError("Final image is missing inventory files")
    print("Verified final {} image: {} files match inventory".format(variant, len(seen)))
