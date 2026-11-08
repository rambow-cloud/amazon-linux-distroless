# Amazon Linux Distroless

**Minimal production container images for Java, Python, and Node.js, built on Amazon Linux 2023.**

Use these images as the final stage of your Dockerfile. Build your application and install its dependencies in a separate builder, then copy in the files it needs to run. The resulting container has the language runtime, its audited system libraries, and your application. This is an independent community project.

## Pull the latest stable images

Java, Python, and Node.js are available publicly on **GHCR and Quay** for `linux/amd64` and `linux/arm64`. Pass any image reference below to `docker pull` or use it in a Dockerfile `FROM` instruction.

| Runtime | GHCR | Quay | Fixed revision as of 2026-11-08 |
| --- | --- | --- | --- |
| **Java** | `ghcr.io/rambow-cloud/java:latest` | `quay.io/rambow-cloud/java:latest` | [`25.0.5-r2`](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/java25-25.0.5-r2) |
| **Python** | `ghcr.io/rambow-cloud/python:latest` | `quay.io/rambow-cloud/python:latest` | [`3.14.10-r2`](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/python314-3.14.10-r2) |
| **Node.js** | `ghcr.io/rambow-cloud/nodejs:latest` | `quay.io/rambow-cloud/nodejs:latest` | [`26.13.0-r2`](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs26-26.13.0-r2) |

```sh
docker pull ghcr.io/rambow-cloud/java:latest
docker pull ghcr.io/rambow-cloud/python:latest
docker pull ghcr.io/rambow-cloud/nodejs:latest
```

- **Newest stable release.** `latest` follows the highest published stable version of each language and its newest revision.
- **Updates within a version line.** Use `:17`, `:21`, or `:25` for Java, `:3.11` through `:3.14` for Python, or `:22`, `:24`, or `:26` for Node.js. For example, `quay.io/rambow-cloud/nodejs:22` follows Node.js 22 updates.
- **Reproducible deployments.** Replace `:latest` with a fixed revision such as `:25.0.5-r2`, or pin the signed OCI index by digest with `@sha256:…`. Find current tags, exact digests, and signed release records in the [stable release index](docs/STABLE.md).

### Foundation images

| Image | GHCR | Quay | Use it for |
| --- | --- | --- | --- |
| `static` | `ghcr.io/rambow-cloud/static:2023` | `quay.io/rambow-cloud/static:2023` | Fully static binaries such as Go binaries built with `CGO_ENABLED=0`. |
| `base` | `ghcr.io/rambow-cloud/base:2023` | `quay.io/rambow-cloud/base:2023` | Applications linked against compatible AL2023 glibc and system libraries. |

Both foundation images provide CA certificates and UTC timezone data. Use `:2023` or `:latest` to follow the current stable AL2023 snapshot. See the [foundation guide](docs/FOUNDATION.md) for fixed revisions and digest verification.

## Why use these images?

- **A smaller production filesystem.** Images start from `scratch` and include a reviewed set of runtime files and shared libraries. The final image has no shell, compiler, or package manager.
- **Non-root by default.** Images run as UID/GID `65532:65532`. The native workload checks exercise read-only root filesystems and explicit writable mounts.
- **Traceable runtime components.** System libraries come from locked AL2023 RPMs. Java uses headless Amazon Corretto, Python builds from signed CPython source, and Node.js uses signed upstream binaries.
- **Verifiable releases.** GitHub Actions builds and tests on both architectures. Stable releases include signed OCI indexes, per-platform CycloneDX SBOMs, and vulnerability scan evidence. The [v1.0 acceptance report](docs/V1-ACCEPTANCE.md) records measured image sizes, reproducibility, and native test results.

## Use an image in your application

For an executable JAR built for Java 25 or earlier, use the Java 25 runtime as your final stage:

```dockerfile
FROM ghcr.io/rambow-cloud/java:25
COPY app.jar /app/app.jar
CMD ["-jar", "/app/app.jar"]
```

For Python wheels and Node.js native addons, build dependencies for the target runtime version and architecture. See the [Java](examples/java-app/Dockerfile), [Python](examples/python-app/Dockerfile), and [Node.js](examples/node-app/Dockerfile) Dockerfile examples and the [application packaging guide](docs/RUNTIMES.md#application-packaging).

## Documentation and contributing

- [Architecture](docs/ARCHITECTURE.md) and [upstream runtime inputs](docs/UPSTREAM-RUNTIMES.md) cover how the images are assembled.
- [Support policy](docs/SUPPORT.md), [updates and rollback](docs/UPDATING.md), and [debugging](docs/DEBUGGING.md) cover day-to-day operation.
- [Security policy](SECURITY.md) covers vulnerability reporting and release scan gates.
- [Roadmap](docs/ROADMAP.md), [open issues](https://github.com/rambow-cloud/amazon-linux-distroless/issues), and [milestones](https://github.com/rambow-cloud/amazon-linux-distroless/milestones) track work in progress. Follow the [contribution guide](CONTRIBUTING.md) and open an [issue](https://github.com/rambow-cloud/amazon-linux-distroless/issues/new/choose) before starting a pull request.

## License

Project-authored code and documentation use [Apache-2.0](LICENSE). Redistributed components retain their respective licenses. Stable releases provide component notices and corresponding source information.
