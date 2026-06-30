# 编码规范

> 写代码前必读。本项目把"规范"转成了"工具校验"，违反规范会被 lint / typecheck / arch-check 拦截。

## 通用

- 缩进 2 空格，LF 换行
- 前端 TS 文件：**双引号**（与 JSX 一致）；后端 ESM JS：**单引号、无分号**
- 包管理器只认 `pnpm`，锁文件只认 [`web/pnpm-lock.yaml`](web/pnpm-lock.yaml)
- 不写 `any`、不写 `@ts-ignore`、不写 `@ts-expect-error`（如需逃生，必须注释具体原因，且只能在测试或临时调试代码中）

## 前端

- React 18 + TypeScript strict；组件 props 必须定义 `XxxProps` interface
- **不在 components 内引 Zustand**：UI 组件保持纯展示，状态由父级 page 传入
- **不裸 fetch**：必须走 [`apiHelpers`](web/src/utils/apiHelpers.ts) 包装
- **不直读 localStorage 配置**：AI Key 走 [`loadAIConfig`](web/src/utils/aiConfig.ts)
- 路由变更必须同步 [`web/src/App.tsx`](web/src/App.tsx)

## 后端
 
- **禁 console.\***：catch 块统一 `logger.error('MODULE', '描述', { error: error.message })`；可预期非致命用 `logger.warn`；调试输出用 `logger.debug`
- 唯一入口原则：文件路径 → `config.js`、SQLite → `db.js`、日志 → `logger.js`
- API 响应格式：成功直接返对象/数组；成功无数据 `{ success: true }`；失败 `{ error: '可读消息' }` + 对应 HTTP 状态码
- 鉴权：`router.use(authMiddleware)` 挂在文件顶部，**不要在单个路由上挂**；管理员路由用 `requireAdmin`

## SSE 流式接口（强模板）

必须按这个顺序，**任何一步不能省**：

```js
// 1. 4 个响应头
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
res.setHeader('X-Accel-Buffering', 'no')
// 2. flush
res.flushHeaders()
// 3. 解析上游 → write
// 4. on('end') 时
recordTokenUsage({ userId: req.user.id, operation: 'generate', ... })
res.write(`event: done\ndata: {}\n\n`)
res.end()
```

`operation` 枚举：`generate` / `analyze` / `edit` / `deai` / `outline` / `refine`。

## Git 提交

格式：`type: description`（`feat` / `fix` / `docs` / `refactor` / `chore` / `test` / `perf` / `style`）。

由 [`.husky/commit-msg`](.husky/commit-msg) 自动校验。

## 完成标准（自检清单）

- [ ] `pnpm --dir web verify` 通过（lint + typecheck:changed + arch + build）
- [ ] 改了 API 契约/鉴权/路径/Electron → 跑过 `pnpm --dir web smoke`
- [ ] 新增长期功能 → 在 [`web/docs/`](web/docs) 留下文档
