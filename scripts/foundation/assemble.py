"""Select the static and base runtime files from an offline RPM staging root."""
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, "/tools")
# Import the existing verified-RPM consumer, not this entry point.
from assemble import Assembler, checksum, fetch, inspect_tree, license_paths, read_lock, rooted_path, run

TRUST = "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"
MACHINES = {
    "linux/amd64": ("Advanced Micro Devices X86-64", "/lib64/ld-linux-x86-64.so.2"),
    "linux/arm64": ("AArch64", "/lib/ld-linux-aarch64.so.1"),
}


def identity(package):
    return "{epoch}:{version}-{release}.{arch}".format(**package)


def ownership(source, packages):
    owners = {}
    for package in packages:
        for file in run("rpm", "--root", str(source), "-ql", package["name"]).splitlines():
            path = PurePosixPath(file)
            canonical = (rooted_path(source, path.parent) / path.name).relative_to(source).as_posix()
            owners.setdefault(canonical, set()).add(package["name"])
    return owners


def select(lock, variant, source, output, owners, package_by_name, licenses):
    image = Assembler(source, output / "rootfs")
    seeds = [TRUST, "/usr/share/zoneinfo/UTC"]
    machine, loader = MACHINES[lock["platform"]]
    if variant == "base":
        seeds += [loader, "/usr/lib/locale/C.utf8", "/usr/lib64/libc.so.6",
                  "/usr/lib64/libm.so.6", "/usr/lib64/libresolv.so.2"]
        seeds += [name for name in ("/usr/lib64/libnss_files.so.2", "/usr/lib64/libnss_dns.so.2")
                  if rooted_path(source, name).exists()]
    for file in seeds:
        image.copy(file)
    image.elf_closure()
    if variant == "base":
        image.link("/lib", "usr/lib")
        image.link("/lib64", "usr/lib64")
        if not rooted_path(image.root, loader).is_file():
            raise RuntimeError("Missing foundation ELF interpreter: " + loader)
    for file, target in {
        "/etc/localtime": "/usr/share/zoneinfo/UTC",
        "/etc/ssl/certs/ca-certificates.crt": TRUST,
        "/etc/pki/tls/certs/ca-bundle.crt": TRUST,
    }.items():
        image.link(file, target)
    image.write("/etc/passwd", "nonroot:x:65532:65532:Non-root:/nonexistent:/sbin/nologin\n")
    image.write("/etc/group", "nonroot:x:65532:\n")
    image.write("/etc/nsswitch.conf", "passwd: files\ngroup: files\nhosts: files dns\n")
    image.write("/etc/os-release", 'NAME="Amazon Linux"\nID=amzn\nVERSION_ID="2023"\n'
                'PRETTY_NAME="Amazon Linux 2023 (distroless-like)"\n')
    (image.root / "app").mkdir(mode=0o755)
    (image.root / "tmp").mkdir()
    (image.root / "tmp").chmod(0o1777)

    # Copy RPM license files for the selected payload owners, not for the
    # larger staging transaction or the toolchain.
    trust_path = TRUST.lstrip("/")
    owners[trust_path] = {"ca-certificates"}
    shipped = set().union(*(owners.get(entry, set()) for entry in image.copied))
    for file in licenses:
        path = PurePosixPath(file)
        canonical = (rooted_path(source, path.parent) / path.name).relative_to(source).as_posix()
        if owners.get(canonical, set()) & shipped and rooted_path(source, file).exists():
            image.copy(file)

    for elf in image.elf_queue + list(image.elf_seen):
        if variant == "static" or not re.search(r"Machine:\s*" + re.escape(machine) + r"\s*$",
                                                run("readelf", "-h", str(elf)), re.MULTILINE):
            raise RuntimeError("Unexpected ELF file for " + lock["platform"] + ": " + str(elf))

    entries = inspect_tree(image.root)
    for entry in entries:
        name = entry["path"]
        if name.startswith(("usr/bin/", "usr/sbin/", "usr/include/")) or re.search(r"lib(ssl|crypto)\.so", name):
            raise RuntimeError("Out-of-contract foundation file: " + name)
        entry["uid"] = 0
        entry["gid"] = 0
        if name in image.generated:
            entry["generated_by"] = "project foundation configuration"
        else:
            entry["packages"] = sorted(owners.get(name, set()) & shipped)
            if not entry["packages"]:
                raise RuntimeError("File lacks RPM provenance: " + name)
        if name == trust_path:
            entry["generated_by"] = "trust data from the locked builder's matching ca-certificates RPM"
        if name in image.normalized_links:
            entry["original_symlink_target"] = image.normalized_links[name]

    epoch = lock["source_date_epoch"]
    for file in sorted(image.root.rglob("*"), reverse=True):
        if file.is_dir() and not file.is_symlink():
            entries.append({"path": file.relative_to(image.root).as_posix(), "kind": "directory",
                            "uid": 0, "gid": 0, "mode": oct(stat.S_IMODE(file.stat().st_mode)),
                            "generated_by": "project foundation layout"})
        os.utime(file, (epoch, epoch), follow_symlinks=False)
    os.utime(image.root, (epoch, epoch))
    report = {"variant": variant, "platform": lock["platform"], "builder": lock["builder"],
              "releasever": lock["releasever"], "source_date_epoch": epoch,
              "packages": [package_by_name[name] for name in sorted(shipped)],
              "files": sorted(entries, key=lambda entry: entry["path"])}
    (output / "inventory.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print("Assembled {} for {} with {} inventory entries".format(variant, lock["platform"], len(entries)), flush=True)


def assemble(lock, cache, output):
    packages = lock["variants"]["base"]["packages"]
    package_by_name = {package["name"]: package for package in packages}
    inputs = [cache / package["filename"] for package in packages]
    for package, rpm in zip(packages, inputs):
        if checksum(rpm) != package["sha256"]:
            raise RuntimeError("RPM changed after signature verification: " + rpm.name)
    with TemporaryDirectory() as directory:
        source = Path(directory)
        subprocess.run(["rpm", "--root", str(source), "-i", "--nodeps", "--noscripts",
                        "--notriggers", "--nosignature", *map(str, inputs)], check=True)
        staged = set(run("rpm", "--root", str(source), "-qa",
                         "--qf", "%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n").splitlines())
        if staged != {package["name"] + "-" + identity(package) for package in packages}:
            raise RuntimeError("Offline staged RPMs differ from the lock")
        if run("rpm", "-q", "ca-certificates", "--qf", "%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}") != identity(package_by_name["ca-certificates"]):
            raise RuntimeError("The locked trust package differs from the builder")
        bundle = rooted_path(source, PurePosixPath(TRUST).parent) / PurePosixPath(TRUST).name
        bundle.parent.mkdir(parents=True, exist_ok=True)
        if bundle.is_symlink():
            bundle.unlink()
        shutil.copyfile(TRUST, bundle)
        owners = ownership(source, packages)
        licenses = list(license_paths(run("rpm", "--root", str(source), "-qa",
                                          "--qf", "[%{FILENAMES}\t%{FILEFLAGS:fflags}\n]")))
        for variant in ("static", "base"):
            select(lock, variant, source, output / variant, owners, package_by_name, licenses)


if __name__ == "__main__":
    mode, lock_path, cache, output = sys.argv[1:]
    lock = read_lock(lock_path, foundation=True)
    cache, output = Path(cache), Path(output)
    if mode == "fetch":
        fetch(lock, cache)
    elif mode == "assemble":
        assemble(lock, cache, output)
    elif mode == "sources":
        needed = set()
        for variant in ("static", "base"):
            report = json.loads((output / variant / "inventory.json").read_text())
            needed.update(package["source_rpm"] for package in report["packages"])
        lock["sources"] = [package for package in lock["sources"] if package["filename"] in needed]
        if {package["filename"] for package in lock["sources"]} != needed:
            raise RuntimeError("Missing corresponding source")
        fetch(lock, output / "sources", sources=True)
    else:
        raise ValueError("Unsupported foundation mode")
