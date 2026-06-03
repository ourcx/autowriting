# 技术方案：优化开发规范

**功能名**：dev-standards  
**日期**：2026-06-03  
**状态**：已确认

---

## 1. 背景与目标

### 背景

项目已积累了一定体量的代码（React + TypeScript 前端 + Node.js/Express 后端 + Electron），但开发规范处于碎片化状态：

- [`AGENTS.md`](../../../AGENTS.md) 是文章写作风格规范，与代码开发无关
- [`.codewiz/rules/new-feature-checklist.md`](../../../.codewiz/rules/new-feature-checklist.md) 记录了片段式的注意事项（SSE 模式、RAG 注意点），不成体系
- [`.codewiz-spec/knowledge/api-design.md`](../../knowledge/api-design.md) 和 [`code-standards.md`](../../knowledge/code-standards.md) 是空占位文件，内容全部「待补充」
- 无 ESLint/Prettier 配置，无 commit message 规范，无测试策略

直接后果：不同文件里错误处理方式不一致（`console.error` vs `logger.error`），API 响应格式不统一（直接返回数组 vs `{ success: true }`），新功能开发时没有参照基准。

### 目标

1. 补全知识库（`api-design.md` + `code-standards.md`），形成可被 AI Agent 和开发者直接消费的规范
2. 新增 `dev-standards-summary.md` 作为速查表，两者兼顾（规则列表 + 背景注释）
3. 本次只动文档，不修改现有代码

---

## 2. 现状分析

### 2.1 已有规范（有效内容）

| 文件 | 有效内容 | 缺口 |
|---|---|---|
| [`new-feature-checklist.md`](../../../.codewiz/rules/new-feature-checklist.md) | SSE 固定模式、RAG 注意点、端口约定、Token 记录要求 | 只有「新功能」视角，缺通用开发规范 |

### 2.2 现有代码的规律（逆向提炼）

从现有代码中可以确认以下已形成事实规范：

**文件命名**
- React 组件：PascalCase.tsx（`ArticleEditor.tsx`、`CoverGenerator.tsx`）
- 样式文件：与组件同名.css（`ArticleEditor.css`）
- 后端路由：camelCase.js（`articles.js`、`settings.js`）
- 工具函数：camelCase.ts / .js（`apiHelpers.ts`、`utils.js`）

**代码格式**
- 缩进：2 空格（前后端统一）
- 分号：不加
- 字符串：TSX 文件用双引号，非 JSX 文件用单引号

**目录职责**
- `web/src/components/`：可复用 UI 组件
- `web/src/pages/`：路由级页面
- `web/src/store/`：Zustand store（`useXxx.ts` 命名）
- `web/src/utils/`：纯函数工具，不含 UI 逻辑
- `web/server/routes/`：Express 路由，每个域一个文件
- `web/server/*.js`：服务层（`db.js` / `utils.js` / `config.js` / `logger.js`）

### 2.3 现有代码的不一致（待规范约束）

| 问题 | 位置 | 规范结论 |
|---|---|---|
| `console.error` 和 `logger.error` 混用 | 各路由文件 catch 块 | 统一用 `logger.error` |
| 工具函数写在路由文件内（如 `getArticlePath`、`scanArticlesInDir`，共 ~80 行） | `articles.js` | 超过 30 行的工具函数抽到 `utils.js` |
| 资源不存在时返回空字符串而非 404 | `articles.js` GET 路由 | 设计选择，文档标注说明 |

---

## 3. 技术方案

### 3.1 整体方案结构

```
规范文档层
├── .codewiz-spec/specs/dev-standards/design.md   ← 本文件（背景 + 方案）
├── .codewiz-spec/knowledge/
│   ├── code-standards.md                         ← 命名、格式、目录规范（补全）
│   └── api-design.md                             ← 接口、错误码、鉴权规范（补全）
└── .codewiz/rules/
    ├── new-feature-checklist.md                  ← 已有，补充通用错误处理规则
    └── dev-standards-summary.md                  ← 新增，AI Agent + 开发者速查
```

### 3.2 代码规范（code-standards.md 内容）

#### 命名规范

