# 常用工作流命令

## 安装与启动

```bash
pnpm --dir web install              # 装依赖
pnpm --dir web start                # 联调前后端
pnpm --dir web dev                  # 仅前端
pnpm --dir web server               # 仅后端
pnpm --dir web electron:dev         # Electron 开发
pnpm --dir web build                # Web 构建
pnpm --dir web electron:build       # Electron 打包
pnpm --dir web rebuild:native       # 原生模块重编译
```

## 校验命令（按速度排）

| 命令 | 包含 | 速度 | 用途 |
|---|---|---|---|
| `pnpm --dir web lint` | ESLint 前端 + 后端 | 快 | 编辑时反馈 |
| `pnpm --dir web arch` | 分层依赖自检 | 极快 | 防越界 |
| `pnpm --dir web typecheck:changed` | 仅改动文件 tsc | 中 | 提交前 |
| `pnpm --dir web typecheck` | 全量 tsc（含豁免清单） | 慢 | CI |
| `pnpm --dir web build` | Vite 构建 | 慢 | 兜底 |
| `pnpm --dir web smoke` | 起 server + 调几个关键接口 | 慢 | API 契约改动 |
| `pnpm --dir web test:deploy` | 模拟脏服务器发布并校验运行数据不变 | 快 | 部署流水线改动 |
| `pnpm --dir web test:canvas` | 画布模板视觉签名 + 内容覆盖 + 质量门禁 | 快 | 改画布 DSL、模板或生成链路 |
| `pnpm --dir web verify` | **lint + arch + typecheck:changed + test:canvas + build** | 慢 | **默认验收命令** |

## 三层反馈回路

```
编辑时 → Claude PostToolUse hook → lint --file <改动文件>
提交时 → .husky/pre-commit         → arch + typecheck:changed + 改动文件 lint
推送/构建 → pnpm verify             → 全量
```

## 重启后端（改了 builtinPrompts、cronEngine 等启动期逻辑时）

```bash
lsof -ti :3000 | xargs kill -9 && (cd web && node server.js &)
```

## 端口

- 后端：`3000`
- 前端 dev server：`5173`（Vite proxy `/api` → `:3000`）
