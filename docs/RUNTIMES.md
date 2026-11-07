# Delivered language runtimes

All ten version lines have public signed stable revisions on native **linux/amd64 and linux/arm64**. Use the [stable release index](STABLE.md) for current tags, digests and release evidence. The [v1.0 acceptance report](V1-ACCEPTANCE.md) records the initial stable baseline. The preview references below identify the builds that supplied that release evidence.

Image prefix: `ghcr.io/rambow-cloud/amazon-linux-distroless/`.

| Runtime | Observed version | Preview reference after prefix | Direct entrypoint | Application arguments | Immutable delivery |
| --- | --- | --- | --- | --- | --- |
| Java 17 | 17.0.21 | `java17:17-preview` | `/usr/bin/java` | `-jar /app/app.jar` | [Java releases](JAVA-RELEASES.md) |
| Java 21 | 21.0.13 | `java21:21-preview` | `/usr/bin/java` | `-jar /app/app.jar` | [Java releases](JAVA-RELEASES.md) |
| Java 25 | 25.0.5 | `java25:25-preview` | `/usr/bin/java` | `-jar /app/app.jar` | [Java releases](JAVA-RELEASES.md) |
| Python 3.11 | 3.11.18 | `python311:3.11-preview` | `/usr/bin/python3.11` | `/app/app.py` or `-m package` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python311-b1e33dc620f5) |
| Python 3.12 | 3.12.16 | `python312:3.12-preview` | `/usr/bin/python3.12` | `/app/app.py` or `-m package` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python312-b1e33dc620f5) |
| Python 3.13 | 3.13.18 | `python313:3.13-preview` | `/usr/bin/python3.13` | `/app/app.py` or `-m package` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python313-b1e33dc620f5) |
| Python 3.14 | 3.14.10 | `python314:3.14-preview` | `/usr/bin/python3.14` | `/app/app.py` or `-m package` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python314-b1e33dc620f5) |
| Node.js 22 | 22.23.4 | `nodejs22:22-preview` | `/usr/bin/node-22` | `/app/main.mjs` or `/app/main.cjs` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs22-b1e33dc620f5) |
| Node.js 24 | 24.22.2 | `nodejs24:24-preview` | `/usr/bin/node-24` | `/app/main.mjs` or `/app/main.cjs` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs24-b1e33dc620f5) |
| Node.js 26 | 26.13.0 | `nodejs26:26-preview` | `/usr/bin/node-26` | `/app/main.mjs` or `/app/main.cjs` | [Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs26-b1e33dc620f5) |

Java versions come from the AL2023 RPM locks. Python and Node.js versions come from the official upstream release locks. All seven upstream digests and scan results are in the [publication record](UPSTREAM-RELEASES.md). Pin the linked multi-platform index digest in deployments; preview aliases can advance after reviewed publication.

## Application packaging

Prepare application dependencies in a compatible builder and copy only the application and runtime dependencies. Final bases contain no shell, package manager, compiler, pip or npm. Default identity is UID/GID 65532:65532; the interpreter/JVM starts directly as PID 1.

- [Java example](../examples/java-app/Dockerfile): executable JAR; context `examples/java-app`. Select a qualified runtime digest and review the [module/headless contract](JAVA.md).
- Install application wheels for the matching CPython minor ABI and architecture into `/opt/python/site-packages`.
- Install production Node.js dependencies for the matching release and architecture into `/app/node_modules`. The native Actions fixture uses the matching official headers and npm.

The [Python example](../examples/python-app/Dockerfile) and [Node.js example](../examples/node-app/Dockerfile) compile native dependencies in matching AL2023 builders and use exact stable digest pins for their final stages. The Node.js example supports both ESM and CommonJS entrypoints. The [upstream runtime guide](UPSTREAM-RUNTIMES.md) describes the builder boundary. The example builder packages do not enter the final image.

Use JSON CMD arguments. Hardened application execution:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m APPLICATION_IMAGE
```

Run the example builds and native verification in GitHub Actions:

```sh
gh workflow run consumer-examples.yml --ref main
```

Use the [stable release index](STABLE.md) to select an exact digest. For example, verify Node.js 24 with:

```sh
image='ghcr.io/rambow-cloud/nodejs@sha256:f90819e2289b694cf165a3cb353320ea43dc3e682553dccf0aa27d21bc12131b'
issuer='https://token.actions.githubusercontent.com'
build='https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-publish.yml@refs/heads/main'
stable='https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-stable.yml@refs/heads/main'
cosign verify --certificate-identity "$build" --certificate-oidc-issuer "$issuer" "$image"
cosign verify-attestation --type 'https://rambow-cloud.github.io/amazon-linux-distroless/runtime-stable/v1' \
  --certificate-identity "$stable" --certificate-oidc-issuer "$issuer" "$image"
