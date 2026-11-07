# Official upstream runtime previews

All seven releases are public on GHCR with native linux/amd64 and linux/arm64 manifests. The publisher verified the keyless index signature and qualified-build provenance before moving each preview alias. The source commit is b1e33dc620f5e8065e766457110b353996e2b0dd.

| Runtime | Release version | Preview tag | Publication evidence |
| --- | --- | --- | --- |
| Python 3.11 | 3.11.18 | `python311:3.11-preview` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python311-b1e33dc620f5) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42347617380) |
| Python 3.12 | 3.12.16 | `python312:3.12-preview` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python312-b1e33dc620f5) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42347620613) |
| Python 3.13 | 3.13.18 | `python313:3.13-preview` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python313-b1e33dc620f5) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42347618160) |
| Python 3.14 | 3.14.10 | `python314:3.14-preview` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python314-b1e33dc620f5) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42347242133) |
| Node.js 22 | 22.23.4 | `nodejs22:22-preview` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs22-b1e33dc620f5) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42347617295) |
| Node.js 24 | 24.22.2 | `nodejs24:24-preview` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs24-b1e33dc620f5) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42347619890) |
| Node.js 26 | 26.13.0 | `nodejs26:26-preview` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs26-b1e33dc620f5) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42347241888) |

## Immutable image references

- `ghcr.io/rambow-cloud/amazon-linux-distroless/python311@sha256:37e734bc93474dcb9826c9affcf68cb95409c7cf0f65cce3da930958955b3162`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/python312@sha256:0acd8af15164b4957cce7db3667771a7612f18e5c274dcf3c4725ae9400e5640`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/python313@sha256:bb6c059a9f689607d4e09e05dbe94e8f1470d8a4fb4329621f90104a1bf1821a`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/python314@sha256:3be1cc8a55fb98b48aa0678ab71c0339e4c92e5378d0d7b473d15fbc7374f137`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs22@sha256:ffe514490046f2dd761f4b2624ecea24c397dfe56fdf3d4e746cc6fcf5719b30`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24@sha256:f90819e2289b694cf165a3cb353320ea43dc3e682553dccf0aa27d21bc12131b`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs26@sha256:c00948070c983b92a392ef03c2fc15799c87949cb3691f20b24dc14fae7dae6d`

Each release includes image archives, exact payload inventories, SBOMs, upstream release signatures and sources, matching AL2023 source RPMs, native runtime evidence and raw vulnerability reports.

| Runtime | ALAS matches amd64 / arm64 | Grype upstream matches amd64 / arm64 |
| --- | --- | --- |
| python311 | 0 / 0 | 9 / 9 |
| python312 | 0 / 0 | 8 / 8 |
| python313 | 0 / 0 | 3 / 3 |
| python314 | 0 / 0 | 3 / 3 |
| nodejs22 | 0 / 0 | 0 / 0 |
| nodejs24 | 0 / 0 | 0 / 0 |
| nodejs26 | 0 / 0 | 0 / 0 |

All publications passed the fixable High/Critical gate. The Python matches were Medium, Low or Negligible. The Node.js scans returned zero matches in these snapshots. The recorded counts come from the scanner database snapshots in security.json. Coverage depends on advisory feeds, runtime and embedded component identity, and applicability.

For Cosign verification use certificate identity `https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-publish.yml@refs/heads/main` and issuer `https://token.actions.githubusercontent.com`. Each release records its predicate type, per-platform manifest digests and verification results.

See [assembly and updates](UPSTREAM-RUNTIMES.md) and [the complete runtime index](RUNTIMES.md).
