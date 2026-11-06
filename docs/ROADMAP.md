# Implementation roadmap

Status: repository foundation; image implementation starts with the runtime-contract RFC. No runtime images are published.

## Delivery sequence

The sequence is scope-based, not a calendar promise. Finish each milestone's exit criteria before promoting its artifacts. Estimate delivery dates after the first prototype establishes real build and maintenance costs.

| Milestone | Deliverables | Exit criteria |
| --- | --- | --- |
| M0 — Repository foundation | Issue forms, labels, milestones, backlog, contribution policy, and PR gate | Configuration committed; issue-driven workflow documented; main protected |
| v0.1.0 — AL2023 runtime prototype | Runtime contract, pinned inputs, amd64 static/base rootfs, runtime probes | Reviewed file inventory; workload and absent-tool tests pass on final images |
| v0.2.0 — Multi-architecture CI | arm64 parity, PR CI, reproducibility report, measured size budgets | Both variants pass on both architectures; file-manifest reproducibility measured |
| v1.0.0 — Verifiable stable release | SBOM/provenance/licenses, vulnerability gates, signed GHCR release, maintenance policy, consumer examples | Verified multi-architecture release with native execution evidence, rollback, and complete published contract |
| v1.1.0 — Runtime extensions | C++ support and debugging/language RFCs | Each extension has an accepted contract, validation, and maintenance owner; language images may remain deferred |

## Issue backlog

| Issue | Milestone | Dependencies | Initial priority |
| --- | --- | --- | --- |
| [#1 Bootstrap repository governance](https://github.com/rambow-cloud/amazon-linux-distroless/issues/1) | M0 | None | p0 |
| [#2 Define the AL2023 runtime contract and redistribution policy](https://github.com/rambow-cloud/amazon-linux-distroless/issues/2) | v0.1.0 | None | p0 |
| [#3 Lock AL2023 builder and RPM inputs with provenance](https://github.com/rambow-cloud/amazon-linux-distroless/issues/3) | v0.1.0 | #2 | p0 |
| [#4 Assemble amd64 static and base rootfs from verified AL2023 packages](https://github.com/rambow-cloud/amazon-linux-distroless/issues/4) | v0.1.0 | #2, #3 | p0 |
| [#5 Prove the final-image runtime and absent-tool contract](https://github.com/rambow-cloud/amazon-linux-distroless/issues/5) | v0.1.0 | #4 | p0 |
| [#6 Add arm64 builds and architecture-specific runtime validation](https://github.com/rambow-cloud/amazon-linux-distroless/issues/6) | v0.2.0 | #5, #3 | p1 |
| [#7 Add unprivileged PR image builds and runtime CI](https://github.com/rambow-cloud/amazon-linux-distroless/issues/7) | v0.2.0 | #5, #6 | p1 |
| [#8 Measure reproducibility and establish image-size budgets](https://github.com/rambow-cloud/amazon-linux-distroless/issues/8) | v0.2.0 | #6, #7 | p1 |
| [#9 Produce SBOM, provenance, and complete redistribution evidence](https://github.com/rambow-cloud/amazon-linux-distroless/issues/9) | v1.0.0 | #3, #8 | p0 |
| [#10 Add AL2023-aware vulnerability scanning and exception policy](https://github.com/rambow-cloud/amazon-linux-distroless/issues/10) | v1.0.0 | #9 | p0 |
| [#11 Publish signed immutable multi-architecture GHCR releases](https://github.com/rambow-cloud/amazon-linux-distroless/issues/11) | v1.0.0 | #9, #10, #7 | p0 |
| [#12 Automate reviewed AL2023 refreshes and document support policy](https://github.com/rambow-cloud/amazon-linux-distroless/issues/12) | v1.0.0 | #11 | p1 |
| [#13 Deliver consumer examples and v1.0 release acceptance evidence](https://github.com/rambow-cloud/amazon-linux-distroless/issues/13) | v1.0.0 | #11, #12 | p1 |
| [#14 Add an explicitly scoped AL2023 C++ runtime variant](https://github.com/rambow-cloud/amazon-linux-distroless/issues/14) | v1.1.0 | #13 | p2 |
| [#15 Define isolated debugging without expanding production images](https://github.com/rambow-cloud/amazon-linux-distroless/issues/15) | v1.1.0 | #13 | p2 |
| [#16 Evaluate language runtime demand and maintenance feasibility](https://github.com/rambow-cloud/amazon-linux-distroless/issues/16) | v1.1.0 | #13 | p3 |

The table shows prerequisite issues. Individual issues contain their own acceptance criteria and validation plan. The first ready issue is [#2](https://github.com/rambow-cloud/amazon-linux-distroless/issues/2); dependent work starts after design acceptance and maintainer triage.

## Stable-release acceptance

- Final images are built from verified, locked AL2023 inputs with explicit per-variant file inventories.
- Both `linux/amd64` and `linux/arm64` pass static/dynamic workload probes, DNS/NSS/CA checks, and hardened-container execution. Record native test evidence for both architectures.
- Production images use numeric non-root identity and contain no shell, package manager, compiler, RPM database, or build cache.
- Size budgets are measured; runtime-file reproducibility and OCI digest reproducibility are reported separately.
- SBOMs and provenance describe the actual shipped files and exact packages. License notices and source obligations are fulfilled.
- AL2023-aware vulnerability gates, expiring exceptions, signatures, consumer verification, update procedures, and rollback are documented and exercised.
- Published examples and the support policy match the released artifact contract.

## Boundaries and deferred choices

The first release covers `static` and `base`. C++ is a follow-up. Java, Python, Node.js, debug images, FIPS claims, additional architectures, and additional registries are outside the initial release contract. Their inclusion requires an accepted issue/RFC and maintenance capacity.

OpenSSL libraries, optional timezone/locale data, scriptlet handling, scanner choice, and release tag naming are explicit design decisions assigned to issues; they are not silently assumed by this roadmap.

## Tracking and source of truth

GitHub Issues and Milestones are the live execution record. [.github/planning/backlog.json](../.github/planning/backlog.json) and [issue-map.json](../.github/planning/issue-map.json) capture the initial planning snapshot and stable issue identities; they do not automatically overwrite live issue bodies or states. Update this roadmap through an issue-linked PR when scope changes. Labels and milestone descriptions are separately maintained by the configuration sync script.

Do not assign arbitrary due dates before estimating effort. Close a milestone after its acceptance criteria are met, and explicitly move deferred issues to the next appropriate milestone.
