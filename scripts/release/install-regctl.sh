#!/usr/bin/env bash
set -euo pipefail

bin="$RUNNER_TEMP/regctl-bin"
mkdir -p "$bin"
gh release download v0.11.7 --repo regclient/regclient --pattern regctl-linux-amd64 --output "$bin/regctl"
printf '%s  %s\n' '3737fbbdd791e04e7a831640b681f3397a376498e80e2ad9b1b2d27296f239bc' "$bin/regctl" | sha256sum --check --status
chmod +x "$bin/regctl"
printf '%s\n' "$bin" >> "$GITHUB_PATH"
