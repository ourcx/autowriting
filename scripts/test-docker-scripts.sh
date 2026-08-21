#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

scripts=(
  "$SCRIPT_DIR/docker-common.sh"
  "$SCRIPT_DIR/docker-start.sh"
  "$SCRIPT_DIR/docker-backup.sh"
  "$SCRIPT_DIR/docker-restore.sh"
  "$SCRIPT_DIR/docker-smoke.sh"
  "$SCRIPT_DIR/docker-import-local-data.sh"
)

for script in "${scripts[@]}"; do
  bash -n "$script"
  if [[ ! -x "$script" ]]; then
    echo "脚本不可执行: $script" >&2
    exit 1
  fi
done

if grep -R --line-number -E 'docker compose down -v|docker volume rm|docker system prune' \
  "$SCRIPT_DIR"/docker-*.sh; then
  echo "检测到高风险 Docker 删除命令。" >&2
  exit 1
fi

if ! grep -q '^name: autowriting$' "$PROJECT_ROOT/docker-compose.yml"; then
  echo "docker-compose.yml 未固定 project name。" >&2
  exit 1
fi

if ! grep -q '127.0.0.1:3000/health' "$PROJECT_ROOT/docker-compose.yml"; then
  echo "docker-compose.yml 缺少容器内健康检查。" >&2
  exit 1
fi

postinstall_line="$(grep -n 'COPY web/scripts/postinstall.cjs' "$PROJECT_ROOT/Dockerfile" | cut -d: -f1)"
install_line="$(grep -n 'RUN pnpm install' "$PROJECT_ROOT/Dockerfile" | cut -d: -f1)"
if [[ -z "$postinstall_line" || -z "$install_line" || "$postinstall_line" -ge "$install_line" ]]; then
  echo "Dockerfile 必须在 pnpm install 前复制 postinstall.cjs。" >&2
  exit 1
fi

if ! grep -q 'sqlite3 .*"\.backup' "$SCRIPT_DIR/docker-import-local-data.sh"; then
  echo "本地数据迁移未使用 SQLite 一致性快照。" >&2
  exit 1
fi

if ! grep -q 'pre-restore-' "$SCRIPT_DIR/docker-restore.sh"; then
  echo "恢复脚本缺少恢复前安全快照。" >&2
  exit 1
fi

echo "Docker 脚本静态检查通过。"
