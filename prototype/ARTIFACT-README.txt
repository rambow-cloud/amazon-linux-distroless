AL2023 distroless-like Java prototype (linux/amd64)

This preview was built and tested in GitHub Actions. It is not a stable release.
images.tar.gz contains base, Java 21, and a runnable Java demo.
The image contents retain their individual upstream licenses.
Project-authored build scripts and the demo use Apache-2.0.

Inspect verification.json, summary.md, linux-amd64.json and the two inventories.
sources/ contains matching source RPMs for every locked runtime input, including
upstream build specifications and patches. project-source.tar.gz contains this
project's build/assembly scripts, lock, demo source and license.
Keep this source material with copies of the binary preview when redistributing.
The inventory is not a complete SPDX/CycloneDX SBOM or a legal compliance report.

To run the downloaded prebuilt demo (no local build is required):

  docker load --input images.tar.gz
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m \
    al2023-distroless-demo:prototype

The demo checks UID 65532, passwd lookup, UTC, JVM trust anchors, a read-only
root filesystem and a writable temporary mount, then prints a JSON result.

Prototype limits: amd64 only; no DNS/TLS handshake, native-library workload
matrix, scanner gate, signing, published registry tag or stable support.
The headless JVM has not been minimized with jlink. Only the java launcher is
included as a JDK executable; this is not a claim about every module in its
runtime image. Bit-identical full rebuilds have not yet been measured.

The artifact expires after 14 days. Re-run the Java prototype workflow against
the committed lock to produce a fresh preview.
