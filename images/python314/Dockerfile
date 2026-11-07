ARG AL2023_BASE=public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7
FROM $AL2023_BASE AS tools
ARG AL2023_RELEASE
RUN dnf --releasever="$AL2023_RELEASE" -y --setopt=install_weak_deps=False \
      install binutils dnf-plugins-core gcc openssl python3.14-devel python3.14-pip \
    && dnf clean all
COPY scripts/prototype/ /tools/
COPY scripts/runtime/ /runtime-tools/
COPY scripts/java21/check_image.py /runtime-tools/check_image.py

FROM tools AS dependencies
ARG LOCK_FILE
COPY ${LOCK_FILE} /locks/runtime.json
COPY images/python314/runtime.json /runtime.json
RUN ["/usr/bin/python3", "/tools/assemble.py", "fetch", "/locks/runtime.json", "/rpms"]
RUN --network=none ["/usr/bin/python3", "/runtime-tools/assemble_runtime.py", "/locks/runtime.json", "/rpms", "/result", "/runtime.json"]

FROM tools AS fixture-build
COPY examples/python314/ /src/
RUN /usr/bin/python3.14 /src/build_fixture.py \
    && openssl req -x509 -newkey rsa:2048 -nodes -keyout /fixture/server.key -out /fixture/server.pem \
      -days 30 -subj /CN=tls-fixture -addext subjectAltName=DNS:tls-fixture,DNS:localhost,IP:127.0.0.1 \
    && chmod 644 /fixture/server.*

FROM scratch AS runtime
COPY --from=dependencies /result/rootfs/ /
ARG SOURCE_REVISION
ARG RELEASE_VERSION
LABEL org.opencontainers.image.source="https://github.com/rambow-cloud/amazon-linux-distroless" \
      org.opencontainers.image.description="AL2023 Python 3.14 runtime; component licenses retained individually" \
      org.opencontainers.image.revision=$SOURCE_REVISION \
      org.opencontainers.image.version=$RELEASE_VERSION
ENV PATH=/usr/bin TZ=UTC LANG=C.UTF-8 PYTHONUTF8=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/python/site-packages SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
USER 65532:65532
WORKDIR /app
ENTRYPOINT ["/usr/bin/python3.14"]
CMD ["--version"]

FROM runtime AS fixture
COPY --from=fixture-build /fixture/site/ /opt/python/site-packages/
COPY --from=fixture-build /fixture/server.pem /fixture/server.pem
COPY --from=fixture-build /fixture/server.key /fixture/server.key
COPY examples/python314/probe.py /fixture/probe.py
ENTRYPOINT ["/usr/bin/python3.14", "/fixture/probe.py"]
CMD ["check"]

FROM scratch AS evidence
COPY --from=dependencies /result/inventory.json /inventory.json
COPY --from=fixture-build /fixture/build.json /fixture-build.json
