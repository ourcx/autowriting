#!/bin/bash
# ============================================================
# sync-to-guard.sh — 从源工程同步到 autowriting-guard
# 用法：bash /Users/zhuxinhao/autowriting/sync-to-guard.sh
# ============================================================
set -e

SRC="/Users/zhuxinhao/autowriting/web"
GUARD="/Users/zhuxinhao/autowriting-guard/web"
ZIP_OUT="/Users/zhuxinhao/autowriting-guard.zip"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[sync]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

info "=========================================="
info "  autowriting → autowriting-guard 同步"
info "=========================================="

# ── Step 1: rsync（排除 guard 专属文件 + 需手动 patch 的文件）────────────────
info "Step 1: rsync 同步..."
rsync -av \
  --exclude="node_modules/" \
  --exclude=".git/" \
  --exclude="dist/" \
  --exclude="dist-electron/" \
  --exclude="electron/" \
  --exclude="electron-builder.config.cjs" \
  --exclude="scripts/" \
  --exclude=".DS_Store" \
  --exclude="install.sh" \
  --exclude="start.sh" \
  --exclude="health.sh" \
  --exclude=".npmrc" \
  --exclude="public/" \
  --exclude="server.js" \
  --exclude="sync-to-guard.sh" \
  "$SRC/" "$GUARD/"
info "rsync 完成"

# ── Step 2: server.js patch ───────────────────────────────────────────────────
# 源工程 server.js 不含 dist/ 静态托管 + 0.0.0.0 + fileURLToPath
# 每次同步后基于源工程自动生成完整 guard 版本
info "Step 2: 生成 guard 版 server.js..."
python3 - << 'PYEOF'
import re

src_path   = "/Users/zhuxinhao/autowriting/web/server.js"
guard_path = "/Users/zhuxinhao/autowriting-guard/web/server.js"

with open(src_path) as f:
    code = f.read()

# 2a. 在第一行 import 前插入 fileURLToPath 等工具 import
extra_imports = (
    "import { fileURLToPath } from 'url'\n"
    "import path from 'path'\n"
    "import fs from 'fs'\n\n"
)
if "fileURLToPath" not in code:
    code = extra_imports + code

# 2b. 在 const app = express() 后插入 __dirname 定义
app_line = "const app = express()"
if "const __dirname" not in code:
    code = code.replace(
        app_line,
        app_line + "\n\n"
        "const __filename = fileURLToPath(import.meta.url)\n"
        "const __dirname  = path.dirname(__filename)"
    )

# 2c. 在 seedBuiltinPrompts() 后插入 dist/ 静态托管
seed_anchor = "seedBuiltinPrompts()"
static_block = """
// ── 前端静态文件（Vite build 产物）──────────────────────────────────────────
// Guard 规范：SPA 路由兜底，所有非 API 请求返回 index.html
const distDir = path.join(__dirname, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api') || _req.path === '/health') return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
} else {
  console.warn('[server] dist/ 不存在，前端静态文件未提供（仅 API 模式）')
}
"""
if "express.static" not in code:
    code = code.replace(seed_anchor, seed_anchor + "\n" + static_block)

# 2d. app.listen: 加 '0.0.0.0' 参数
code = re.sub(
    r"app\.listen\(PORT,\s*\(\)",
    "app.listen(PORT, '0.0.0.0', ()",
    code
)
# 修正 log 里的 localhost → 0.0.0.0
code = code.replace(
    "http://localhost:${PORT}",
    "http://0.0.0.0:${PORT}"
)

with open(guard_path, "w") as f:
    f.write(code)

print("[sync] server.js: guard 版本生成完成")
PYEOF

# ── Step 3: App.tsx patch（BrowserRouter → HashRouter）────────────────────────
info "Step 3: App.tsx patch..."
if grep -q "BrowserRouter" "$GUARD/src/App.tsx" 2>/dev/null; then
  sed -i '' \
    -e 's/import { BrowserRouter,/import { HashRouter,/g' \
    -e 's/<BrowserRouter>/<HashRouter>/g' \
    -e 's/<\/BrowserRouter>/<\/HashRouter>/g' \
    "$GUARD/src/App.tsx"
  info "App.tsx: BrowserRouter → HashRouter"
else
  info "App.tsx: 已是 HashRouter，跳过"
fi

# ── Step 4: server/config.js patch（PORT → APP_PORT）─────────────────────────
info "Step 4: server/config.js patch..."
if grep -q "process\.env\.PORT[^_]" "$GUARD/server/config.js" 2>/dev/null; then
  perl -i -0pe \
    's/export const PORT = process\.env\.PORT/\/* 用 APP_PORT 避免与 Pod\/PM2 注入的全局 PORT 冲突 *\/\nexport const PORT = process.env.APP_PORT/g' \
    "$GUARD/server/config.js"
  info "server/config.js: PORT → APP_PORT"
else
  info "server/config.js: 已是 APP_PORT，跳过"
fi

# ── Step 5: package.json patch ────────────────────────────────────────────────
info "Step 5: package.json guard 专属改写..."
python3 - << 'PYEOF'
import json

