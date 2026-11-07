ARG AL2023_BASE=public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7
FROM $AL2023_BASE AS tools
ARG AL2023_RELEASE
RUN dnf --releasever="$AL2023_RELEASE" -y --setopt=install_weak_deps=False \
      install binutils dnf-plugins-core gcc openssl python3.14-devel python3.14-pip \
    && dnf clean all
COPY scripts/prototype/ /tools/
COPY scripts/runtime/ /runtime-tools/
