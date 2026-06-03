---
alwaysApply: true
---

# 开发规范速查（autowriting 项目）

> 规则列表 + 背景注释。AI Agent 和开发者均适用。
> 完整规范见 `.codewiz-spec/knowledge/code-standards.md` 和 `api-design.md`。

## 文件命名

- React 组件：PascalCase.tsx + 同名.css（`ArticleEditor.tsx` + `ArticleEditor.css`）
- 页面：PascalCase.tsx（`DashboardPage.tsx`）
- Zustand store：useXxx.ts（`useAuth.ts`）
- 后端路由：camelCase.js（`articles.js`）
- 工具函数：camelCase.ts / .js（`apiHelpers.ts`）
- 测试文件：与源文件同目录，`*.test.ts` / `*.test.js`

## 代码格式

- 缩进 2 空格，无分号，LF 换行
- TSX/JSX 用双引号，其他 .ts/.js 用单引号
- 新代码禁止 `any`，用 `unknown` + 类型守卫或注释说明
- 组件 props 必须定义 `XxxProps` interface

## 目录职责

- `src/components/`：可复用组件，组件内不引入 Zustand
- `src/pages/`：路由级页面
- `src/store/`：全局状态（Zustand）
- `src/utils/`：纯函数，不含 React 依赖
- `server/routes/`：只做参数校验 + 调服务层 + 返回结果
- `server/db.js`：所有 SQLite 操作
- `server/utils.js`：业务工具函数（LLM、图片、文件）

**规则**：路由文件中超过 30 行的工具函数必须抽到 `utils.js`

## 错误处理

- 后端 catch 块统一用 `logger.error`，禁止 `console.error`
- 格式：`logger.error('MODULE', '描述', { error: error.message })`
- 可预期的非致命错误用 `logger.warn`
- `console.log` 只允许临时调试，合并前必须删除

## API 响应

- 成功返数据：直接返对象/数组
- 成功无数据：`{ success: true }`
- 失败：`{ error: '用户可读的错误信息' }` + 对应 HTTP 状态码（400/401/403/500）
- 文章不存在时返空字符串，这是设计选择（草稿中间态）

## 鉴权

- 整个 router 统一挂：`router.use(authMiddleware)`，不在单个路由挂
- 管理员路由用 `requireAdmin`
- 前端 Token：`localStorage.getItem('auth_token')`
- AI 配置：`loadAIConfig()`

## SSE 流式接口

必须按顺序：4 个响应头 → `flushHeaders()` → 解析上游 → `on('end')` 时 `recordTokenUsage()` + `send('done')` + `res.end()`

4 个固定头：`Content-Type: text/event-stream` / `Cache-Control: no-cache` / `Connection: keep-alive` / `X-Accel-Buffering: no`

## Token 用量

每个 AI 操作结束时必须调 `recordTokenUsage()`，operation 值：`generate` / `analyze` / `edit` / `deai` / `outline` / `refine`

## Git 提交

格式：`type: description`（`feat` / `fix` / `docs` / `refactor`）

## 端口约定

- 后端：3000
- 前端 dev：5173（通过 Vite proxy 转发 `/api`）
- 数据库：SQLite，操作函数在 `web/server/db.js`
