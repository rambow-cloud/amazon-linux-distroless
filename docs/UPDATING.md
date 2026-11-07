# Updating AL2023 builders and runtime packages

Java RPM updates and Python/Node.js upstream releases use protected lock PRs and native GitHub Actions qualification. The AL2023 builder digest, system RPM snapshot and language release can advance independently. See [delivered runtimes](RUNTIMES.md) and [support boundaries](SUPPORT.md).

## Inputs that change independently

Runtime images start FROM scratch. The builder supplies tools, official RPM trust and repository configuration. Only audited runtime files and the recorded Java transform enter the final image.

| Input | Source of truth | Effect |
| --- | --- | --- |
| Official builder tag | `images/javaID/packages.json` or `images/upstream/packages.json` | Resolution records the immutable digest |
| Builder identity | `builder` in the matching architecture RPM lock | Normal builds consume the locked digest |
| Repository snapshot | Per-runtime `packages.json: releasever`, repeated in locks | Selects the binary/source RPM transaction |
| Package/file/module roots | Per-runtime `packages.json` and `runtime.json` | Selects native/data closure, linked Java modules and omitted tools |
| Exact RPMs and sources | Java version locks or family/architecture locks in `locks/upstream/` | Pins NEVRA, URLs, checksums, verified signatures, licenses and source |
| Upstream runtime | `images/upstream/versions.json` and per-version/per-architecture archive locks | Pins the signed official CPython source or Node.js binary and corresponding source |
| Builder tools | Lock `tool_packages` | Drift fails consumption; JDK/JMods and native headers must match the contract |
| Actions/scanner/signing tools | Pinned action SHAs and tool image/version pins | Reviewed independently from runtime packages |

AL2023 snapshots are deterministic: the same releasever does not expose later snapshots. Select an explicit published release and regenerate locks. Updating only a builder digest does not update locked RPMs. See [AWS deterministic upgrades](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html).

## Automatic discovery

AL2023 builder discovery runs daily at **03:17 UTC / 11:17 Asia/Shanghai**, with manual dispatch. It resolves the official moving builder tag to an immutable digest, reads its release marker and separately queries the newest official RPM repository snapshot. It compares both inputs against the shared Java 21 baseline. Each platform, builder digest and repository snapshot has one maintenance proposal. Evidence stays with the run.

The detector tracks the shared AL2023 baseline through Java 21 and opens a review issue for changed candidates. Follow [the discovery contract](UPSTREAM-DISCOVERY.md).

```sh
gh workflow run al2023-discovery.yml --repo rambow-cloud/amazon-linux-distroless --ref main
```

## Protected AL2023 refresh

1. An eligible discovery triggers `Prepare AL2023 snapshot lock candidates`. Its read-only jobs resolve all 12 native RPM locks from one immutable builder and explicit repository snapshot. Each artifact lists exact binary and source RPM inputs, version and license changes, and tool changes. A direct dispatch rehearses resolution against the current lock.
2. The repository-scoped GitHub App opens the issue-linked lock PR. Project qualification runs the full native matrix, source and SBOM checks, size ceilings and paired language builds. The `al2023-refresh-evidence` artifact compares actual payload RPMs, licenses, unpacked bytes and ALAS findings against the signed public baseline. Both sides use one fresh ALAS database. The App verifies the five protected checks and the exact PR's full qualification run before it can squash-merge.
3. The workflow publishes signed previews for all ten lines, then submits a stable plan through a second protected PR. Corretto follows the RPM transaction. Same-patch rebuilds advance the revision. Python and Node.js keep their separately pinned upstream archives. All ten stable preflight checks must pass before stable publication starts. The stable workflow re-scans the approved previews and publishes them to GHCR and Quay. Once both mirrors are current, the foundation publisher runs full qualification and fresh scans before signing and publishing static and base.
4. `releases/al2023-refresh.json` records the approved builder, repository snapshot and foundation revision. The next discovery reconciles the unfinished refresh before proposing another one. It can reuse verified previews, approved plans and in-flight publication runs. Independent language updates wait while the snapshot is publishing.

If a check fails, inspect the linked Actions run and proposal before dispatching discovery again. Closing an unmerged proposal opts out of that candidate. If a foundation publication stops after creating its immutable draft, rerun the original foundation run from Actions to preserve its source SHA. Escalate a conflicting immutable revision for maintainer review. To pause scheduled and manually triggered discovery, disable **AL2023 builder discovery** in Actions.

## Independent upstream language updates

The `Upstream language update discovery` workflow observes the official CPython and Node.js indexes daily and can be dispatched manually. It considers only newer final releases within existing supported version lines. On protected main it verifies the candidate source and binaries using the pinned release signer policy and outputs both architecture locks and their exact diffs. Unchanged versions produce only the observation report. This stage prepares inputs for the update gates; it does not merge a PR or publish a tag. Corretto updates follow the AL2023 snapshot and RPM locks.

The unattended language workflow consumes successful discovery runs from protected main. It proposes one runtime update at a time, verifies every required check and the exact PR contents before each merge, and dispatches the trusted preview and stable workflows. Later discovery runs resume a merged bot update even when the upstream version has not changed. A preview is reusable when its signature and build inputs match the approved locks. A new attempt uses its own preview tag so an incomplete release cannot block it. An approved stable release with missing mirror tags goes through the existing mirror repair workflow. A failed protected check still requires investigation through the tracked PR.

