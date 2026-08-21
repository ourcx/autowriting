#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/docker-common.sh"

usage() {
  echo "用法: $0 [--yes] [--force] [--no-start]" >&2
}

confirmed="false"
force="false"
start_after_import="true"
for argument in "$@"; do
  case "$argument" in
    --yes) confirmed="true" ;;
    --force) force="true" ;;
    --no-start) start_after_import="false" ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [[ "$confirmed" != "true" ]]; then
  echo "导入会写入 Docker 数据卷；必须显式传入 --yes。" >&2
  exit 1
fi

require_docker
require_command sqlite3
require_command curl
ensure_optional_env

source_data="$PROJECT_ROOT/web/data"
source_drafts="$PROJECT_ROOT/公众号写作/drafts"
if [[ ! -f "$source_data/app.db" ]]; then
  echo "未找到本地 SQLite: $source_data/app.db" >&2
  exit 1
fi

data_volume="$(volume_name autowriting_data)"
drafts_volume="$(volume_name autowriting_drafts)"
logs_volume="$(volume_name autowriting_logs)"
docker volume create "$data_volume" >/dev/null
docker volume create "$drafts_volume" >/dev/null
docker volume create "$logs_volume" >/dev/null

volume_has_content() {
  local volume="$1"
  docker run --rm -v "$volume:/source:ro" alpine:3.20 sh -c 'test -n "$(find /source -mindepth 1 -maxdepth 1 -print -quit)"'
}

for volume in "$data_volume" "$drafts_volume"; do
  if volume_has_content "$volume" && [[ "$force" != "true" ]]; then
    echo "目标卷非空，拒绝覆盖: $volume。确认已有备份后才可使用 --force。" >&2
    exit 1
  fi
done

was_running="false"
if compose ps --status running --services | grep -qx autowriting; then
  was_running="true"
  compose stop --timeout 30 autowriting >/dev/null
fi

restart_on_failure() {
  if [[ "$was_running" == "true" ]]; then
    compose start autowriting >/dev/null 2>&1 || true
  fi
}
trap restart_on_failure ERR

if curl --fail --silent --max-time 2 http://127.0.0.1:3000/health >/dev/null 2>&1; then
  echo "检测到宿主 3000 端口仍有服务，先停止 PM2/本地后端再迁移，避免 SQLite 快照不一致。" >&2
  exit 1
fi

safety_dir="$BACKUP_ROOT/pre-import-$(date +%Y%m%d-%H%M%S)"
if [[ "$force" == "true" ]]; then
  mkdir -p "$safety_dir"
  chmod 700 "$safety_dir"
  archive_volume "$data_volume" "$safety_dir" data.tar.gz
  archive_volume "$drafts_volume" "$safety_dir" drafts.tar.gz
  archive_volume "$logs_volume" "$safety_dir" logs.tar.gz
  if compgen -G "$safety_dir/*.tar.gz" >/dev/null; then
    write_checksums "$safety_dir"
    chmod 600 "$safety_dir/SHA256SUMS" "$safety_dir"/*.tar.gz
    echo "覆盖前 Docker 卷快照: $safety_dir"
  else
    rmdir "$safety_dir"
  fi
fi

staging="$(mktemp -d)"
cleanup() {
  rm -rf "$staging"
}
trap cleanup EXIT
mkdir -p "$staging/data" "$staging/drafts"

echo "创建 SQLite 一致性快照..."
sqlite3 "$source_data/app.db" ".backup '$staging/data/app.db'"
find "$source_data" -mindepth 1 -maxdepth 1 \
  ! -name app.db \
  ! -name app.db-wal \
  ! -name app.db-shm \
  -exec cp -a {} "$staging/data/" \;
if [[ -d "$source_drafts" ]]; then
  cp -a "$source_drafts"/. "$staging/drafts/"
fi

replace_from_directory() {
  local volume="$1"
  local source="$2"
  docker run --rm \
    -v "$volume:/target" \
    -v "$source:/source:ro" \
    alpine:3.20 \
    sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && cp -a /source/. /target/ && chown -R 1000:1000 /target'
}

replace_from_directory "$data_volume" "$staging/data"
replace_from_directory "$drafts_volume" "$staging/drafts"

if [[ "$start_after_import" == "true" ]]; then
  compose up -d --build autowriting
  host_port="${AUTOWRITING_PORT:-3000}"
  if ! wait_for_url "http://127.0.0.1:${host_port}/health" "导入后健康检查" 90; then
    compose logs --tail=200 autowriting
    exit 1
  fi
fi

trap - ERR
echo "本地数据已导入 Docker 卷。原始 web/data 和草稿目录未删除、未修改。"
