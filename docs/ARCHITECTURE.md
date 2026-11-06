# Architecture and implementation strategy

Status: proposed implementation route. The runtime-contract RFC must settle the remaining choices before image implementation.

## Goals

Build a small, inspectable runtime from official AL2023 packages, with explicit contents and traceable updates. Preserve compatibility for the documented workload contract rather than attempting general-purpose Linux compatibility.

## Assembly pipeline

1. **Lock inputs.** Store an official AL2023 builder image index digest, architecture mapping, exact `releasever`, tool versions, selected package versions/NEVRAs, RPM checksums, and repository metadata references. Reject floating release selection in release builds. A builder digest and a repository release are separate inputs and both must be pinned.
2. **Resolve in a builder.** Start with the standard AL2023 image for full DNF/RPM tooling. Resolve only official, signature-verified AL2023 RPMs for the target architecture. Disable weak dependencies where appropriate. Materialize and record the transitive package closure. Use a disposable install root or verified RPM extraction; the RFC/prototype must settle scriptlet handling and configuration generation.
3. **Select runtime files.** Package closure alone is too broad. Derive an explicit per-variant file allowlist with ownership/provenance, preserve symlinks and license notices, and fail on missing or unexpected files. Do not populate the final rootfs by copying the entire builder and deleting obvious tools.
4. **Audit runtime closure.** Inspect ELF interpreter and `DT_NEEDED` dependencies, including transitive libraries, architecture-specific loader paths, and runtime-loaded components. Cover NSS, CA trust configuration, OpenSSL configuration when applicable, and symlink targets. Avoid invoking `ldd` on arbitrary untrusted binaries as an audit technique.
5. **Package from scratch.** Use `FROM scratch`, numeric `USER 65532:65532`, OCI source/version/license labels, exec-form application entrypoints in examples, and no inherited shell command. Keep build metadata outside the final rootfs unless runtime or license obligations require it.
6. **Test the final artifact.** Run workload probes and inspect the exported filesystem, OCI configuration, user identity, and absent tools. Produce per-architecture manifests and compare outputs before publishing an index.

BuildKit multi-stage Dockerfiles plus small, reviewable assembly scripts are the starting toolchain. Bazel or a different image assembler requires evidence that the additional complexity solves an identified issue.

## Variant boundaries

| Concern | `static` | `base` |
| --- | --- | --- |
| Workload | Fully static binary; no glibc dependency | AL2023-compatible dynamically linked binary |
| Common data | CA roots, minimal passwd/group, writable-path contract | Same |
| glibc/loader | Excluded | Verified loader and runtime library closure |
| C++ / language runtimes | Excluded | Excluded until separately accepted |
| OpenSSL shared libraries | Excluded | Explicit RFC decision based on a supported workload; not assumed from the word `base` |
| Time zones/locales | UTC baseline; additional data is an explicit contract decision | Same; glibc locale behavior must be tested |
| Shell/package manager | Excluded | Excluded |

`static` describes workload linkage, not a guarantee that arbitrary static glibc binaries work without external NSS/runtime data. Start with pure static Go probes. Rebuild dynamically linked applications against a compatible AL2023 toolchain; this is not a promise of compatibility with arbitrary Debian, Alpine/musl, or newer-glibc binaries.

The contract must decide `/etc/os-release`, `/etc/nsswitch.conf`, CA bundle paths/symlinks, passwd/group entries, working directory, `/tmp` permissions, UTC behavior, and whether any runtime configuration needs generation. Container runtimes supply files such as `/etc/hosts` and `/etc/resolv.conf`; application behavior still needs final-container tests.

## Security and traceability

Omitting RPM tools and the RPM database must not erase package identity from SBOMs. Keep a package-to-file map and exact version metadata in build artifacts, then validate scanner detection against known AL2023 advisories. Fewer detected packages is not proof of fewer vulnerabilities.

The project uses Apache-2.0 for its own work. RPM licenses, notices, redistribution rules, and corresponding-source requirements remain component-specific. The first RFC and supply-chain milestone must resolve how to distribute required notices and source references. Do not claim FIPS compliance from the choice of AL2023 alone.

## Reproducibility and updates

First require a stable rootfs file manifest for identical locked inputs. Normalize timestamps, ordering, ownership, and archive metadata where possible. Separately measure image/index digest reproducibility: provenance timestamps and build metadata can change an OCI digest even when runtime files match. Report both outcomes and any limitations.

Updates are reviewed changes to lock files, never an implicit `--releasever=latest` during release builds. A scheduled update detector should eventually open an issue or PR, with a human-reviewable package diff and security impact. No image publishing workflow is installed during repository bootstrap.

## Upstream references

Reviewed on 2026-11-06:

- [AL2023 deterministic upgrades](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html) explains repository version selection.
- [Official minimal image](https://docs.aws.amazon.com/linux/al2023/ug/minimal-container.html) retains `microdnf`; it is a useful baseline, not this project's final rootfs.
- [AL2023 lifecycle](https://docs.aws.amazon.com/linux/al2023/ug/release-cadence.html) lists standard support through 2027-06-30 and maintenance through 2029-06-30. Recheck before setting a project support window.
- [Google Distroless](https://github.com/GoogleContainerTools/distroless) provides a reference for minimal runtime and shell-free usage conventions. This project uses its own AL2023 assembly implementation.
