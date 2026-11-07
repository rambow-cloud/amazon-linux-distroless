"""Bind native audited Docker archives to local, tagged OCI image layouts."""
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

ARCHITECTURES = ("amd64", "arm64")
INDEX = "application/vnd.oci.image.index.v1+json"
MANIFEST = "application/vnd.oci.image.manifest.v1+json"
CONFIG = "application/vnd.oci.image.config.v1+json"


def encoded(document):
    return json.dumps(document, sort_keys=True, separators=(",", ":")).encode()


def blob_path(digest):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("Expected a SHA-256 OCI descriptor")
    return "blobs/sha256/" + digest[7:]


def put_blob(layout, contents, media_type):
    digest = "sha256:" + hashlib.sha256(contents).hexdigest()
    (layout / blob_path(digest)).write_bytes(contents)
    return {"digest": digest, "size": len(contents), "mediaType": media_type}


def copy_blob(archive, layout, descriptor):
    contents = archive.extractfile(blob_path(descriptor["digest"])).read()
    if (len(contents) != descriptor["size"] or
            "sha256:" + hashlib.sha256(contents).hexdigest() != descriptor["digest"]):
        raise ValueError("OCI blob bytes differ from the descriptor")
    (layout / blob_path(descriptor["digest"])).write_bytes(contents)
    return contents


def leaf(evidence, layout, variant, arch):
    build = json.loads((evidence / "build.json").read_text())
    proof = json.loads((evidence / "verification.json").read_text())
    image = build["images"][variant]
    if not (proof["commit"] == build["commit"] and proof["platform"] == build["platform"] == "linux/" + arch
            and proof["execution"] == "native" and proof["results"][variant]["image"] == image["id"]):
        raise ValueError("Native evidence does not match the archived image")
    with tarfile.open(evidence / (variant + "-image.tar.gz"), "r:gz") as archive:
        root = json.load(archive.extractfile("index.json"))
        entries = root["manifests"]
        if root["mediaType"] != INDEX or len(entries) != 1 or entries[0]["mediaType"] != MANIFEST:
            raise ValueError("Expected a single-platform native OCI manifest")
        descriptor = {key: entries[0][key] for key in ("digest", "size", "mediaType")}
        manifest = json.loads(copy_blob(archive, layout, descriptor))
        if (manifest["mediaType"] != MANIFEST or manifest["config"]["mediaType"] != CONFIG
                or manifest["config"]["digest"] != image["id"]):
            raise ValueError("OCI manifest differs from the verified image identity")
        config = json.loads(copy_blob(archive, layout, manifest["config"]))
        if (config["os"], config["architecture"], config["config"]["Labels"]["org.opencontainers.image.revision"]) != (
                "linux", arch, build["commit"]):
            raise ValueError("OCI configuration differs from the tested architecture or commit")
        docker_entries = json.load(archive.extractfile("manifest.json"))
        layer_paths = [blob_path(layer["digest"]) for layer in manifest["layers"]]
        if len(docker_entries) != 1 or docker_entries[0]["Layers"] != layer_paths:
            raise ValueError("OCI layers are not the same layers audited in the Docker archive")
        for layer in manifest["layers"]:
            copy_blob(archive, layout, layer)
    descriptor["platform"] = {"os": "linux", "architecture": arch}
    return descriptor, build["commit"]


def index(source, destination):
    reports = {}
    commits = set()
    for variant in ("static", "base"):
        layout = destination / "layouts" / variant
        (layout / "blobs/sha256").mkdir(parents=True)
        leaves = []
        for arch in ARCHITECTURES:
            evidence = source / ("foundation-candidate-" + arch)
            descriptor, commit = leaf(evidence, layout, variant, arch)
            leaves.append(descriptor)
            commits.add(commit)
        root = put_blob(layout, encoded({"schemaVersion": 2, "mediaType": INDEX, "manifests": leaves}), INDEX)
        root["annotations"] = {"org.opencontainers.image.ref.name": "candidate"}
        (layout / "oci-layout").write_bytes(encoded({"imageLayoutVersion": "1.0.0"}))
        (layout / "index.json").write_bytes(encoded({"schemaVersion": 2, "mediaType": INDEX, "manifests": [root]}))
        reports[variant] = {"index": root["digest"], "manifests": leaves}
    if len(commits) != 1:
        raise ValueError("Mixed commits in the foundation OCI index")
    (destination / "indexes.json").write_text(json.dumps({
        "commit": commits.pop(), "execution": "native", "variants": reports,
    }, indent=2) + "\n")


if __name__ == "__main__":
    index(*map(Path, sys.argv[1:]))