One-time setup: install a private GitHub App only on `rambow-cloud/amazon-linux-distroless`. Give it Contents and Pull requests write, Checks and Commit statuses read, plus mandatory Metadata read. Store the App ID as the repository variable `UPSTREAM_UPDATE_APP_ID` and the private key as the Actions secret `UPSTREAM_UPDATE_APP_PRIVATE_KEY`. The App does not need Packages, Actions, Workflows, administration or branch-protection bypass permissions. The normal job token handles issue metadata and workflow dispatch. Without the App configuration the write job stays disabled. [GitHub explains](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs) why the default token cannot start the PR checks without approval.

The [upstream runtime guide](UPSTREAM-RUNTIMES.md) covers independent Python and Node.js patch updates.

## Manual refresh and emergency fixes

1. Create a maintenance issue with milestone, type/area/priority/status labels and acceptance criteria. Edit the relevant package specification on an update branch, selecting an official builder tag and explicit repository release. Review all ten version lines when refreshing a shared AL2023 baseline. Update the upstream version manifest for a Python or Node.js patch refresh. Review upstream advisories and per-package support boundaries alongside ALAS; an available snapshot is not automatically an acceptable security update.
2. Resolve selected inputs on native amd64/arm64 runners:

   ```sh
   gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh -f major=17
   gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh -f major=21
   gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh -f major=25
   gh workflow run runtime-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh
   ```

3. Download the two architecture lock artifacts for each selected Java major or the four upstream family/architecture lock artifacts. Review package/source availability, official signatures and checksums, licenses, tool identities and native differences before committing the locks. Review linked Java modules, Python SOABI/default-GIL extensions, or Node module ABI/N-API/ICU as appropriate. Never change checksums to bypass verification or mix unrelated snapshots. A targeted security fix still needs coherent constraints and complete resolution.
4. Open an issue-linked PR after specs and locks agree. Main requires Issue policy, Repository checks, Java 21 gate and Language runtime gate. Shared Java changes qualify all six Java major/architecture pairs; shared language changes qualify all fourteen Python and Node version/architecture pairs. Common rootfs/audit changes qualify both suites. Review actual saved-image inventory, nonroot/PID 1/read-only behavior, Unicode/UTC, trust/TLS/DNS, signals, absent tools, native dependency fixtures, source/SBOM and size changes. Java additionally qualifies agents/fonts/ImageIO; Python qualifies builder-installed wheels and stdlib extensions; Node qualifies locked production node_modules, N-API, ICU and HTTP. Documentation-only changes skip native rebuilds while reporting required gate status.
5. After checks pass and the PR merges, publish each selected runtime from trusted main:

   ```sh
   gh workflow run java21-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f major=17
   gh workflow run java21-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f major=21
   gh workflow run java21-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f major=25
   gh workflow run runtime-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f runtime=python314
   gh workflow run runtime-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f runtime=nodejs24
   ```

6. Publication rebuilds/qualifies both architectures at the actual main source commit, verifies exact payload SBOM coverage, blocks known fixable High/Critical findings from ALAS and the applicable upstream scan, and preserves upstream sources, matching source RPMs, project source, image archives, inventories, locks, native reports, raw scans and checksums in a persistent prerelease. It verifies the index signature and qualified-build provenance before advancing only the selected runtime's preview alias. Review published.json, exact index/leaf digests, workflow identity and visibility. Every intended open-source package must be Public; new package visibility is independent.
7. Rebuild and test application images using the accepted runtime digest, then deploy the new application digest. Runtime refreshes do not update dependencies inside JARs, wheels or node_modules. Record the accepted runtime/application pair and previous pair for rollback.

All container resolution, builds, runtime tests and scans run only in GitHub Actions. There is no package-manager update command inside a delivered runtime: the update unit is a new verified image plus rebuilt applications.

## Foundation RPM locks

The native amd64 and arm64 foundation locks record the official builder digest, explicit repository release, strong RPM dependency closure, builder tools and corresponding source RPMs. Weak dependencies are disabled. The initial snapshots use the identical `base` transaction already resolved for the Python and Node.js builders. This is a staging transaction; image inventories determine which files and packages actually ship.

Update the explicit builder tag and repository release in `images/upstream/packages.json`, then run `gh workflow run foundation-lock.yml --ref <candidate-branch>`. Download both `foundation-rpm-lock-<arch>` artifacts and review changes to NEVRA, source RPM, checksum, license, official download URL and tool package lists before committing under `locks/foundation/`. Pull request CI re-resolves the closure using the committed builder digest and verifies a match on both architectures. It also checks rejection of tampered inputs.

## Stable promotion

After a preview is published, review its digest and release evidence in a stable candidate plan PR. Run the stable workflow on main to refresh the scans, sign the promotion and advance the stable alias. Follow the [stable channel guide](STABLE.md).

## Findings, recovery and rollback

Retain all scan severities and raw findings. ALAS unfixed and language-runtime advisory matching remain limited; zero matches do not prove zero exposure or superiority over Debian-based Distroless. Review transformed-file advisory applicability separately when needed. Inspect the actual publication stage before recovery: immutable release tags are not silently overwritten on rerun. A partial publication requires a deliberate recovery decision or a new reviewed source commit.

Consumers should pin a multi-platform index digest, or a platform manifest when intentionally selecting one architecture. Roll back by redeploying the prior accepted application/runtime digest pair with its signed release record. For a foundation pin, open the prior GitHub Release, read `foundation-release.json`, and run the **Verify published foundation pulls** workflow with that release tag. It pulls the signed immutable indexes on both architectures. Leave the stable aliases and immutable tags in place during consumer rollback. A corrective refresh goes through the same protected gates.

Original prototype lock/build workflows are manual historical entry points documented in [PROTOTYPE.md](PROTOTYPE.md). Trivy/native-RPM/Grype comparison workflows remain disabled and do not run during normal updates. Publication security gates remain active.
