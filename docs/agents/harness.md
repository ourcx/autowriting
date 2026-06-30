# Harness 反馈回路（本仓库版）

> 项目里"规范"是怎么被工具强制执行的，反馈延迟从"提交后"压到"编辑后"。

## 三层递进

```
编辑时拦截        提交时拦截              CI/构建时兜底
    │                │                       │
    ▼                ▼                       ▼
Claude PostToolUse   .husky/pre-commit       pnpm verify
 - lint --file       - changed-file lint     - 全量 lint
                     - arch                  - typecheck（含豁免）
                     - typecheck:changed     - arch
                                             - build
                                             - smoke（可选）
```

## 约束清单

| 层 | 工具 | 命令 | 强制方式 |
|---|---|---|---|
| 信息 | [`AGENTS.md`](AGENTS.md) + [`docs/agents/`](docs/agents) | 阅读 | Agent 自取 |
| 编码风格 | ESLint（前端） | `pnpm lint` | hook + CI |
| 编码风格 | ESLint（后端，禁 console） | `pnpm lint:server` | hook + CI |
| 类型 | tsc strict | `pnpm typecheck:changed` | hook |
| 类型 | tsc 全量（含豁免） | `pnpm typecheck` | CI |
| 结构 | [`scripts/arch-check.mjs`](web/scripts/arch-check.mjs) | `pnpm arch` | hook + CI |
| 行为 | smoke（鉴权 + SSE 头） | `pnpm smoke` | 按需 |
| 视觉/产物 | Vite | `pnpm build` | CI 兜底 |

## 错误信息约定（三段式）

工具产生的违规消息必须带 FIX 指引。例如 [`arch-check.mjs`](web/scripts/arch-check.mjs) 的输出：

```
❌ web/server/routes/foo.js:42 直接 import 了 fs/promises
✅ FIX：文件路径请走 web/server/config.js 的 getXxxDir() 暴露的入口
📖 See: docs/agents/structure.md#强约束
```

## 增量约束、存量豁免

老问题不阻断开发，新代码必须达标：

| 工具 | 豁免清单 | 文件 |
|---|---|---|
| tsc | 已存在 12 个 TS6133 的旧文件 | [`web/tsconfig.baseline.json`](web/tsconfig.baseline.json) |
| ESLint（后端 no-console） | 启动期 console.log（migration 日志） | 文件内 `/* eslint-disable no-console */` 块 |
| arch-check | 已知违规文件 | [`web/scripts/arch-baseline.json`](web/scripts/arch-baseline.json) |

**新增代码默认进入严格区**。任何缩减豁免的 PR 优先合入。

## 文档新鲜度

- 改了 `routes/*.js` 的 API 契约 → 必须同步 [`web/docs/PROMPTS_*.md`](web/docs)（如涉及）或 [`docs/agents/structure.md`](docs/agents/structure.md)
- 改了启动命令或 verify 流程 → 必须同步 [`docs/agents/workflows.md`](docs/agents/workflows.md) 和 [`AGENTS.md`](AGENTS.md)
