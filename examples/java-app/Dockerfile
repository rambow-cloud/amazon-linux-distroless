FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7 AS build
RUN dnf --releasever=2023.12.20261102 -y --setopt=install_weak_deps=False install java-21-amazon-corretto-devel \
    && dnf clean all
COPY Main.java /src/Main.java
RUN mkdir /classes && javac --release 21 -d /classes /src/Main.java \
    && jar --create --file /app.jar --main-class Main -C /classes .

# Replace this moving preview alias with the published digest in production.
FROM ghcr.io/rambow-cloud/amazon-linux-distroless/java21:21-preview
COPY --from=build /app.jar /app/app.jar
CMD ["-jar", "/app/app.jar"]
