# Static and base foundation candidates

The [foundation contract](ARCHITECTURE.md#foundation-runtime-contract) covers both images. Use `static` for a Go binary built with `CGO_ENABLED=0`. Use `base` for a compatible application built against the locked AL2023 glibc and loader. Native dependencies beyond that contract belong to the application. Both images provide CA roots and UTC data; neither provides a shell or package manager.

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
