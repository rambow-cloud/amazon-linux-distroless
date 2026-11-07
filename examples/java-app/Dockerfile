ARG JAVA_RUNTIME=ghcr.io/rambow-cloud/java@sha256:de7886e8d9b8dcda6112e6732b9d4b7dc3d3bffee4ccee5314c86ab9805f6ad0
FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7 AS build
RUN dnf --releasever=2023.12.20261102 -y --setopt=install_weak_deps=False install java-21-amazon-corretto-devel \
    && dnf clean all
COPY Main.java /src/Main.java
RUN mkdir /classes && javac --release 21 -d /classes /src/Main.java \
    && jar --create --file /app.jar --main-class Main -C /classes .

FROM ${JAVA_RUNTIME}
COPY --from=build /app.jar /app/app.jar
CMD ["-jar", "/app/app.jar"]
