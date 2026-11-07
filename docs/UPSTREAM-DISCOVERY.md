# Official AL2023 builder discovery

Discovery observes the official linux/amd64 builder and the official AL2023 RPM snapshot. The [protected refresh](UPDATING.md#protected-al2023-refresh) qualifies both native architectures before publication.

## Source and evidence

The workflow pulls public.ecr.aws/amazonlinux/amazonlinux:2023. AWS documents this AL2023-specific moving tag as its latest AL2023 base image. It resolves and records the immutable registry digest, image config ID, platform, creation time and size. It then starts that exact local image ID with networking disabled, a read-only root, no capabilities, no-new-privileges and UID/GID 65532, using cat to read usr/lib/system-release. The detector rejects a non-AL2023 marker, invalid snapshot date, unexpected registry reference or platform.

The detector also queries the newest official `system-release` RPM in the builder's Amazon Linux repository. The RPM version provides the explicit repository snapshot even when AWS publishes it before rebuilding the container. Runtime builds consume the reviewed immutable builder and exact binary/source RPM locks.

Config: [.github/al2023-discovery.json](../.github/al2023-discovery.json). Workflow: [al2023-discovery.yml](../.github/workflows/al2023-discovery.yml). Candidate evidence is uploaded as al2023-builder-discovery for 30 days, with discovery.json and summary.md; the Actions summary also shows the observed/current identities.

The registry digest is the identity returned by Docker's official repository resolution, which can represent a multi-platform index; the separate image ID records the selected amd64 configuration. An index-only change can therefore create a review proposal even if other amd64 details remain unchanged. Future arm64 work must define its own observation/qualification matrix.

## Decisions

| Condition | Classification | Result |
| --- | --- | --- |
| Observed digest and repository snapshot equal the lock | unchanged | Record evidence |
| Different digest and equal repository release marker | digest-refresh | Propose review of an image/build revision |
| Newer RPM repository snapshot | newer-release | Propose a refresh, including when the builder digest is unchanged |
| Older RPM repository snapshot | older-release-review | Record the candidate for explicit review |

Release ordering compares the observed RPM snapshot with the locked snapshot. The builder marker and repository snapshot are recorded separately. The candidate build and ALAS comparison determine package and security impact.

## Schedule, activation and permissions

- Daily at 03:17 UTC / 11:17 Asia/Shanghai, plus workflow_dispatch.
- GitHub runs scheduled workflows from the default branch; integrate the reviewed workflow into main to activate daily checks. Manual dispatch is also a supported entry point after the workflow is present on the default branch. Scheduled runs may be delayed by GitHub and are not a security-response SLA.
- The implementation branch automation/al2023-discovery has a push preview restricted to detector/config/test paths. The preview has contents:read permission, executes controlled fixture tests and live discovery, and cannot run the proposal job.
- Proposal writes are allowed only for schedule/workflow_dispatch on the exact default-branch ref. A separate job has issues:write and read access to code/artifacts, while discovery has no repository write access. The proposal script repeats the event/ref check before accessing the API. No pull_request_target code execution is added.
- Concurrency serializes runs on the same ref. Proposal lookup includes open and closed issues and keys by platform, full digest and repository snapshot. A closed issue for an unmerged candidate records a maintainer decision.
- New proposals have type:maintenance, area:build, priority:p1, status:triage, an explicit open milestone and actionable acceptance checkboxes. proposal_milestone must be changed when the configured milestone closes; discovery remains read-only and a failed proposal does not silently create an unclassified issue.

After integration, run a deliberate default-branch check with:

```sh
gh workflow run al2023-discovery.yml --repo rambow-cloud/amazon-linux-distroless --ref main
```

To pause future discovery, disable AL2023 builder discovery in Actions. This is separate from the three retired CVE comparison workflows, which remain disabled.

## Handoff to the refresh workflow

An eligible discovery hands its immutable builder and explicit RPM snapshot to the native lock generator. The repository-scoped GitHub App opens a protected update PR after all 12 native locks resolve. See [UPDATING.md](UPDATING.md#protected-al2023-refresh) for evidence, publication and rollback. Direct dispatches on implementation branches are read-only.

References: [AWS AL2023 base container tag](https://docs.aws.amazon.com/linux/al2023/ug/base-container.html), [versioned repositories](https://docs.aws.amazon.com/linux/al2023/ug/deterministic-upgrades.html), [GitHub manual workflow requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow), and [GitHub schedule semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## First live observation

[Actions run 42314824370](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42314824370) succeeded at source commit 621cb3ed35a2a7285f634e0e01ede946bbf010ad. Eight controlled decision/validation/deduplication tests and the live registry/image observation passed. The proposal job was skipped; this was a read-only implementation-branch preview and the observed digest was unchanged.

- Observation time: 2026-11-06T23:53:51.898Z.
- Source: public.ecr.aws/amazonlinux/amazonlinux:2023.
- Observed and currently locked digest: public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7.
- Selected amd64 config ID: sha256:37c1d5642e095a520c5e211d70d652f72a48d9e364ac272189e3a9dd023a9c75.
- Observed builder marker and locked RPM snapshot: 2023.12.20261102.
- Status: unchanged; no maintenance issue created and no input/lock changes.

The al2023-builder-discovery artifact on that run contains the full JSON and human-readable summary. Live proposal writes have not been exercised on the preview branch; those writes and daily scheduling become eligible only after default-branch integration. No runtime build or vulnerability scan was performed.
