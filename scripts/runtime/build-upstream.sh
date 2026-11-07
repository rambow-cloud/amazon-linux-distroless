#!/bin/sh
set -eu

variant=$1
version=$2
line=$3
mkdir -p /upstream/unpacked /upstream-root
tar -xJf /upstream/archive -C /upstream/unpacked --strip-components=1

case "$variant" in
  nodejs)
    mkdir -p /upstream-root/usr/bin "/upstream-root/usr/share/licenses/nodejs${line}-upstream"
    install -m 0755 /upstream/unpacked/bin/node "/upstream-root/usr/bin/node-${line}"
    install -m 0644 /upstream/unpacked/LICENSE "/upstream-root/usr/share/licenses/nodejs${line}-upstream/LICENSE"
    ;;
  python)
    cd /upstream/unpacked
    ./configure --prefix=/opt/cpython --with-ensurepip=no --with-system-expat
    make -j"$(nproc)"
    make DESTDIR=/upstream-root install
    mkdir -p "/upstream-root/usr/share/licenses/python${line}-upstream"
    install -m 0644 LICENSE "/upstream-root/usr/share/licenses/python${line}-upstream/LICENSE"
    ;;
  *) exit 1 ;;
esac
