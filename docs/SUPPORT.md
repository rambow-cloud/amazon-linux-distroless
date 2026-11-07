# Runtime support and maintenance

The delivered matrix is Java 17/21/25, Python 3.11–3.14 (default GIL builds), and Node.js 22/24/26 on native linux/amd64 and linux/arm64. These are community-maintained previews owned by rambow-cloud, without a commercial support SLA. [Runtime delivery](RUNTIMES.md) records observed patch versions and evidence.

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

Python and Node.js patch versions follow reviewed upstream release locks. Review upstream advisories for the runtime and ALAS for system RPMs. Raise an issue if a required fix lacks an acceptable upstream or AL2023 release. Record migration/retirement decisions before the applicable boundary. Adding or replacing a version line requires an accepted RFC.

## Ownership and updates

rambow-cloud maintainers own reviewed builder/repository/RPM refreshes, file and ABI contracts, native qualification, source/license delivery, vulnerability decisions and signed publication. Consumers own application dependencies, application-specific native libraries, digest updates and deployment rollback.

Daily builder discovery proposes maintenance issues. It does not edit locks, advance aliases or deploy consumers. Follow [UPDATING.md](UPDATING.md): issue, native Actions resolution, lock review, protected checks, merge, trusted-main publication, evidence verification, application rebuild and digest promotion. Project-wide stable automation and exception policies remain #10/#11/#12. Preview maintenance carries no response-time guarantee.

## ABI, size and licensing

Java uses per-major linked headless module contracts. Python wheels must match the selected CPython minor ABI, the default GIL build, architecture and compatible AL2023 libraries. Node addons must match architecture/libc and either the selected module ABI or a supported N-API boundary. Arbitrary JNI, wheel and addon compatibility is not guaranteed. See [Java](JAVA.md), [Python](PYTHON.md) and [Node.js](NODEJS.md).

Delivery reports measure uncompressed runtime-image bytes separately from source/evidence archives. Native qualification and exact file audits are delivered; enforced size budgets and measured byte-identical OCI reproducibility remain #8/#23. Deterministic RPM locks alone do not prove either.

Project-authored files use Apache-2.0. Redistributed components retain their individual licenses, notices and applicable corresponding-source obligations; Apache-2.0 does not relicense AL2023 packages. Releases preserve source RPMs, applicable upstream source archives and project source. Consumer examples copy the project license for their project-owned native fixture. No standalone C++ image, FIPS certification, general GUI/CJK-font bundle or unrestricted native-library compatibility is claimed.
