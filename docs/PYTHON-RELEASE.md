# Python 3.14 delivery

Python **3.14.8** has a public signed linux/amd64 + linux/arm64 preview, following Java 17/21/25. Node.js #22 is the remaining requested runtime; project-wide stable v1 acceptance remains open.

[Trusted main publication](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42336514085) · [Permanent release/source/evidence](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python314-bb4ed2b45f00) · [Public package](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fpython314)

Source: [bb4ed2b45f0037bcb10b2c84e6e891ed99f22c51](https://github.com/rambow-cloud/amazon-linux-distroless/commit/bb4ed2b45f0037bcb10b2c84e6e891ed99f22c51), AL2023 repository snapshot 2023.12.20261102.

- Immutable version: `ghcr.io/rambow-cloud/amazon-linux-distroless/python314:python314-bb4ed2b45f00`
- Rolling preview: `ghcr.io/rambow-cloud/amazon-linux-distroless/python314:3.14-preview`
- Qualified two-platform index: `ghcr.io/rambow-cloud/amazon-linux-distroless/python314@sha256:fb8b7c9aacc27b4f8d7a21c8023f2b29acce60664a2ba7792388c364e6e61aed`
- amd64 leaf: `sha256:f3b9cf2ae860ef3c0cc52df09ef48d8ffa4d3824c0e41d036824d8ca012e0458`
- arm64 leaf: `sha256:4f3077daffeb011e5245df2a0d0b346e0ed5f5bad9fc8c9ac00c775452786b4c`

| Platform | Observed Python | Uncompressed bytes | Native SOABI | Payload RPMs | Runtime check groups |
| --- | --- | ---: | --- | ---: | --- |
| amd64 | 3.14.8 | 41,771,991 | cpython-314-x86_64-linux-gnu | 23 | 18 passed |
| arm64 | 3.14.8 | 50,957,626 | cpython-314-aarch64-linux-gnu | 23 | 18 passed |

Each native run verified exact saved runtime file hashes/modes/owners/symlinks, nonroot/PID 1/read-only execution, tmpfs and Unicode filename/content behavior, script/module entrypoints, explicit application dependency paths, an architecture-specific cp314 wheel compiled from project-owned C source and installed by builder-only pip, SSL/ctypes/compression/SQLite, 135 system CA trust anchors, no installers/cache, controlled DNS/TLS including rejection cases, SIGTERM/shutdown hook/143, application exit status and shell absence. Wheel identity, native binary/source information and hashes are recorded in verification.json.

The official interpreter's RPM transaction includes an installer-wheel dependency. The runtime allowlist omits that payload, retains applicable notices, and the saved-image audit rejects .whl archives and build headers. The 23-RPM payload SBOM excludes notice-only/unshipped transaction inputs; it does not claim that every installed builder dependency ships. No pip/ensurepip module, compiler or shell is available in the runtime.

The publisher checked all 23 payload RPM identities on each architecture and reported zero matched ALAS findings. Raw scans/database fingerprints remain in security.json and scan reports. ALAS unfixed/language-runtime coverage remains limited; clean results do not prove zero exposure. Application dependencies need their own scanning and ABI qualification. The prerelease preserves matching source RPM bundles, project source, runtime image archives, SBOMs, inventories, locks, native verification, checksums and signature/provenance verification. Component licenses remain individual.

## Use and verify

The entrypoint is /usr/bin/python3.14, with a /usr/bin/python3 alias. Dependencies belong in /opt/python/site-packages via the documented PYTHONPATH; use a compatible builder with explicit pip --target. No runtime bytecode writes are needed. [The multi-stage native-dependency example](../examples/python-app/Dockerfile) defaults to this immutable runtime. [The full contract](PYTHON.md) records exclusions, OpenSSL trust/providers, read-only startup and ABI boundaries.

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m ghcr.io/rambow-cloud/amazon-linux-distroless/python314@sha256:fb8b7c9aacc27b4f8d7a21c8023f2b29acce60664a2ba7792388c364e6e61aed --version
```

The index signature and qualified-build provenance were verified before the preview alias advanced. Per-architecture CycloneDX attestations are attached to their leaf manifests. Repeat verification using the actual digest and workflow identity:

```sh
cosign verify --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-publish.yml@refs/heads/main' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/rambow-cloud/amazon-linux-distroless/python314@sha256:fb8b7c9aacc27b4f8d7a21c8023f2b29acce60664a2ba7792388c364e6e61aed
cosign verify-attestation --type 'https://rambow-cloud.github.io/amazon-linux-distroless/python314-qualified-build/v1' --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-publish.yml@refs/heads/main' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/rambow-cloud/amazon-linux-distroless/python314@sha256:fb8b7c9aacc27b4f8d7a21c8023f2b29acce60664a2ba7792388c364e6e61aed
```

For updates, resolve/review both native locks with runtime-lock.yml, qualify the PR, merge, then run runtime-publish.yml with runtime=python314 on main. Rebuild consumer application images against the new accepted digest. The daily builder detector proposes work; it does not mutate released images. All container builds, scans and runtime tests ran only in GitHub Actions.
