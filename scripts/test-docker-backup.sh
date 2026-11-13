#!/usr/bin/env bash
# Contract tests for host-owned archives and restart-on-failure. No Docker daemon or real data.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/autowriting-backup-test.XXXXXX")"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/project/scripts" "$fixture/project/web" "$fixture/bin" "$fixture/volumes"
cp "$SCRIPT_DIR/docker-common.sh" "$SCRIPT_DIR/docker-backup.sh" "$fixture/project/scripts/"
export MOCK_VOLUME_ROOT="$fixture/volumes" MOCK_DOCKER_LOG="$fixture/docker.log"
for volume in autowriting_data autowriting_drafts autowriting_logs; do
  mkdir -p "$MOCK_VOLUME_ROOT/autowriting_$volume"
  printf 'fixture-content\n' > "$MOCK_VOLUME_ROOT/autowriting_$volume/fixture.txt"
done
printf 'fixture-db\n' > "$MOCK_VOLUME_ROOT/autowriting_autowriting_data/app.db"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  info) exit 0 ;;
  compose)
    case " $* " in
      *' version '*) exit 0 ;;
      *' ps --status running --services '*) echo autowriting; exit 0 ;;
      *' stop --timeout 30 autowriting '*) echo stop >> "$MOCK_DOCKER_LOG"; exit 0 ;;
      *' start autowriting '*) echo start >> "$MOCK_DOCKER_LOG"; exit 0 ;;
    esac ;;
  volume)
    test -d "$MOCK_VOLUME_ROOT/$3"; exit $? ;;
  run)
    if [[ "$*" == *'/backup'* ]]; then echo 'archive must be written by host, not bind mount' >&2; exit 1; fi
    if [[ "${MOCK_ARCHIVE_FAIL:-0}" == 1 ]]; then printf 'partial'; exit 7; fi
    source_volume=''
    for arg in "$@"; do
      if [[ "$arg" == *':/source:ro' ]]; then source_volume="${arg%:/source:ro}"; fi
    done
    test -n "$source_volume"
    tar -czf - -C "$MOCK_VOLUME_ROOT/$source_volume" .
    exit 0 ;;
esac
printf 'unexpected docker command: %s\n' "$*" >&2
exit 1
MOCK
chmod +x "$fixture/bin/docker"
export PATH="$fixture/bin:$PATH"
bash "$fixture/project/scripts/docker-backup.sh" "$fixture/success"
test "$(cat "$MOCK_DOCKER_LOG")" = "$(printf 'stop\nstart')"
test "$(tar -xOzf "$fixture/success/data.tar.gz" ./app.db)" = fixture-db
for archive in data drafts logs; do
  tar -tzf "$fixture/success/$archive.tar.gz" >/dev/null
  test -O "$fixture/success/$archive.tar.gz"
done
python3 - "$fixture/success" <<'PY'
import pathlib, stat, sys
root = pathlib.Path(sys.argv[1])
assert stat.S_IMODE(root.stat().st_mode) == 0o700
for name in ['data.tar.gz', 'drafts.tar.gz', 'logs.tar.gz', 'SHA256SUMS', 'manifest.txt', 'web.env']:
    assert stat.S_IMODE((root / name).stat().st_mode) == 0o600, name
PY
(cd "$fixture/success" && if command -v sha256sum >/dev/null; then sha256sum -c SHA256SUMS; else shasum -a 256 -c SHA256SUMS; fi)
: > "$MOCK_DOCKER_LOG"
if MOCK_ARCHIVE_FAIL=1 bash "$fixture/project/scripts/docker-backup.sh" "$fixture/failure"; then
  echo 'failed tar must fail the backup' >&2; exit 1
fi
test "$(cat "$MOCK_DOCKER_LOG")" = "$(printf 'stop\nstart')"
test -z "$(find "$fixture/failure" -type f -print)"
echo 'Backup contract tests passed: contents, caller ownership, private modes, checksums, failure cleanup and service restart.'
