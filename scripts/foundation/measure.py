"""Compare normalized file inventories separately from OCI image metadata."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

from index import INDEX, MANIFEST, blob_path, encoded


def load(path):
    return json.loads(path.read_text())


def archive_metrics(archive_path, image_id):
    with tarfile.open(archive_path, "r:gz") as archive:
        [manifest] = json.load(archive.extractfile("index.json"))["manifests"]
        doc = json.load(archive.extractfile(blob_path(manifest["digest"])))
        if doc["config"]["digest"] != image_id:
            raise ValueError("Unexpected OCI image configuration")
        transfer = manifest["size"] + doc["config"]["size"]
        for layer in doc["layers"]:
            data = archive.extractfile(blob_path(layer["digest"])).read()
            if layer["mediaType"] == "application/vnd.oci.image.layer.v1.tar":
                transfer += len(gzip.compress(data, compresslevel=9, mtime=0))
            elif layer["mediaType"] == "application/vnd.oci.image.layer.v1.tar+gzip":
                transfer += len(data)
            else:
                raise ValueError("Unknown image layer compression")
    return {
        "gzipTransferBytes": transfer,
        "manifestDigest": manifest["digest"],
        "manifestSize": manifest["size"],
        "configDigest": doc["config"]["digest"],
        "layerDigests": [layer["digest"] for layer in doc["layers"]],
    }


def measure(evidence):
    build = load(evidence / "build.json")
    lock = load(evidence / "lock.json")
    variants = {}
    for variant, image in build["images"].items():
        inventory = load(evidence / (variant + "-inventory.json"))
        variants[variant] = {
            **archive_metrics(evidence / (variant + "-image.tar.gz"), image["id"]),
            "fileCount": sum(entry["kind"] != "directory" for entry in inventory["files"]),
            "packageCount": len(inventory["packages"]),
            "unpackedBytes": image["unpackedImageBytes"],
            "inventorySHA256": hashlib.sha256(encoded(inventory["files"])).hexdigest(),
        }
    return {"commit": build["commit"], "platform": build["platform"], "lockSHA256":
            hashlib.sha256(encoded(lock)).hexdigest(), "variants": variants}


def budget(result, config):
    expected = config["limits"][result["platform"]]
    for variant, measured in result["variants"].items():
        for field in ("unpackedBytes", "gzipTransferBytes"):
            if measured[field] > expected[variant][field]:
                raise RuntimeError(f"{variant} {field} {measured[field]} exceeds {expected[variant][field]}")


def docker(*args):
    return subprocess.check_output(("docker", *args), text=True)


def official(evidence):
    lock = load(evidence / "lock.json")
    spec = load(Path("images/upstream/packages.json"))
    platform = lock["platform"]
    os, arch = platform.split("/")
    repo = "public.ecr.aws/amazonlinux/amazonlinux"
    results = {}
    for flavor, ref in (("officialBase", lock["builder"]), ("officialMinimal", spec["builder_tag"] + "-minimal")):
        index = json.loads(docker("buildx", "imagetools", "inspect", "--raw", ref))
        [leaf] = [d for d in index["manifests"] if d.get("platform", {}).get("os") == os
                  and d.get("platform", {}).get("architecture") == arch]
        immutable = repo + "@" + leaf["digest"]
        manifest = json.loads(docker("buildx", "imagetools", "inspect", "--raw", immutable))
        subprocess.run(("docker", "pull", "--platform", platform, immutable), check=True)
        [image] = json.loads(docker("image", "inspect", immutable))
        if (image["Os"], image["Architecture"], image["Id"]) != (os, arch, manifest["config"]["digest"]):
            raise ValueError("Unexpected official AL2023 baseline")
        results[flavor] = {
            "reference": immutable, "input": ref, "unpackedBytes": image["Size"],
            "registryTransferBytes": leaf["size"] + manifest["config"]["size"] +
            sum(layer["size"] for layer in manifest["layers"]),
            "rpmCount": len(docker("run", "--rm", "--network", "none", "--entrypoint",
                                  "/usr/bin/rpm", immutable, "-qa").splitlines()),
        }
    return results


def compare(source):
    report = {}
    commits = set()
    for arch in ("amd64", "arm64"):
        a = load(source / f"repro-{arch}-a" / "metrics.json")
        b = load(source / f"repro-{arch}-b" / "metrics.json")
        if a["commit"] != b["commit"] or a["lockSHA256"] != b["lockSHA256"] or (
                a["platform"] != b["platform"] or a["platform"] != "linux/" + arch):
            raise ValueError("Clean builds used different inputs")
        commits.add(a["commit"])
        outcome = {}
        for variant, x in a["variants"].items():
            y = b["variants"][variant]
            if x["inventorySHA256"] != y["inventorySHA256"]:
                outcome[variant] = "normalized runtime file inventory differs"
            elif x["manifestDigest"] == y["manifestDigest"]:
                outcome[variant] = "identical OCI manifest and normalized file inventory"
            elif x["layerDigests"] == y["layerDigests"]:
                outcome[variant] = "identical layers; OCI manifest or config metadata differs"
            else:
                outcome[variant] = "identical normalized files; OCI layer encoding or metadata differs"
        report[arch] = {"sampleA": a, "sampleB": b, "outcome": outcome}
    if len(commits) != 1:
        raise ValueError("Compared mixed source commits")
    indexes = {}
    for sample in ("sampleA", "sampleB"):
        indexes[sample] = {}
        for variant in ("static", "base"):
            leaves = []
            for arch, row in report.items():
                metrics = row[sample]["variants"][variant]
                leaves.append({"digest": metrics["manifestDigest"], "size": metrics["manifestSize"],
                               "mediaType": MANIFEST, "platform": {"os": "linux", "architecture": arch}})
            index = encoded({"schemaVersion": 2, "mediaType": INDEX, "manifests": leaves})
            indexes[sample][variant] = "sha256:" + hashlib.sha256(index).hexdigest()
    return {"architectures": report, "indexes": indexes}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--budgets", type=Path)
    parser.add_argument("--official", action="store_true")
    parser.add_argument("--compare", action="store_true")
    args = parser.parse_args()
    result = compare(args.source) if args.compare else measure(args.source)
    if args.official:
        result["official"] = official(args.source)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if args.budgets:
        budget(result, load(args.budgets))
    if args.compare and any(
        "normalized runtime file inventory differs" in row["outcome"].values()
        for row in result["architectures"].values()
    ):
        raise RuntimeError("Paired clean builds produced different runtime file inventories")
