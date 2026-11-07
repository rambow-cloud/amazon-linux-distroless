# Java 21 runtime contract

Java is delivered first, under [#20](https://github.com/rambow-cloud/amazon-linux-distroless/issues/20) and [RFC #37](https://github.com/rambow-cloud/amazon-linux-distroless/issues/37). Python and Node.js follow Java and remain required v1 deliverables. Java preview publication is tracked in #39; a Java preview does not declare the full project v1 support/release milestone complete.

## Runtime

- Native linux/amd64 and linux/arm64, Amazon Corretto 21.0.13 from the explicit AL2023 2023.12.20261102 snapshot.
- FROM scratch, UID/GID 65532:65532, nonroot user/group, /app working directory, JAVA_HOME=/opt/java, PATH=/usr/bin, UTF-8 and UTC.
- ENTRYPOINT ["/usr/bin/java"], default CMD ["-version"]. Pass JVM options and an executable JAR directly. There is no shell expansion or wrapper process; Java is PID 1.
- A generic JRE is linked with same-version, locked Corretto devel/JMods tools. [runtime.json](../images/java21/runtime.json) is the versioned module contract: java.se and explicit runtime providers, agents, management/JFR, networking, security, character sets, locale, ZIP and headless capabilities. This is not an application-specific jdeps-derived runtime.
- Compiler/linker/javadoc/jar/debug-tool implementation modules and standalone tool commands are excluded. Standard java.compiler interfaces remain part of Java SE, but ToolProvider.getSystemJavaCompiler() is null. Required native JVM helpers under lib are retained. No JMods, headers, manpages, package manager, RPM database, shell or build cache is shipped.
- A reviewed Noto Sans variable-font family, fontconfig and required native closure support basic headless text and ImageIO. Interactive GUI/X11/splash natives are excluded. Additional fonts, CJK coverage, GUI workloads, JSP/runtime compilation, arbitrary native agents and application JNI libraries require explicit compatible application dependencies and qualification.
- Java/default trust anchors use the AL2023 RPM-generated JVM truststore. The native system-release marker and os-release identify AL2023. This does not constitute a FIPS claim.
- Use a read-only root and an explicit /tmp tmpfs. XDG_CACHE_HOME=/tmp/.cache supports font caches. Runtime package/input/source/component licenses remain individual; the project's Apache-2.0 license does not relicense Corretto/glibc/fonts.

## Build and update entry points

[packages.json](../images/java21/packages.json) selects the official builder, repository snapshot and package roots. Exact reviewed locks are [amd64](../locks/java21/linux-amd64.json) and [arm64](../locks/java21/linux-arm64.json). JMods are a builder-only package; every selected JMod hash and its package identity is recorded in the runtime transform manifest. Generated JRE files are explicitly attributed to the same-version runtime package and marked as transformed, rather than asserted to be unchanged RPM files.

All builds run in Actions. Java 21 lock update resolves candidate locks on native runners and uploads one artifact per architecture. Maintainers review/commit both locks before the Java 21 qualification PR workflow builds/validates. Its always-reported Java 21 gate requires both architectures when Java inputs/assembly/fixtures change; unrelated PRs do not trigger duplicate image builds. The original prototype build remains manual-only.

After integration into main:

```sh
gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref UPDATE_BRANCH
gh workflow run java21-build.yml --repo rambow-cloud/amazon-linux-distroless --ref UPDATE_BRANCH
```

The builder discovery workflow follows the maintained Java input/amd64 lock. A changed builder still requires reviewed lock generation for both native architectures. See [the update procedure](UPDATING.md).

## Qualification

Each architecture verifies the saved image layer contents/hashes/modes/owners/symlinks against its file inventory before Docker injects container mounts. Runtime probes run direct executable JARs as PID 1/nonroot with a read-only root, tmpfs, dropped capabilities and no-new-privileges. They cover JAVA_HOME, UTF-8/UTC, temporary files, Java Agent startup, compiler capability absence, default trust anchors, font rasterization/ImageIO, application exit 17 and shell absence.

A controlled internal Docker network hosts a temporary HTTPS Java service. The client resolves the service name, verifies the fixture's trusted certificate and hostname, rejects an untrusted trust root and wrong hostname, then the server handles SIGTERM with a shutdown hook and exit 143. This is a container runtime contract check, not a public/local DNS infrastructure validation. Test keys/certificates belong only to the fixture image, not the delivered runtime.

Artifacts are split into the runtime Docker archive, SBOM/file/package/lock/verification/project-source evidence, and matching signed/checksummed source RPM bundles. Rootfs input/timestamp normalization is present; byte-identical clean OCI rebuilds are not yet a measured guarantee.

## Preview publication

Publish Java 21 preview is a manual main-only workflow. It builds and qualifies both architectures again in the trusted publication run, checks exact source identities and module parity, verifies complete payload SBOM coverage and blocks known fixable High/Critical ALAS matches. Raw scans and database fingerprints remain evidence; ALAS unfixed and JVM advisory coverage are limited, so a clean scan is not proof of zero risk.

The publisher creates a persistent GitHub prerelease containing Docker archives, matching source RPM bundles, project source, SBOMs, inventories, locks and checksums. It publishes an immutable java21-REVISION GHCR index and advances 21-preview only after keyless signature/provenance verification. It signs the index, attests per-architecture CycloneDX SBOMs and records qualified-build provenance tied to the actual publication run. An existing immutable release is not silently overwritten by rerunning the publisher.

Intended registry: ghcr.io/rambow-cloud/amazon-linux-distroless/java21. Availability and exact digest are recorded in the completed publication report; a configured workflow is not evidence that an image has been published. GHCR package visibility is separate from repository visibility and is recorded explicitly; anonymous access requires Public visibility in package settings.

Consumers should pin the recorded immutable digest and rebuild applications in a compatible JDK builder. [The multi-stage JAR example](../examples/java-app/Dockerfile) installs the matching JDK only in its builder and copies the JAR into the Java runtime. Build it with examples/java-app as the context in application CI. The preview alias in the example must be replaced with the qualified digest for production consumption.

To run a derived application image with the contract:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m APPLICATION_IMAGE
```

To verify a published index, use its recorded digest with cosign verify and certificate identity https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/java21-publish.yml@refs/heads/main and issuer https://token.actions.githubusercontent.com. Build/supply-chain hashes and source availability support inspection; application compatibility and security qualification remain the consumer's responsibility.
