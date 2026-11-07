ARG AL2023_BASE
FROM ${AL2023_BASE} AS tools
ARG AL2023_RELEASE
RUN dnf --releasever="$AL2023_RELEASE" -y --setopt=install_weak_deps=False install \
      binutils gcc make openssl openssl-devel bzip2-devel expat-devel libffi-devel \
      sqlite-devel xz-devel zlib-devel libxcrypt-devel ncurses-devel readline-devel \
      gdbm-devel libuuid-devel libatomic tar xz && dnf clean all
COPY scripts/prototype/ /tools/
COPY scripts/runtime/ /runtime-tools/
COPY scripts/java21/check_image.py /runtime-tools/check_image.py

FROM tools AS upstream-build
ARG RUNTIME_VARIANT
ARG RUNTIME_VERSION
ARG RUNTIME_LINE
COPY --from=upstream /archive /upstream/archive
COPY --from=upstream /upstream.json /upstream/upstream.json
RUN --network=none /bin/sh /runtime-tools/build-upstream.sh "$RUNTIME_VARIANT" "$RUNTIME_VERSION" "$RUNTIME_LINE"

FROM tools AS dependencies
ARG LOCK_FILE
COPY ${LOCK_FILE} /locks/runtime.json
COPY --from=upstream /runtime.json /runtime.json
COPY --from=upstream-build /upstream-root/ /upstream-root/
COPY --from=upstream-build /upstream/upstream.json /upstream.json
RUN ["/usr/bin/python3", "/tools/assemble.py", "fetch", "/locks/runtime.json", "/rpms"]
RUN --network=none ["/usr/bin/python3", "/runtime-tools/assemble_runtime.py", "/locks/runtime.json", "/rpms", "/result", "/runtime.json", "/upstream-root", "/upstream.json"]

FROM upstream-build AS fixture-build
ARG RUNTIME_VARIANT
ARG RUNTIME_LINE
COPY examples/python314/ /python-fixture/
COPY examples/nodejs24/ /node-fixture/
RUN --network=none /bin/sh /runtime-tools/build-upstream-fixture.sh "$RUNTIME_VARIANT" "$RUNTIME_LINE"

FROM scratch AS runtime
COPY --from=dependencies /result/rootfs/ /
ARG SOURCE_REVISION
ARG RELEASE_VERSION
LABEL org.opencontainers.image.source="https://github.com/rambow-cloud/amazon-linux-distroless" \
      org.opencontainers.image.description="Upstream language runtime on AL2023 system libraries" \
      org.opencontainers.image.revision=$SOURCE_REVISION \
      org.opencontainers.image.version=$RELEASE_VERSION
ENV PATH=/usr/bin TZ=UTC LANG=C.UTF-8 SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
@RUNTIME_ENV@
USER 65532:65532
WORKDIR /app
ENTRYPOINT ["@EXECUTABLE@"]
CMD ["--version"]

FROM runtime AS fixture
COPY --from=fixture-build /fixture-root/ /
ENTRYPOINT ["@EXECUTABLE@", "@PROBE@"]
CMD ["check"]

FROM scratch AS evidence
COPY --from=dependencies /result/inventory.json /inventory.json
COPY --from=fixture-build /fixture/build.json /fixture-build.json
