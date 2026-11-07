# Node.js 24 delivery

This page records the original AL2023 RPM-based preview. See [current upstream releases](UPSTREAM-RELEASES.md) for the published multi-version matrix.

Node.js **24.22.1** has a public signed linux/amd64 + linux/arm64 preview. Java 17/21/25 and Python 3.14 are also delivered; see [all runtimes](RUNTIMES.md). See the [v1.0 acceptance report](V1-ACCEPTANCE.md) for the initial stable releases.

[Trusted main publication](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42338033297) · [Permanent release/source/evidence](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/nodejs24-73d04ae2adb4) · [Public package](https://github.com/orgs/rambow-cloud/packages/container/package/amazon-linux-distroless%2Fnodejs24)

Source: [73d04ae2adb4e05eb15c6f737db9d9e4d218c574](https://github.com/rambow-cloud/amazon-linux-distroless/commit/73d04ae2adb4e05eb15c6f737db9d9e4d218c574), AL2023 repository snapshot 2023.12.20261102.

- Immutable version: `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24:nodejs24-73d04ae2adb4`
- Rolling preview: `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24:24-preview`
- Qualified two-platform index: `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24@sha256:4deb78a4d8f94493fb2bc8e58f30b13feb7b74d6389512fd89e57488fb00fdc5`
- amd64 leaf: `sha256:3bfc09547ba73b282ff64923bf65dda6fc1e085a87d14299dd0e834efee207d5`
- arm64 leaf: `sha256:0dcefbda5e479dace7c1bfd0b0b33c1b26b926f0ce94bd0e59a1cffb87237093`

| Platform | Observed Node.js | Uncompressed bytes | Payload RPMs | Runtime check groups |
| --- | --- | ---: | ---: | --- |
| amd64 | 24.22.1 | 121,899,336 | 15 | 19 passed |
| arm64 | 24.22.1 | 117,044,784 | 15 | 19 passed |

Both architectures report Node module ABI **137**, runtime N-API **10**, ICU **78.3**, and a project-owned native C addon compiled for **N-API 8**. A matching AL2023 builder installs the local-source production package from a committed npm lockfile without registry access. ESM imports the native CommonJS package; direct CommonJS execution also passes. The fixture records source, lockfile and architecture-specific addon hashes.

The 19 native check groups verify exact saved files/hashes/modes/owners/symlinks, nonroot/PID 1/read-only root/tmpfs, native addon execution and production node_modules, full ICU locale and actual non-English formatting, Unicode paths/UTC, system CA policy, absent installers/compile cache, controlled HTTP/HTTPS/DNS, valid TLS plus wrong-hostname/untrusted-root rejection, SIGTERM with shutdown hook/143, application exit 17 and shell absence.

The official small-ICU engine uses the separately packaged full-i18n data at /usr/share/node-24/icudata. NODE_ICU_DATA selects that directory. NODE_OPTIONS=--use-openssl-ca and SSL_CERT_FILE select AL2023 trust. The Node API reported **270 CA entries**, which can contain duplicates; this is not a count of unique roots. Compiled crypto/provider support is not a validated FIPS-mode claim.

Publication verified exact coverage of all 15 payload RPM identities on each architecture and reported **zero matched ALAS findings**. Scanner database SHA256: `7c07dd239c3bb7117bbbbda40c0c3c409b0ce801588b4fc2165b73e9196d6712`. Raw scans retain every severity. Unfixed and language-runtime advisory coverage remain limited; clean results do not establish zero exposure. Consumers must scan application dependencies and qualify external native libraries.

The permanent prerelease preserves corresponding source RPM bundles, project source, runtime archives, locks, inventories, package/file/license data, CycloneDX SBOMs, native verification, raw scans, checksums and signature/provenance verification. Component licenses remain individual.

## Use and verify

Direct entrypoint: /usr/bin/node-24, with a /usr/bin/node alias. The [multi-stage application example](../examples/node-app/Dockerfile) defaults to this exact index digest and installs dependencies in /app/node_modules. Build it in application Actions using the repository root as context and -f examples/node-app/Dockerfile. Review [the full runtime/ABI/CA contract](NODEJS.md).

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24@sha256:4deb78a4d8f94493fb2bc8e58f30b13feb7b74d6389512fd89e57488fb00fdc5 --version
```

Index signature and qualified-build provenance were verified before the preview alias advanced. Per-architecture CycloneDX attestations attach to platform manifests. Verification uses the immutable digest and actual workflow identity:

```sh
cosign verify --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-publish.yml@refs/heads/main' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24@sha256:4deb78a4d8f94493fb2bc8e58f30b13feb7b74d6389512fd89e57488fb00fdc5
cosign verify-attestation --type 'https://rambow-cloud.github.io/amazon-linux-distroless/nodejs24-qualified-build/v1' --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-publish.yml@refs/heads/main' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24@sha256:4deb78a4d8f94493fb2bc8e58f30b13feb7b74d6389512fd89e57488fb00fdc5
```

For updates, resolve/review both native locks with runtime-lock.yml, qualify the PR, merge and run runtime-publish.yml with runtime=nodejs24 on main. Rebuild consumers against the accepted digest. See [updates](UPDATING.md) and [support](SUPPORT.md). All container builds, scans and runtime tests ran only in GitHub Actions.
