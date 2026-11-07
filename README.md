# Amazon Linux Distroless

Distroless-like OCI runtime images for Java, Python, and Node.js, assembled from verified AL2023 system packages and locked language releases.

**Status: Static, base, Java 17/21/25, Python 3.11–3.14 and Node.js 22/24/26 have public signed stable images on native amd64/arm64. Project-wide stable v1 is not yet released.** Start with the [foundation images](docs/FOUNDATION.md) and [delivered languages](docs/RUNTIMES.md) for image references, immutable digests, examples and verification. Each delivered GHCR package is public; its GitHub Release preserves runtime archives and matching source.

The project targets small, auditable application runtimes with no shell or package manager, a non-root default user, and traceable AL2023 package provenance. This is an independent community project, not an AWS or Google Distroless distribution.

Use `ghcr.io/rambow-cloud/nodejs:22` or `quay.io/rambow-cloud/nodejs:22` to follow the Node.js 22 stable line. Java and Python use the same short paths on both registries. Each language's `latest` tag follows its highest published stable version. See the [stable release index](docs/STABLE.md) for supported version lines, fixed revisions and verified digests.

## Image contract and scope

| Variant | Intended workload | Contents |
| --- | --- | --- |
| `static` | Fully static binaries, initially Go with `CGO_ENABLED=0` | CA trust, minimal user/group and filesystem metadata; no glibc |
| `base` | Dynamically linked applications built against compatible AL2023 libraries | `static` contents plus the AL2023 glibc loader and verified runtime dependency closure |
| `java` | Headless Java applications | `base` plus the selected Amazon Corretto headless runtime, JVM trust configuration, and audited native dependencies |
| `python` | Applications written in Python with builder-installed dependencies | `base` plus the selected Python interpreter, standard library, and required extension libraries |
| `nodejs` | Node.js applications with builder-installed production dependencies | `base` plus the selected Node.js runtime and audited native/data dependencies |

Targets: `linux/amd64` and `linux/arm64`. The first foundation prototype starts with amd64; v1.0 requires all five variants on both architectures. Java, Python, and Node.js are committed deliverables, introduced in v0.3 before the stable release. Default identity: UID/GID `65532:65532`. Production images must not contain shells, package managers, compilers, or build caches.

There is no standalone `cc` image or general C++ application support. Audited native libraries such as `libstdc++` remain permitted when required by a supported Java, Python, or Node.js runtime. `static` and `base` remain shared foundations rather than a C++ product line.

The versioned language matrix includes Java 17/21/25, Python 3.11–3.14 and Node.js 22/24/26. Java uses AL2023 Corretto RPMs. Python builds from signed CPython source and Node.js uses signed upstream binaries. The [upstream runtime guide](docs/UPSTREAM-RUNTIMES.md) describes the inputs and runtime assembly. No floating system default is a version contract.

All language preview references are recorded in [runtime delivery](docs/RUNTIMES.md). [Support boundaries](docs/SUPPORT.md) define lifecycle, ABI and maintenance ownership; [update operations](docs/UPDATING.md) cover refreshes and rollback.

## Implementation approach

1. Pin an official AL2023 builder image by digest and select an explicit AL2023 repository release.
2. Verify signed AL2023 RPM inputs and the upstream Python or Node.js release. Keep exact checksums, version locks, licenses and source references.
3. Assemble a reviewed file allowlist into a clean root filesystem, including transitive ELF dependencies and runtime configuration.
4. Copy that filesystem into a `FROM scratch` image and validate the actual final image.
5. Assemble separate Java, Python, and Node.js variants with application dependencies installed in compatible builders. Validate runtime-loaded files and native extension/addon compatibility.
6. Build all variants for both architectures, generate SBOM and provenance, scan, sign, and publish immutable release references.

The official AL2023 minimal image still includes a package manager. It can be a comparison baseline, but it does not satisfy this project's final-image contract. See [architecture](docs/ARCHITECTURE.md) for decisions and unresolved questions.

## Start here

- [Implementation roadmap](docs/ROADMAP.md) — milestones, dependencies, and exit criteria.
- [Delivered runtimes](docs/RUNTIMES.md) — all ten version lines and immutable delivery evidence.
- [Java prototype](docs/PROTOTYPE.md) — inspect a real Actions-built preview and its evidence.
- [Java 21 runtime](docs/JAVA21.md) — JRE module/file contract, native qualification, updates and preview publishing.
- [Open issues](https://github.com/rambow-cloud/amazon-linux-distroless/issues) — executable development backlog.
- [Milestones](https://github.com/rambow-cloud/amazon-linux-distroless/milestones) — release scope and progress.
- [Contributing](CONTRIBUTING.md) — issue-first workflow and pull request requirements.
- [Security policy](SECURITY.md) — reporting and planned release security requirements.

## Repository governance

Use an [Issue Form](https://github.com/rambow-cloud/amazon-linux-distroless/issues/new/choose) before starting implementation. Maintainers triage the issue, set its milestone and labels, and move it to `status:ready`. A PR must include a standalone closing reference such as `Closes #2`. The `Issue policy` check verifies the issue's metadata and acceptance criteria. Branch protection requires this check before merging to `main`.

Labels and milestones are versioned in [.github/labels.json](.github/labels.json) and [.github/milestones.json](.github/milestones.json). Preview configuration changes with:

```sh
node scripts/sync-github-config.mjs --repo rambow-cloud/amazon-linux-distroless
```

Maintainers can apply the preview using `--apply` with an authenticated GitHub CLI. The script updates configured entries and preserves unrelated labels and milestones. It never reopens closed milestones.

## License

Project-authored code and documentation use Apache-2.0. Redistributed AL2023 components retain their respective licenses. License notices, source availability obligations, and package provenance must be resolved before publishing images.

## References

- [AL2023 deterministic upgrades](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html)
- [AL2023 minimal container image](https://docs.aws.amazon.com/linux/al2023/ug/minimal-container.html)
- [AL2023 release cadence](https://docs.aws.amazon.com/linux/al2023/ug/release-cadence.html)
- [Google Distroless](https://github.com/GoogleContainerTools/distroless)
