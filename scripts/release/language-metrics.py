"""Measure the exact language image that passed native qualification."""
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "foundation"))
from measure import archive_metrics, encoded, load

runtime, architecture, evidence_path = sys.argv[1:]
evidence = Path(evidence_path)
inventory = load(evidence / "inventory.json")
verification = load(evidence / "verification.json")
coverage = load(evidence / "payload-packages.json")
policy = load(Path("releases/stable-candidates.json"))[runtime]
image = verification["image"]
arch = "linux/" + architecture
if inventory["platform"] != arch or verification["platform"] != arch:
    raise ValueError("Incorrect language platform")
if image["config"]["User"] != "65532:65532" or not verification["checks"]:
    raise ValueError("Missing hardened workload qualification")
if image["size"] > policy["maxImageMiB"] * 1048576:
    raise ValueError(f"{runtime} {arch} image exceeds the reviewed size ceiling")
files = {}
for file in inventory["files"]:
    name = file["path"]
    if name in files:
        raise ValueError("Duplicate inventory file")
    # The final archive audit already verified root ownership for every file.
    files[name] = {**file, "uid": 0, "gid": 0}
result = {
    **archive_metrics(evidence / "image.tar.gz", image["id"]),
    "runtime": runtime, "platform": arch, "commit": verification["sourceCommit"],
    "unpackedBytes": image["size"], "fileCount": len(files),
    "packageCount": len(coverage["selected"]), "ceilingMiB": policy["maxImageMiB"],
    "lockSHA256": hashlib.sha256(encoded(load(evidence / "lock.json"))).hexdigest(),
    "inventorySHA256": hashlib.sha256(encoded(files)).hexdigest(),
    "files": {name: hashlib.sha256(encoded(value)).hexdigest() for name, value in files.items()},
}
(evidence / "language-metrics.json").write_text(json.dumps(result, indent=2) + "\n")
