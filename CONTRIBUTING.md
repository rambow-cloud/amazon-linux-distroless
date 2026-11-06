# Contributing

## Issue-driven development

1. Open an issue using the bug, feature, task, or RFC form. Sensitive vulnerabilities belong in private reporting, not public issues.
2. Describe the problem, scope, dependencies, and observable acceptance criteria before writing implementation code.
3. A maintainer assigns a milestone and exactly one label from each family: `type:*`, `area:*`, `priority:*`, and `status:*`.
4. Move an issue from `status:triage` to `status:ready` after scope and dependencies are settled. Replace the status with `status:in-progress` when implementation begins. Use `status:blocked` when a dependency prevents progress; explain the blocker in the issue.
5. Create a branch such as `issue-2-runtime-contract`. Open a focused PR and include a standalone `Closes #2` line for every issue the PR fully completes. A partial PR can use `Refs #2`, but must also close a smaller, independently accepted implementation issue.
6. Record verification and check each acceptance criterion. Merge through a pull request after required checks pass. GitHub closes linked issues when the PR merges to the default branch.

There is no `status:done` label: GitHub's closed state is the completion signal. Before closing an issue, remove its status label and check off acceptance criteria. If GitHub auto-closes it, the closing PR author or maintainer performs that cleanup. Reopened work returns to triage.

## Label conventions

| Family | Meaning |
| --- | --- |
| `type:bug`, `type:feature`, `type:task`, `type:rfc`, `type:maintenance` | Nature of the work |
| `area:build`, `area:runtime`, `area:security`, `area:ci`, `area:release`, `area:docs`, `area:governance` | Primary owning area |
| `priority:p0` | Release or foundational blocker |
| `priority:p1` | Required for the assigned milestone |
| `priority:p2` | Planned enhancement |
| `priority:p3` | Exploration or optional follow-up |
| `status:triage`, `status:ready`, `status:in-progress`, `status:blocked` | Current work state |
| `runtime:java`, `runtime:python`, `runtime:nodejs` | Optional runtime-specific filters, independent of the required label families |
| `good first issue`, `help wanted` | Optional contributor-discovery labels |

Issue Forms apply a type and `status:triage`. Area, priority, and milestone are maintainer decisions; form dropdown responses do not automatically set GitHub labels or milestones. Do not add several status labels to represent transitions.

## PR policy and branch protection

The required `Issue policy` check runs from `pull_request_target`, without checking out or executing PR code. It reads the PR body and linked issues using a read-only token. Fork PRs therefore receive the same metadata checks without access to a write token.

Each standalone closing line must reference an open issue in this repository, have the four label families set exactly once, be ready or in progress, belong to an open milestone, and contain at least one actionable unchecked or checked acceptance checkbox under `## Acceptance criteria` or `### Acceptance criteria`. The check rejects pull request numbers and issues marked as pull requests. Maintainers still review whether the criteria are meaningful and have been met.

Supported form: `Closes #123` (also `Fixes` or `Resolves`; case insensitive, optional trailing period). Use one issue per line. Cross-repository and URL closing forms are intentionally not accepted by this project's policy.

The check reruns when the PR is opened, edited, reopened, synchronized, or marked ready for review. After changing linked issue labels, body, or milestone, edit the PR body or rerun the check; issue metadata changes alone do not trigger it. GitHub required checks reflect their last run, so reviewers must confirm metadata still matches at merge time. Draft PRs also receive the check.

`main` requires pull requests, an up-to-date branch, the `Issue policy` and `Repository checks` checks, resolved review conversations, and no force pushes or deletion. Admin enforcement is enabled. Zero mandatory review approvals support a solo maintainer; contributors should still request review when available. Governance changes follow the same PR process. Future image-build and security checks become required once their implementation issues are complete.

## Validation

Choose checks that prove the issue's behavior. Document the command, environment, and result in the PR. Do not add tests that merely repeat configuration. Image implementation must validate the final filesystem and runnable workloads, not just the builder stage. Refer to the roadmap for release acceptance tests.

Run the governance gate's behavior tests with Node.js 22 or newer:

```sh
node --test tests/issue-policy.test.mjs
```

These tests execute the actual metadata-check script against an in-memory API, covering valid links, rejected metadata, and API failures. They do not make GitHub requests. `Repository checks` runs them for pull requests with a read-only checkout and no persisted Git credentials.

## Configuration maintenance

Edit `.github/labels.json` or `.github/milestones.json` in a PR. After merging, a repository admin runs:

```sh
node scripts/sync-github-config.mjs --repo rambow-cloud/amazon-linux-distroless
node scripts/sync-github-config.mjs --repo rambow-cloud/amazon-linux-distroless --apply
```

The default command previews changes. Applying requires `gh` authentication with repository administration access. No entries are deleted, and existing milestone state is preserved. Milestones have scope-based exit criteria; no delivery dates are committed yet.

Main branch protection is versioned in `.github/branch-protection.json`. Administrators apply it with `gh api --hostname github.com --method PUT repos/rambow-cloud/amazon-linux-distroless/branches/main/protection --input .github/branch-protection.json` after merging any policy changes. It is applied during bootstrap. The policy workflows' first hosted executions will occur on the first pull request; bootstrap records local behavior-test evidence only.
