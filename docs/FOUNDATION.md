# Static and base foundation images

The [foundation contract](ARCHITECTURE.md#foundation-runtime-contract) covers both images. Use `static` for a Go binary built with `CGO_ENABLED=0`. Use `base` for a compatible application built against the locked AL2023 glibc and loader. Native dependencies beyond that contract belong to the application. Both images provide CA roots and UTC data; neither provides a shell or package manager.

The [first stable foundation release](https://github.com/rambow-cloud/amazon-linux-distroless/releases/tag/foundation-2023.12.20261102-r1) and its [successful Actions run](https://github.com/rambow-cloud/amazon-linux-distroless/actions/runs/42366198722) cover native amd64 and arm64:

| Variant | GHCR | Quay | Initial fixed revision |
| --- | --- | --- | --- |
| `static` | `ghcr.io/rambow-cloud/static:2023` | `quay.io/rambow-cloud/static:2023` | `2023.12.20261102-r1` |
| `base` | `ghcr.io/rambow-cloud/base:2023` | `quay.io/rambow-cloud/base:2023` | `2023.12.20261102-r1` |

The `:latest` and `:2023` tags follow the current stable foundation. The full snapshot tag follows revisions of that snapshot. For deployment pinning, use a fixed revision or the signed index digest. The initial release digests on GHCR are:

- `ghcr.io/rambow-cloud/static@sha256:74ad3c883feb5cd0fb61f742a7b30cc03eb2bdd9bc68e95f341fade3b9b9d257`
- `ghcr.io/rambow-cloud/base@sha256:1a096a58c201e9bca0a8986d00b125d9de40944894305273c7fbc372de4464c6`

## Build and qualify a candidate

Build and qualify in GitHub Actions:

```sh
gh workflow run foundation-build.yml --ref main
```

Open the completed [Foundation image build](https://github.com/rambow-cloud/amazon-linux-distroless/actions/workflows/foundation-build.yml) run and download the `foundation-candidate-amd64` or `foundation-candidate-arm64` artifact. Each contains the tested image archives, locked inputs, exact final file inventories, matching source RPMs, project source, and native verification results. These candidates do not publish a registry tag.

Changes to foundation inputs run the native build, workload and OCI index checks on pull requests and main. The `Foundation gate` still reports a result for documentation-only changes. Pull request jobs use read-only repository permissions and do not receive registry or signing credentials. BuildKit uses only the runner's job-local cache; the Go module/build cache action is disabled. If a shared cache is added, scope it by architecture, toolchain, and the SHA-256 of all build and lock inputs.

The [Go](../examples/foundation/probe.go) and [AL2023-linked C](../examples/foundation/probe.c) fixtures run as the default numeric user with an exec-form entrypoint, a read-only root, a writable `/tmp` mount, no capabilities and no new privileges. A private test service exercises container DNS and TLS without contacting an external endpoint or modifying the images. The application supplies the ephemeral fixture CA explicitly; the tests also require rejection of an untrusted CA and a mismatched hostname. Separate probes check UID/GID, NSS, locale, UTC, signal delivery, and application exit codes. The final-image inventory audit and failed execution attempts verify the absent-tool contract.

The same run provides a `foundation-oci-indexes` artifact. It contains one OCI layout per variant, tagged `candidate`, and `indexes.json` with the exact index and leaf digests. Each index is built from the audited Linux amd64 and arm64 manifests with their matching native probe results. Both build and execution are native; emulation is not release qualification evidence.

Run `gh workflow run foundation-repro.yml --ref main` for a paired clean build on separate native runners. The `foundation-reproducibility` artifact compares normalized file inventories, OCI manifests, layers and index digests. Inventory fingerprints include paths, hashes, ownership, modes and symlink targets. The assembler uses the lock's timestamp and ordered inputs; the report separates any OCI metadata or encoding difference from a runtime-file difference.

Each candidate CI run enforces the [measured size ceilings](../images/foundation/budgets.json). Unpacked bytes are the Docker image size; modeled transfer bytes sum individually gzip-compressed image layers plus the manifest and config. File count includes regular files and symlinks, and package count includes only RPM owners of selected payload files. The reproducibility report also lists official AL2023 base and minimal images from the selected release, including the platform digest and the registry's actual manifest, config and layer byte sizes. Review the report before changing a ceiling.

For a prebuilt application, use an exec-form `ENTRYPOINT ["/app/program"]` and mount only the writable paths the application needs. Match the application binary and native libraries to the target architecture. Follow [Updating inputs](UPDATING.md#foundation-rpm-locks) to refresh the signed RPM locks.

## SBOM, source and provenance

The OCI index artifact includes `evidence/provenance.json`, a CycloneDX SBOM and a payload RPM report for each variant and architecture. The SBOM subject is the exact OCI leaf digest. Components name the owning RPM, package and source versions, license, and pinned source download. The coverage report distinguishes partial RPM payloads from transaction inputs that did not ship. The provenance includes the builder and repository pins, tool package identities, source commit and SHA-256 for each native evidence file. The corresponding source archives are attached to the same run in the architecture artifacts.

For signed evidence, dispatch `gh workflow run foundation-evidence.yml --ref main`. Download the `foundation-signed-evidence` artifact from the successful run and verify it:

```sh
cosign verify-blob --bundle SHA256SUMS.sigstore.json \
  --certificate-identity 'https://github.com/rambow-cloud/amazon-linux-distroless/.github/workflows/foundation-evidence.yml@refs/heads/main' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' SHA256SUMS
sha256sum -c SHA256SUMS
```

Compare architecture artifact files with the checksums in `evidence/provenance.json`. Use the stable release below for registry-level verification.

## Stable foundation promotion

After the language stable plan and foundation locks have merged, dispatch from protected main:

```sh
gh workflow run foundation-release.yml --ref main -f revision=1
```

Promotion runs the full native foundation/language qualification and fresh scans. It signs both OCI indexes, attaches the platform SBOMs, preserves matching source and scan evidence in the GitHub Release, and then moves `static:2023` and `base:2023` under `ghcr.io/rambow-cloud/amazon-linux-distroless/`. Each image has a fixed tag such as `base:2023.12.20261102-r1`. Use revision 1 for a newer AL2023 repository snapshot, or increment the revision for a new digest of the same snapshot.

The workflow copies the same signed indexes and attestations to the short GHCR and Quay repositories. Quay uses the existing publisher's GitHub OIDC exchange and repository-scoped Write access. On initial setup, make the short GHCR packages public after their first publish and create the public Quay repositories with Write access for the OIDC publisher. To repair the current mirrors or verify both with anonymous native pulls, run:

```sh
gh workflow run foundation-release.yml --ref main -f mode=mirror -f registry=both
gh workflow run foundation-pull.yml --ref main -f registry=both -f release=foundation-2023.12.20261102-r1
```

Select the current signed foundation release tag for mirror verification. The compatibility GHCR repositories also serve the original fixed tags.

Select a GitHub Release tag from the [acceptance report](V1-ACCEPTANCE.md) or the later foundation releases. Verify the index, the signed release record and the platform SBOM. This example selects the v1.0 base image on amd64:

```sh
set -eu
release='foundation-2023.12.20261102-r1'
variant='base'
arch='amd64'
repo='rambow-cloud/amazon-linux-distroless'
issuer='https://token.actions.githubusercontent.com'
identity="https://github.com/$repo/.github/workflows/foundation-release.yml@refs/heads/main"
predicate='https://rambow-cloud.github.io/amazon-linux-distroless/foundation-stable/v1'
record=$(gh release download "$release" --repo "$repo" --pattern foundation-release.json --output -)
image=$(printf '%s' "$record" | jq -er --arg v "$variant" '.images[$v].reference')
leaf=$(printf '%s' "$record" | jq -er --arg v "$variant" --arg a "$arch" '.images[$v].leaves[$a]')
cosign verify --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" "$image"
attestations=$(cosign verify-attestation --type "$predicate" --certificate-identity "$identity" \
  --certificate-oidc-issuer "$issuer" "$image")
printf '%s\n' "$attestations" | jq -es --argjson record "$record" \
  '[.[] | (if type == "array" then .[] else . end) | .payload | @base64d | fromjson | .predicate] | any(. == $record)'
cosign verify-attestation --type cyclonedx --certificate-identity "$identity" \
  --certificate-oidc-issuer "$issuer" "${image%@*}@$leaf"
```

The signed record's `assets` entries give the SHA-256 digests for downloaded evidence files. Select `arm64` for that platform or `static` for the static image.

If promotion stops partway through, rerun the failed job from the same release workflow and source commit. A draft belongs to the exact approved digests; an already published release is only replayed after checking its immutable image and signed evidence. Roll back a consumer by redeploying its prior verified application and base digests.
