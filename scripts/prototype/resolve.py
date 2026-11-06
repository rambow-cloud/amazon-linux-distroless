"""Resolve official AL2023 RPMs inside the digest-pinned tools container."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import dnf


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def tool_packages():
    return sorted(line for line in run("rpm", "-qa", "--qf",
                  "%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}\n").splitlines()
                  if not line.startswith("gpg-pubkey-"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--builder", required=True)
    parser.add_argument("--epoch", required=True, type=int)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    inputs = json.loads(Path(args.inputs).read_text())
    for key in sorted(Path("/etc/pki/rpm-gpg").glob("RPM-GPG-KEY-amazon-linux-2023")):
        subprocess.run(["rpm", "--import", str(key)], check=True)
    lock = {
        "schema_version": 1, "platform": inputs["platform"],
        "builder": args.builder, "releasever": inputs["releasever"],
        "source_date_epoch": args.epoch, "tool_packages": tool_packages(),
        "trust": {"key_source": "Pinned official AL2023 builder /etc/pki/rpm-gpg",
                  "verification": "rpmkeys --checksig; SHA-256 checked again on consumption"},
        "variants": {},
    }
    for variant, roots in inputs["roots"].items():
        with dnf.Base() as base:
            base.conf.substitutions["releasever"] = inputs["releasever"]
            base.conf.install_weak_deps = False
            base.conf.cachedir = "/tmp/prototype-dnf-" + variant
            base.read_all_repos()
            for repo in base.repos.iter_enabled():
                repo.gpgcheck = True
            base.fill_sack(load_system_repo=False)
            for package in roots:
                base.install(package)
            base.resolve()
            packages = sorted(base.transaction.install_set, key=lambda p: str(p))
            base.download_packages(packages)
            entries = []
            for package in packages:
                path = Path(package.localPkg())
                verification = run("rpmkeys", "--checksig", "--verbose", str(path))
                if "signature" not in verification.lower():
                    raise RuntimeError("No RPM signature: " + str(path))
                if package.arch not in ("x86_64", "noarch"):
                    raise RuntimeError("Unexpected RPM architecture: " + package.arch)
                entries.append({
                    "name": package.name, "epoch": str(package.epoch),
                    "version": package.version, "release": package.release,
                    "arch": package.arch, "filename": path.name,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "url": package.remote_location(), "license": package.license,
                    "source_rpm": package.sourcerpm, "signature_verified": True,
                })
            lock["variants"][variant] = {"roots": roots, "packages": entries}
            print("Resolved {}: {} verified RPMs".format(variant, len(entries)), flush=True)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
