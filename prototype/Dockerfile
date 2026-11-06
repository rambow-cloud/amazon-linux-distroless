ARG AL2023_BASE
FROM $AL2023_BASE AS tools
ARG AL2023_RELEASE
RUN dnf --releasever="$AL2023_RELEASE" -y --setopt=install_weak_deps=False \
      install binutils dnf-plugins-core java-21-amazon-corretto-devel \
    && dnf clean all
COPY scripts/prototype/ /tools/

FROM tools AS dependencies
COPY locks/ /locks/
RUN ["/usr/bin/python3", "/tools/assemble.py", "fetch", "/locks/linux-amd64.json", "/rpms"]
# Only exact local RPMs are available; no repository access or network.
RUN --network=none ["/usr/bin/python3", "/tools/assemble.py", "assemble", "/locks/linux-amd64.json", "/rpms", "/result"]

FROM tools AS demo-build
COPY examples/java/Hello.java /src/Hello.java
RUN mkdir /classes && javac --release 21 -d /classes /src/Hello.java \
    && jar --create --file /hello.jar --main-class Hello -C /classes .

FROM scratch AS base
COPY --from=dependencies /result/base/rootfs/ /
LABEL org.opencontainers.image.source="https://github.com/rambow-cloud/amazon-linux-distroless" \
      org.opencontainers.image.description="Experimental AL2023 base; component licenses retained individually"
USER 65532:65532
ENV TZ=UTC LANG=C.UTF-8
WORKDIR /app

FROM scratch AS java
COPY --from=dependencies /result/java/rootfs/ /
LABEL org.opencontainers.image.source="https://github.com/rambow-cloud/amazon-linux-distroless" \
      org.opencontainers.image.description="Experimental AL2023 Corretto 21 runtime; component licenses retained individually"
USER 65532:65532
ENV JAVA_HOME=/opt/java PATH=/usr/bin TZ=UTC LANG=C.UTF-8
WORKDIR /app
ENTRYPOINT ["/usr/bin/java"]
CMD ["-version"]

FROM java AS demo
COPY --from=demo-build /hello.jar /app/hello.jar
ENTRYPOINT ["/usr/bin/java", "-jar", "/app/hello.jar"]
CMD []

FROM scratch AS evidence
COPY --from=dependencies /result/base/inventory.json /base-inventory.json
COPY --from=dependencies /result/java/inventory.json /java-inventory.json
