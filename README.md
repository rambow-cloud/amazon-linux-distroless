# Amazon Linux Distroless

Distroless-like OCI runtime images assembled from Amazon Linux 2023 packages.

**Status: planning and repository bootstrap. No runtime images have been built or published yet.**

The project targets small, auditable application runtimes with no shell or package manager, a non-root default user, and traceable AL2023 package provenance. This is an independent community project, not an AWS or Google Distroless distribution.

## Planned image contract

| Variant | Intended workload | Planned contents |
| --- | --- | --- |
| `static` | Fully static binaries, initially Go with `CGO_ENABLED=0` | CA trust, minimal user/group and filesystem metadata; no glibc |
| `base` | Dynamically linked applications built against compatible AL2023 libraries | `static` contents plus the AL2023 glibc loader and verified runtime dependency closure |
| `cc` (later) | C++ applications | `base` plus explicitly selected C++ runtime libraries |

Targets: `linux/amd64` and `linux/arm64`. The first prototype starts with amd64; both architectures are required for v1.0. Default identity: UID/GID `65532:65532`. Production images must not contain shells, package managers, compilers, or build caches. Debugging and language runtimes have separate follow-up issues.

Image names and tags remain proposals until the release-policy issue is accepted. Do not use example registry paths as available artifacts.

## Implementation approach

1. Pin an official AL2023 builder image by digest and select an explicit AL2023 repository release.
2. Resolve and verify official RPMs in the builder; retain package checksums, versions, licenses, and source references.
3. Assemble a reviewed file allowlist into a clean root filesystem, including transitive ELF dependencies and runtime configuration.
4. Copy that filesystem into a `FROM scratch` image and validate the actual final image.
5. Build both architectures, generate SBOM and provenance, scan, sign, and publish immutable release references.

The official AL2023 minimal image still includes a package manager. It can be a comparison baseline, but it does not satisfy this project's final-image contract. See [architecture](docs/ARCHITECTURE.md) for decisions and unresolved questions.

## Start here

- [Implementation roadmap](docs/ROADMAP.md) — milestones, dependencies, and exit criteria.
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