src_path   = "/Users/zhuxinhao/autowriting/web/package.json"
guard_path = "/Users/zhuxinhao/autowriting-guard/web/package.json"

with open(src_path) as f:
    pkg = json.load(f)

# Guard 专属：engines
pkg["engines"] = {"node": ">=18"}

# Guard 专属：scripts（只保留 web server 相关，去掉 Electron / postinstall）
guard_scripts = {
    "dev":     pkg["scripts"].get("dev",     "vite"),
    "build":   pkg["scripts"].get("build",   "vite build"),
    "preview": pkg["scripts"].get("preview", "vite preview"),
    "server":  "node server.js",
    "start":   "node server.js",
}
pkg["scripts"] = guard_scripts

# 删除 Electron 相关顶层字段
pkg.pop("main", None)

# runtime deps 必须在 dependencies（Pod npm ci --omit=dev 时才会安装）
runtime_deps = {
    "cors":     "^2.8.5",
    "dotenv":   "^16.3.1",
    "express":  "^4.18.2",
    "react-is": "^18.2.0",
}
dev  = pkg.get("devDependencies", {})
deps = pkg.get("dependencies", {})
for name, ver in runtime_deps.items():
    dev.pop(name, None)          # 从 devDep 移除
    deps.setdefault(name, ver)   # 加进 dep（已有则保留原版本号）

# @types/react-router-dom → devDependencies
if "@types/react-router-dom" in deps:
    dev["@types/react-router-dom"] = deps.pop("@types/react-router-dom")

# 移除 Electron / dev 工具（guard 不需要，Pod 也没有）
electron_pkgs = [
    "electron", "electron-builder", "@electron/rebuild",
    "nodemon", "concurrently", "wait-on",
]
for d in electron_pkgs:
    dev.pop(d, None)
    deps.pop(d, None)

pkg["dependencies"]    = deps
pkg["devDependencies"] = dev

# 删除 pnpm 专属配置（guard 用 npm）
pkg.pop("pnpm", None)

with open(guard_path, "w") as f:
    json.dump(pkg, f, indent=2, ensure_ascii=False)
    f.write("\n")

print("[sync] package.json: guard 专属改写完成")
PYEOF

# ── Step 6: npm install + build ───────────────────────────────────────────────
info "Step 6: npm install（重新生成 lockfile，保证与 guard package.json 对齐）..."
cd "$GUARD"
# 删除旧 lockfile，避免 npm ci 时因源工程多余包报 EUSAGE
rm -f package-lock.json
npm install --legacy-peer-deps 2>&1 | tail -3

info "Step 7: npm run build..."
npm run build 2>&1 | grep -E "(✓|✗|dist/|error|warning)" | tail -10

# ── Step 7: 烟测 ──────────────────────────────────────────────────────────────
info "Step 8: 烟测..."
pkill -f "APP_PORT=3099 node server.js" 2>/dev/null || true
sleep 1
APP_PORT=3099 node server.js > /tmp/guard-smoke.log 2>&1 &
SMOKE_PID=$!
sleep 4

HEALTH=$(curl -sf http://127.0.0.1:3099/health 2>/dev/null || echo "FAIL")
TITLE=$(curl -s http://127.0.0.1:3099/ 2>/dev/null | grep -o '<title>[^<]*</title>' || echo "FAIL")
kill $SMOKE_PID 2>/dev/null || true
pkill -f "APP_PORT=3099 node server.js" 2>/dev/null || true

if echo "$HEALTH" | grep -q '"status":"ok"'; then
  info "烟测 /health → $HEALTH"
  if echo "$TITLE" | grep -q "Error\|FAIL"; then
    warn "烟测 / → $TITLE  (检查 dist/ 是否存在)"
  else
    info "烟测 /  → $TITLE"
  fi
else
  error "烟测失败！/health 返回: $HEALTH\n详情: cat /tmp/guard-smoke.log"
fi

# ── Step 8: 打 zip ────────────────────────────────────────────────────────────
info "Step 9: 打 zip..."
python3 - << PYEOF
import zipfile, os, shutil

src = '/Users/zhuxinhao/autowriting-guard/web'
tmp = '/tmp/autowriting-guard-tmp.zip'
dst = '/Users/zhuxinhao/autowriting-guard.zip'

# 排除目录名（精确匹配）
exclude_dirs  = {'node_modules', '.git', '__pycache__', 'dist-electron', 'electron', 'scripts'}
# 排除文件名
exclude_files = {'electron-builder.config.cjs', 'sync-to-guard.sh', '.DS_Store'}

with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            if file in exclude_files:
                continue
            abs_path = os.path.join(root, file)
            arc_name = os.path.relpath(abs_path, src)
            zf.write(abs_path, arc_name)

shutil.move(tmp, dst)
size = os.path.getsize(dst) / 1024 / 1024
print(f"[sync] zip 完成: {dst}  ({size:.1f} MB)")
PYEOF

echo ""
info "=========================================="
info "  同步完成！zip: $ZIP_OUT"
info "=========================================="
