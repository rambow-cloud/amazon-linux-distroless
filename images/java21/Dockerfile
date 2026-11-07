ARG AL2023_BASE=public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7
FROM $AL2023_BASE AS tools
ARG AL2023_RELEASE
RUN dnf --releasever="$AL2023_RELEASE" -y --setopt=install_weak_deps=False \
      install binutils dnf-plugins-core java-21-amazon-corretto-devel java-21-amazon-corretto-jmods \
    && dnf clean all
COPY scripts/prototype/ /tools/
COPY scripts/java21/ /java-tools/

FROM tools AS dependencies
ARG LOCK_FILE
COPY ${LOCK_FILE} /locks/java21.json
COPY images/java21/runtime.json /runtime.json
RUN ["/usr/bin/python3", "/tools/assemble.py", "fetch", "/locks/java21.json", "/rpms"]
RUN --network=none ["/usr/bin/python3", "/java-tools/assemble_java.py", "/locks/java21.json", "/rpms", "/result", "/runtime.json"]

FROM tools AS fixture-build
COPY examples/java21/Probe.java /src/Probe.java
RUN mkdir /classes /fixture && javac --release 21 -d /classes /src/Probe.java \
    && printf 'Main-Class: Probe\nPremain-Class: Probe\n\n' > /manifest \
    && jar --create --file /fixture/probe.jar --manifest /manifest -C /classes . \
    && keytool -genkeypair -alias server -storetype PKCS12 -keystore /fixture/server.p12 \
      -storepass test-only-password -keypass test-only-password -keyalg RSA -keysize 2048 \
      -validity 30 -dname CN=tls-fixture -ext SAN=dns:tls-fixture,dns:localhost,ip:127.0.0.1 \
    && keytool -exportcert -alias server -keystore /fixture/server.p12 \
      -storepass test-only-password -rfc -file /fixture/server.pem \
    && chmod 644 /fixture/*

FROM scratch AS runtime
COPY --from=dependencies /result/java/rootfs/ /
ARG SOURCE_REVISION
ARG RELEASE_VERSION
LABEL org.opencontainers.image.source="https://github.com/rambow-cloud/amazon-linux-distroless" \
      org.opencontainers.image.description="AL2023 Amazon Corretto 21 headless JRE; component licenses retained individually" \
      org.opencontainers.image.revision=$SOURCE_REVISION \
      org.opencontainers.image.version=$RELEASE_VERSION
USER 65532:65532
ENV JAVA_HOME=/opt/java PATH=/usr/bin TZ=UTC LANG=C.UTF-8 XDG_CACHE_HOME=/tmp/.cache
WORKDIR /app
ENTRYPOINT ["/usr/bin/java"]
CMD ["-version"]

FROM runtime AS fixture
COPY --from=fixture-build /fixture/ /fixture/
ENTRYPOINT ["/usr/bin/java", "-jar", "/fixture/probe.jar"]
CMD ["check"]

FROM scratch AS evidence
COPY --from=dependencies /result/java/inventory.json /inventory.json
COPY --from=fixture-build /fixture/server.pem /test-server.pem
