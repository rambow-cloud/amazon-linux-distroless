# v1.0 release acceptance

This report records the initial stable releases of static, base, Java 17/21/25, Python 3.11–3.14 and Node.js 22/24/26 on native `linux/amd64` and `linux/arm64`. The accepted artifacts use AL2023 RPM snapshot `2023.12.20261102`. The [stable release index](STABLE.md) follows subsequent runtime updates. Use the [runtime guide](RUNTIMES.md) for packaging, signature verification and troubleshooting.

## Accepted images

Sizes are measured unpacked image bytes, excluding source archives and release evidence. The signed runtime `stable.json` records the language sizes. For static and base, the architecture metrics assets are bound by the signed `foundation-release.json`. Scan columns show finding counts at release in amd64 / arm64 order. Grype applies to the upstream Python and Node.js components.

| Image | Stable revision and evidence | OCI index digest | amd64 bytes | arm64 bytes | ALAS | Grype |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| static | [2023.12.20261102-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/foundation-2023.12.20261102-r1) | `sha256:74ad3c883feb5cd0fb61f742a7b30cc03eb2bdd9bc68e95f341fade3b9b9d257` | 209,469 | 209,469 | 0 / 0 | — |
| base | [2023.12.20261102-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/foundation-2023.12.20261102-r1) | `sha256:1a096a58c201e9bca0a8986d00b125d9de40944894305273c7fbc372de4464c6` | 5,125,843 | 5,121,819 | 0 / 0 | — |
| Java 17 | [17.0.21-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java17-17.0.21-r1) | `sha256:45365c585dd7501ec027a34dc95886b3097a8e6b6001befc1d8ac327b85000de` | 94,789,231 | 100,816,835 | 0 / 0 | — |
| Java 21 | [21.0.13-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java21-21.0.13-r1) | `sha256:de7886e8d9b8dcda6112e6732b9d4b7dc3d3bffee4ccee5314c86ab9805f6ad0` | 101,205,292 | 106,264,153 | 0 / 0 | — |
| Java 25 | [25.0.5-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java25-25.0.5-r1) | `sha256:0c354b31ec54bb950af9a97d51feaf698c7c6e4bef480d214cbccc8528724382` | 102,817,190 | 106,664,128 | 0 / 0 | — |
| CPython 3.11 | [3.11.18-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python311-3.11.18-r1) | `sha256:37e734bc93474dcb9826c9affcf68cb95409c7cf0f65cce3da930958955b3162` | 68,221,198 | 80,518,711 | 0 / 0 | 9 / 9 |
| CPython 3.12 | [3.12.16-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python312-3.12.16-r1) | `sha256:0acd8af15164b4957cce7db3667771a7612f18e5c274dcf3c4725ae9400e5640` | 78,931,221 | 90,462,987 | 0 / 0 | 8 / 8 |
| CPython 3.13 | [3.13.18-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python313-3.13.18-r1) | `sha256:bb6c059a9f689607d4e09e05dbe94e8f1470d8a4fb4329621f90104a1bf1821a` | 82,934,627 | 94,518,305 | 0 / 0 | 3 / 3 |
| CPython 3.14 | [3.14.10-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python314-3.14.10-r1) | `sha256:3be1cc8a55fb98b48aa0678ab71c0339e4c92e5378d0d7b473d15fbc7374f137` | 90,652,896 | 100,016,870 | 0 / 0 | 3 / 3 |
| Node.js 22 | [22.23.4-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs22-22.23.4-r1) | `sha256:ffe514490046f2dd761f4b2624ecea24c397dfe56fdf3d4e746cc6fcf5719b30` | 133,456,430 | 131,292,590 | 0 / 0 | 0 / 0 |
| Node.js 24 | [24.22.2-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs24-24.22.2-r1) | `sha256:f90819e2289b694cf165a3cb353320ea43dc3e682553dccf0aa27d21bc12131b` | 135,447,218 | 132,390,210 | 0 / 0 | 0 / 0 |
| Node.js 26 | [26.13.0-r1](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs26-26.13.0-r1) | `sha256:c00948070c983b92a392ef03c2fc15799c87949cb3691f20b24dc14fae7dae6d` | 158,921,595 | 159,540,219 | 0 / 0 | 0 / 0 |

