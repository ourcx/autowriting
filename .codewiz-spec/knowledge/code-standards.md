---
name: 编码规范
stages:
  - design
  - coding
source: project
priority: high
---

# 编码规范

> 基于 autowriting 项目实际代码提炼，2026-06-03

## 命名规范

| 类型 | 规则 | 示例 |
|---|---|---|
| React 组件文件 | PascalCase.tsx | `ArticleEditor.tsx` |
| 样式文件 | 与组件同名.css | `ArticleEditor.css` |
| 页面 / 路由文件 | PascalCase.tsx | `DashboardPage.tsx` |
| Zustand store | `useXxx.ts` | `useAuth.ts` |
| 后端路由文件 | camelCase.js | `articles.js` |
| 工具函数文件 | camelCase.ts / .js | `apiHelpers.ts` |
| 变量 / 函数 | camelCase | `getUserDraftsDir()` |
| 常量 | SCREAMING_SNAKE_CASE | `DRAFTS_DIR`, `JWT_SECRET` |
| TS 类型 / interface | PascalCase | `AIConfig`, `ArticleEditorProps` |
| 组件 props interface | `XxxProps` | `CoverGeneratorProps` |
| 数据库操作函数 | camelCase 动词前缀 | `getLatestAnalysis()`, `recordTokenUsage()` |

## 代码风格

- **缩进**：2 空格，前后端统一
- **分号**：不加
- **字符串**：TSX/JSX 文件用双引号；非 JSX 的 `.ts` / `.js` / `.cjs` 文件用单引号
- **换行符**：LF（Unix）
- **最大行长**：120 字符
- **TypeScript**：`tsconfig.json` 保持 `strict: true`；新代码禁止 `any`（必须用 `unknown` + 类型守卫，或加注释说明）

## 目录结构

### 前端（`web/src/`）

```
src/
├── components/     # 可复用 UI 组件。每个组件独立 .tsx + .css 文件对
├── pages/          # 路由级页面，一个路由一个文件
├── store/          # 全局状态，Zustand，文件名 useXxx.ts
├── utils/          # 纯函数工具，不引入 React 依赖
└── styles/         # 仅放真正全局的样式（CSS 变量、reset）
```

### 后端（`web/server/`）

```
server/
├── routes/         # 路由层：参数校验 + 调服务层 + 返回结果
│                   # 超过 30 行的工具函数必须抽到 utils.js
├── db.js           # 所有 SQLite 操作函数
├── utils.js        # 业务工具函数（LLM 请求、图片生成、文件操作）
├── config.js       # 环境变量读取和 AI 配置
├── logger.js       # 日志系统（必须用它，不用 console）
└── authMiddleware.js  # JWT 认证
```

## 前端组件规范

- 组件 props 必须定义显式 interface，命名 `XxxProps`，不用 `React.FC<>`
- 需要回写文章内容的组件，必须有 `onArticleChange?: (content: string) => void` prop，由 `ArticleEditor` 传入
- AI 操作统一用 `loadAIConfig()` 读本地配置
- SSE 读取固定模式：`fetch` → `resp.body.getReader()` → `TextDecoder` → 按行解析 `event:` / `data:` → dispatch

## 测试规范

覆盖重点（按优先级）：
1. `web/server/utils.js`：`buildLLMRequest`、`callLLMWithRetry`、`maskApiKey`
2. `web/server/db.js`：核心 CRUD 函数、`recordTokenUsage`
3. `web/src/utils/apiHelpers.ts`：`extractErrorMessage`、`isLocalApiKeyConfigured`

测试文件：与源文件同目录，命名 `*.test.ts` / `*.test.js`

推荐框架：后端用 Vitest（ESM 兼容）；前端用 Vitest + `@testing-library/react`

不要求覆盖率指标，不要求覆盖 UI 组件和 SSE 流式接口。

## Git 提交规范

格式：`type: description`

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更 |
| `refactor` | 重构，不改功能 |

示例：`feat: 新增 RAG 向量检索页面`、`fix: 修复中文路径保存问题`
