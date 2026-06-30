# 项目结构与目录边界

> 想知道某个文件应该放在哪里、为什么不能放在别处，看这里。

## 顶层

| 路径 | 用途 | 是否允许新增业务代码 |
|---|---|---|
| [`web/`](web) | 主应用（前端 + Express 后端 + Electron 壳） | ✅ 默认所有改动都在这里 |
| [`scripts/`](scripts) | 遗留 shell 工作流 | ❌ 不再新增主流程 |
| [`公众号写作/drafts/`](公众号写作/drafts) | 文章草稿/cron 产物 | ❌ 视为运行数据，禁手改 |
| [`logs/`](logs) | 运行日志 | ❌ 产物 |
| [`.codewiz/`](.codewiz)、[`.codewiz-spec/`](.codewiz-spec) | AI 编码规则、知识库 | ✅ 规则演进 |
| [`docs/agents/`](docs/agents) | Agent 渐进式文档（本目录） | ✅ |

## web/ 内部分层（这是约束最强的部分）

```
web/
├── src/
│   ├── pages/        路由级页面，挂在 App.tsx 路由表里
│   ├── components/   可复用 UI；组件 + 同目录 .css
│   ├── store/        全局状态（Zustand）
│   ├── utils/        纯函数工具，不依赖 React
│   └── styles/       全局样式
├── server/
│   ├── routes/       Express 路由
│   ├── db.js         所有 SQLite 操作（唯一入口）
│   ├── logger.js     结构化日志（唯一日志入口）
│   ├── config.js     配置/路径/密钥读取（唯一入口）
│   ├── rag.js        RAG/向量检索
│   ├── cronEngine.js 定时任务调度
│   └── utils.js      LLM/图片/文件业务工具
├── electron/         桌面壳 + IPC + 打包
└── docs/             长期维护文档（功能说明，非 Agent 规则）
```

## 强约束（违反 = 阻断）

1. **组件不引 store**：`src/components/**` 禁止 import `src/store/**`，状态由 props 传入
2. **页面不直连 fetch**：`src/pages/**`、`src/components/**` 禁止裸 `fetch(`，必须走 [`web/src/utils/apiHelpers.ts`](web/src/utils/apiHelpers.ts)
3. **页面不直读 AI Key**：禁止直接读 `localStorage` 拿 AI 配置，必须走 [`loadAIConfig`](web/src/utils/aiConfig.ts)
4. **路由不直读 fs**：`server/routes/**` 禁止 import `fs` 写绝对路径，文件路径统一走 [`config.js`](web/server/config.js)
5. **路由不绕鉴权**：`server/routes/**` 顶部必须有 `router.use(authMiddleware)`，管理员入口必须 `requireAdmin`
6. **路由不直读 sqlite**：禁止 `new Database(`，必须走 [`db.js`](web/server/db.js) 暴露的函数
7. **后端禁 console.\***：必须用 [`logger`](web/server/logger.js) 的 `debug/info/warn/error`
8. **utils.js 体量门禁**：路由文件中超 30 行的工具函数必须抽到 [`utils.js`](web/server/utils.js)

强约束由 [`web/scripts/arch-check.mjs`](web/scripts/arch-check.mjs) 和 ESLint 共同强制。

## 命名约定

| 类型 | 模式 | 示例 |
|---|---|---|
| React 组件 | `PascalCase.tsx` + 同名 `.css` | `ArticleEditor.tsx` + `ArticleEditor.css` |
| 页面 | `PascalCase.tsx` | `DashboardPage.tsx` |
| Zustand store | `useXxx.ts` | `useAuth.ts` |
| 后端路由 | `camelCase.js` | `articles.js` |
| 工具函数 | `camelCase.ts` / `.js` | `apiHelpers.ts` |

## 产物 / 数据目录（禁手改）

- `web/dist/`、`web/dist-electron/`、`.cache/`
- `公众号写作/drafts/`、`logs/`
- `.git/`、`node_modules/`