| 类型 | 规则 | 示例 |
|---|---|---|
| React 组件文件 | PascalCase.tsx | `ArticleEditor.tsx` |
| 样式文件 | 与组件同名.css | `ArticleEditor.css` |
| 页面/路由文件 | PascalCase.tsx | `DashboardPage.tsx` |
| Zustand store | `useXxx.ts` | `useAuth.ts` |
| 后端路由文件 | camelCase.js | `articles.js` |
| 工具函数文件 | camelCase.ts / .js | `apiHelpers.ts` |
| 变量 / 函数 | camelCase | `getUserDraftsDir()` |
| 常量 | SCREAMING_SNAKE_CASE | `DRAFTS_DIR`, `JWT_SECRET` |
| TS 类型 / interface | PascalCase | `AIConfig`, `ArticleEditorProps` |
| 数据库操作函数 | camelCase 动词前缀 | `getLatestAnalysis()`, `recordTokenUsage()` |
| 组件 props interface | `XxxProps` | `CoverGeneratorProps` |

#### 代码格式

- 缩进：2 空格，前后端统一
- 分号：不加
- 字符串：TSX/JSX 文件用双引号；非 JSX 的 .ts / .js 文件用单引号
- 换行符：LF（Unix）
- 最大行长：120 字符
- 推荐 `.editorconfig` 配置：

```
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
[*.{tsx,jsx}]
quote_type = double
[*.{ts,js,mjs,cjs}]
quote_type = single
```

#### TypeScript 要求

- `tsconfig.json` 保持 `strict: true`（已有）
- 新代码禁止使用 `any`，必须用 `unknown` + 类型守卫，或显式类型断言并加注释说明原因
- 函数参数和返回值必须有类型声明
- React 组件 props 必须定义显式 interface（`XxxProps`），不用 `React.FC<>`

#### 目录结构规范

前端职责划分：
- `components/`：通用可复用组件。每个组件必须是独立的 `.tsx` + `.css` 文件对
- `pages/`：路由级页面，每个页面对应一个路由
- `store/`：全局状态。用 Zustand，文件名 `useXxx.ts`
- `utils/`：纯函数工具，不得引入 React 依赖
- `styles/`：仅放真正全局的样式（字体、reset、CSS 变量）

后端职责划分：
- `routes/`：路由层，只做参数校验 + 调用服务层 + 返回结果。超过 30 行的工具函数必须抽到 `utils.js`
- `db.js`：所有 SQLite 操作函数
- `utils.js`：与业务相关的工具函数（LLM 请求、图片生成、文件操作）
- `config.js`：环境变量读取和 AI 配置
- `logger.js`：日志系统（已有，用它）

### 3.3 API 设计规范（api-design.md 内容）

#### 接口路径规范

- 遵循 RESTful 风格
- 资源名用复数小写：`/api/articles`、`/api/templates`
- 嵌套资源：`/api/articles/:articleId/generate`
- 操作类 endpoint（非 CRUD）用动词后缀：`/generate`、`/analyze`、`/stream`

#### 响应格式

**成功（返回数据）**：直接返回数据对象或数组，不包装额外字段
```
GET /api/articles → [{ id, title, status, ... }]
GET /api/articles/:id → { task, materials, article, title }
```

**成功（无数据返回）**：
```
{ "success": true }
```

**失败**：
```
{ "error": "可读的错误信息，直接面向用户" }
```

#### HTTP 状态码使用规则

| 状态码 | 场景 |
|---|---|
| `200` | 成功 |
| `400` | 参数错误 / 业务规则校验失败（如「任务和素材不能为空」） |
| `401` | 未登录（Token 缺失或无效） |
| `403` | 无权限（如非管理员访问 admin 接口） |
| `500` | 服务器内部错误 |

**设计说明**：当前代码中，文章不存在时返回空字符串而非 404，这是有意为之的设计——文章草稿可能处于「已创建目录但文件未生成」的中间态，空字符串表示「内容为空」而非「资源不存在」。

#### 错误处理规范

后端 catch 块统一写法：

```js
} catch (error) {
  logger.error('MODULE_NAME', '操作失败描述', { error: error.message })
  res.status(500).json({ error: error.message })
}
```

- 禁止在路由层用 `console.error`，必须用 `logger.error`
- 已预期的非致命错误（如资源可能不存在）用 `logger.warn`
- `console.log` 只允许临时调试，合并前必须删除

#### 鉴权方式

- JWT Bearer Token，通过 `Authorization: Bearer <token>` 头传递
- 所有非公开路由统一在 router 级别挂 `authMiddleware`（不在单个路由上挂）：`router.use(authMiddleware)`
- 管理员路由用 `requireAdmin`
- Token 从前端 `localStorage.getItem('auth_token')` 获取，AI 操作从 `loadAIConfig()` 读本地配置

