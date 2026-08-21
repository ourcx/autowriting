#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/docker-common.sh"

usage() {
  echo "用法: $0 <backup-directory> --yes [--no-start]" >&2
}

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

source_dir="$1"
shift
confirmed="false"
start_after_restore="true"
for argument in "$@"; do
  case "$argument" in
    --yes) confirmed="true" ;;
    --no-start) start_after_restore="false" ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [[ "$confirmed" != "true" ]]; then
  echo "恢复会覆盖当前 Docker 卷；必须显式传入 --yes。" >&2
  exit 1
fi
if [[ ! -d "$source_dir" ]]; then
  echo "备份目录不存在: $source_dir" >&2
  exit 1
fi
source_dir="$(cd "$source_dir" && pwd)"

require_docker
ensure_optional_env
verify_checksums "$source_dir"

compose stop --timeout 30 autowriting >/dev/null 2>&1 || true

safety_dir="$BACKUP_ROOT/pre-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$safety_dir"
chmod 700 "$safety_dir"
archive_volume "$(volume_name autowriting_data)" "$safety_dir" data.tar.gz
archive_volume "$(volume_name autowriting_drafts)" "$safety_dir" drafts.tar.gz
archive_volume "$(volume_name autowriting_logs)" "$safety_dir" logs.tar.gz
if [[ -f "$PROJECT_ROOT/web/.env" ]]; then
  install -m 600 "$PROJECT_ROOT/web/.env" "$safety_dir/web.env"
fi
if compgen -G "$safety_dir/*.tar.gz" >/dev/null; then
  write_checksums "$safety_dir"
  chmod 600 "$safety_dir/SHA256SUMS" "$safety_dir"/*.tar.gz
fi
if compgen -G "$safety_dir/*" >/dev/null; then
  echo "恢复前安全快照: $safety_dir"
else
  rmdir "$safety_dir"
fi

restore_volume "$(volume_name autowriting_data)" "$source_dir" data.tar.gz
restore_volume "$(volume_name autowriting_drafts)" "$source_dir" drafts.tar.gz
if [[ -f "$source_dir/logs.tar.gz" ]]; then
  restore_volume "$(volume_name autowriting_logs)" "$source_dir" logs.tar.gz
fi

if [[ -f "$source_dir/web.env" ]]; then
  install -m 600 "$source_dir/web.env" "$PROJECT_ROOT/web/.env"
fi

if [[ "$start_after_restore" == "true" ]]; then
  ensure_optional_env
  compose up -d --build autowriting
  host_port="${AUTOWRITING_PORT:-3000}"
  if ! wait_for_url "http://127.0.0.1:${host_port}/health" "恢复后健康检查" 90; then
    compose logs --tail=200 autowriting
    exit 1
  fi
fi

echo "恢复完成: $source_dir"
