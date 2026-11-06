# Security policy

## Current support status

This repository is in planning/bootstrap. There are no supported or published runtime images yet. A v1.0 support policy, vulnerability gates, and update cadence must be completed before a stable release.

AL2023's upstream lifecycle does not constitute a support promise from this project. Individual package support can differ from the distribution lifecycle.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/rambow-cloud/amazon-linux-distroless/security/advisories/new) for sensitive findings. Include affected digests, architecture, reproduction details, and impact. Do not publish exploit details or secrets in an issue. If private reporting is unavailable, ask a maintainer for a private reporting channel without disclosing the vulnerability publicly.

Ordinary non-sensitive build failures and scanner usability issues can use the bug form.

## Planned release requirements

- Fixed AL2023 repository release and builder digest; verified RPM signatures and checksums.
- Complete component inventory despite omitting the RPM database from runtime images.
- SBOM, provenance, component license notices, image signatures, and consumer verification instructions.
- Vulnerability scanning that identifies AL2023 packages correctly and considers ALAS/backported fixes.
- No unreviewed critical/high vulnerability gate exceptions; every exception has an owner, reason, scope, and expiry.
- Default non-root execution; read-only-rootfs and dropped-capabilities smoke tests.
- Separate unprivileged build/test workflows from trusted release credentials and signing permissions.
- Issue-tracked dependency updates and published rollback instructions.

These are roadmap requirements, not claims about an existing artifact.