leaf=$(docker buildx imagetools inspect --raw "$image" | jq -r '.manifests[] | select(.platform.os == "linux" and .platform.architecture == "amd64") | .digest')
cosign verify-attestation --type cyclonedx --certificate-identity "$build" --certificate-oidc-issuer "$issuer" "${image%@*}@$leaf"
```

For Java, use the build identity ending in `java21-publish.yml@refs/heads/main`. For arm64, select the arm64 leaf. Match the signed predicate and corresponding source links to the release record.

## Runtime behavior and troubleshooting

| Area | Runtime contract |
| --- | --- |
| System CA roots | The AL2023 PEM bundle is available at `/etc/ssl/certs/ca-certificates.crt`. Foundation, Python and Node.js images set `SSL_CERT_FILE` to that path. Python's standard-library TLS uses OpenSSL trust defaults, and Node.js sets `NODE_OPTIONS=--use-openssl-ca`. |
| Java trust | Corretto's `$JAVA_HOME/lib/security/cacerts` links to the AL2023 Java truststore at `/etc/pki/java/cacerts`. Configure a separate JVM truststore with `-Djavax.net.ssl.trustStore=/path/to/truststore` when the application needs private roots. |
| Identity and DNS | UID and GID `65532` map to `nonroot`. The glibc images use local passwd/group files and resolve hosts through local files followed by DNS. Docker or Kubernetes supplies `/etc/hosts` and `/etc/resolv.conf`. A fully static application's resolver behavior depends on how it was built. |
| Time zones and locale | The system zoneinfo payload provides UTC, with `TZ=UTC` and `/etc/localtime` linked to UTC. The glibc images provide `C.UTF-8`. `static` carries the environment setting and leaves locale handling to the application. Node.js has its own ICU locale data. Test named time zones and formatting with the selected language API and supply any additional data your application requires. |

For a private CA, mount a bundle read-only and set the application's trust configuration explicitly. A client library may use its own bundle or a custom SSL context. Preserve the system roots in a replacement bundle when the application also needs public trust. Keep certificate and hostname verification enabled.

Choose the build environment for the target architecture and ABI. Use pure Go with `CGO_ENABLED=0` for the qualified static workload, or an AL2023-compatible loader and library closure with [`base`](FOUNDATION.md). Build Java bytecode for the selected major and check the linked [module list](JAVA.md) and JNI dependencies. Install wheels for the selected CPython minor, default GIL ABI and architecture. Build Node.js addons for the selected architecture and module ABI or a supported N-API level. Copy any extra application libraries in the builder stage.

Inspect startup failures from outside the container. For Docker, record the image ID, exit code, OOM state and application logs:

```sh
docker inspect --format '{{.Image}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.State.Error}}' "$container"
docker logs "$container"
```

For Kubernetes, check events, the effective image ID and container logs. Use `--previous` after a restart. See [Docker inspect](https://docs.docker.com/reference/cli/docker/inspect/) and [Kubernetes Pod debugging](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/).

```sh
kubectl -n "$namespace" describe pod "$pod"
kubectl -n "$namespace" logs "$pod" -c "$container"
kubectl -n "$namespace" logs "$pod" -c "$container" --previous
```

| Symptom | What to check |
| --- | --- |
| `exec format error`, missing loader or missing shared object | Compare the node architecture with the OCI leaf and application binary. Inspect the binary's interpreter and `DT_NEEDED` entries with `readelf` in the builder. |
| Class version, missing module, wheel import or addon load failure | Check the Java target and linked modules, CPython SOABI, or Node ABI/N-API against the selected version and architecture. |
| DNS or TLS failure | Compare the service name, namespace, DNS configuration, network policy, certificate chain and hostname. A diagnostic container uses its own trust store, so reproduce verification in the application or its fixture as well. |
| `EROFS` or permission denied | Check the numeric UID/GID and mount ownership. Direct temporary writes to a writable `/tmp` and use explicit writable volumes for persistent data. |

For network diagnostics, use an approved tool image pinned by digest in an isolated container. Docker can share the network namespace of a running target with `--network container:$container`. In Kubernetes, use an ephemeral container if RBAC and admission allow it. Its filesystem and trust settings are separate from the workload. Reproduce a startup crash in a disposable environment with the same image digest, arguments and mounts. The decision on project-maintained debug images is tracked for v1.1 in [#15](https://github.com/rambow-cloud/amazon-linux-distroless/issues/15). See [Docker container networking](https://docs.docker.com/engine/network/) and [Kubernetes ephemeral containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/).

## Evidence and maintenance

Delivery reports record index/leaf digests, source commits, native runtime/ABI checks, image sizes, payload RPM coverage, public visibility and verified signatures/provenance. Permanent GitHub prereleases preserve image archives, matching source RPMs, project source, locks, inventories, SBOMs, native verification, raw scans and checksums. CycloneDX attestations attach to platform manifests; the index carries a keyless signature and qualified-build provenance. Verify the exact workflow identity and issuer in the selected report.

Stable promotion applies the [High/Critical vulnerability policy](../SECURITY.md#stable-vulnerability-gate) to ALAS and applicable Grype findings. Unfixed and language-runtime advisory coverage remain limited; consumers must scan their application dependencies. Retired Trivy/native-RPM/Grype comparison experiments remain disabled.

All container resolution, builds, scans and runtime tests run in GitHub Actions. See [update operations](UPDATING.md), [support boundaries](SUPPORT.md), and the [foundation image guide](FOUNDATION.md).
