"""Reconstruct a locked installation database for a scan-only experiment."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

sys.path.insert(0, "/tools")
from assemble import checksum, fetch, read_lock, rooted_path


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def packages(*options):
    rows = run("rpm", *options, "-qa", "--qf",
               "%{NAME}\t%{EPOCHNUM}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\t%{SOURCERPM}\n")
    result = []
    for row in rows.splitlines():
        values = row.split("\t")
        result.append(dict(zip(("name", "epoch", "version", "release", "arch", "source_rpm"), values)))
    return sorted(result, key=lambda p: p["name"])


def assert_packages(actual, expected):
    fields = ("name", "epoch", "version", "release", "arch", "source_rpm")
    identity = lambda p: tuple(str(p[key]) for key in fields)
    found = {identity(p) for p in actual if p["name"] != "gpg-pubkey"}
    wanted = {identity(p) for p in expected}
    if found != wanted:
        raise RuntimeError("Native RPM package set differs: " + str(found ^ wanted))


def checkpoint(db):
    with sqlite3.connect(db) as connection:
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("RPM database failed SQLite integrity check")


def reconstruct(lock, cache, out):
    source = Path("/work/out/rpm-work/java-installed")
    source.mkdir(parents=True)
    expected = lock["variants"]["java"]["packages"]
    for p in expected:
        if checksum(cache / p["filename"]) != p["sha256"]:
            raise RuntimeError("RPM changed after signature verification: " + p["filename"])
    subprocess.run([
        "dnf", "-y", "--disablerepo=*", "--releasever=" + lock["releasever"],
        "--installroot=" + str(source), "--setopt=install_weak_deps=False",
        "--setopt=localpkg_gpgcheck=False", "install",
        *[str(cache / p["filename"]) for p in expected],
    ], check=True)
    full = packages("--root", str(source))
    assert_packages(full, expected)
    candidates = [rooted_path(source, path) for path in
                  ("/var/lib/rpm", "/usr/lib/sysimage/rpm")]
    dbdir = next((p for p in candidates if (p / "rpmdb.sqlite").is_file()), None)
    if dbdir is None:
        raise RuntimeError("No native SQLite RPM database found in the reconstructed installation root")
    checkpoint(dbdir / "rpmdb.sqlite")
    relative = dbdir.relative_to(source)
    coverage = json.loads((out / "prototype-coverage.json").read_text())
    selected = {p["name"] for p in coverage["selected"]}
    payload_expected = [p for p in expected if p["name"] in selected]
    if {p["name"] for p in payload_expected} != selected:
        raise RuntimeError("Payload package set differs from locked transaction")
    marker = rooted_path(source, "/usr/lib/system-release")
    if not marker.is_file() or not marker.read_text().startswith("Amazon Linux release 2023"):
        raise RuntimeError("Expected locked AL2023 release marker")
    marker_owners = run("rpm", "--root", str(source), "-qf", "/usr/lib/system-release", "--qf", "%{NAME}")
    if marker_owners != "system-release":
        raise RuntimeError("Release marker is not owned by system-release")
    result = {"origin": "Reconstructed offline installation transaction; original build database was not archived",
              "releasever": lock["releasever"], "database_path": relative.as_posix(),
              "release_marker": {"path": "usr/lib/system-release", "content": marker.read_text(),
                                 "sha256": checksum(marker), "owner": marker_owners}, "variants": {}}
    for variant in ("full", "payload"):
        root = out / "rpmdb" / variant
        copied = root / relative
        copied.parent.mkdir(parents=True)
        shutil.copytree(dbdir, copied)
        if variant == "payload":
            excluded = sorted({p["name"] for p in full} - selected)
            if excluded:
                subprocess.run(["rpm", "--dbpath", str(copied), "--erase", "--justdb",
                                "--nodeps", "--noscripts", "--notriggers", "--noplugins", *excluded], check=True)
        native = packages("--dbpath", str(copied))
        assert_packages(native, expected if variant == "full" else payload_expected)
        checkpoint(copied / "rpmdb.sqlite")
        # Closed SQLite handles and a checkpointed main DB are sufficient. Do not
        # ship host lock/shared-memory files in the experiment layer.
        for file in copied.iterdir():
            if file.name != "rpmdb.sqlite":
                file.unlink()
        output_marker = root / "usr/lib/system-release"
        output_marker.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(marker, output_marker)
        database = copied / "rpmdb.sqlite"
        result["variants"][variant] = {"packages": native, "sqlite_integrity": "ok",
                                       "database_sha256": checksum(database),
                                       "database_bytes": database.stat().st_size,
                                       "removed_names": sorted({p["name"] for p in full} - {p["name"] for p in native})}
    (out / "rpmdb-evidence.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"database_path": result["database_path"], "release_marker": result["release_marker"],
                      "package_counts": {k: len(v["packages"]) for k, v in result["variants"].items()}}, indent=2))


if __name__ == "__main__":
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Run native database preparation in GitHub Actions")
    command = sys.argv[1]
    lock = read_lock("/work/out/prototype-input/linux-amd64.json")
    cache = Path("/work/out/rpm-inputs")
    if command == "fetch":
        fetch(lock, cache)
    elif command == "reconstruct":
        reconstruct(lock, cache, Path("/work/out/cve"))
    else:
        raise ValueError("Unknown RPM database experiment command")
