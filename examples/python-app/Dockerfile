ARG PYTHON_RUNTIME=ghcr.io/rambow-cloud/amazon-linux-distroless/python@sha256:3be1cc8a55fb98b48aa0678ab71c0339e4c92e5378d0d7b473d15fbc7374f137
FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:381352c430f36d8aa6b8b670de06e7e4e5642fe0cb9dbd463bb8d1e79aefc0c7 AS builder
RUN dnf --releasever=2023.12.20261102 -y --setopt=install_weak_deps=False install gcc python3.14-devel python3.14-pip && dnf clean all
COPY examples/python314/ /src/
RUN /usr/bin/python3.14 /src/build_fixture.py
FROM ${PYTHON_RUNTIME}
COPY --from=builder --chown=65532:65532 /fixture/site/ /opt/python/site-packages/
COPY --chown=65532:65532 examples/python-app/app.py /app/app.py
COPY examples/python-app/LICENSE /app/LICENSE.project
CMD ["/app/app.py"]
