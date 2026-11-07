# Implementation roadmap

Java 17/21/25, Python 3.11–3.14 and Node.js 22/24/26 have public signed dual-architecture previews. See [the runtime index](RUNTIMES.md) and [support boundaries](SUPPORT.md).

The owner-directed sequence is complete: Java 21 first, expanded Java 17/21/25 in #41/#42/#43/#44, Python #21/#45/#46/#47, then Node.js #22/#48/#49. The language contract RFC #16 records the final matrix. This completes the requested language implementation and preview delivery; project-wide stable v1 acceptance remains open.

The v0.1 foundation contract and v0.2 native CI milestones are complete. [Foundation candidates](FOUNDATION.md) include verified native static and base images, OCI indexes and measured size and reproducibility evidence. Project-wide SBOM, scanner policy, signed publication and updates remain #9/#10/#11/#12.

## Delivery sequence

The sequence is scope-based, not a calendar promise. Finish each milestone's exit criteria before promotion. Estimate delivery dates after the prototype establishes real build and maintenance costs.

| Milestone | Deliverables | Exit criteria |
| --- | --- | --- |
| M0 — Repository foundation | Issue forms, labels, milestones, backlog, contribution policy, and PR gates | Completed: configuration committed, workflow documented, and main protected |
| v0.1.0 — AL2023 runtime prototype | Shared runtime contract, Java/Python/Node.js contract, pinned inputs, amd64 static/base foundations, runtime probes | Reviewed file inventory and passing foundation probes; all three language contracts accepted |
| v0.2.0 — Multi-architecture CI | arm64 foundation parity, PR CI, reproducibility report, measured size budgets | Static/base pass on both architectures; extensible CI matrix and foundation baselines exist |
| v0.3.0 — Java, Python, and Node.js runtimes | Separate java/python/nodejs images, version/ABI packaging contracts, language CI and native-dependency probes | All three languages pass on amd64/arm64 with runtime-specific verification and reviewed size/evidence baselines |
| v1.0.0 — Verifiable stable release | SBOM/provenance/licenses, vulnerability gates, signed GHCR artifacts, maintenance policy, and examples for all five variants | Every committed language and foundation variant has verified artifacts, native execution evidence, rollback, and a published support contract |
| v1.1.0 — Runtime extensions | Isolated debugging and operational improvements for the supported runtime matrix | Accepted scope, verification, and maintenance ownership; production images remain shell-free |

## Issue backlog

