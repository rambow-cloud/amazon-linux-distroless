ARG AL2023_BASE=public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7
FROM $AL2023_BASE AS tools
ARG AL2023_RELEASE
RUN dnf --releasever="$AL2023_RELEASE" -y --setopt=install_weak_deps=False \
      install binutils dnf-plugins-core gcc openssl nodejs24-devel nodejs24-npm nodejs24-full-i18n \
    && dnf clean all
COPY scripts/prototype/ /tools/
COPY scripts/runtime/ /runtime-tools/
COPY scripts/java21/check_image.py /runtime-tools/check_image.py
