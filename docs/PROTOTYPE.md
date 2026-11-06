# Inspecting the Java prototype

This is an owner-requested experiment tracked in [#25](https://github.com/rambow-cloud/amazon-linux-distroless/issues/25), implemented in [PR #26](https://github.com/rambow-cloud/amazon-linux-distroless/pull/26). All RPM resolution, image builds, and runtime checks run in GitHub Actions. The build driver rejects execution outside Actions.

## Scope and locked inputs

- Platform: `linux/amd64`, running natively on an Ubuntu 24.04 Actions runner.
- AL2023 repository release: `2023.12.20261102`.
- Builder: official AL2023 image pinned by digest in [the lock](../locks/linux-amd64.json).
- Java: Amazon Corretto 21, exact RPM version `21.0.13.0.11-1.amzn2023.1`.
- Outputs: `base`, `java`, and a runnable `demo`; every image declares `USER 65532:65532`.

The lock contains 35 base transaction RPMs, 68 Java transaction RPMs, 54 matching source RPMs, and the exact installed builder-tool identities. These transaction inputs are broader than the final runtime: shell and package-manager dependencies needed by RPM scriptlets stay outside the selected filesystem. The Java roots explicitly include `libstdc++`, `freetype`, and `alsa-lib`, required by native libraries in the selected JVM payload. A standalone C++ image remains excluded; font/audio application behavior is not yet qualified by this console prototype.

## Build pipeline

1. **Explicit lock update.** The `Prototype lock update` workflow resolves package closures with weak dependencies disabled, verifies RPM signatures using the key from the pinned official builder, and uploads a candidate lock. It does not commit files or publish images. Maintainers download, review, and commit the candidate.
2. **Locked download.** The `Java prototype` workflow verifies the builder tools, downloads only the locked RPM URLs, checks SHA-256 and signatures, and rejects unofficial download hosts.
3. **Offline transaction.** With networking disabled, DNF installs exactly the already-verified local RPM set into disposable install roots. All repositories are disabled; no additional packages can be selected or downloaded. The installed identities must equal the lock. Scriptlets generate CA/trust configuration. DNF's local-package signature check is disabled for this transaction because validation has already used the pinned builder's trusted RPM key; bytes are checked again before consumption.
4. **Fresh rootfs.** The assembler copies explicit glibc/CA/UTC seeds and the Java runtime directories, follows required symlink targets within the install root, and computes ELF interpreter/shared-library closure with `readelf`. It adds minimal user/NSS configuration and preserves package license material. It never copies the whole install root and removes tools afterward.
5. **Scratch images.** BuildKit copies the selected files into separate scratch images. The demo compiles a JAR in a builder and adds only the JAR to the Java runtime image.
6. **Final-artifact checks.** Actions runs assembler trust-boundary tests, compares actual exported image files with the inventories, executes the hardened Java demo, and checks exit-code preservation and shell absence.
7. **Download bundle.** Only after successful checks does the workflow package images, matching source RPMs, project source, inventories, and verification results together.

## Run and download through GitHub Actions

After this workflow is on the default branch:

```sh
gh workflow run prototype-build.yml --repo rambow-cloud/amazon-linux-distroless --ref main
gh run list --repo rambow-cloud/amazon-linux-distroless --workflow prototype-build.yml
```

Open the successful `Java prototype` run in [Actions](https://github.com/rambow-cloud/amazon-linux-distroless/actions/workflows/prototype-build.yml). Its summary shows measured image sizes and the Java demo result. Download the artifact named `al2023-java-prototype-with-sources` from that run, or use:

```sh
gh run download RUN_ID --repo rambow-cloud/amazon-linux-distroless --name al2023-java-prototype-with-sources --dir preview
```

The artifact contains:

- `images.tar.gz`: loadable Docker images, with tags `al2023-distroless-base:prototype`, `al2023-distroless-java:prototype`, and `al2023-distroless-demo:prototype`.
- `verification.json` and `summary.md`: actual image identities, uncompressed sizes, test outcomes, and limits.
- `base-inventory.json` / `java-inventory.json`: actual selected file hashes, modes, symlinks, package owners, and generated-file provenance.
- `linux-amd64.json`: exact build, binary RPM, and source RPM inputs.
- `sources/`: verified matching source RPMs, including upstream source, packaging specifications, and patches.
- `project-source.tar.gz`: this project's assembly/build scripts, demo, lock, and license at the tested commit.
- `SHA256SUMS` and `README.txt`.

Keep the corresponding source material with the binary preview when redistributing it. Component licenses remain applicable; the project's Apache-2.0 license does not relicense those components. The artifact expires after 14 days; rerun the locked workflow for a fresh preview. No registry tag is published.

To run the prebuilt demo, load the archive and execute it without a local build:

```sh
docker load --input preview/images.tar.gz
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
  al2023-distroless-demo:prototype
```

The JSON output reports Java version, UID 65532, `nonroot` passwd lookup, UTC, nonempty JVM trust anchors, the read-only root mount, and successful temporary-file writes. The demo has no HTTP port; inspect the Actions summary and downloadable files to review it.

## Limits

This prototype does not close the broader runtime/toolchain RFCs or the stable Java implementation issue. Python, Node.js, arm64, native-extension workloads, DNS/TLS handshake tests, full SBOM/scanning/signing gates, and stable support remain roadmap work. The inventory and accompanying source are useful evidence, not a complete license audit.

The headless JVM has not been minimized with `jlink`. Only the Java launcher is selected as a JDK executable; modules in the packaged runtime have not been audited down to a minimal application-specific module graph. File metadata is normalized, but bit-identical clean rebuilds have not yet been measured. No size target is claimed in advance; use the run's measured figures.
