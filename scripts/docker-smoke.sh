#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/docker-common.sh"

require_docker
require_command curl
ensure_optional_env

if ! compose ps --status running --services | grep -qx autowriting; then
  echo "autowriting 容器未运行，请先执行 ./scripts/docker-start.sh" >&2
  exit 1
fi

host_port="${AUTOWRITING_PORT:-3000}"
base_url="http://127.0.0.1:${host_port}"

assert_status() {
  local expected="$1"
  local url="$2"
  local actual
  actual="$(curl --silent --output /dev/null --write-out '%{http_code}' "$url")"
  if [[ "$actual" != "$expected" ]]; then
    echo "状态码不符合预期: $url expected=$expected actual=$actual" >&2
    exit 1
  fi
}

assert_status 200 "$base_url/health"
assert_status 200 "$base_url/"
# Legacy article IDs deliberately redirect to canonical /articles/:id/:slug URLs.
legacy_url="$base_url/articles/docker-smoke?tab=analysis"
canonical_url="$base_url/articles/docker-smoke/docker-smoke?tab=analysis"
assert_status 301 "$legacy_url"
redirect_url="$(curl --silent --show-error --output /dev/null --write-out '%{redirect_url}' "$legacy_url")"
if [[ "$redirect_url" != "$canonical_url" ]]; then
  echo "旧文章地址重定向错误: expected=$canonical_url actual=$redirect_url" >&2
  exit 1
fi
assert_status 200 "$canonical_url"
assert_status 302 "$base_url/deepseek"
deepseek_redirect="$(curl --silent --show-error --output /dev/null --write-out '%{redirect_url}' "$base_url/deepseek")"
if [[ "$deepseek_redirect" != "$base_url/settings" ]]; then
  echo "旧 DeepSeek 页面应重定向到 AI 配置。" >&2
  exit 1
fi
assert_status 200 "$base_url/settings"
article_body="$(curl --fail --silent --show-error "$canonical_url")"
if [[ "$article_body" != *"<div id=\"root\""* ]]; then
  echo "规范文章地址未返回 React 页面。" >&2
  exit 1
fi
assert_status 404 "$base_url/api/docker-smoke-not-found"

index_body="$(curl --fail --silent --show-error "$base_url/")"
if [[ "$index_body" != *"<div id=\"root\""* ]]; then
  echo "首页没有检测到 React root，前端构建产物可能未被托管。" >&2
  exit 1
fi

for volume in \
  "$(volume_name autowriting_data)" \
  "$(volume_name autowriting_drafts)" \
  "$(volume_name autowriting_logs)"; do
  if ! volume_exists "$volume"; then
    echo "缺少命名卷: $volume" >&2
    exit 1
  fi
done

compose exec -T autowriting node - <<'NODE'
const fs = require('node:fs')
const paths = [
  '/app/data',
  '/app/drafts',
  '/app/logs',
  '/app/data/app.db',
  '/app/dist/index.html',
]
for (const path of paths) {
  if (!fs.existsSync(path)) throw new Error(`missing: ${path}`)
}
for (const directory of ['/app/data', '/app/drafts', '/app/logs']) {
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK)
}
NODE

compose exec -T autowriting node - <<'NODE'
const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
NODE

compose exec -T autowriting sh -lc '
  set -eu
  marker="/app/drafts/.docker-smoke-write"
  printf "ok\n" >"$marker"
  test "$(cat "$marker")" = "ok"
  rm -f "$marker"
'

echo "Docker smoke 通过：健康、首页、旧文章301、规范SPA、DeepSeek页面、API 404、卷、SQLite、草稿写入、Playwright。"
