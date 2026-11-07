# Isolated debugging

Use logs, container state and a separate operator-approved tool image to diagnose production workloads. This decision applies to `static`, `base`, Java, Python and Node.js on Linux amd64 and arm64. The production runtime contract stays shell-free. The project defers publication of a separate debug image. [RFC #15](https://github.com/rambow-cloud/amazon-linux-distroless/issues/15)

| Scenario | Docker | Kubernetes |
| --- | --- | --- |
| Workload exits on startup | Read `docker logs` and inspect the exit code, OOM state, image digest, mounts and command. Reproduce with the same digest and workload configuration in a disposable environment. | Read Pod events and `kubectl logs --previous` after a restart. Reproduce with the same digest, arguments and relevant configuration in a disposable Pod. |
| Running workload has a connection or TLS error | Run a temporary tool container with `--network container:<name-or-id>` to reach the target's loopback and network. | Add a short-lived ephemeral container to the affected Pod. It shares the Pod network. Network probes can use loopback without targeting the workload's process namespace. |
| Need runtime-specific tools such as a JDK debugger | Reproduce the issue in an isolated application environment with a matching, separately approved toolchain. | Use an isolated reproduction Pod and the matching toolchain. Treat access to process namespaces, JVM agents and workload data as separate permissions. |

A project-published debug image would supply a consistent toolset and simplify pinning. A tool image alone would still use its own filesystem, libraries and trust configuration. A set of runtime-derived debug variants would also require its own architecture builds, size budgets and release maintenance. The isolated approach uses the same workflow for all five production variants. [Docker container networks](https://docs.docker.com/engine/network/#container-networks) · [Kubernetes Pod debugging](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/)

## TLS probe from a separate container

Set `helper` to an approved image reference ending in `@sha256:…`, `container` to the running workload's name or ID, and `url` to the HTTPS endpoint. For a private CA, mount the approved public certificate bundle read-only in the helper and pass its path to `--cacert`. Keep hostname and certificate verification enabled.

```sh
docker run --rm --network "container:$container" --read-only --user 65532:65532 \
  --cap-drop ALL --security-opt no-new-privileges:true --entrypoint curl \
  "$helper" --fail --show-error --max-time 5 "$url"
```

In Kubernetes, set `namespace` and `pod` to the target. Use a helper that supports non-root execution and matches the cluster's admission policy.

```sh
kubectl -n "$namespace" auth can-i patch pods/ephemeralcontainers
kubectl -n "$namespace" debug "$pod" --attach=true --profile=restricted \
  --image="$helper" -- curl --fail --show-error --max-time 5 "$url"
```

Use the application's actual hostname for SNI and certificate validation. A probe with the correct endpoint and a different trust bundle can distinguish a trust failure from a connectivity failure. The helper uses its own filesystem and trust settings. Confirm a fix through the workload's own TLS client. For an exited Docker container, start a disposable reproduction before using shared networking. A terminated Kubernetes ephemeral container remains in the Pod record until the Pod is replaced. [Kubernetes ephemeral containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/)

## Access, provenance and maintenance

- Limit Docker daemon access to operators authorized for the target host. In Kubernetes, scope `pods/ephemeralcontainers` patch/update and attach permissions to the relevant namespace and operators, and enforce the namespace's admission and image policies. Grant process or filesystem access separately where the scenario requires it.
- The operator owns the approved helper, its digest pins, inventory, supplier provenance, component licenses and vulnerability review. Select an index or leaf that matches the node architecture. Check the supplier's license notices and source obligations before redistributing an image.
- If a future RFC proposes a project-owned image, assign an owner for updates, license and source delivery, and vulnerability gates. Require a pinned input set, signed indexes, per-platform SBOMs, native amd64/arm64 tests and separate unpacked and registry transfer size ceilings based on measured candidates. Keep debug references separate from production aliases.

## Verification

The [Isolated debug verification workflow](https://github.com/rambow-cloud/amazon-linux-distroless/actions/workflows/isolated-debug.yml) runs a TLS fixture on the signed Node.js 24 runtime digest. It uses a separate helper from the locked official AL2023 builder digest and reaches the fixture over its shared loopback. Default trust rejects the fixture certificate, the trusted certificate fails against the wrong hostname, and the correct certificate and hostname succeed. The workload keeps its image and start time and reports an empty filesystem diff. The run summary records both architectures, exact digests, image sizes and the curl RPM version and license. This run exercises Docker. The Kubernetes procedure follows the upstream Pod debugging interface.
