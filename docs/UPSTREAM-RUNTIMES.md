# Upstream language runtimes on AL2023

The Python and Node.js workflow uses separate inputs for the language release and the operating system. The final image starts from scratch with the upstream runtime and its selected AL2023 library, locale, timezone and trust files. It runs as UID/GID 65532.

| Family | Version lines | Release input | Verification |
| --- | --- | --- | --- |
| CPython | 3.11, 3.12, 3.13, 3.14 | Source archive from python.org | Sigstore bundle, pinned release-manager identity and SHA-256 |
| Node.js | 22, 24, 26 | Linux x64 or arm64 binary archive from nodejs.org | OpenPGP signed checksum manifest, pinned release keys and SHA-256 |

CPython builds natively on AL2023 with the default GIL and system OpenSSL and Expat. The interpreter and selected standard library install below `/opt/cpython`, with versioned `/usr/bin/python3.X` entrypoints and a `python3` alias. The wheel fixture uses the exact build and architecture. Node.js ships the upstream executable, embedded ICU and license. The matching upstream headers and npm build the fixture addon. Its native library closure includes AL2023 libatomic where required.

Builder provisioning and RPM lock resolution use dnf. Runtime assembly stages the verified RPM payloads with scripts and triggers disabled. An explicit file selection and ELF dependency walk populate the final image. The builder supplies generated CA and crypto policy files tied to the matching locked packages. Python installer modules, npm, headers, compilers, package databases and shells stay outside the final image.

## Refreshing inputs

Update exact releases in [versions.json](../images/upstream/versions.json). The [system package inputs](../images/upstream/packages.json) identify the reviewed AL2023 snapshot and roots. These inputs can change independently.

1. Open a maintenance issue and push the reviewed input changes to a branch.
2. Run `gh workflow run runtime-lock.yml --ref BRANCH`. The workflow resolves locks on native amd64 and arm64 and verifies upstream release signatures. Download the four `upstream-lock-*` artifacts, review the changes and commit them to `locks/upstream/`.
3. Open the issue-linked PR. The protected language gate runs all seven versions on both architectures and records payload inventory, native wheel/addon, TLS, locale, process and hardening checks.
4. Merge after review and run `gh workflow run runtime-publish.yml --ref main -f runtime=RUNTIME_ID` for each changed line. Check the public image index digest, signature and provenance before rebuilding applications.
5. Deploy the application image built from the accepted runtime digest. Roll back by redeploying the previous accepted application digest.

Source bundles include the official upstream source archive and signature evidence alongside matching AL2023 source RPMs. The SBOM identifies the upstream release, observed bundled versions and shipped OS package identities. Publication scans OS RPMs with the ALAS matcher and upstream components with Grype using the runtime CPE and component identities. Review vendor advisories and embedded dependency applicability alongside the raw reports.
