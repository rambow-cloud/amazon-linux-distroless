"""Create a generic headless JRE from matching locked Corretto module inputs."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.path.insert(0, "/tools")
from assemble import assemble, checksum, read_lock, run


def profile(config):
    def prepare(source, definition, lock, output):
        major = config["java_major"]
        if major not in (17, 21, 25):
            raise RuntimeError("Unsupported Java major")
        prefix = "java-{}-amazon-corretto".format(major)
        arch = {"linux/amd64": "x86_64", "linux/arm64": "aarch64"}[lock["platform"]]
        home = "/usr/lib/jvm/" + prefix + "." + arch
        runtime = next(p for p in definition["packages"] if p["name"] == prefix + "-headless")
        tool = run("rpm", "-q", prefix + "-devel", "--qf", "%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}")
        expected = "{epoch}:{version}-{release}.{arch}".format(**runtime)
        if tool != expected or not runtime["version"].startswith(str(major) + "."):
            raise RuntimeError("jlink tool and runtime package versions differ")
        jmods_tool = run("rpm", "-q", prefix + "-jmods", "--qf", "%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}")
        if jmods_tool != expected:
            raise RuntimeError("JMods and runtime package versions differ")
        module_path = Path(home) / "jmods"
        linked = output / "java-linked"
        subprocess.run([home + "/bin/jlink", "--module-path", str(module_path), "--add-modules", ",".join(config["modules"]),
                        "--output", str(linked), "--no-header-files", "--no-man-pages", "--compress=2"], check=True)
        release = (linked / "release").read_text()
        modules = re.search(r'^MODULES="([^"]+)"', release, re.M).group(1).split()
        if set(modules) & set(config["forbidden_modules"]):
            raise RuntimeError("Compiler/tool modules leaked into the JRE")
        inputs = [{"module": m, "path": str(module_path / (m + ".jmod")),
                   "sha256": checksum(module_path / (m + ".jmod"))} for m in sorted(modules)]
        cacerts = linked / "lib/security/cacerts"
        if cacerts.exists() or cacerts.is_symlink():
            cacerts.unlink()
        cacerts.symlink_to("/etc/pki/java/cacerts")
        destination = source / home.lstrip("/")
        if destination.is_symlink() or source.resolve() not in destination.resolve().parents:
            raise RuntimeError("Invalid disposable JVM replacement path")
        shutil.rmtree(destination)
        shutil.copytree(linked, destination, symlinks=True)
        # Java 17 and native filename conversion use glibc's selected locale.
        # These files are supplied by the already locked minimal langpack RPM.
        locale = source / "usr/lib/locale/C.utf8"
        if not locale.is_dir():
            raise RuntimeError("Locked C.UTF-8 locale is missing: " + str(locale))
        return {"home": home, "runtime_package": runtime["name"], "excluded_names": config["excluded_native_files"],
                "seeds": ["/usr/lib/system-release", "/usr/lib/locale/C.utf8", "/usr/lib64/libfontconfig.so.1", "/etc/fonts",
                          "/usr/share/fontconfig", "/usr/share/fonts"],
                "transform": {"kind": "jlink", "java_major": major, "tool_package": prefix + "-devel-" + tool,
                              "jmods_package": prefix + "-jmods-" + jmods_tool,
                              "runtime_package": runtime["name"], "runtime_nevra": expected,
                              "root_modules": config["modules"], "modules": sorted(modules), "jmod_inputs": inputs,
                              "options": ["--no-header-files", "--no-man-pages", "--compress=2"],
                              "excluded_native_files": config["excluded_native_files"],
                              "truststore": "Linked runtime points to the offline RPM-generated AL2023 JVM truststore"}}
    return prepare


if __name__ == "__main__":
    lock_path, cache, output, configuration = sys.argv[1:]
    assemble(read_lock(lock_path), cache, output, java_profile=profile(json.loads(Path(configuration).read_text())))
