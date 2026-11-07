ARG NODE_RUNTIME=ghcr.io/rambow-cloud/amazon-linux-distroless/nodejs24:24-preview
FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7 AS builder
RUN dnf --releasever=2023.12.20261102 -y --setopt=install_weak_deps=False install gcc nodejs24-devel nodejs24-npm nodejs24-full-i18n && dnf clean all
COPY examples/nodejs24/ /src/
RUN --network=none /usr/bin/node-24 /src/build_fixture.mjs
FROM ${NODE_RUNTIME}
COPY --from=builder --chown=65532:65532 /src/node_modules/ /app/node_modules/
COPY --chown=65532:65532 examples/node-app/main.mjs /app/main.mjs
CMD ["/app/main.mjs"]
