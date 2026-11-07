"""Consume verified RPM inputs and assemble an explicitly selected rootfs."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import urllib.parse
import urllib.request

FORBIDDEN = {
    "sh", "bash", "dash", "zsh", "busybox", "dnf", "yum", "microdnf", "rpm",
    "rpmkeys", "gcc", "g++", "cc", "c++", "javac", "jar", "jlink", "jmod",
    "mvn", "gradle", "python", "python3", "pip", "npm", "npx", "curl", "wget",
}


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def checksum(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_lock(path):
    lock = json.loads(Path(path).read_text())
    if lock.get("schema_version") != 1 or lock.get("platform") not in ("linux/amd64", "linux/arm64"):
        raise ValueError("Only schema 1, native amd64/arm64 is supported")
    package_arch = {"linux/amd64": "x86_64", "linux/arm64": "aarch64"}[lock["platform"]]
    if not re.fullmatch(r"public\.ecr\.aws/amazonlinux/amazonlinux@sha256:[a-f0-9]{64}", lock["builder"]):
        raise ValueError("Official digest-pinned builder required")
    if not re.fullmatch(r"2023\.\d+\.\d{8}", lock["releasever"]):
        raise ValueError("Explicit repository release required")
    if set(lock["variants"]) != {"base", "java"}:
        raise ValueError("Expected base and java variants")
    if not isinstance(lock.get("source_date_epoch"), int) or lock["source_date_epoch"] < 0:
        raise ValueError("Invalid normalization timestamp")
    for variant in lock["variants"].values():
        seen = set()
        if not variant["packages"]:
            raise ValueError("Empty RPM lock")
        for package in variant["packages"]:
            name = package["filename"]
            if not re.fullmatch(r"[A-Za-z0-9_.+~-]+\.rpm", name) or name in seen:
                raise ValueError("Invalid/duplicate RPM filename")
            seen.add(name)
            if package["arch"] not in (package_arch, "noarch") or not package["signature_verified"]:
                raise ValueError("Unverified or wrong-architecture RPM")
            if not re.fullmatch(r"[a-f0-9]{64}", package["sha256"]):
                raise ValueError("Invalid checksum")
            url = urllib.parse.urlsplit(package["url"])
            if url.scheme != "https" or url.hostname != "cdn.amazonlinux.com":
                raise ValueError("Official HTTPS AL2023 CDN required")
    required_sources = {p["source_rpm"] for v in lock["variants"].values() for p in v["packages"]}
    if required_sources != {p["filename"] for p in lock.get("sources", [])}:
        raise ValueError("Complete matching source RPM inputs are required")
    for package in lock["sources"]:
        url = urllib.parse.urlsplit(package["url"])
        if (package["arch"] != "src" or not package["signature_verified"]
                or not re.fullmatch(r"[A-Za-z0-9_.+~-]+\.src\.rpm", package["filename"])
                or not re.fullmatch(r"[a-f0-9]{64}", package["sha256"])
                or url.scheme != "https" or url.hostname != "cdn.amazonlinux.com"):
            raise ValueError("Invalid source RPM lock")
    return lock


def locked_packages(lock):
    result = {}
    for variant in lock["variants"].values():
        for package in variant["packages"]:
            previous = result.get(package["filename"])
            if previous and previous != package:
                raise ValueError("Conflicting RPM entries")
            result[package["filename"]] = package
    return list(result.values())


def download_url(url):
    parts = urllib.parse.urlsplit(url)
    # S3-backed CDN paths distinguish a literal '+' from an encoded space.
    encoded = urllib.parse.quote(urllib.parse.unquote(parts.path), safe="/")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, encoded, parts.query, ""))


def fetch(lock, cache, sources=False):
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    tools = sorted(line for line in run("rpm", "-qa", "--qf",
                   "%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n").splitlines()
                   if not line.startswith("gpg-pubkey-"))
    if tools != lock["tool_packages"]:
        raise RuntimeError("Builder tools changed; regenerate and review inputs")
    for key in Path("/etc/pki/rpm-gpg").glob("RPM-GPG-KEY-amazon-linux-2023"):
        subprocess.run(["rpm", "--import", str(key)], check=True)
    selected = lock["sources"] if sources else locked_packages(lock)
    for package in selected:
        path = cache / package["filename"]
        if not path.exists():
            temporary = path.with_suffix(".part")
            print("Downloading locked input: " + package["filename"], flush=True)
            with urllib.request.urlopen(download_url(package["url"]), timeout=120) as response, temporary.open("wb") as out:
                if urllib.parse.urlsplit(response.url).hostname != "cdn.amazonlinux.com":
                    raise ValueError("Download redirected outside the official CDN")
                shutil.copyfileobj(response, out)
            temporary.replace(path)
        if checksum(path) != package["sha256"]:
            raise RuntimeError("RPM checksum mismatch: " + path.name)
        verification = run("rpmkeys", "--checksig", "--verbose", str(path))
        if "signature" not in verification.lower():
            raise RuntimeError("RPM signature missing: " + path.name)
    print("Verified {} locked {} RPMs".format(len(selected), "source" if sources else "binary"), flush=True)


def rooted_path(root, path):
    """Resolve absolute symlinks within the supplied root, never the host root."""
    pending, parts, traversals = str(path).split("/"), [], 0
    while pending:
        part = pending.pop(0)
        if part in ("", "."):
            continue
        if part == "..":
            # Match Linux/chroot semantics: .. at / remains at the virtual /.
            # Never delegate absolute RPM symlinks to the builder filesystem.
            if parts:
                parts.pop()
            continue
        candidate = root.joinpath(*parts, part)
        if candidate.is_symlink():
            traversals += 1
            if traversals > 40:
                raise ValueError("Symlink cycle")
            target = os.readlink(candidate)
            if target.startswith("/"):
                parts = []
            pending = target.split("/") + pending
        else:
            parts.append(part)
    return root.joinpath(*parts)


class Assembler:
    def __init__(self, source, destination, excluded_names=()):
        self.source, self.root = Path(source), Path(destination)
        self.excluded_names = set(excluded_names)
        self.root.mkdir(parents=True)
        self.copied, self.generated, self.elf_queue, self.elf_seen = set(), {}, [], set()
        self.normalized_links = {}

    def copy(self, path):
        path = PurePosixPath(path)
        if path.name in self.excluded_names:
            return
        if ".." in path.parts:
            resolved = rooted_path(self.source, str(path))
            path = PurePosixPath("/" + resolved.relative_to(self.source).as_posix())
        source = rooted_path(self.source, str(path.parent)) / path.name
        relative = source.relative_to(self.source).as_posix()
        destination = self.root / relative
        if relative in self.copied:
            return
        if not source.exists() and not source.is_symlink():
            raise FileNotFoundError("Required runtime path is absent: " + str(path))
        self.copied.add(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_symlink():
            original = os.readlink(source)
            terminal = "/" + rooted_path(self.source, "/" + relative).relative_to(self.source).as_posix()
            # The intermediate alternatives/CA links need not be in the selected
            # rootfs. Point directly to the selected terminal file or directory.
            destination.symlink_to(terminal)
            self.normalized_links[relative] = original
            self.copy(terminal)
        elif source.is_dir():
            destination.mkdir(exist_ok=True)
            destination.chmod(stat.S_IMODE(source.stat().st_mode) & ~0o6000)
            for child in sorted(source.iterdir()):
                self.copy("/" + child.relative_to(self.source).as_posix())
        elif source.is_file():
            shutil.copyfile(source, destination)
            destination.chmod(stat.S_IMODE(source.stat().st_mode) & ~0o6000)
            with source.open("rb") as stream:
                if stream.read(4) == b"\x7fELF":
                    self.elf_queue.append(source)
        else:
            raise ValueError("Special runtime file")

    def write(self, path, content):
        target = self.root / path.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        target.chmod(0o644)
        self.generated[path.lstrip("/")] = "prototype configuration"

    def link(self, path, target):
        output = self.root / path.lstrip("/")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.symlink_to(target)
        self.generated[path.lstrip("/")] = "prototype symlink"

    def elf_closure(self):
        missing = set()
        while self.elf_queue:
            source = self.elf_queue.pop()
            if source in self.elf_seen:
                continue
            self.elf_seen.add(source)
            dynamic = run("readelf", "-d", str(source))
            program = run("readelf", "-l", str(source))
            for interpreter in re.findall(r"Requesting program interpreter: ([^\]]+)", program):
                self.copy(interpreter)
            for library in re.findall(r"\(NEEDED\).*Shared library: \[([^\]]+)\]", dynamic):
                if library in self.excluded_names:
                    raise RuntimeError("Required native library was excluded: " + library)
                candidates = [rooted_path(self.source, prefix) / library for prefix in
                              ("/usr/lib64/", "/lib64/", "/usr/lib/", "/lib/")]
                candidates += sorted(self.source.glob("usr/lib/jvm/**/" + library))
                candidate = next((p for p in candidates if p.is_file() or p.is_symlink()), None)
                if candidate is None:
                    missing.add((source.name, library))
                    continue
                self.copy("/" + candidate.relative_to(self.source).as_posix())
        if missing:
            raise RuntimeError("Missing ELF dependencies: " + "; ".join(
                "{} needs {}".format(binary, library) for binary, library in sorted(missing)))


def inspect_tree(root):
    result = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        mode = stat.S_IMODE(path.lstat().st_mode)
        if mode & 0o6000:
            raise ValueError("Setuid/setgid file: " + relative)
        if not path.is_dir() and (path.name in FORBIDDEN or relative.startswith(("var/lib/rpm/", "usr/lib/sysimage/rpm/"))):
            raise ValueError("Forbidden runtime file: " + relative)
        if path.is_symlink():
            if not rooted_path(root, "/" + relative).exists():
                raise ValueError("Dangling runtime symlink: " + relative)
            entry = {"path": relative, "kind": "symlink", "target": os.readlink(path), "mode": oct(mode)}
        elif path.is_dir():
            continue
        elif path.is_file():
            entry = {"path": relative, "kind": "file", "sha256": checksum(path),
                     "size": path.stat().st_size, "mode": oct(mode)}
        else:
            raise ValueError("Special runtime file: " + relative)
        result.append(entry)
    return result


def license_paths(marked):
    # rpm's unflagged last row may lose its trailing tab after text stripping.
    for line in marked.splitlines():
        file, separator, flags = line.partition("\t")
        if separator and "l" in flags:
            yield file


def assemble(lock, cache, output, java_profile=None):
    cache, output = Path(cache), Path(output)
    for package in locked_packages(lock):
        if checksum(cache / package["filename"]) != package["sha256"]:
            raise RuntimeError("RPM changed after signature verification")
    for variant, definition in lock["variants"].items():
        if java_profile and variant != "java":
            continue
        source = output / (variant + "-installed")
        source.mkdir(parents=True)
        # Signature verification used the pinned builder key before this offline
        # transaction. No additional repository/package candidates are available.
        subprocess.run([
            "dnf", "-y", "--disablerepo=*", "--releasever=" + lock["releasever"],
            "--installroot=" + str(source), "--setopt=install_weak_deps=False",
            "--setopt=localpkg_gpgcheck=False", "install",
            *[str(cache / p["filename"]) for p in definition["packages"]],
        ], check=True)
        installed = set(run("rpm", "--root", str(source), "-qa", "--qf",
                            "%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n").splitlines())
        expected = {"{name}-{epoch}:{version}-{release}.{arch}".format(**p) for p in definition["packages"]}
        if {p for p in installed if not p.startswith("gpg-pubkey-")} != expected:
            raise RuntimeError("Offline installed set differs from lock")
        profile = java_profile(source, definition, lock, output) if java_profile else None
        selected = output / variant / "rootfs"
        image = Assembler(source, selected, profile["excluded_names"] if profile else ())
        for seed in ["/usr/lib64/libc.so.6", "/usr/lib64/libm.so.6",
                     "/usr/lib64/libresolv.so.2",
                     "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
                     "/usr/share/zoneinfo/UTC"]:
            image.copy(seed)
        for optional in ("/usr/lib64/libnss_files.so.2", "/usr/lib64/libnss_dns.so.2"):
            if rooted_path(source, optional).exists():
                image.copy(optional)
        if variant == "java":
            home = profile["home"] if profile else "/usr/lib/jvm/java-21-amazon-corretto.x86_64"
            for item in ("bin/java", "conf", "lib", "legal", "release"):
                image.copy(home + "/" + item)
            image.link("/opt/java", home)
            image.link("/usr/bin/java", "/opt/java/bin/java")
        if profile:
            for seed in profile["seeds"]:
                image.copy(seed)
        image.elf_closure()
        # Retain package-marked licenses as well as the conventional license tree.
        if (source / "usr/share/licenses").exists():
            image.copy("/usr/share/licenses")
        marked = run("rpm", "--root", str(source), "-qa", "--qf", "[%{FILENAMES}\t%{FILEFLAGS:fflags}\n]")
        for file in license_paths(marked):
            if rooted_path(source, file).exists():
                image.copy(file)
        image.link("/lib64", "usr/lib64")
        (selected / "usr/lib").mkdir(parents=True, exist_ok=True)
        image.link("/lib", "usr/lib")
        image.link("/etc/localtime", "/usr/share/zoneinfo/UTC")
        image.link("/etc/ssl/certs/ca-certificates.crt", "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem")
        image.link("/etc/pki/tls/certs/ca-bundle.crt", "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem")
        image.write("/etc/passwd", "nonroot:x:65532:65532:Non-root:/nonexistent:/sbin/nologin\n")
        image.write("/etc/group", "nonroot:x:65532:\n")
        image.write("/etc/nsswitch.conf", "passwd: files\ngroup: files\nhosts: files dns\n")
        image.write("/etc/os-release", 'NAME="Amazon Linux"\nID=amzn\nVERSION_ID="2023"\nPRETTY_NAME="Amazon Linux 2023 (distroless prototype)"\n')
        (selected / "tmp").mkdir(mode=0o1777)
        (selected / "tmp").chmod(0o1777)
        (selected / "app").mkdir()
        owners = {}
        for package in definition["packages"]:
            for file in run("rpm", "--root", str(source), "-ql", package["name"]).splitlines():
                parent = rooted_path(source, str(PurePosixPath(file).parent))
                canonical = (parent / PurePosixPath(file).name).relative_to(source).as_posix()
                owners.setdefault(canonical, []).append(package["name"])
        entries = inspect_tree(selected)
        for entry in entries:
            entry["packages"] = sorted(set(owners.get(entry["path"], [])))
            if profile and entry["path"].startswith(home.lstrip("/") + "/"):
                if not entry["packages"]:
                    entry["packages"] = [profile["runtime_package"]]
                entry["generated_by"] = "jlink from locked same-version Corretto devel toolset"
                entry["runtime_transform"] = "corretto-jlink"
            if entry["path"] in image.normalized_links:
                entry["original_symlink_target"] = image.normalized_links[entry["path"]]
                entry["transformation"] = "normalized to an absolute target within the runtime root"
            if entry["path"] in image.generated:
                entry["generated_by"] = image.generated[entry["path"]]
            elif not entry["packages"]:
                if entry["path"].startswith("etc/pki/"):
                    entry["generated_by"] = "offline RPM transaction (CA/trust generation)"
                else:
                    raise RuntimeError("File lacks provenance: " + entry["path"])
        epoch = lock["source_date_epoch"]
        for path in sorted(selected.rglob("*"), reverse=True):
            os.utime(path, (epoch, epoch), follow_symlinks=False)
        os.utime(selected, (epoch, epoch))
        report = {
            "prototype": True, "variant": variant, "platform": lock["platform"],
            "builder": lock["builder"], "releasever": lock["releasever"],
            "source_date_epoch": epoch, "packages": definition["packages"], "files": entries,
            "runtime_bytes": sum(entry.get("size", 0) for entry in entries),
            "limitations": ["Not a full SPDX/CycloneDX SBOM",
                            "Matching source RPMs accompany the download; signing and stable support are not implemented",
                            "The headless runtime is not jlink module-minimized"],
        }
        if profile:
            report["prototype"] = False
            report["runtime_transform"] = profile["transform"]
            report["limitations"] = ["Native Java 21 candidate; project-wide stable release obligations remain tracked separately",
                                     "Package-level vulnerability findings require transformed-file applicability review"]
        (output / variant / "inventory.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print("Assembled {}: {} files, {} bytes".format(variant, len(entries), report["runtime_bytes"]), flush=True)


if __name__ == "__main__":
    command, lock_path, cache = sys.argv[1:4]
    lock = read_lock(lock_path)
    if command == "fetch":
        fetch(lock, cache)
    elif command == "fetch-sources":
        fetch(lock, cache, sources=True)
    elif command == "assemble":
        assemble(lock, cache, sys.argv[4])
    else:
        raise ValueError("Unknown command")
