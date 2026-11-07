# Runtime support and maintenance

The stable matrix is Java 17/21/25, Python 3.11–3.14 (default GIL builds), and Node.js 22/24/26 on native linux/amd64 and linux/arm64. rambow-cloud maintains these images on a community basis. The [stable release index](STABLE.md) and [v1.0 acceptance report](V1-ACCEPTANCE.md) record published versions and evidence.

## Lifecycle boundaries

Reviewed on 2026-11-07. Upstream dates do not extend AL2023 support or promise availability of a particular RPM patch.

| Line | Upstream maintenance boundary |
| --- | --- |
| Corretto 17 | Last planned update July 2029; end of support October 2029 |
| Corretto 21 | Last planned update July 2030; end of support October 2030 |
| Corretto 25 | Last planned update July 2032; end of support October 2032 |
| Python 3.11 | Security fixes through October 2027 |
| Python 3.12 | Security fixes through October 2028 |
| Python 3.13 | Security fixes through October 2029 |
| Python 3.14 | Bugfix releases approximately through October 2027; security fixes approximately through October 2030 |
| Node.js 22 | End of life 2027-04-30 |
| Node.js 24 | End of life 2028-04-30 |
| Node.js 26 | End of life 2029-04-30 |

Sources: [Corretto calendar](https://aws.amazon.com/corretto/faqs/), [Python schedule](https://devguide.python.org/versions/), [Node schedule](https://github.com/nodejs/Release/blob/main/schedule.json).

[AL2023 support ends on 2029-06-30](https://docs.aws.amazon.com/linux/al2023/release-notes/support-information.html). Individual packages can have earlier boundaries. Maintainers must review official per-package support statements during refreshes, using the official tables or builder-only `dnf supportinfo`. The project boundary for every line is the earliest of upstream support, AL2023/package support, or an announced project retirement. Later Corretto/Python dates do not imply these AL2023 images remain maintained beyond June 2029.

Corretto 17, 21 and 25 follow the signed RPMs in the reviewed AL2023 repository snapshot. Python 3.11, 3.12, 3.13 and 3.14 follow same-minor final CPython releases. Node.js 22, 24 and 26 follow same-major final Node.js releases. Review upstream advisories for the language and ALAS for system RPMs. Raise an issue if a required fix lacks an acceptable release.

Before any line reaches its applicable boundary, open a retirement issue and document the migration to a later supported line in the same language. Qualify JNI modules, Python wheels or Node addons against the replacement ABI before promoting application digests. New or replacement lines require an accepted RFC and complete native qualification on both architectures. Retain the retired line's signed immutable releases for rollback and stop advancing its version alias.

## Ownership and updates

The [qualification policy](../releases/runtime-support.json) records the earlier of the published runtime and AL2023 support boundaries. Review it with the official schedules above when refreshing the support matrix. These checks do not replace per-package support review.

rambow-cloud maintainers own reviewed builder/repository/RPM refreshes, file and ABI contracts, native qualification, source/license delivery, vulnerability decisions and signed publication. Consumers own application dependencies, application-specific native libraries, digest updates and deployment rollback.

Daily AL2023 discovery and daily Python/Node.js discovery feed the protected refresh workflows. [UPDATING.md](UPDATING.md) describes native resolution, issue-linked lock PRs, protected checks, signed publication, evidence verification and consumer digest promotion. Community maintenance carries no response-time guarantee.

## ABI, size and licensing

Java uses per-major linked headless module contracts. Python wheels must match the selected CPython minor ABI, the default GIL build, architecture and compatible AL2023 libraries. Node addons must match architecture/libc and either the selected module ABI or a supported N-API boundary. Arbitrary JNI, wheel and addon compatibility is not guaranteed. See [Java](JAVA.md), [Python](PYTHON.md) and [Node.js](NODEJS.md).

Native qualification enforces size ceilings and audits the saved image files. The [acceptance report](V1-ACCEPTANCE.md) separates uncompressed runtime-image bytes from evidence archives and records the outcome of paired clean builds at the normalized-file and OCI digest levels.

Project-authored files use Apache-2.0. Redistributed components retain their individual licenses, notices and applicable corresponding-source obligations; Apache-2.0 does not relicense AL2023 packages. Releases preserve source RPMs, applicable upstream source archives and project source. Consumer examples copy the project license for their project-owned native fixture. No standalone C++ image, FIPS certification, general GUI/CJK-font bundle or unrestricted native-library compatibility is claimed.
