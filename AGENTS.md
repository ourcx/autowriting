# AGENTS.md（项目级 Agent 索引）

> 本文件是 AI 编码助手的入口文档，包含**每次任务都要执行的默认维护协议 + 细则索引**。低频细则按主题拆分在 [`docs/agents/`](docs/agents) 下，按需读取以节省 context window。
> 注意：[`web/server/config.ts`](web/server/config.ts) 会读取本文件，但写作流程不得把本文件内容注入文章正文。

## AI 默认维护协议（每次任务必读）

本项目后续默认由 AI 维护。目标是：**快速迭代、自动闭环、保护数据、不破坏主要功能**。

### 1. 默认自主执行

- 先检查工作区状态、适用规范和相关历史，再修改；不得覆盖用户未提交的工作。
- 对可逆、低风险的本地操作直接执行，不反复请求确认。
- 持续工作到实现、验证和提交完成；只有缺少凭据、权限、必要业务决策或涉及不可逆外部操作时才询问。
- 优先修根因，保持改动小而聚焦；不借机重构无关模块或清理全部存量问题。

### 2. 数据安全优先

- `web/data/`、`公众号写作/drafts/`、`logs/` 都是运行数据；不得删除、覆盖、重置或纳入发布产物。
- 修改部署、迁移、数据库或路径逻辑前，必须先确认真实数据目录、Git 跟踪状态和备份/恢复路径。
- 部署脚本必须先备份 SQLite 与草稿，禁止用 `git reset --hard`、`git clean`、整目录覆盖等方式处理生产目录。
- 数据库变更必须兼容旧库并使用启动期迁移；不得假设线上是空库。

### 3. 安全与兼容边界

- 新增或修改 API 时，先处理鉴权、多用户隔离、参数校验、路径逃逸和密钥管理，再写业务逻辑。
- 远程能力复用现有业务入口；密钥只从环境变量读取，默认关闭，不写入代码、日志、文档示例真实值或前端。
- 保持现有 API、数据格式、主要页面流程和 PM2/Nginx 运行方式兼容；破坏性变更必须明确说明并提供迁移方案。
- 真实发布、部署、推送、删除线上数据等外部副作用，除非用户明确要求，否则只验证到副作用前一步。

### 4. 快速反馈与自动验收

- 先跑最小相关校验，再扩大范围；不要每次编辑后都跑全量构建。
- 改动文件先做定向 lint/typecheck；提交前跑 `pnpm --dir web verify`。
- 改 API 契约、鉴权、路径、数据库或关键路由时，额外跑 `pnpm --dir web smoke`，并补对应 smoke case。
- 改前端交互后，自动启动本地服务并做浏览器回归；可使用 `admin/admin123` 本地测试。测试产生的文章、账号和文件必须清理。
- 浏览器工具不可用时，改做等价 API/构建回归并明确记录阻断原因，不得声称 UI 已验证。
- 若全量校验被存量错误阻断，必须证明改动文件零新增错误，并分别报告“本次通过项”和“存量阻断项”。

### 5. 提交纪律

- 一个功能或一个独立修复对应一个 commit，格式遵守 Conventional Commits。
- 每个 commit 前完成该功能的最小必要验证；不要把未验证的多个功能堆在一个提交里。
- 禁止提交运行数据、构建产物、调试截图、临时文件、Cookie、Token 或真实密钥。
- 未经用户明确要求，不 push、不创建 MR、不合并；本地 commit 可以按任务要求及时创建。

### 6. 完成汇报

- 先给结果，再列关键文件、commit 和验证命令。
- 明确指出未完成项、外部阻断、存量错误和上线前配置；不得把降级验证描述成完整验证。
- 结束前确认工作区状态、临时服务已关闭、测试数据已清理。

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

1. 后端禁 `console.*`，必须用 [`web/server/logger.ts`](web/server/logger.ts)
2. 前端禁裸 `fetch(`，必须走 [`apiHelpers`](web/src/utils/apiHelpers.ts)
3. 路由必须 `router.use(authMiddleware)`，管理员路由必须 `requireAdmin`
4. 路由禁直接 `import fs`，路径统一走 [`config.ts`](web/server/config.ts)
5. 路由禁直接 `new Database(`，必须走 [`db.ts`](web/server/db.ts)
6. 不写 `any` / `@ts-ignore` / `@ts-expect-error`
7. 组件不引 Zustand store

完整清单与豁免策略见 [`docs/agents/structure.md#强约束`](docs/agents/structure.md) 与 [`docs/agents/harness.md`](docs/agents/harness.md)。

## 禁手改区

- `web/dist/`、`web/dist-electron/`、`.cache/`
- `公众号写作/drafts/`、`logs/`
- 任何密钥 / Token / Cookie 不准写进代码、文档、截图、测试数据
