# Java 17, 21 and 25 delivery

All three Corretto Java lines have public signed previews for native linux/amd64 and linux/arm64. These releases use AL2023 snapshot 2023.12.20261102 and source commit [40a17983a91aac4c160110710ec26185a6616bff](https://github.com/rambow-cloud/amazon-linux-distroless/commit/40a17983a91aac4c160110710ec26185a6616bff). Python #21 and Node.js #22 are the next deliverables; the full language goal and project-wide stable v1 acceptance remain open.

| Java | Observed JVM version | amd64 uncompressed | arm64 uncompressed | JRE modules | Payload RPMs per architecture | Source and evidence |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 17 | 17.0.21 | 90.40 MiB | 96.15 MiB | 45 | 24 | [Release/source](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java17-40a17983a91a) |
| 21 | 21.0.13 | 96.52 MiB | 101.34 MiB | 45 | 24 | [Release/source](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java21-40a17983a91a) |
| 25 | 25.0.5 | 98.05 MiB | 101.72 MiB | 44 | 24 | [Release/source](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java25-40a17983a91a) |

Each trusted publication run passed 16 runtime check groups on each architecture: saved-image inventory hashes/modes/ownership/symlinks, PID 1/nonroot, read-only root/tmpfs, Java agent, 135 JVM trust anchors, fonts/ImageIO, compiler implementation absence, UTF-8/UTC including Unicode filename/content round trips, controlled service-name resolution, trusted TLS, wrong-hostname and untrusted-root rejection, SIGTERM/shutdown hook/143, application exit propagation and shell absence. Architecture parity is required within each major. Java 25 has 44 linked modules rather than 45 because its crypto module layout differs; per-major module contracts remain explicit.

The publisher verified exact payload RPM scan coverage, the keyless index signature and qualified-build provenance before moving that major's preview alias. Per-architecture CycloneDX SBOM attestations are attached to leaf manifests. All three publication reports record Public GHCR visibility. Scan totals and database fingerprints are in each release's security.json/raw reports; ALAS unfixed and JVM advisory coverage remain limited, so clean scans do not prove zero exposure or a security advantage over Debian-based Distroless.

Every prerelease permanently contains exact Docker image archives, matching signed/checksummed source RPM bundles, project source, locks, inventories, payload SBOMs/package metadata, native verification, raw scans, checksums and signature/provenance verification results. Component licenses remain individual. The original [Java 21 delivery](JAVA21-RELEASE.md) remains a historical immutable release; its old digest/source record is preserved.

## Java 17

[Public package](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fjava17) · [Trusted publication run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42333985070) · [Corresponding source and evidence](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java17-40a17983a91a)

- Version tag: `ghcr.io/rambow-cloud/amazon-linux-distroless/java17:java17-40a17983a91a`
- Rolling preview: `ghcr.io/rambow-cloud/amazon-linux-distroless/java17:17-preview`
- Immutable two-platform index: `ghcr.io/rambow-cloud/amazon-linux-distroless/java17@sha256:45365c585dd7501ec027a34dc95886b3097a8e6b6001befc1d8ac327b85000de`
- amd64 leaf: `sha256:784e07b9cc6b8cd284dd8e78cc05700784b2bc31c30f47664529a869389b84e2`
- arm64 leaf: `sha256:776c35966a301ffe7396042c6291e9f20503603e12754be52d4099e2d01df61a`
- Qualified-build predicate: `https://rambow-cloud.github.io/amazon-linux-distroless/java17-qualified-build/v1`

## Java 21

[Public package](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fjava21) · [Trusted publication run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42334012867) · [Corresponding source and evidence](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java21-40a17983a91a)

- Version tag: `ghcr.io/rambow-cloud/amazon-linux-distroless/java21:java21-40a17983a91a`
- Rolling preview: `ghcr.io/rambow-cloud/amazon-linux-distroless/java21:21-preview`
- Immutable two-platform index: `ghcr.io/rambow-cloud/amazon-linux-distroless/java21@sha256:de7886e8d9b8dcda6112e6732b9d4b7dc3d3bffee4ccee5314c86ab9805f6ad0`
- amd64 leaf: `sha256:402def582d4407857a32b48b4ce152d6e9687dd696be9e4c6487fdafc5e17dae`
- arm64 leaf: `sha256:c6be73e1a2c7e0799a35378b09690bd519ed5035183e7a2f3c54d76eca724128`
- Qualified-build predicate: `https://rambow-cloud.github.io/amazon-linux-distroless/java21-qualified-build/v1`

## Java 25

[Public package](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fjava25) · [Trusted publication run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42333989027) · [Corresponding source and evidence](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java25-40a17983a91a)

- Version tag: `ghcr.io/rambow-cloud/amazon-linux-distroless/java25:java25-40a17983a91a`
- Rolling preview: `ghcr.io/rambow-cloud/amazon-linux-distroless/java25:25-preview`
- Immutable two-platform index: `ghcr.io/rambow-cloud/amazon-linux-distroless/java25@sha256:0c354b31ec54bb950af9a97d51feaf698c7c6e4bef480d214cbccc8528724382`
- amd64 leaf: `sha256:3428fb156e73771cf928149122b3c02db5b0fc0810d5013839e6dd049421029a`
- arm64 leaf: `sha256:5309184615dc3223792d4167973ee6a352895812ba96e6c332637d4edacd18d7`
- Qualified-build predicate: `https://rambow-cloud.github.io/amazon-linux-distroless/java25-qualified-build/v1`

## Application configuration

Select the Java line matching the application's required class-file version and native dependencies. Compile/install dependencies in a compatible JDK builder, then copy the executable JAR into a derived image. For example, for Java 17:

```dockerfile
FROM ghcr.io/rambow-cloud/amazon-linux-distroless/java17@sha256:45365c585dd7501ec027a34dc95886b3097a8e6b6001befc1d8ac327b85000de
COPY --chown=65532:65532 app.jar /app/app.jar
CMD ["-jar", "/app/app.jar"]
```

The entrypoint is already /usr/bin/java; JAVA_HOME=/opt/java. Pass JVM arguments before -jar in JSON CMD or use standard JVM environment options such as JAVA_TOOL_OPTIONS. There is no shell wrapper or compiler implementation. Use a read-only root and /tmp tmpfs:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m APPLICATION_IMAGE
```

The runtime includes basic Noto Sans headless text support, not a general desktop/JSP compiler/CJK-font/JNI dependency bundle. See [the runtime boundaries](JAVA21.md) and [per-major configuration](JAVA.md).

## Signature verification

The shared main-only workflow retains its historical filename. For every major, require certificate identity `https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/java21-publish.yml@refs/heads/main` and issuer `https://token.actions.githubusercontent.com`. Verify the selected immutable index and its major-specific predicate. For Java 17:

```sh
cosign verify --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/java21-publish.yml@refs/heads/main' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/rambow-cloud/amazon-linux-distroless/java17@sha256:45365c585dd7501ec027a34dc95886b3097a8e6b6001befc1d8ac327b85000de
cosign verify-attestation --type 'https://rambow-cloud.github.io/amazon-linux-distroless/java17-qualified-build/v1' --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/java21-publish.yml@refs/heads/main' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/rambow-cloud/amazon-linux-distroless/java17@sha256:45365c585dd7501ec027a34dc95886b3097a8e6b6001befc1d8ac327b85000de
```

For Java 21/25, substitute the corresponding digest and predicate from the recorded release above. [Update operations](UPDATING.md) cover daily upstream discovery, reviewed per-major native lock refreshes, publishing, consumer rebuilds and rollback. All container builds, scans and runtime checks ran in GitHub Actions.
