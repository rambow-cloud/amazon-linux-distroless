# Runtime stable channels

The stable promotion workflow reuses a qualified public preview digest. Each version line has a fixed revision tag and a moving alias. For example, `python314:3.14.10-r1` names one release and `python314:3.14` follows that line. Both references use the prefix `ghcr.io/rambow-cloud/amazon-linux-distroless/`.

The [candidate plan](../releases/stable-candidates.json) binds the source commit, preview release, image index digest, stable revision and size ceiling. The initial ceilings round the larger native image up to an 8 MiB boundary and add 8 MiB of headroom. Each future change goes through a protected PR. Start at revision 1 for an upstream version, then increment the revision for each new digest at the same version. A higher upstream version starts its own revision 1.

After the plan merges, run the workflow on main. Check mode performs the validation and refreshes scanner evidence. Publish mode signs the promotion, records the GitHub Release and moves the stable alias.

```sh
gh workflow run runtime-stable.yml --ref main -f runtime=nodejs26 -f mode=check
gh workflow run runtime-stable.yml --ref main -f runtime=nodejs26 -f mode=publish
```

The workflow verifies the signed preview index and qualified-build provenance against the trusted main workflow identity. It verifies the native reports and the CycloneDX attestation for each leaf, and compares release asset digests with the signed evidence manifest. The original preview holds the exact image and corresponding source archives. Fresh ALAS scans and applicable upstream Grype scans use the verified SBOMs and block fixable High/Critical findings. The stable release attaches the scan reports and signed promotion record.

Promotion binds the same index digest to the fixed revision tag. The rolling alias moves after the versioned image and the published GitHub Release have been verified. The workflow rejects downgrade attempts and collisions. A rerun can finish the alias update for a verified release or resume a draft bound to the same digest. Published revision evidence is preserved.

Consumers can pin the exact index digest. Roll back a deployment by redeploying the previous accepted application and runtime digests. Use the stable release's `stable.json` to recover its digest and previous reference.

The stable attestation type is `https://rambow-cloud.github.io/amazon-linux-distroless/runtime-stable/v1`. Its certificate identity is `https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/runtime-stable.yml@refs/heads/main` and its issuer is `https://token.actions.githubusercontent.com`. The verified predicate records the runtime, revision, source commit, preview and scan checksums. Check the tag and digest in the record before using it as deployment evidence.

The runtime channels are a scoped part of [#11](https://github.com/rambow-cloud/amazon-linux-distroless/issues/11). The project release criteria and unattended upstream updates have separate milestones.
