# Updating AL2023 builders and runtime packages

Java 17, 21 and 25 use independent reviewed inputs/locks and shared native Actions qualification/publication. See [versioned Java operations](JAVA.md) for the supported contract and delivery evidence. Python and Node.js follow Java and require their own qualification before being listed as delivered. Builder discovery is active; automatic lock-update PRs and project-wide stable-release automation remain in [#12](https://github.com/rambow-cloud/amazon-linux-distroless/issues/12).

## Inputs that change independently

The runtime starts `FROM scratch`. The builder supplies tools, trusted RPM keys and repository configuration; the final image receives an audited selection of verified RPM files and the recorded JRE transform.

| Input | Source of truth | Effect |
| --- | --- | --- |
| Official builder tag | `images/javaN/packages.json: builder_tag` | Resolution records the tag's immutable digest |
| Builder identity | `locks/javaN/linux-ARCH.json: builder` | Normal builds consume this digest without resolving discovery tags |
| Repository snapshot | Per-major `packages.json: releasever`, repeated in locks | Determines the binary/source RPM transaction |
| Package/module roots | Per-major `packages.json` and `runtime.json` | Defines package selection, linked JRE roots and excluded tools/GUI libraries |
| Exact RPMs and sources | Per-major/per-architecture locks | Pins NEVRA, official URL, checksums, signature verification, licenses and corresponding source |
| Builder tools | Lock `tool_packages` | Drift fails consumption; JDK/JMods must exactly match the runtime RPM |
| Actions/scanner/signing tools | Pinned workflow action SHAs and tool image/version pins | Reviewed separately from runtime package updates |

AL2023 snapshots are deterministic. Waiting or running DNF against the same `releasever` does not expose later snapshots. Select an explicit published release, regenerate locks and review them. Updating only a builder digest does not update locked runtime RPMs. See [AWS deterministic upgrades](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html).

## Automatic discovery

`AL2023 builder discovery` runs daily at **03:17 UTC / 11:17 Asia/Shanghai**, with manual dispatch available. It resolves official `public.ecr.aws/amazonlinux/amazonlinux:2023` to a digest, reads that pinned image's release marker and compares it with the maintained Java 21 input/amd64 lock. Changed candidates create one maintenance issue per platform/digest, deduplicating open and closed proposals. Evidence is retained with the run.

Discovery does not edit locks, rebuild consumers, move aliases or automatically publish. Follow [the discovery contract](UPSTREAM-DISCOVERY.md). A manual check is:

```sh
gh workflow run al2023-discovery.yml --repo rambow-cloud/amazon-linux-distroless --ref main
```

## Reviewed update process

1. Use a maintenance issue with milestone, type/area/priority/status labels and acceptance criteria. Edit the relevant per-major package specification on an update branch using a real official builder tag and explicit repository release. For a common AL2023 baseline refresh, review all three Java lines; each retains independent locks and evidence.
2. Resolve each selected major on native amd64/arm64 runners:

   ```sh
   gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh -f major=17
   gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh -f major=21
   gh workflow run java21-lock.yml --repo rambow-cloud/amazon-linux-distroless --ref update/al2023-refresh -f major=25
   ```

3. Download the selected run's `javaN-lock-amd64` and `javaN-lock-arm64` artifacts. Review package/source availability, signatures/checksums, licenses, tool identities, module inventories and native differences before copying `linux-ARCH.json` into `locks/javaN/`. Never edit checksums to bypass verification or mix unrelated snapshots. A targeted security fix still needs coherent constraints/snapshot selection and complete resolution.
4. Open an issue-linked PR after inputs and locks agree. The protected Java gate runs all six native major/architecture combinations when shared Java inputs/assembly/fixtures change. Review saved-image file inventories, exact identities, nonroot/PID 1/read-only behavior, UTF-8 and Unicode filenames, trust/TLS/DNS, headless fonts/ImageIO, agents, signals, absent tools, source/SBOM and size changes. All container work runs in Actions.
5. After required checks pass and the PR is merged, publish each selected major from trusted main:

   ```sh
   gh workflow run java21-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f major=17
   gh workflow run java21-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f major=21
   gh workflow run java21-publish.yml --repo rambow-cloud/amazon-linux-distroless --ref main -f major=25
   ```

6. Publication rebuilds/qualifies both architectures at the actual source commit, checks exact payload SBOM coverage, blocks known fixable High/Critical ALAS matches, and saves matching source RPMs, project source, image archives, inventories, locks, raw scans and checksums in a persistent prerelease. It verifies index signature and qualified-build provenance before advancing only that major's `N-preview` alias. Review `published.json` and exact index/leaf digests. Each newly created GHCR package has independent visibility; intended open-source packages must be Public.
7. Rebuild and test consumer application images with the accepted runtime digest, then roll out the new application digest. Runtime refreshes do not update dependencies inside application JARs, wheels or `node_modules`.

There is no package-manager update command in a delivered runtime. The update unit is a new verified image plus rebuilt applications.

## Findings, promotion and rollback

Retain every scan severity and raw finding. ALAS unfixed coverage and JVM advisory matching remain limited; zero matches does not prove zero exposure or establish superiority over Debian-based Distroless. Transformed-file advisory applicability may require separate review. Inspect the actual publication stage/evidence before recovery; immutable release tags are not silently overwritten on rerun.

Consumers should pin a multi-architecture index digest, or a platform manifest when intentionally selecting one architecture. Rolling `N-preview` aliases are convenience references. Roll back by redeploying the previous accepted application/runtime digest with its source and qualification record. Do not overwrite version tags or bypass gates. Project-wide stable support, measured OCI reproducibility and complete refresh/exception policies remain in #8/#9/#10/#11/#12.

The original prototype lock/build workflows are manual historical entry points documented in [PROTOTYPE.md](PROTOTYPE.md). Trivy/native-RPM/Grype comparison workflows remain disabled and do not run during normal updates.
