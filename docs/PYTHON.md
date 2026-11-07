# Python 3.14 runtime contract

Python follows the completed Java 17/21/25 phase, under [#21](https://github.com/rambow-cloud/amazon-linux-distroless/issues/21) and the [language RFC #16](https://github.com/rambow-cloud/amazon-linux-distroless/issues/16). Native resolution of the explicit AL2023 2023.12.20261102 snapshot selected Python **3.14.8** for both amd64 and arm64 in [Actions run 42334960167](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42334960167). This document defines the candidate; availability requires actual native qualification and trusted-main publication evidence.

## Runtime and dependencies

- Default GIL CPython 3.14, direct `/usr/bin/python3.14`, generated `/usr/bin/python3` alias, UID/GID 65532, `/app` working directory and `FROM scratch`.
- Audited stdlib at `/usr/lib64/python3.14`, version-matched native extension modules and ELF dependency closure, C.UTF-8 locale, UTC, system CA trust and packaged OpenSSL configuration/providers. This is not a FIPS claim.
- `PYTHONPATH=/opt/python/site-packages` defines the builder-installed application dependency location. Interpreter stdlib paths remain available. Builder sysconfig defaults under `/usr/local` are not the application installation contract; use an explicit pip `--target`.
- `PYTHONUTF8=1`, `PYTHONDONTWRITEBYTECODE=1`, `PYTHONUNBUFFERED=1` and explicit `SSL_CERT_FILE` provide UTF-8, no runtime bytecode cache writes, unbuffered output and the AL2023 CA bundle. Use a read-only root and a `/tmp` tmpfs.
- No shell, package manager, native compiler, development headers, pip or ensurepip payloads. Exclude IDLE, Tk/turtle demos, stdlib tests, precompiled cache directories, development config directories and installed builder site-packages. The runtime retains the remaining standard library; unsupported external executable invocations still require application dependencies.

Application wheels must match CPython ABI **cp314** and target architecture, with compatible AL2023 libc/native dependencies. The native SOABI is `cpython-314-x86_64-linux-gnu` or `cpython-314-aarch64-linux-gnu`. A wheel built for another interpreter/architecture is not interchangeable. A manylinux tag is not proof that every workload-specific shared library is present; package and qualify application dependencies in a compatible builder.

## Application example

[The multi-stage example](../examples/python-app/Dockerfile) uses the pinned AL2023 builder/snapshot to compile a project-owned C extension, build an architecture/ABI-specific wheel, and install it with builder-only pip into the explicit target. The final stage copies only application dependencies and the script. The native fixture wheel/source/checksums are recorded by qualification; no mutable external PyPI dependency is needed for this example.

Build that example in application GitHub Actions with the repository root as context and `-f examples/python-app/Dockerfile`. Set its `PYTHON_RUNTIME` build argument to the actual qualified immutable runtime digest once published. For real dependencies, commit a fully pinned requirements lock including hashes, use matching binary wheels or build them in the compatible builder, then install into the same target with `--require-hashes` and controlled dependency resolution. Build tools, pip and package caches stay in the builder.

The runtime entrypoint is already Python. For a script, use `CMD ["/app/app.py"]`; for an application module, use `CMD ["-m", "application"]`. There is no shell wrapper. Run a derived image with:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m APPLICATION_IMAGE
```

## Qualification and publishing

Native amd64/arm64 qualification verifies exact saved runtime files/hashes/modes/owners/symlinks, interpreter version, script and module entrypoints, explicit application dependency paths, a builder-installed CPython native wheel, stdlib SSL/ctypes/compression/SQLite, Unicode filenames, system trust, no installers/cache, hardened PID 1 execution, controlled TLS/service-name resolution and certificate rejection, SIGTERM/143, application exit status and shell absence. Fixture keys, application code and compiled extension are added only to the fixture image.

The maintained specifications are [packages](../images/python314/packages.json), [runtime file selection](../images/python314/runtime.json), and `locks/python314/linux-{amd64,arm64}.json`. Lock updates run through `runtime-lock.yml`; review both native artifacts before committing. The language PR gate runs relevant native qualification, and shared rootfs helper changes also run all six Java regression combinations. Retired CVE comparison workflows remain disabled.

After integration into main, `runtime-publish.yml` with runtime `python314` rebuilds both architectures in a trusted main-only run, checks Python ABI/source/runtime evidence and exact payload SBOM scan coverage, blocks known fixable High/Critical ALAS findings, preserves matching source and reports in a prerelease, and verifies keyless index signature/provenance before moving `3.14-preview`. Intended package: `ghcr.io/rambow-cloud/amazon-linux-distroless/python314`. Do not treat the intended package as published until a delivery record proves it.

The publisher shares the source-preservation/signing/index implementation with Java while retaining separate language-specific evidence validators and workflow certificate identities. Python certificate identity is `https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-publish.yml@refs/heads/main`, with GitHub Actions OIDC issuer. ALAS unfixed/language advisory coverage remains limited; application dependencies need separate scanning and runtime qualification. Component licenses remain individual.
