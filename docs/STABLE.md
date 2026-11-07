# Runtime stable channels

Use `ghcr.io/rambow-cloud/python:3.14` or `quay.io/rambow-cloud/python:3.14` to follow Python 3.14. Pin a full revision tag or its index digest on either registry for reproducibility. The original GHCR paths continue to serve existing consumers.

## Published stable revisions

All ten stable channels use the same native amd64 and arm64 indexes as their qualified previews. Each regular GitHub Release contains its signed promotion record, fresh scan reports and source links.

Browse the GHCR packages for [Java](https://github.com/orgs/rambow-cloud/packages/container/package/java), [Python](https://github.com/orgs/rambow-cloud/packages/container/package/python) and [Node.js](https://github.com/orgs/rambow-cloud/packages/container/package/nodejs).

Browse the Quay tags for [Java](https://quay.io/repository/rambow-cloud/java?tab=tags), [Python](https://quay.io/repository/rambow-cloud/python?tab=tags) and [Node.js](https://quay.io/repository/rambow-cloud/nodejs?tab=tags).

Open a package’s **Versions** or **Tags** list to find the version line, its exact revision tag and its index digest. For the evidence, match the revision to a regular [GitHub Release](https://github.com/rambow-cloud/amazon-linux-distroless/releases) named for the runtime line and revision. Download `stable.json` and compare its image digest with the selected tag. The signed record links the qualified preview, source and scan reports.

For example, to resolve the current Node.js 22 digest, inspect the version line in either registry:

```sh
docker buildx imagetools inspect ghcr.io/rambow-cloud/nodejs:22
docker buildx imagetools inspect quay.io/rambow-cloud/nodejs:22
```

Pin the reported `sha256:…` with `@sha256:…` and follow the [signature verification instructions](RUNTIMES.md#application-packaging). Use the registry tag list and signed record together if publication is still in progress.

## Release operation

The [candidate plan](../releases/stable-candidates.json) binds the source commit, preview release, image index digest, stable revision and size ceiling. The initial ceilings round the larger native image up to an 8 MiB boundary and add 8 MiB of headroom. Each future change goes through a protected PR. Start at revision 1 for an upstream version, then increment the revision for each new digest at the same version. A higher upstream version starts its own revision 1.

After the plan merges, run the workflow on main. Check mode performs the validation and refreshes scanner evidence. Publish mode signs the promotion, records the GitHub Release and moves the rolling tag in the language package as well as the compatibility tag.

```sh
gh workflow run runtime-stable.yml --ref main -f runtime=nodejs26 -f mode=check
gh workflow run runtime-stable.yml --ref main -f runtime=nodejs26 -f mode=publish
```

The workflow verifies the signed preview index and qualified-build provenance against the trusted main workflow identity. It verifies the native reports and the CycloneDX attestation for each leaf, and compares release asset digests with the signed evidence manifest. The original preview holds the exact image and corresponding source archives. Fresh ALAS scans and applicable upstream Grype scans use the verified SBOMs and enforce the [stable vulnerability policy](../SECURITY.md#stable-vulnerability-gate). The stable release attaches the scan reports and signed promotion record.

Promotion binds the same index digest to the fixed revision tag. It verifies the copied index, build signature, build and promotion attestations, and each platform's CycloneDX attestation in the language package before moving the rolling tag. The signed promotion record still identifies the original per-line image reference. The workflow rejects downgrade attempts and collisions, and preserves published revision evidence.

Use `mode=mirror` to copy or repair an existing stable release without rebuilding or refreshing its scan reports. The workflow revalidates the published release and its evidence before moving any tag. The `registry` input selects `both`, `ghcr` or `quay` in mirror mode. Publish mode updates GHCR and the enabled Quay mirror.

The short repositories use `ghcr.io/rambow-cloud/{java,python,nodejs}` and `quay.io/rambow-cloud/{java,python,nodejs}`. A version line such as `nodejs:22` follows its latest stable patch and revision. A full version such as `nodejs:22.23.4` follows revisions of that patch. `nodejs:22.23.4-r1` pins a specific revision. The `latest` tag selects the highest numeric stable version published in that language repository, then its highest revision. Updating an older line leaves `latest` on the higher line.

For first-time setup, mirror to GHCR to create the three packages and make them Public in their package settings if needed. Quay uses the `rambow-cloud+runtime_publisher` robot with Write access to the three public repositories. Its federation trusts issuer `https://token.actions.githubusercontent.com` and subject `repo:rambow-cloud@333554680/amazon-linux-distroless@1448396331:environment:quay-runtime-publish`. The GitHub environment permits deployments only from `main`. Each publishing job exchanges its GitHub OIDC token for a short-lived Quay token. No stored Quay secret is needed. After the first mirror and verification succeed, set the repository Actions variable `QUAY_RUNTIME_MIRROR_ENABLED` to `true` so all future stable promotions update Quay.

```sh
gh workflow run runtime-stable.yml --ref main -f runtime=all -f mode=mirror -f registry=both
gh workflow run runtime-mirror-pull.yml --ref main -f registry=both
```

The second workflow pulls the public mirrors without registry credentials on native amd64 and arm64. It checks tag digests, signatures, the stable record, per-platform SBOMs and the native runtime version.

The GitHub Release tag identifies the protected main promotion commit. The signed record identifies both that commit and the original build source commit, and the qualified preview supplies the matching build source archives.

Consumers can pin the exact index digest. Roll back a deployment by redeploying the previous accepted application and runtime digests. Use the stable release's `stable.json` to recover its digest and previous reference.

The stable attestation type is `https://rambow-cloud.github.io/amazon-linux-distroless/runtime-stable/v1`. Its certificate identity is `https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-stable.yml@refs/heads/main` and its issuer is `https://token.actions.githubusercontent.com`. The verified predicate records the runtime, revision, source commit, preview and scan checksums. Check the tag and digest in the record before using it as deployment evidence.

The runtime channels are a scoped part of [#11](https://github.com/rambow-cloud/amazon-linux-distroless/issues/11). The project release criteria and unattended upstream updates have separate milestones.

For project-wide release qualification, run `gh workflow run project-qualification.yml --ref main` after the accepted stable language candidates have been promoted. The read-only workflow runs native static/base checks and paired clean builds of each supported language on both architectures. It records normalized file inventories, OCI manifest reproducibility and size measurements using the foundation definitions. The locked timestamp is passed to Java truststore generation and CPython compilation to avoid embedding the runner time in runtime files. The workflow also verifies the signed security evidence of every approved language channel and its [support window](SUPPORT.md). A missing or failing variant fails the project qualification. Foundation signing and fresh project-wide release scans remain part of [#11](https://github.com/rambow-cloud/amazon-linux-distroless/issues/11).
