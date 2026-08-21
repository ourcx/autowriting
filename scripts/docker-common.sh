#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
COMPOSE_PROJECT_NAME="autowriting"
BACKUP_ROOT="$PROJECT_ROOT/backups"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

require_docker() {
  require_command docker
  if ! docker compose version >/dev/null 2>&1; then
    echo "需要 Docker Compose v2: docker compose" >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker daemon 未运行，请先启动 Docker Desktop 或 Docker Engine。" >&2
    exit 1
  fi
}

compose() {
  docker compose --project-directory "$PROJECT_ROOT" -f "$COMPOSE_FILE" "$@"
}

volume_name() {
  printf '%s_%s\n' "$COMPOSE_PROJECT_NAME" "$1"
}

volume_exists() {
  docker volume inspect "$1" >/dev/null 2>&1
}

archive_volume() {
  local volume="$1"
  local destination="$2"
  local archive_name="$3"
  if ! volume_exists "$volume"; then
    echo "跳过不存在的卷: $volume"
    return
  fi
  docker run --rm \
    -v "$volume:/source:ro" \
    -v "$destination:/backup" \
    alpine:3.20 \
    tar -czf "/backup/$archive_name" -C /source .
}

restore_volume() {
  local volume="$1"
  local source_dir="$2"
  local archive_name="$3"
  if [[ ! -f "$source_dir/$archive_name" ]]; then
    echo "缺少恢复文件: $source_dir/$archive_name" >&2
    exit 1
  fi
  docker volume create "$volume" >/dev/null
  docker run --rm \
    -v "$volume:/target" \
    -v "$source_dir:/backup:ro" \
    alpine:3.20 \
    sh -c "find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/$archive_name -C /target && chown -R 1000:1000 /target"
}

write_checksums() {
  local directory="$1"
  (
    cd "$directory"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum ./*.tar.gz >SHA256SUMS
    else
      shasum -a 256 ./*.tar.gz >SHA256SUMS
    fi
  )
}

verify_checksums() {
  local directory="$1"
  if [[ ! -f "$directory/SHA256SUMS" ]]; then
    echo "备份没有 SHA256SUMS，拒绝恢复。" >&2
    exit 1
  fi
  (
    cd "$directory"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c SHA256SUMS
    else
      shasum -a 256 -c SHA256SUMS
    fi
  )
}

ensure_optional_env() {
  local env_file="$PROJECT_ROOT/web/.env"
  if [[ -f "$env_file" ]]; then
    return
  fi
  umask 077
  cat >"$env_file" <<'EOF'
# 可选：服务启动后也可以在浏览器「AI 配置」页面完成设置。
EOF
  echo "已创建可选配置文件: $env_file"
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local timeout_seconds="${3:-90}"
  local started_at
  started_at="$(date +%s)"
  while true; do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      echo "$label 已就绪: $url"
      return
    fi
    if (( "$(date +%s)" - started_at >= timeout_seconds )); then
      echo "$label 在 ${timeout_seconds}s 内未就绪: $url" >&2
      return 1
    fi
    sleep 2
  done
}
