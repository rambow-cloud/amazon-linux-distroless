# Updating AL2023 builders and runtime packages

Tracked in [#33](https://github.com/rambow-cloud/amazon-linux-distroless/issues/33). The current implementation is an amd64 Java prototype in PR #26. It produces downloadable image/source artifacts; stable GHCR publishing and automated input-update PRs are not implemented. Python, Node.js and arm64 remain planned work. The supported runtime/architecture matrix must grow with its qualification evidence.

## Inputs that change independently

The final runtime starts FROM scratch. The Amazon Linux image supplies build tools, trusted RPM keys and repository configuration; its filesystem is not an inherited final-image layer. Runtime content comes from verified RPMs selected into a fresh filesystem.

| Input | Source of truth | Effect of changing it |
| --- | --- | --- |
| Official AL2023 builder selection | prototype/inputs.json: builder_tag | A resolver run pulls this versioned tag and records its immutable registry digest |
| Build image identity | locks/linux-amd64.json: builder | The build driver passes this digest as AL2023_BASE; normal builds do not resolve the discovery tag again |
| Package repository snapshot | prototype/inputs.json: releasever, repeated in the generated lock | Determines which versions DNF can select, including security/bug-fix updates |
| Required package roots | prototype/inputs.json: roots | Selects the base/Java runtime and its complete dependency transaction |
| Exact binary and source RPMs | locks/linux-amd64.json | Pins package epoch/version/release/architecture, official URL, checksum, signature verification, licenses and corresponding source RPMs |
| Builder tools | Generated lock: tool_packages | Pins the installed builder-tool identities; drift fails the build rather than silently changing the environment |
| Actions/tooling dependencies | Workflow action SHAs and scanner pins | Changes build/scanner behavior and must be reviewed separately from runtime package changes |

Updating only the builder digest leaves the locked runtime RPM selection unchanged. Updating a releasever string without regenerating the lock is rejected by the driver. Use the resolver to update the related identities together instead of hand-editing package hashes or the builder digest in a lock.

AL2023 uses versioned repository snapshots. Moving time forward or running DNF against the same snapshot does not automatically expose packages from a newer snapshot. Select an explicit tested release rather than using latest as a production build input. Discovery may inspect upstream current releases, but the committed build inputs must identify a specific release/digest. See [AWS deterministic upgrades](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html) and [safe update practices](https://docs.aws.amazon.com/linux/al2023/ug/updating-best-practice.html).

## Current manual update process

GitHub requires a workflow_dispatch workflow to exist on the default branch before it is a supported manual entry point. The prototype workflows are currently in unmerged preview PRs; integrate the reviewed implementation into main first. The commands below describe the steady manual process after that integration. They do not claim that an automatic updater or release pipeline already exists. See [GitHub manual workflow requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

1. Open an update issue with the required labels, milestone and acceptance criteria. Record the old/new AL2023 snapshot, official builder tag/digest, affected supported runtime lines, relevant ALAS/runtime advisories and expected changes. Keep Java 21 on its selected major line for routine patch updates; language-major or runtime-contract changes need their own accepted scope.
2. Create and push an update branch, such as update/al2023-refresh. Edit prototype/inputs.json to select an actual published official builder tag and explicit repository release. Obtain the tag from the official release/registry rather than guessing a date/build suffix. The existing roots request the latest suitable package versions within that selected snapshot. Preserve the required native-library closure and trust/license inputs.
3. Run the existing resolver in Actions on the update branch. This resolves the entire binary dependency transaction and matching source RPMs, verifies signatures/checksums and records the new builder/tool identities:

   ```sh
   gh workflow run prototype-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh
   gh run list --repo rambow-cloud/amazon-linux-distroless --workflow prototype-lock.yml --branch update/al2023-refresh
   ```

   Open the new Prototype lock update run in Actions. After it succeeds, download its prototype-lock-linux-amd64 artifact, using that run's ID:

   ```sh
   gh run download LOCK_RUN_ID --repo rambow-cloud/amazon-linux-distroless --name prototype-lock-linux-amd64 --dir out/candidate-lock
   ```

4. Review out/candidate-lock/linux-amd64.json against the committed lock. Check added/removed/updated packages, epochs and architectures, changed file inventories/native dependencies, source availability, license changes and advisory applicability. The transaction includes packages whose code never ships, so review actual final-file ownership as well as the input transaction. Copy the reviewed candidate to locks/linux-amd64.json and commit it with the input changes. Do not mix arbitrary RPMs from different snapshots or edit individual checksums to bypass the resolver. A targeted urgent fix still needs a reviewed package constraint/snapshot and a fresh complete dependency resolution.
5. Open the issue-linked PR after the input and candidate lock agree, avoiding a deliberately mismatched inputs-only build. Existing path-based PR CI runs the Java prototype build. The existing Issue policy and Repository checks also apply. If a manual build is needed, use:

   ```sh
   gh workflow run prototype-build.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh
   ```

   All image builds and runtime checks run in Actions. A normal build consumes the committed lock, verifies exact tool/package identities and RPM bytes/signatures, installs offline with repository access disabled, selects the rootfs and verifies the final image. The current Java checks cover filesystem inventory, non-root/read-only execution, trust anchors, exit propagation and absence of a shell. Future Python/Node.js/native-architecture release gates belong to #23. Byte-identical rebuilds remain work in #8.
6. Review the artifact's inventories, source bundle, package/license/size changes and runtime evidence before merging. The current build uploads a preview; it does not publish or deploy a registry image. Production promotion also requires the release SBOM/provenance, vulnerability/exception and signing gates in #9/#10/#11. Those gates must use the new candidate's actual payload metadata, not the old experimental scanner run IDs.

There is no in-place package-update command inside the shell-free runtime. Refresh inputs, build a new runtime image, then rebuild and roll out applications using that image. Updating an application JAR, wheel or npm dependency remains the application's own build responsibility; runtime-base refreshes do not update those dependencies.

## Proposed automation and maintenance policy

The following is the intended design for [#12](https://github.com/rambow-cloud/amazon-linux-distroless/issues/12), not an enabled schedule or promised response SLA. No cron or publishing automation is activated by this document.

- Use a weekly upstream check as a starting cadence, with an explicit manual security-refresh entry point. Monitor AL2023 release notes/ALAS and the supported Corretto/Python/Node.js release lines. Assess security notifications promptly and prioritize a qualified emergency candidate when a supported shipped component is affected; publishing remains subject to the same evidence gates.
- Have the detector create/link a scoped update issue before implementation, deduplicate by the proposed snapshot/builder/runtime-line identities, regenerate locks in Actions and open a PR with package/source/license/advisory/size diffs. An unchanged candidate should not create another PR. Updating a language major requires a separate compatibility decision.
- Keep routine builds pinned and offline after verified input download. The update detector/resolver is the component that intentionally discovers new inputs. Do not auto-merge or silently advance published runtime tags merely because a detector found a newer version.
- Include shared native libraries in every affected runtime's rebuild/test matrix. A glibc, CA, timezone or crypto-library change can affect more than one language image. Respect upstream/package end-of-life, and define this project's supported runtime versions and response expectations before promising stable maintenance.
- Dependabot currently checks GitHub Actions dependencies weekly. It does not understand prototype/inputs.json and the custom RPM lock, so it is not the AL2023 package updater. Existing issue-driven requirements must also be satisfied by automated update PRs.

## Publishing, consumer updates and rollback

The release design in #11 should publish a new immutable version/date/revision tag and digest for every accepted runtime rebuild, together with matching SBOM, provenance, signatures, license notices and source delivery. Stable aliases such as java21 may advance only after verification; the exact tag convention remains a release-contract decision. Existing immutable release tags/digests must continue to identify their original bytes.

Consumers should pin the released runtime digest in their application Dockerfile, rebuild the application image and promote the tested application digest through staged deployment. Moving a runtime alias does not replace running containers, and a digest-pinned application never absorbs a new base automatically. Consumer update tooling needs to open an application rebuild PR when the chosen runtime release changes.

For rollback, redeploy the previous known-good application image digest and retain the corresponding runtime digest, input specification/lock, source bundle and release evidence. If an upstream refresh regresses, record the reason in the update issue and revert the source/lock through a PR. Preserve the failed candidate's evidence for diagnosis. Reconsider the security exposure of rolling back a security fix during that incident review.

The prototype's 14-day artifact retention is a preview convenience, not a stable release archive. Permanent release/source-evidence retention and registry availability must be implemented with the stable publishing work; do not base a support promise or rollback strategy solely on expiring Actions artifacts.

## Retired comparison workflows

The following bounded experiments are disabled in GitHub, and their versioned definitions now expose only workflow_dispatch:

- Java CVE comparison: cve-comparison.yml
- Native RPM database CVE comparison: rpmdb-comparison.yml
- Grype Java CVE comparison: grype-comparison.yml

Their committed reports and existing runs are retained. Actions artifact expiration remains governed by its existing retention setting. A future deliberate diagnostic replay requires re-enabling its workflow, available input artifacts and an explicit manual dispatch; those experiments pin historical input run IDs and are not candidate-release security gates. Production scanning and its ALAS/unfixed/JVM coverage contract remain work in #10. The existing input-lock resolver, prototype build/runtime validation, Issue policy and Repository checks remain available for ongoing development and updates.
