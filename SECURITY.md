# Security policy

## Current support status

Java, Python and Node.js have [published stable runtime channels](docs/STABLE.md), alongside the [stable static and base foundation images](docs/FOUNDATION.md). The [support policy](docs/SUPPORT.md) records maintenance boundaries. The [v1.0 acceptance report](docs/V1-ACCEPTANCE.md) records the scanner results and links the signed release evidence.

AL2023's upstream lifecycle does not constitute a support promise from this project. Individual package support can differ from the distribution lifecycle.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/rambow-cloud/amazon-linux-distroless/security/advisories/new) for sensitive findings. Include affected digests, architecture, reproduction details, and impact. Do not publish exploit details or secrets in an issue. If private reporting is unavailable, ask a maintainer for a private reporting channel without disclosing the vulnerability publicly.

Ordinary non-sensitive build failures and scanner usability issues can use the bug form.

## Stable vulnerability gate

Trivy's AL2023 matcher scans the exact RPM owners of selected files. Grype adds upstream runtime coverage for Python and Node.js. Stable promotion rejects known High and Critical findings, including findings without a fix, unless the exact runtime, architecture, scanner, advisory ID, package and installed version match an unexpired exception. Scanner reports and the exceptions applied to them remain in release evidence. A missing, stale, invalid or changed database fails the job; both databases must have been built within 48 hours.

Run `gh workflow run foundation-security.yml --ref main` to scan both native static and base candidates. Its evidence binds each raw ALAS result and CycloneDX SBOM to the exact candidate leaf digest. Java uses the AL2023 RPM matcher for Corretto and native libraries; Python and Node.js use both that matcher and Grype for their upstream language components.

An exception needs a repository issue recording the maintainer review, the affected files or functionality, the source advisory, the rationale or mitigation, and an owner. Add the exact scope to [the exception list](releases/vulnerability-exceptions.json) through a protected PR. Set UTC creation and expiry dates at most 30 days apart. An expired exception cannot permit a finding. Record both false-positive and accepted-risk decisions in the issue; an exception never changes the raw scanner output.

Compare RPM versions to the [ALAS advisory](https://docs.aws.amazon.com/linux/al2023/ug/alas.html), since Amazon can backport a fix while leaving the upstream version unchanged. The ALAS regression workflow compares synthetic before/after RPM identities for [ALAS-2023-181](https://alas.aws.amazon.com/AL2023/ALAS-2023-181.html). ALAS-derived package metadata does not enumerate every unfixed CVE. Grype's upstream and bundled-component matches depend on its data and component identities. Check official advisories for relevant files and features; a clean scan is not proof of no vulnerabilities or coverage of downstream applications.

## Project release requirements

- Fixed AL2023 repository release and builder digest; verified RPM signatures and checksums.
- Complete component inventory despite omitting the RPM database from runtime images.
- SBOM, provenance, component license notices, image signatures, and consumer verification instructions.
- Vulnerability scanning that identifies AL2023 packages correctly and considers ALAS/backported fixes.
- No unreviewed critical/high vulnerability gate exceptions; every exception has an owner, reason, scope, and expiry.
- Default non-root execution; read-only-rootfs and dropped-capabilities smoke tests.
- Separate unprivileged build/test workflows from trusted release credentials and signing permissions.
- Issue-tracked dependency updates and published rollback instructions.
- Apply these requirements to static/base and every committed Java, Python, and Node.js variant on both architectures. Track selected language-version support windows, runtime-loaded components, and required native libraries; no variant bypasses the stable-release gates.