| Issue | Milestone | Dependencies | Initial priority |
| --- | --- | --- | --- |
| [#1 Bootstrap repository governance](https://github.com/rambow-cloud/amazon-linux-distroless/issues/1) | M0 | None | p0 |
| [#2 Define the AL2023 runtime contract and redistribution policy](https://github.com/rambow-cloud/amazon-linux-distroless/issues/2) | v0.1.0 | None | p0 |
| [#16 Define committed Java, Python, and Node.js runtime contracts](https://github.com/rambow-cloud/amazon-linux-distroless/issues/16) | v0.1.0 | #2 | p0 |
| [#3 Lock AL2023 builder and RPM inputs with provenance](https://github.com/rambow-cloud/amazon-linux-distroless/issues/3) | v0.1.0 | #2, #16 | p0 |
| [#4 Assemble amd64 static and base rootfs from verified AL2023 packages](https://github.com/rambow-cloud/amazon-linux-distroless/issues/4) | v0.1.0 | #2, #3 | p0 |
| [#5 Prove the final-image runtime and absent-tool contract](https://github.com/rambow-cloud/amazon-linux-distroless/issues/5) | v0.1.0 | #4 | p0 |
| [#6 Add arm64 builds and architecture-specific runtime validation](https://github.com/rambow-cloud/amazon-linux-distroless/issues/6) | v0.2.0 | #5, #3 | p1 |
| [#7 Add unprivileged PR image builds and runtime CI](https://github.com/rambow-cloud/amazon-linux-distroless/issues/7) | v0.2.0 | #5, #6 | p1 |
| [#8 Measure reproducibility and establish image-size budgets](https://github.com/rambow-cloud/amazon-linux-distroless/issues/8) | v0.2.0 | #6, #7 | p1 |
| [#20 Build a distroless-like Amazon Corretto Java runtime image](https://github.com/rambow-cloud/amazon-linux-distroless/issues/20) | v0.3.0 | #16, #3, #6 | p1 |
| [#21 Build a distroless-like Python runtime image](https://github.com/rambow-cloud/amazon-linux-distroless/issues/21) | v0.3.0 | #16, #3, #6 | p1 |
| [#22 Build a distroless-like Node.js runtime image](https://github.com/rambow-cloud/amazon-linux-distroless/issues/22) | v0.3.0 | #16, #3, #6 | p1 |
| [#23 Qualify all three language images in CI and release gates](https://github.com/rambow-cloud/amazon-linux-distroless/issues/23) | v0.3.0 | #20, #21, #22, #7, #8 | p0 |
| [#9 Produce SBOM, provenance, and complete redistribution evidence](https://github.com/rambow-cloud/amazon-linux-distroless/issues/9) | v1.0.0 | #3, #8, #23 | p0 |
| [#10 Add AL2023-aware vulnerability scanning and exception policy](https://github.com/rambow-cloud/amazon-linux-distroless/issues/10) | v1.0.0 | #9 | p0 |
| [#11 Publish signed immutable multi-architecture GHCR releases](https://github.com/rambow-cloud/amazon-linux-distroless/issues/11) | v1.0.0 | #9, #10, #7, #23 | p0 |
| [#12 Automate reviewed AL2023 refreshes and document support policy](https://github.com/rambow-cloud/amazon-linux-distroless/issues/12) | v1.0.0 | #11 | p1 |
| [#13 Deliver consumer examples and v1.0 release acceptance evidence](https://github.com/rambow-cloud/amazon-linux-distroless/issues/13) | v1.0.0 | #11, #12 | p1 |
| [#15 Define isolated debugging without expanding production images](https://github.com/rambow-cloud/amazon-linux-distroless/issues/15) | v1.1.0 | #13 | p2 |

The table records the original dependency plan; live issue states and the delivery reports above show completed language work. #23 remains the integration point for complete foundation/language stable acceptance, including size/reproducibility criteria that preview delivery does not satisfy.

## Language deliverables

| Runtime | Required implementation | Key acceptance evidence |
| --- | --- | --- |
| Java | Amazon Corretto headless runtime with explicit paths and a separate application builder | Executable JAR, JVM native dependencies, JAVA_HOME, truststore/TLS, DNS, signals, and hardened non-root execution |
| Python | Versioned AL2023 interpreter/stdlib and documented builder-installed dependency path | Stdlib/import paths, SSL, version-matched native extension, cache/bytecode behavior, and hardened non-root execution |
| Node.js | Versioned AL2023 runtime with production dependencies installed by a matching builder | ESM/CommonJS, HTTP/TLS/DNS, native addon ABI/N-API, CA/Intl behavior, signals, and hardened non-root execution |

The accepted matrix supports Java 17/21/25, Python 3.11–3.14 and Node.js 22/24/26. RFC #51 adds independently versioned official upstream releases for Python and Node.js.

## Stable-release acceptance

- All five variants (`static`, `base`, `java`, `python`, and `nodejs`) use verified, locked AL2023 inputs and explicit per-variant file inventories.
- Both `linux/amd64` and `linux/arm64` pass the common and language-specific contract suites, including required native libraries/extensions. Record native runtime evidence on both architectures.
- Production images use numeric non-root identity and contain no shell, package manager, compiler, RPM database, development toolchain, or build cache. Application runtimes themselves remain available by design.
- Java/Python/Node.js dependencies are prepared in compatible builders. Do not require Maven/Gradle/javac, pip/ensurepip, npm/npx/corepack, or a shell at production startup.
- Each variant/version/architecture has measured size budgets and separate runtime-file/OCI-digest reproducibility results.
- SBOMs, provenance, scans, licenses, and source delivery cover actual shipped runtime files and native components. Every committed language is included in the release gates and signature/evidence verification.
- Published examples, runtime-version support windows, refresh procedures, and rollback match the released artifact matrix.

## Removed scope and remaining decisions

The standalone C++/`cc` image is removed. [Issue #14](https://github.com/rambow-cloud/amazon-linux-distroless/issues/14) is closed as not planned following the owner-directed decision in [#19](https://github.com/rambow-cloud/amazon-linux-distroless/issues/19). This does not ban native C++ libraries that are required dependencies of supported Java/Python/Node.js runtimes; those libraries must be audited and covered by the same evidence and update gates.

Debug images, FIPS claims, additional language versions, additional architectures, and additional registries require their own accepted scope and maintenance capacity. Java, Python, and Node.js are required deliverables rather than optional language explorations.

Current language versions, library/data boundaries, scanner behavior and preview tags are recorded in the delivered contracts. Additional runtime capabilities and stable-release policy changes require their own issue/RFC.

## Tracking and source of truth

GitHub Issues and Milestones are the live execution record. [.github/planning/backlog.json](../.github/planning/backlog.json) and [issue-map.json](../.github/planning/issue-map.json) capture versioned planning snapshots and issue identities; they do not automatically overwrite live issue bodies or states. [retired.json](../.github/planning/retired.json) retains removed work and its decision history. Update this roadmap through an issue-linked PR when scope changes. Labels and milestone descriptions are maintained by the configuration sync script.

Do not assign arbitrary due dates before estimating effort. Close a milestone after its acceptance criteria are met and explicitly move deferred work. Deferring one of the three committed languages requires a new owner-approved scope change.
