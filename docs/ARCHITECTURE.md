# Architecture and implementation strategy

The published language channels use their own runtime contracts. The foundation contract below governs the standalone `static` and `base` images; see the [roadmap](ROADMAP.md) for qualification and release criteria.

The [Java contract](JAVA.md) covers linked Corretto runtimes. The [upstream runtime contract](UPSTREAM-RUNTIMES.md) covers signed CPython source and Node.js binary releases with AL2023 system libraries.

An owner-authorized [Java prototype](PROTOTYPE.md), tracked in #25, exercises this candidate route before the broader RFCs are complete. It uses a verified offline RPM transaction followed by fresh file selection. Its Java 21/amd64 choices and validation limits do not constitute the stable runtime contract.

## Goals

Build a small runtime with an explicit file inventory, verified AL2023 system packages and traceable language sources. Preserve compatibility for the documented workload contract rather than attempting general-purpose Linux compatibility.

## Assembly pipeline

1. **Lock inputs.** Store an official AL2023 builder image index digest, architecture mapping, exact `releasever`, tool versions, selected package versions/NEVRAs, RPM checksums, and repository metadata references. Reject floating release selection in release builds. A builder digest and a repository release are separate inputs and both must be pinned.
2. **Resolve in a builder.** Start with the standard AL2023 image for full DNF/RPM tooling. Resolve only official, signature-verified AL2023 RPMs for the target architecture. Disable weak dependencies where appropriate. Materialize and record the transitive package closure. Use an isolated staging root. Upstream language assembly stages the verified RPM payloads with scripts and triggers disabled and imports the CA and crypto policy files from the matching builder packages.
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
| Language runtimes | Excluded from the foundation | Added only in separate `java`, `python`, and `nodejs` variants |
| OpenSSL shared libraries | Excluded | Excluded; applications using them must supply and qualify their own compatible libraries |
| Time zones/locales | UTC; no additional time zones or locale data | UTC and the AL2023 glibc C.UTF-8 locale; no extra locale packs |
| Shell/package manager | Excluded | Excluded |

`static` describes workload linkage, not a guarantee that arbitrary static glibc binaries work without external NSS/runtime data. Start with pure static Go probes. Rebuild dynamically linked applications against a compatible AL2023 toolchain; this is not a promise of compatibility with arbitrary Debian, Alpine/musl, or newer-glibc binaries.

### Foundation runtime contract

Both images use a scratch root, default to numeric UID/GID `65532:65532` (the `nonroot` user and group), and start in `/app` with no default executable. Use an exec-form application entrypoint. The root filesystem can be mounted read-only; applications needing temporary writes mount a separate `/tmp` with sticky mode 01777. No root-owned application directory is writable by default.

Both include AL2023 CA roots at `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem`, with compatibility links at `/etc/ssl/certs/ca-certificates.crt` and `/etc/pki/tls/certs/ca-bundle.crt`. Set `SSL_CERT_FILE` to the former compatibility path. Include only UTC zone data, with `/etc/localtime` linked to it. A minimal project-generated `/etc/os-release` identifies the AL2023 base and the project image. Minimal passwd/group entries and `nsswitch.conf` use local files for identities and files followed by DNS for host lookup. The container runtime supplies `/etc/hosts` and `/etc/resolv.conf`; the image includes neither its own resolver configuration nor network directory services.

Qualify `static` with a pure Go binary built with `CGO_ENABLED=0`; this does not qualify arbitrary statically linked glibc programs. Qualify `base` with a C fixture compiled in the locked AL2023 toolchain and the matching glibc loader. The fixture tests the foundation; it does not define a C or C++ runtime image. Applications linking to extra libraries must prepare them in their own compatible builder. Neither foundation includes language runtimes, shells, package managers, RPM databases, compilers, or build caches.

Stage the signature-verified RPM payloads offline, with scripts and triggers disabled, then copy an explicit file selection into a fresh root. Generate the minimal runtime configuration from project-owned inputs. For trust data generated by RPM scripts, copy the bundle from the locked builder only after matching its owning RPM identity to the locked package. Review the resulting file inventory and component licenses; preserve the corresponding source RPMs, notices, and project build inputs with redistributed binaries. The project's Apache-2.0 license applies to project-authored files.

The [AL2023 repository documentation](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html) defines repository release pinning independently of the builder digest. [#3](https://github.com/rambow-cloud/amazon-linux-distroless/issues/3) tracks input verification, [#4](https://github.com/rambow-cloud/amazon-linux-distroless/issues/4) tracks exact rootfs inventories, and [#5](https://github.com/rambow-cloud/amazon-linux-distroless/issues/5) tracks the Go/C workload evidence. [#6](https://github.com/rambow-cloud/amazon-linux-distroless/issues/6) extends the same contract to native arm64.

## Committed language variants

Java, Python, and Node.js are required deliverables for v1.0, with an intermediate v0.3 implementation milestone. All three use the shared AL2023 runtime contract and must pass on `linux/amd64` and `linux/arm64`. Use an accepted RFC for each version expansion and lock the runtime identity and paths. RFC #51 defines the upstream Python and Node.js inputs.

| Variant | Assembly and application contract | Runtime-specific verification |
| --- | --- | --- |
| `java` | Official AL2023 Amazon Corretto headless runtime; executable JARs built in a separate builder; explicit `java` path and `JAVA_HOME` | JVM native libraries, Java truststore/CA behavior, DNS, direct JAR startup, signals, and non-root temporary-file behavior |
| `python` | Verified upstream CPython source built on AL2023 with a reviewed stdlib; dependencies installed into a documented path by a matching builder; no runtime pip or ensurepip installer payloads | `sys.path`, importlib/encodings, SSL and supported extension modules, native wheel ABI, bytecode/cache writes, and script/module entrypoints |
| `nodejs` | Verified upstream Node.js executable with the AL2023 shared library closure; production `node_modules` installed by a matching builder; direct `node` startup without npm/npx/corepack | ESM/CommonJS, Node/OpenSSL CA policy, DNS, Intl/data scope, native addon ABI/N-API, signals, and HTTP service operation |

Keep package-version selection separate from floating alternatives symlinks. Pin versioned entrypoints and provide aliases to the selected executables. Required development tools stay in the builder. Runtime executables such as `java`, `python`, and `node` are deliberately allowed even though they can execute application code.

A standalone `cc` variant and general C++ workload support are out of scope. This does not prohibit a required `libstdc++`, `libgcc`, JNI library, Python extension, or Node native addon: include only the audited dependency closure of a supported workload. A C fixture may continue to test the shared glibc layer without constituting a C++ runtime product.

Do not remove data merely because it is not an ELF dependency. Audit JVM truststores/resources, Python standard-library modules and dynamically loaded extensions, Node ICU/Intl and OpenSSL configuration, and all required license texts. Size and reproducibility budgets apply separately to each variant/version/architecture. Supply-chain and vulnerability evidence must identify the language runtime and native libraries even without an RPM database.

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
- [Corretto headless packages on AL2023](https://docs.aws.amazon.com/corretto/latest/corretto-21-ug/amazon-linux-install.html) illustrate the runtime/development package boundary; this is not a commitment to a specific major version.
- [Python in AL2023](https://docs.aws.amazon.com/linux/al2023/ug/python.html) documents versioned interpreters and package support considerations.
- [Node.js in AL2023](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html) documents namespaced packages, executable paths, and alternatives.
