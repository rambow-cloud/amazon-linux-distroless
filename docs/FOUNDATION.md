# Static and base foundation candidates

The [foundation contract](ARCHITECTURE.md#foundation-runtime-contract) covers both images. Use `static` for a Go binary built with `CGO_ENABLED=0`. Use `base` for a compatible application built against the locked AL2023 glibc and loader. Native dependencies beyond that contract belong to the application. Both images provide CA roots and UTC data; neither provides a shell or package manager.

Build and qualify in GitHub Actions:

```sh
gh workflow run foundation-build.yml --ref main
```

Open the completed [Foundation image build](https://github.com/rambow-cloud/amazon-linux-distroless/actions/workflows/foundation-build.yml) run and download the `foundation-candidate-amd64` or `foundation-candidate-arm64` artifact. Each contains the tested image archives, locked inputs, exact final file inventories, matching source RPMs, project source, and native verification results. These candidates do not publish a registry tag.

The [Go](../examples/foundation/probe.go) and [AL2023-linked C](../examples/foundation/probe.c) fixtures run as the default numeric user with an exec-form entrypoint, a read-only root, a writable `/tmp` mount, no capabilities and no new privileges. A private test service exercises container DNS and TLS without contacting an external endpoint or modifying the images. The application supplies the ephemeral fixture CA explicitly; the tests also require rejection of an untrusted CA and a mismatched hostname. Separate probes check UID/GID, NSS, locale, UTC, signal delivery, and application exit codes. The final-image inventory audit and failed execution attempts verify the absent-tool contract.

The same run provides a `foundation-oci-indexes` artifact. It contains one OCI layout per variant, tagged `candidate`, and `indexes.json` with the exact index and leaf digests. Each index is built from the audited Linux amd64 and arm64 manifests with their matching native probe results. Both build and execution are native; emulation is not release qualification evidence.

For a prebuilt application, use an exec-form `ENTRYPOINT ["/app/program"]` and mount only the writable paths the application needs. Match the application binary and native libraries to the target architecture. Follow [Updating inputs](UPDATING.md#foundation-rpm-locks) to refresh the signed RPM locks.
