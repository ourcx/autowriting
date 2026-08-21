#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/docker-common.sh"

require_docker
require_command curl
ensure_optional_env
mkdir -p "$PROJECT_ROOT/data"

echo "构建并启动 autowriting..."
compose up -d --build --remove-orphans

host_port="${AUTOWRITING_PORT:-3000}"
base_url="http://127.0.0.1:${host_port}"
if ! wait_for_url "$base_url/health" "后端健康检查" 120; then
  compose logs --tail=200 autowriting
  exit 1
fi
if ! wait_for_url "$base_url/" "Web 首页" 30; then
  compose logs --tail=200 autowriting
  exit 1
fi

compose ps
echo "访问地址: http://localhost:${host_port}"
echo "查看日志: docker compose -f \"$COMPOSE_FILE\" logs -f autowriting"
