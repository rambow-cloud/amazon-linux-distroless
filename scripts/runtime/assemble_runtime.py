"""Assemble language runtimes from an exact offline RPM transaction."""
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys

sys.path.insert(0, "/tools")
from assemble import Assembler, checksum, inspect_tree, license_paths, read_lock, rooted_path, run


def assemble(lock, cache, output, config):
    output, cache = Path(output), Path(cache)
    variant = config["variant"]
    if set(lock["variants"]) != {"base", variant} or variant not in ("python", "nodejs"):
        raise ValueError("Runtime specification differs from locked variants")
    definition = lock["variants"][variant]
    for name in config["identity_packages"]:
        package = next(p for p in definition["packages"] if p["name"] == name)
        expected_tool = "{epoch}:{version}-{release}.{arch}".format(**package)
        if run("rpm", "-q", name, "--qf", "%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}") != expected_tool:
            raise ValueError("Builder/runtime identity mismatch: " + name)
    source = output / "installed"
    source.mkdir(parents=True)
    for package in definition["packages"]:
        if checksum(cache / package["filename"]) != package["sha256"]:
            raise ValueError("RPM changed after verification")
    subprocess.run(["dnf", "-y", "--disablerepo=*", "--releasever=" + lock["releasever"],
                    "--installroot=" + str(source), "--setopt=install_weak_deps=False", "--setopt=localpkg_gpgcheck=False",
                    "install", *[str(cache / p["filename"]) for p in definition["packages"]]], check=True)
    installed = set(run("rpm", "--root", str(source), "-qa", "--qf", "%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n").splitlines())
    expected = {"{name}-{epoch}:{version}-{release}.{arch}".format(**p) for p in definition["packages"]}
    if {p for p in installed if not p.startswith("gpg-pubkey-")} != expected:
        raise RuntimeError("Offline installed set differs from lock")
    selected = output / "rootfs"
    image = Assembler(source, selected, config["excluded_names"])
    common = ["/usr/lib64/libc.so.6", "/usr/lib64/libm.so.6", "/usr/lib64/libresolv.so.2",
              "/usr/lib/locale/C.utf8", "/usr/lib/system-release", "/usr/share/zoneinfo/UTC",
              "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"]
    for seed in common + config["seeds"]:
        image.copy(seed)
    for optional in ("/usr/lib64/libnss_files.so.2", "/usr/lib64/libnss_dns.so.2"):
        if rooted_path(source, optional).exists():
            image.copy(optional)
    image.elf_closure()
    if (source / "usr/share/licenses").exists():
        image.copy("/usr/share/licenses")
    marked = run("rpm", "--root", str(source), "-qa", "--qf", "[%{FILENAMES}\t%{FILEFLAGS:fflags}\n]")
    for file in license_paths(marked):
        if rooted_path(source, file).exists():
            image.copy(file)
    for path, target in {"/lib64": "usr/lib64", "/lib": "usr/lib", "/etc/localtime": "/usr/share/zoneinfo/UTC",
                         "/etc/ssl/certs/ca-certificates.crt": "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
                         "/etc/pki/tls/certs/ca-bundle.crt": "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
                         "/etc/pki/tls/cert.pem": "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", **config["aliases"]}.items():
        image.link(path, target)
    image.write("/etc/passwd", "nonroot:x:65532:65532:Non-root:/nonexistent:/sbin/nologin\n")
    image.write("/etc/group", "nonroot:x:65532:\n")
    image.write("/etc/nsswitch.conf", "passwd: files\ngroup: files\nhosts: files dns\n")
    image.write("/etc/os-release", 'NAME="Amazon Linux"\nID=amzn\nVERSION_ID="2023"\nPRETTY_NAME="Amazon Linux 2023 (distroless-like)"\n')
    for directory in config["directories"]:
        (selected / directory).mkdir(parents=True, exist_ok=True)
    (selected / "tmp").chmod(0o1777)
    owners = {}
    for package in definition["packages"]:
        for file in run("rpm", "--root", str(source), "-ql", package["name"]).splitlines():
            path = PurePosixPath(file)
            canonical = (rooted_path(source, str(path.parent)) / path.name).relative_to(source).as_posix()
            owners.setdefault(canonical, []).append(package["name"])
    entries = inspect_tree(selected, config["allowed_paths"])
    for entry in entries:
        entry["packages"] = sorted(set(owners.get(entry["path"], [])))
        if entry["path"] in image.normalized_links:
            entry["original_symlink_target"] = image.normalized_links[entry["path"]]
            entry["transformation"] = "normalized to an absolute target within the runtime root"
        if entry["path"] in image.generated:
            entry["generated_by"] = "language runtime configuration"
        elif not entry["packages"]:
            if entry["path"].startswith(("etc/pki/", "etc/crypto-policies/")):
                entry["generated_by"] = "offline RPM transaction (trust/crypto configuration)"
            else:
                raise RuntimeError("File lacks provenance: " + entry["path"])
    epoch = lock["source_date_epoch"]
    for path in sorted(selected.rglob("*"), reverse=True):
        os.utime(path, (epoch, epoch), follow_symlinks=False)
    os.utime(selected, (epoch, epoch))
    report = {"prototype": False, "variant": variant, "runtime": config["id"], "platform": lock["platform"],
              "builder": lock["builder"], "releasever": lock["releasever"], "source_date_epoch": epoch,
              "packages": definition["packages"], "files": entries, "configuration": config,
              "runtime_bytes": sum(e.get("size", 0) for e in entries),
              "limitations": ["Unfixed ALAS coverage requires separate review", "Native application dependencies need their own ABI qualification", "No FIPS claim"]}
    (output / "inventory.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print("Assembled {}: {} files, {} bytes".format(config["id"], len(entries), report["runtime_bytes"]), flush=True)


if __name__ == "__main__":
    lock_path, cache, output, configuration = sys.argv[1:]
    assemble(read_lock(lock_path), cache, output, json.loads(Path(configuration).read_text()))