#### SSE 流式接口固定模式

```js
// 固定 4 个响应头
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
res.setHeader('X-Accel-Buffering', 'no')
res.flushHeaders()

// 逐行解析上游 data
// on('end') 时：recordTokenUsage() → send('done') → res.end()
```

#### Token 用量记录规范

每个 AI 操作结束时必须调 `recordTokenUsage()`，`operation` 字段：

| 操作 | operation 值 |
|---|---|
| 文章生成 | `generate` |
| 内容分析 | `analyze` |
| 内容编辑 | `edit` |
| 去 AI 化 | `deai` |
| 大纲生成 | `outline` |
| 内容打磨 | `refine` |

### 3.4 Git 规范

#### commit message 格式

```
type: description
```

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更（含规范文件、注释） |
| `refactor` | 重构，不改功能和接口 |

示例：
- `feat: 新增 RAG 向量检索页面`
- `fix: 修复文章保存时中文路径问题`
- `docs: 补充 API 设计规范`
- `refactor: 将 articles.js 中的工具函数抽离到 utils.js`

#### 分支命名（建议）

`feat/功能描述`、`fix/bug描述`，描述用中文或英文均可，kebab-case

### 3.5 测试规范（轻量策略）

#### 覆盖范围（按优先级）

1. **`web/server/utils.js`**：`buildLLMRequest`、`callLLMWithRetry`、`maskApiKey`
2. **`web/server/db.js`**：核心 CRUD 函数、`recordTokenUsage`
3. **`web/src/utils/apiHelpers.ts`**：`extractErrorMessage`、`isLocalApiKeyConfigured`

不要求覆盖：
- UI 组件（除非含复杂业务逻辑）
- 路由层（通过手工 / E2E 测试保证）
- SSE 流式接口

不强制覆盖率指标。

#### 测试文件命名和位置

与源文件同目录，命名 `*.test.ts` 或 `*.test.js`：
- `web/server/utils.test.js` 紧邻 `utils.js`
- `web/src/utils/apiHelpers.test.ts` 紧邻 `apiHelpers.ts`

#### 推荐测试框架

- 后端：Vitest（与 ESM 兼容，无需额外配置）
- 前端：Vitest + `@testing-library/react`

（本次不安装，仅作文档推荐）

### 3.6 前端组件规范

- 需要回写文章内容的组件，必须有 `onArticleChange?: (content: string) => void` prop，由 `ArticleEditor` 传入
- AI 操作统一用 `loadAIConfig()` 读本地配置
- SSE 读取固定模式：`fetch` → `resp.body.getReader()` → `TextDecoder` → 按行解析 `event:` / `data:` → dispatch

---

## 4. 实施策略

### 4.1 文件改动清单

| 文件 | 操作 | 内容 |
|---|---|---|
| `.codewiz-spec/specs/dev-standards/design.md` | 新增（本文件） | 背景、现状分析、完整方案 |
| `.codewiz-spec/knowledge/code-standards.md` | 补全 | 命名、格式、目录规范 |
| `.codewiz-spec/knowledge/api-design.md` | 补全 | 接口、错误处理、鉴权、SSE 规范 |
| `.codewiz/rules/dev-standards-summary.md` | 新增 | AI Agent + 开发者速查表 |
| `.codewiz/rules/new-feature-checklist.md` | 补充 | 引用新规范，补充通用错误处理说明 |

现有代码：**不改动**。

### 4.2 执行顺序

1. 写入 `design.md`（本文件）——完成
2. 补全 `code-standards.md`
3. 补全 `api-design.md`
4. 新增 `dev-standards-summary.md`
5. 更新 `new-feature-checklist.md`

### 4.3 后续可选项（本次不做）

- 添加 `.editorconfig` 到项目根目录
- 安装 Vitest 并补充 `package.json` 的 `test` 脚本
- 在 `package.json` 中添加 lint 脚本（ESLint）
- 修复现有代码中 `console.error` → `logger.error` 的替换

---

## 5. 影响范围

- 不影响任何现有功能
- 不改动任何代码文件
- 新增的规范文档会被 codewiz AI Agent 在 design / coding 阶段自动加载（通过 `stages` frontmatter 控制）
