# AGENTS.md（项目级 Agent 索引）

> 本文件是 AI 编码助手的入口文档。**只放索引，不放细则**——细则按主题拆分在 [`docs/agents/`](docs/agents) 下，按需读取以节省 context window。
> 注意：[`web/server/config.js`](web/server/config.js) 在文章生成流程里会读取本文件，所以**禁止把路径、命令、review 规则写进文章正文**。

## 我要做什么 → 去哪里看

| 目标                                       | 文档                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| 了解项目分层、目录边界、命名约定           | [`docs/agents/structure.md`](docs/agents/structure.md)                               |
| 写代码前查规范（前端 / 后端 / SSE / 提交） | [`docs/agents/conventions.md`](docs/agents/conventions.md)                           |
| 知道用哪个命令验收、跑测试                 | [`docs/agents/workflows.md`](docs/agents/workflows.md)                               |
| 提 MR / review 时按什么顺序看              | [`docs/agents/review.md`](docs/agents/review.md)                                     |
| 添加日志的方法                             | [`docs\添加日志的方法.md`](docs\添加日志的方法.md)                                   |
| 理解 Harness 反馈回路 & 豁免策略           | [`docs/agents/harness.md`](docs/agents/harness.md)                                   |
| 新增功能时的高频陷阱清单                   | [`.codewiz/rules/new-feature-checklist.md`](.codewiz/rules/new-feature-checklist.md) |
| 视觉设计规范                               | [`.codewiz/rules/DESIGN.md`](.codewiz/rules/DESIGN.md)                               |

## 默认验收命令

```bash
pnpm --dir web verify
```

包含：ESLint（前端 + 后端）→ arch-check → typecheck:changed → build。改 API 契约/鉴权/路径时额外跑 `pnpm --dir web smoke`。

## 强约束（违反 = 阻断，**不要尝试绕过**）

1. 后端禁 `console.*`，必须用 [`web/server/logger.js`](web/server/logger.js)
2. 前端禁裸 `fetch(`，必须走 [`apiHelpers`](web/src/utils/apiHelpers.ts)
3. 路由必须 `router.use(authMiddleware)`，管理员路由必须 `requireAdmin`
4. 路由禁直接 `import fs`，路径统一走 [`config.js`](web/server/config.js)
5. 路由禁直接 `new Database(`，必须走 [`db.js`](web/server/db.js)
6. 不写 `any` / `@ts-ignore` / `@ts-expect-error`
7. 组件不引 Zustand store

完整清单与豁免策略见 [`docs/agents/structure.md#强约束`](docs/agents/structure.md) 与 [`docs/agents/harness.md`](docs/agents/harness.md)。

## 禁手改区

- `web/dist/`、`web/dist-electron/`、`.cache/`
- `公众号写作/drafts/`、`logs/`
- 任何密钥 / Token / Cookie 不准写进代码、文档、截图、测试数据
