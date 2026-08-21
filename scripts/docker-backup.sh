#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/docker-common.sh"

require_docker
ensure_optional_env

timestamp="$(date +%Y%m%d-%H%M%S)"
destination="${1:-$BACKUP_ROOT/$timestamp}"
mkdir -p "$destination"
destination="$(cd "$destination" && pwd)"
chmod 700 "$destination"

was_running="false"
if compose ps --status running --services | grep -qx autowriting; then
  was_running="true"
  echo "暂停 autowriting，确保 SQLite/WAL 和文件快照一致..."
  compose stop --timeout 30 autowriting
fi

restart_if_needed() {
  if [[ "$was_running" == "true" ]]; then
    compose start autowriting >/dev/null
  fi
}
trap restart_if_needed EXIT

archive_volume "$(volume_name autowriting_data)" "$destination" data.tar.gz
archive_volume "$(volume_name autowriting_drafts)" "$destination" drafts.tar.gz
archive_volume "$(volume_name autowriting_logs)" "$destination" logs.tar.gz

if [[ ! -f "$destination/data.tar.gz" || ! -f "$destination/drafts.tar.gz" ]]; then
  echo "核心数据卷不存在，备份未完成。" >&2
  exit 1
fi

if [[ -f "$PROJECT_ROOT/web/.env" ]]; then
  install -m 600 "$PROJECT_ROOT/web/.env" "$destination/web.env"
fi

cat >"$destination/manifest.txt" <<EOF
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
project=$COMPOSE_PROJECT_NAME
data_volume=$(volume_name autowriting_data)
drafts_volume=$(volume_name autowriting_drafts)
logs_volume=$(volume_name autowriting_logs)
git_revision=$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || printf unknown)
EOF
chmod 600 "$destination/manifest.txt"
write_checksums "$destination"
chmod 600 "$destination/SHA256SUMS" "$destination"/*.tar.gz

trap - EXIT
restart_if_needed

echo "备份完成: $destination"
echo "备份包含运行数据，可能含 API Key 或用户内容，请按敏感文件保管。"
