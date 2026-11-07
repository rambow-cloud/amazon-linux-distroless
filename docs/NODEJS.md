# Node.js 24 runtime contract

Node.js follows public signed Java 17/21/25 and Python 3.14 delivery, under [#22](https://github.com/rambow-cloud/amazon-linux-distroless/issues/22) and [RFC #16](https://github.com/rambow-cloud/amazon-linux-distroless/issues/16). Native [resolution run 42336688597](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42336688597) selected **Node.js 24.22.1**, ICU **78.3**, Node module ABI **137** and runtime N-API **10** from the explicit AL2023 2023.12.20261102 snapshot on both architectures. These are candidate inputs until final runtime qualification and trusted-main delivery provide actual immutable references.

## Runtime

- `FROM scratch`, native linux/amd64 and linux/arm64, UID/GID 65532, `/app` workdir, direct `/usr/bin/node-24` entrypoint and generated `/usr/bin/node` alias. No npm start or shell wrapper.
- Locked Node shared-library closure, AL2023 CA trust, OpenSSL crypto configuration/providers, C.UTF-8 and UTC. Compiled FIPS support/provider availability is not a validated FIPS operating-mode claim; the default runtime is not forced into FIPS mode.
- The official engine uses small-ICU plus a separate full-i18n RPM. Ship its audited `/usr/share/node-24/icudata` data and set `NODE_ICU_DATA` explicitly. Qualification requires multiple locales and actual non-English number/date formatting rather than merely checking that Intl exists.
- `NODE_OPTIONS=--use-openssl-ca` and explicit `SSL_CERT_FILE` select the AL2023 CA bundle. When supplying additional NODE_OPTIONS, preserve the CA option if this policy is intended. Certificate validation remains enabled; private application trust is an explicit application configuration. [Node 24 TLS documentation](https://github.com/nodejs/node/blob/v24.x/doc/api/tls.md) distinguishes system, default, bundled and extra CA stores.
- `NODE_DISABLE_COMPILE_CACHE=1`, a read-only root and an explicit `/tmp` tmpfs avoid runtime cache writes. npm/npx/corepack/node-gyp, compilers, development headers, package managers, package databases and shells are absent from the production base.

## Applications and native addons

Install production dependencies into `/app/node_modules` using a version/architecture-compatible AL2023 builder and a committed package lock, then copy the dependency tree and application. `npm ci --omit=dev` belongs in the builder. Supply only deliberately required installation scripts, and review native dependencies instead of relying solely on package metadata.

The [multi-stage example](../examples/node-app/Dockerfile) compiles a project-owned **N-API 8 C addon** with official Node 24 headers, then installs a repository-owned local-source package with a committed v3 lockfile using offline `npm ci --omit=dev --ignore-scripts --install-links`. Only packed runtime files are copied. Source is bound to the project commit; no mutable registry lookup is needed for this example. The fixture records the lock and native binary hashes, exact Node version, architecture, N-API target and module ABI.

N-API stability covers the Node-facing API boundary; it does not make a native binary portable across CPU architectures, libc baselines or arbitrary external shared libraries. Non-N-API addons also need the matching Node module ABI (137 for this line). Build and qualify application-specific native dependencies against the selected runtime. This project does not add a general C++ workload image.

Use `CMD ["/app/main.mjs"]` for ESM or `CMD ["/app/main.cjs"]` for CommonJS. Pass Node options before the script in the JSON argument list or through the documented NODE_OPTIONS policy. Build the consumer example in application Actions with the repository root as context, `-f examples/node-app/Dockerfile`, and NODE_RUNTIME set to an actual qualified immutable runtime reference after publication.

```sh
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m APPLICATION_IMAGE
```

## Qualification and maintenance

Native checks compare exact saved runtime files/hashes/modes/owners/symlinks, then execute ESM and CommonJS entrypoints, a builder-installed N-API addon, locked production dependency paths, full ICU locale formatting, system trust/crypto, Unicode filenames, PID 1/nonroot/read-only behavior, no package tools/cache, controlled plain HTTP and HTTPS services, service-name resolution, wrong-hostname/untrusted-root rejection, SIGTERM/shutdown hook/143, application exit propagation and shell absence. Test certificates, keys and application/native dependency code are confined to fixture images.

[Package inputs](../images/nodejs24/packages.json), [runtime file selection](../images/nodejs24/runtime.json), and `locks/nodejs24/linux-{amd64,arm64}.json` define the reviewed runtime. `runtime-lock.yml` selects runtime=nodejs24 for candidate resolution. Shared language verification changes qualify both Python and Node.js; common rootfs/image-audit changes also qualify all six Java pairs. All container work runs only in Actions; retired CVE comparisons remain disabled.

After main integration, `runtime-publish.yml` with runtime=nodejs24 rebuilds/qualifies both architectures, rejects cross-version/ABI/ICU/CA-policy evidence, verifies complete payload SBOM scan coverage, blocks known fixable High/Critical ALAS findings, preserves matching source/report/image assets in a prerelease, and verifies keyless index signature/provenance before advancing 24-preview. Intended package: `ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24`. Actual delivery evidence is required before claiming this reference exists.

Certificate identity is `https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-publish.yml@refs/heads/main`, issuer `https://token.actions.githubusercontent.com`. Component licenses remain individual. ALAS unfixed/language-runtime advisory coverage is limited; applications need separate dependency scanning/qualification. Stable project-wide support and measured OCI reproducibility remain separate roadmap work.
