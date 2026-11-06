# Working agreements

- Use English for repository content, issues, pull requests, labels, and milestones.
- Track every change in an issue before implementation. The initial bootstrap is tracked in issue #1; subsequent changes require a pull request.
- Start implementation only after the issue has a milestone, acceptance criteria, exactly one type, area, priority, and status label, and status `ready` or `in-progress`.
- Keep implementation within the issue's scope. Propose contract changes in an RFC before widening image contents or supported runtimes.
- Link PRs with standalone `Closes #N`, `Fixes #N`, or `Resolves #N` lines for same-repository issues. Use references without closing keywords for partial progress.
- Avoid redundant validation and repeated retries. Run each relevant verification once unless it fails for a newly understood reason or a meaningful state change justifies another run.
- When a result can be verified by opening it in a browser, tell the user exactly what to open and verify instead of independently testing it with curl or similar command-line requests.
- For DNS validation, use server-side CloudFormation status and outputs as the source of truth. Do not perform local DNS validation. Ask the user to perform additional confirmation only when necessary and provide clear steps.
- Do not claim that an image exists or is validated until the corresponding build and runtime evidence exists.
- Pin build inputs and action dependencies. Keep final images free of build tools and package managers; preserve component provenance and license obligations.
