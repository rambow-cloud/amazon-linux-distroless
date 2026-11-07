# Delivered language runtimes

All five lines have public signed previews for native **linux/amd64 and linux/arm64**, with trusted-main publication records, native final-image verification, matching source and persistent evidence. Project-wide stable v1 acceptance remains open.

Image prefix: `ghcr.io/rambow-cloud/amazon-linux-distroless/`.

| Runtime | Observed version | Preview reference after prefix | Direct entrypoint | Application arguments | Immutable delivery |
| --- | --- | --- | --- | --- | --- |
| Java 17 | 17.0.21 | `java17:17-preview` | `/usr/bin/java` | `-jar /app/app.jar` | [Java releases](JAVA-RELEASES.md) |
| Java 21 | 21.0.13 | `java21:21-preview` | `/usr/bin/java` | `-jar /app/app.jar` | [Java releases](JAVA-RELEASES.md) |
| Java 25 | 25.0.5 | `java25:25-preview` | `/usr/bin/java` | `-jar /app/app.jar` | [Java releases](JAVA-RELEASES.md) |
| Python 3.14 | 3.14.8 | `python314:3.14-preview` | `/usr/bin/python3.14` | `/app/app.py` or `-m package` | [Python release](PYTHON-RELEASE.md) |
| Node.js 24 | 24.22.1 | `nodejs24:24-preview` | `/usr/bin/node-24` | `/app/main.mjs` or `/app/main.cjs` | [Node.js release](NODEJS-RELEASE.md) |

These are locked AL2023 snapshot versions, not claims about the newest upstream patch. Pin the linked multi-platform index digest in deployments; preview aliases can advance after reviewed publication.

## Application packaging

Prepare application dependencies in a compatible builder and copy only the application and runtime dependencies. Final bases contain no shell, package manager, compiler, pip or npm. Default identity is UID/GID 65532:65532; the interpreter/JVM starts directly as PID 1.

- [Java example](../examples/java-app/Dockerfile): executable JAR; context `examples/java-app`. Select a qualified runtime digest and review the [module/headless contract](JAVA.md).
- [Python example](../examples/python-app/Dockerfile): repository-root context with `-f examples/python-app/Dockerfile`; default runtime is pinned by digest. Dependencies go to `/opt/python/site-packages`. Qualify cp314 native wheels on each architecture.
- [Node example](../examples/node-app/Dockerfile): repository-root context with `-f examples/node-app/Dockerfile`; default runtime is pinned by digest. Production dependencies go to `/app/node_modules`. Qualify module ABI/N-API, architecture and external libraries.

Use JSON CMD arguments. Hardened application execution:

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m APPLICATION_IMAGE
```

## Evidence and maintenance

Delivery reports record index/leaf digests, source commits, native runtime/ABI checks, image sizes, payload RPM coverage, public visibility and verified signatures/provenance. Permanent GitHub prereleases preserve image archives, matching source RPMs, project source, locks, inventories, SBOMs, native verification, raw scans and checksums. CycloneDX attestations attach to platform manifests; the index carries a keyless signature and qualified-build provenance. Verify the exact workflow identity and issuer in the selected report.

Publication blocks known fixable High/Critical ALAS matches. Unfixed and language-runtime advisory coverage remain limited; zero matches do not prove zero risk. Consumers must scan their application dependencies. Retired Trivy/native-RPM/Grype comparison experiments remain disabled; normal publication security gates stay active.

All container resolution, builds, scans and runtime tests run in GitHub Actions. See [update operations](UPDATING.md) and [support boundaries](SUPPORT.md). Static/base parity, size budgets, measured OCI reproducibility and stable policy remain separate [roadmap](ROADMAP.md) work.
