#!/usr/bin/env bash
set -euo pipefail

arch=$1
case "$arch:$(uname -m)" in
  amd64:x86_64|arm64:aarch64) ;;
  *) echo 'A native runner is required' >&2; exit 1 ;;
esac
test "${GITHUB_ACTIONS:-}" = true
platform="linux/$arch"
digest=$(jq -er '.nodejs24.reference | split("@")[1] | select(test("^sha256:[a-f0-9]{64}$"))' releases/stable-candidates.json)
runtime="ghcr.io/rambow-cloud/nodejs@$digest"
helper=$(jq -er '.builder | select(test("^public\\.ecr\\.aws/amazonlinux/amazonlinux@sha256:[a-f0-9]{64}$"))' "locks/foundation/linux-$arch.json")
docker pull --platform "$platform" "$runtime"
docker pull --platform "$platform" "$helper"

fixture=$(mktemp -d)
app=
cleanup() {
  if [[ -n $app ]]; then docker rm -f "$app" >/dev/null; fi
  rm -f "$fixture/server.key" "$fixture/server.crt"
  rmdir "$fixture"
}
trap cleanup EXIT
openssl req -x509 -newkey rsa:2048 -noenc -days 1 -subj /CN=probe.test \
  -addext subjectAltName=DNS:probe.test -keyout "$fixture/server.key" -out "$fixture/server.crt" 2>/dev/null
# This key is generated for the disposable server and has no use outside the fixture.
chmod 0755 "$fixture"
chmod 0644 "$fixture/server.key" "$fixture/server.crt"

hardened=(--pull never --platform "$platform" --read-only --user 65532:65532
  --cap-drop ALL --security-opt no-new-privileges:true)
app=$(docker run -d "${hardened[@]}" --network none \
  --mount "type=bind,src=$fixture,dst=/tmp,readonly" \
  "$runtime" -e '
    const { readFileSync } = require("node:fs");
    require("node:https").createServer({
      key: readFileSync("/tmp/server.key"), cert: readFileSync("/tmp/server.crt")
    }, (_request, response) => response.end("isolated TLS probe"))
      .listen(8443, "127.0.0.1", () => console.log("TLS fixture ready"));
  ')
ready=false
for ((attempt=0; attempt<20; attempt++)); do
  if [[ $(docker logs "$app") == *'TLS fixture ready'* ]]; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true

state() {
  docker inspect --format '{{.Image}} {{.State.StartedAt}} {{.State.Running}}' "$app"
}
before=$(state)
test "${before##* }" = true
probe() {
  local host=$1
  shift
  docker run --rm "${hardened[@]}" --network "container:$app" \
    --mount "type=bind,src=$fixture/server.crt,dst=/probe.crt,readonly" \
    --entrypoint /usr/bin/curl "$helper" --disable --silent --show-error --fail \
    --max-time 5 --noproxy '*' --resolve "$host:8443:127.0.0.1" "$@" "https://$host:8443/"
}
expect_rejection() {
  local status=0 output
  output=$(probe "$@" 2>&1) || status=$?
  printf '%s\n' "$output"
  test "$status" -eq 60
}
expect_rejection probe.test
expect_rejection wrong.test --cacert /probe.crt
test "$(probe probe.test --cacert /probe.crt)" = 'isolated TLS probe'
test "$(state)" = "$before"
test -z "$(docker diff "$app")"

tool=$(docker run --rm "${hardened[@]}" --network none --entrypoint /usr/bin/rpm "$helper" \
  -qf /usr/bin/curl --qf '%{NAME} %{VERSION}-%{RELEASE} (%{LICENSE})\n')
helper_size=$(docker image inspect --format '{{.Size}}' "$helper")
runtime_size=$(docker image inspect --format '{{.Size}}' "$runtime")
{
  printf 'TLS verification passed on %s\n\n' "$platform"
  printf 'The default trust store rejected the fixture, and the fixture certificate was rejected for the wrong hostname. The pinned certificate and correct hostname succeeded from the separate helper. The workload kept its original image, start time and clean writable layer.\n\n'
  printf -- '- Workload: `%s` (%s image bytes)\n' "$runtime" "$runtime_size"
  printf -- '- Helper: `%s` (%s image bytes)\n' "$helper" "$helper_size"
  printf -- '- Helper RPM: %s\n' "$tool"
} | tee -a "$GITHUB_STEP_SUMMARY"
