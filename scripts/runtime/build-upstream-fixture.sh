#!/bin/sh
set -eu

variant=$1
line=$2
mkdir -p /fixture-root/fixture
case "$variant" in
  nodejs)
    cp -a /node-fixture /src
    NODE_HOME=/upstream/unpacked PATH="/upstream/unpacked/bin:$PATH" \
      /upstream/unpacked/bin/node /src/build_fixture.mjs
    mkdir -p /fixture-root/app
    cp -a /src/node_modules /src/probe.mjs /src/commonjs.cjs /fixture-root/app/
    ;;
  python)
    cp -a /upstream-root/opt/cpython /opt/
    "/opt/cpython/bin/python${line}" -m ensurepip
    cp -a /python-fixture /src
    "/opt/cpython/bin/python${line}" /src/build_fixture.py
    mkdir -p /fixture-root/opt/python
    cp -a /fixture/site /fixture-root/opt/python/site-packages
    cp /src/probe.py /fixture-root/fixture/
    ;;
  *) exit 1 ;;
esac
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /fixture-root/fixture/server.key -out /fixture-root/fixture/server.pem \
  -days 30 -subj /CN=tls-fixture -addext subjectAltName=DNS:tls-fixture,DNS:localhost,IP:127.0.0.1
chmod 644 /fixture-root/fixture/server.*
