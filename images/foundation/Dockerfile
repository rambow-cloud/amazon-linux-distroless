FROM scratch
ARG SOURCE_REVISION
ARG FOUNDATION_VARIANT
COPY rootfs/ /
LABEL org.opencontainers.image.source="https://github.com/rambow-cloud/amazon-linux-distroless" \
      org.opencontainers.image.revision=$SOURCE_REVISION \
      org.opencontainers.image.title=$FOUNDATION_VARIANT
ENV TZ=UTC LANG=C.UTF-8 SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
USER 65532:65532
WORKDIR /app
