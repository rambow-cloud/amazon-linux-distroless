ARG AL2023_BASE=public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7
FROM $AL2023_BASE AS tools
ARG AL2023_RELEASE
RUN dnf --releasever="$AL2023_RELEASE" -y --setopt=install_weak_deps=False \
      install binutils dnf-plugins-core gcc openssl nodejs24-devel nodejs24-npm nodejs24-full-i18n \
    && dnf clean all
COPY scripts/prototype/ /tools/
COPY scripts/runtime/ /runtime-tools/
COPY scripts/java21/check_image.py /runtime-tools/check_image.py

FROM tools AS dependencies
ARG LOCK_FILE
COPY ${LOCK_FILE} /locks/runtime.json
COPY images/nodejs24/runtime.json /runtime.json
RUN ["/usr/bin/python3", "/tools/assemble.py", "fetch", "/locks/runtime.json", "/rpms"]
RUN --network=none ["/usr/bin/python3", "/runtime-tools/assemble_runtime.py", "/locks/runtime.json", "/rpms", "/result", "/runtime.json"]

FROM tools AS fixture-build
COPY examples/nodejs24/ /src/
RUN --network=none /usr/bin/node-24 /src/build_fixture.mjs \
    && openssl req -x509 -newkey rsa:2048 -nodes -keyout /fixture/server.key -out /fixture/server.pem \
      -days 30 -subj /CN=tls-fixture -addext subjectAltName=DNS:tls-fixture,DNS:localhost,IP:127.0.0.1 \
    && chmod 644 /fixture/server.*

FROM scratch AS runtime
COPY --from=dependencies /result/rootfs/ /
ARG SOURCE_REVISION
ARG RELEASE_VERSION
LABEL org.opencontainers.image.source="https://github.com/rambow-cloud/amazon-linux-distroless" \
      org.opencontainers.image.description="AL2023 Node.js 24 runtime with full ICU data; component licenses retained individually" \
      org.opencontainers.image.revision=$SOURCE_REVISION \
      org.opencontainers.image.version=$RELEASE_VERSION
ENV PATH=/usr/bin TZ=UTC LANG=C.UTF-8 NODE_ICU_DATA=/usr/share/node-24/icudata \
    NODE_OPTIONS=--use-openssl-ca SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt NODE_DISABLE_COMPILE_CACHE=1
USER 65532:65532
WORKDIR /app
ENTRYPOINT ["/usr/bin/node-24"]
CMD ["--version"]

FROM runtime AS fixture
COPY --from=fixture-build /src/node_modules/ /app/node_modules/
COPY --from=fixture-build /fixture/server.pem /fixture/server.pem
COPY --from=fixture-build /fixture/server.key /fixture/server.key
COPY examples/nodejs24/probe.mjs examples/nodejs24/commonjs.cjs /app/
ENTRYPOINT ["/usr/bin/node-24", "/app/probe.mjs"]
CMD ["check"]

FROM scratch AS evidence
COPY --from=dependencies /result/inventory.json /inventory.json
COPY --from=fixture-build /fixture/build.json /fixture-build.json
