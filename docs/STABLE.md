# Runtime stable channels

The stable promotion workflow reuses a qualified public preview digest. Use `ghcr.io/rambow-cloud/amazon-linux-distroless/python:3.14` to follow the Python 3.14 line, or `ghcr.io/rambow-cloud/amazon-linux-distroless/python314:3.14.10-r1` to pin a fixed revision. Existing per-line tags such as `python314:3.14` remain available for compatibility.

## Published stable revisions

All ten stable channels use the same native amd64 and arm64 indexes as their qualified previews. Each regular GitHub Release contains its signed promotion record, fresh scan reports and source links.

Browse the public [Java](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fjava), [Python](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fpython), and [Node.js](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fnodejs) packages. The [initial language-tag promotion](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42359934107) records the copied digest for each version line.

| Runtime | Fixed revision | Rolling stable tag | Evidence |
| --- | --- | --- | --- |
| java17 | `java17:17.0.21-r1` | `java:17` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java17-17.0.21-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358617466) |
| java21 | `java21:21.0.13-r1` | `java:21` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java21-21.0.13-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358616498) |
| java25 | `java25:25.0.5-r1` | `java:25` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java25-25.0.5-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358616651) |
| python311 | `python311:3.11.18-r1` | `python:3.11` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python311-3.11.18-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358137861) |
| python312 | `python312:3.12.16-r1` | `python:3.12` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python312-3.12.16-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358137956) |
| python313 | `python313:3.13.18-r1` | `python:3.13` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python313-3.13.18-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358138247) |
| python314 | `python314:3.14.10-r1` | `python:3.14` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python314-3.14.10-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358138103) |
| nodejs22 | `nodejs22:22.23.4-r1` | `nodejs:22` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs22-22.23.4-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358137961) |
| nodejs24 | `nodejs24:24.22.2-r1` | `nodejs:24` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs24-24.22.2-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42358139806) |
| nodejs26 | `nodejs26:26.13.0-r1` | `nodejs:26` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs26-26.13.0-r1) · [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42357940352) |

### Exact image index digests

- `ghcr.io/rambow-cloud/amazon-linux-distroless/java@sha256:45365c585dd7501ec027a34dc95886b3097a8e6b6001befc1d8ac327b85000de`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/java@sha256:de7886e8d9b8dcda6112e6732b9d4b7dc3d3bffee4ccee5314c86ab9805f6ad0`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/java@sha256:0c354b31ec54bb950af9a97d51feaf698c7c6e4bef480d214cbccc8528724382`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/python@sha256:37e734bc93474dcb9826c9affcf68cb95409c7cf0f65cce3da930958955b3162`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/python@sha256:0acd8af15164b4957cce7db3667771a7612f18e5c274dcf3c4725ae9400e5640`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/python@sha256:bb6c059a9f689607d4e09e05dbe94e8f1470d8a4fb4329621f90104a1bf1821a`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/python@sha256:3be1cc8a55fb98b48aa0678ab71c0339e4c92e5378d0d7b473d15fbc7374f137`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs@sha256:ffe514490046f2dd761f4b2624ecea24c397dfe56fdf3d4e746cc6fcf5719b30`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs@sha256:f90819e2289b694cf165a3cb353320ea43dc3e682553dccf0aa27d21bc12131b`
- `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs@sha256:c00948070c983b92a392ef03c2fc15799c87949cb3691f20b24dc14fae7dae6d`

All ten promotions passed the fixable High/Critical gate. The stable Release assets record the scanner databases and raw findings in the fresh reports.

## Release operation

The [candidate plan](../releases/stable-candidates.json) binds the source commit, preview release, image index digest, stable revision and size ceiling. The initial ceilings round the larger native image up to an 8 MiB boundary and add 8 MiB of headroom. Each future change goes through a protected PR. Start at revision 1 for an upstream version, then increment the revision for each new digest at the same version. A higher upstream version starts its own revision 1.

After the plan merges, run the workflow on main. Check mode performs the validation and refreshes scanner evidence. Publish mode signs the promotion, records the GitHub Release and moves the rolling tag in the language package as well as the compatibility tag.

```sh
gh workflow run runtime-stable.yml --ref main -f runtime=nodejs26 -f mode=check
gh workflow run runtime-stable.yml --ref main -f runtime=nodejs26 -f mode=publish
```

The workflow verifies the signed preview index and qualified-build provenance against the trusted main workflow identity. It verifies the native reports and the CycloneDX attestation for each leaf, and compares release asset digests with the signed evidence manifest. The original preview holds the exact image and corresponding source archives. Fresh ALAS scans and applicable upstream Grype scans use the verified SBOMs and block fixable High/Critical findings. The stable release attaches the scan reports and signed promotion record.

Promotion binds the same index digest to the fixed revision tag. It verifies the copied index, build signature, build and promotion attestations, and each platform's CycloneDX attestation in the language package before moving the rolling tag. The signed promotion record still identifies the original per-line image reference. The workflow rejects downgrade attempts and collisions, and preserves published revision evidence.

Use `mode=mirror` to finish the language tag update for an existing stable release without rebuilding or refreshing its scan reports. The workflow revalidates the published release and its evidence before moving the tag.

The GitHub Release tag identifies the protected main promotion commit. The signed record identifies both that commit and the original build source commit, and the qualified preview supplies the matching build source archives.

Consumers can pin the exact index digest. Roll back a deployment by redeploying the previous accepted application and runtime digests. Use the stable release's `stable.json` to recover its digest and previous reference.

The stable attestation type is `https://rambow-cloud.github.io/amazon-linux-distroless/runtime-stable/v1`. Its certificate identity is `https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-stable.yml@refs/heads/main` and its issuer is `https://token.actions.githubusercontent.com`. The verified predicate records the runtime, revision, source commit, preview and scan checksums. Check the tag and digest in the record before using it as deployment evidence.

The runtime channels are a scoped part of [#11](https://github.com/rambow-cloud/amazon-linux-distroless/issues/11). The project release criteria and unattended upstream updates have separate milestones.

For project-wide release qualification, run `gh workflow run project-qualification.yml --ref main` after the accepted stable language candidates have been promoted. The read-only workflow runs native static/base checks and paired clean builds of each supported language on both architectures. It records normalized file inventories, OCI manifest reproducibility and size measurements using the foundation definitions. It also verifies the signed security evidence of every approved language channel and its [support window](SUPPORT.md). A missing or failing variant fails the project qualification. Foundation signing and fresh project-wide release scans remain part of [#11](https://github.com/rambow-cloud/amazon-linux-distroless/issues/11).