Append `@sha256:…` to the image name to pin an index. The language repositories are `java`, `python` and `nodejs` under `ghcr.io/rambow-cloud/` and `quay.io/rambow-cloud/`. For foundation images, use `static` or `base` under `ghcr.io/rambow-cloud/amazon-linux-distroless/`. See the [foundation guide](FOUNDATION.md) and [runtime guide](RUNTIMES.md) for exact references and verification commands.

The foundation model measured gzip transfer sizes of 124,258 bytes for static on both architectures, and 2,189,529 bytes for base on amd64 and 1,840,660 on arm64. CI applies the [foundation budgets](../images/foundation/budgets.json) and the [language size ceilings](../releases/stable-candidates.json).

## Native and release verification

| Check | Verified evidence |
| --- | --- |
| Full project qualification | The [native matrix](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42397622185) passed workload, hardening, file inventory, support and size checks. All 20 pairs of clean language builds matched on normalized files, OCI manifests and layer digests. Open its `project-qualification-report` artifact for per-platform results. |
| Foundation reproducibility | The [paired foundation builds](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42387240281) matched normalized files and OCI manifest digests for both variants on both architectures. The two independently assembled indexes also matched. |
| Public runtime registries | The [native mirror run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42381331964) pulled and ran all ten signed language indexes anonymously on GHCR and Quay on both architectures. It checked version tags, build signatures, stable promotion records and platform SBOM attestations. |
| Foundation publication and pull | The [foundation publication](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42366198722) signed the two indexes and preserved their platform SBOMs, source and security reports. The [native pull run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42397364808) pulled both images by digest and verified their signatures and platform evidence. |
| Consumer examples | All six [stable consumer jobs](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42366432351) verified signature and SBOM evidence, then built and ran a Java 21 JAR, a Python 3.14 native wheel, and Node.js 24 ESM/CommonJS with a native addon. They used the pinned images above, numeric non-root users, read-only root filesystems and temporary mounts. [Foundation probes](FOUNDATION.md) cover static Go and AL2023-linked workloads. |

Each release provides or links to the source commit, runtime archive, native verification, payload inventory, component licenses and matching source. Verify the OCI index signature and stable promotion attestation, then verify the CycloneDX attestation for the selected platform manifest. For files downloaded from GitHub Releases, use the checksums bound to the signed release evidence. See [language verification](RUNTIMES.md#application-packaging) and [foundation verification](FOUNDATION.md#stable-foundation-promotion).

## Security and support

Trivy scanned the RPMs identified in the actual payload SBOMs with the AL2023 advisory matcher. Grype scanned upstream Python and Node.js SBOMs bound to the signed release evidence. The [read-only stable recheck](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42405911136) passed all ten version lines against the same immutable digests on 2026-11-07 UTC. It reported the same counts shown above. The Python findings were Medium, Low or Negligible. No High or Critical findings or applied exceptions were reported in the language recheck. The [foundation release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/foundation-2023.12.20261102-r1) recorded zero ALAS findings and zero exceptions for its four platform payloads.

Open the recheck's `<runtime>-stable-evidence` artifacts for fresh raw scans. Published releases retain their original scans and database metadata. Consult the [security policy](../SECURITY.md#stable-vulnerability-gate) for gate scope, advisory coverage and exception handling. Scan counts are specific to the evidence and database timestamp. Scan application dependencies separately.

The [support policy](SUPPORT.md) defines per-line maintenance windows, ABI boundaries, ownership and retirement. The [protected refresh and rollback runbook](UPDATING.md) describes AL2023 and language updates and redeployment using the previous verified application and runtime digests. The [trusted AL2023 rehearsal](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42398613175) exercised the reconciler on main while the upstream snapshot was unchanged. The first real newer snapshot will exercise automated merge and publication.

## Deferred scope

The v1.1 [isolated debugging RFC](https://github.com/rambow-cloud/amazon-linux-distroless/issues/15) tracks the decision on a separate debug image. Use the [current troubleshooting guide](RUNTIMES.md#runtime-behavior-and-troubleshooting) for shell-free operations. Additional language lines, platforms and FIPS certification require separate qualification and scope.
