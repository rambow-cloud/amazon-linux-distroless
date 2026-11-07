# Java 21 preview delivery

The first Java delivery uses Amazon Corretto 21.0.13 and the AL2023 2023.12.20261102 package snapshot. It is qualified on native linux/amd64 and linux/arm64. See the [v1.0 acceptance report](V1-ACCEPTANCE.md) for the initial stable releases.

## Image and source

[GitHub prerelease and permanent source/evidence assets](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java21-194d482cb102). The source RPM bundles, project source, exact Docker archives, inventories, SBOMs, locks, runtime checks, raw scans, database fingerprint and SHA256SUMS are attached there. Component licenses remain individual.

- Immutable version: `ghcr.io/rambow-cloud/amazon-linux-distroless/java21:java21-194d482cb102`
- Rolling preview: `ghcr.io/rambow-cloud/amazon-linux-distroless/java21:21-preview`
- Qualified two-platform index: `ghcr.io/rambow-cloud/amazon-linux-distroless/java21@sha256:c275c49d30bb1d3cda32b8e9f058b3d4e35b38f9c35df559380a4fa790013e99`
- amd64 manifest: `sha256:1991fe3d62550e8a7115c66a4c6d3e3ce07de9a02fb88b5417bcf820b05eb4b8`
- arm64 manifest: `sha256:b06455560400f997b19e54833f56ca6e7602412566e617973c54aa4f40493c25`

The [GHCR Java package](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fjava21) is Public and supports anonymous pulls. On November 7, 2026, the owner authorized enabling Public package creation for the organization and making this package Public; GitHub's package settings confirmed the resulting public state. The original publication report correctly records private visibility at publication time and is retained unchanged. This permission change did not rebuild or alter the qualified image digest. The public GitHub Release also provides downloadable runtime archives with matching source.

Run Java directly without a registry login:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m ghcr.io/rambow-cloud/amazon-linux-distroless/java21@sha256:c275c49d30bb1d3cda32b8e9f058b3d4e35b38f9c35df559380a4fa790013e99 -version
```

For an existing executable JAR, copy it into a derived image:

```dockerfile
FROM ghcr.io/rambow-cloud/amazon-linux-distroless/java21@sha256:c275c49d30bb1d3cda32b8e9f058b3d4e35b38f9c35df559380a4fa790013e99
COPY --chown=65532:65532 app.jar /app/app.jar
CMD ["-jar", "/app/app.jar"]
```

Use a compatible builder for compilation and application dependencies; the runtime entrypoint is already `/usr/bin/java`. [The multi-stage example](../examples/java-app/Dockerfile) is suitable for application CI. JVM options precede `-jar` in the JSON CMD. Shell expansion and `JAVA_OPTS` wrappers are unavailable; use explicit arguments or standard JVM environment options such as `JAVA_TOOL_OPTIONS`.

## Signatures and security evidence

The publication run verified the keyless index signature and qualified-build attestation before advancing the preview alias. Per-architecture CycloneDX attestations are attached to their respective leaf manifests. The prerelease includes `published.json`, `provenance.json`, `cosign-verification.json` and `attestation-verification.json`.

```sh
cosign verify --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/java21-publish.yml@refs/heads/main' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/rambow-cloud/amazon-linux-distroless/java21@sha256:c275c49d30bb1d3cda32b8e9f058b3d4e35b38f9c35df559380a4fa790013e99

cosign verify-attestation --type 'https://rambow-cloud.github.io/amazon-linux-distroless/java21-qualified-build/v1' --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/java21-publish.yml@refs/heads/main' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/rambow-cloud/amazon-linux-distroless/java21@sha256:c275c49d30bb1d3cda32b8e9f058b3d4e35b38f9c35df559380a4fa790013e99
```

Trivy 0.76.2 recognized all 23 payload RPM identities on each architecture and returned zero matched ALAS findings using the same database fingerprint `112895ef5c65cfe71007fc6d1ba8df0b6652412cd5c869f95e3d4723b4912508`. This does not cover all possible AL2023 unfixed or JVM vulnerabilities. The raw scan reports and `security.json` preserve the actual result and limitation.

## Recorded build

Source: [194d482cb102fb35ea46bc2f064686986b19dc1e](https://github.com/rambow-cloud/amazon-linux-distroless/commit/194d482cb102fb35ea46bc2f064686986b19dc1e). [Trusted main publication run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42320474372).

| Platform | Uncompressed image bytes | Runtime modules | Payload RPM identities | Runtime checks |
| --- | ---: | ---: | ---: | ---: |
| linux/amd64 | 100,853,475 | 45 | 23 | 16 passed |
| linux/arm64 | 105,912,336 | 45 | 23 | 16 passed |

Each platform passed saved-image inventory validation, nonroot/PID 1 execution, read-only root and tmpfs writes, agents, 135 JVM trust anchors, headless fonts/ImageIO, compiler implementation absence, UTF-8/UTC, controlled service-name resolution, positive TLS, rejection of an untrusted issuer and wrong hostname, SIGTERM/shutdown hook/143, application exit propagation and shell absence. No image was built or scanned locally.

The runtime is a generic JRE produced by the locked Corretto JDK/JMods, with the [explicit module contract](../images/java21/runtime.json). Required native dependencies and basic Noto Sans headless text support are included. Maven/Gradle/javac, a shell, a package manager and the RPM database are absent. See [the full runtime contract and limitations](JAVA21.md).

## Maintenance

[AL2023 discovery on main](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42320480665) confirmed the official :2023 builder digest and repository release match the reviewed locks. Daily discovery runs at 03:17 UTC and creates a deduplicated update issue when the official builder changes. Discovery does not modify released images. Review both native lock updates, pass the Java gate, merge, then run the trusted publisher to produce a new version; consumers rebuild their applications against that version. [Update runbook](UPDATING.md).

The three historical CVE comparison workflows remain disabled. The Java publication scan checks the exact shipped RPM metadata against ALAS and blocks known fixable High/Critical findings. ALAS unfixed coverage and JVM advisory matching remain limited. Scanner totals do not establish a security ranking against Debian-based Distroless or prove absence of vulnerabilities.
