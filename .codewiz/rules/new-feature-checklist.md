---
alwaysApply: true
---

# 新增功能注意事项（autowriting 项目）

> 详细规范见 [`AGENTS.md`](AGENTS.md) → [`docs/agents/`](docs/agents)。本文件只列**高频陷阱**，AI 写代码前先扫一眼。

## 提交前自检（必跑）

```bash
pnpm --dir web verify     # = lint + arch-check + typecheck:changed + build
pnpm --dir web smoke      # 改 API 契约 / 鉴权 / 关键路由后追加
```

任何一条失败 = 不能提交。错误信息里都带 `❌ 问题 | ✅ FIX | 📖 see docs` 三段式，按指引修。

## 强约束清单（违反 = ESLint / arch-check 阻断）

| 区域 | 禁止 | 必须 |
|---|---|---|
| `server/**` | `console.log/info/warn/error` | `logger.info('MODULE', '描述', { ... })` |
| `server/routes/**` | `import fs` / `new Database()` 直连 | 路径走 [`config.js`](web/server/config.js)，SQLite 走 [`db.js`](web/server/db.js) |
| `server/routes/**` | 单个路由 `app.get('/x', authMiddleware, ...)` | 路由顶部统一 `router.use(authMiddleware)` |
| `src/**` | `fetch(...)`、`@ts-ignore`、`any` | 走 [`apiHelpers`](web/src/utils/apiHelpers.ts)、用 `unknown` + 类型守卫 |
| `src/components/**` | `import x from '*/store/*'` | 状态由父组件以 props 传入 |
| `src/pages/**` `src/components/**` | `localStorage.getItem('ai...')` 直读 AI 配置 | 走 [`loadAIConfig()`](web/src/utils/aiConfig.ts) |

存量违规已记录在 [`web/scripts/arch-baseline.json`](web/scripts/arch-baseline.json) 和 ESLint 后端豁免清单，**不要**继续在这些文件里写新代码扩大违规面，新文件 0 容忍。

## 涉及内置提示词时

1. 在 [`web/server/seedPrompts.js`](web/server/seedPrompts.js) 的 `builtinPrompts` 数组末尾添加新条目
2. **必须重启后端**，`seedBuiltinPrompts()` 只在启动时跑：`lsof -ti :3000 | xargs kill -9 && node server.js &`
3. 在 [`web/src/pages/PromptsPage.tsx`](web/src/pages/PromptsPage.tsx) 的 `PROMPT_USAGE_TIPS` 里补说明文字

## 涉及 SSE 流式接口时

后端固定模板（顺序不能变）：

```js
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
res.setHeader('X-Accel-Buffering', 'no')
res.flushHeaders()
// ... 解析上游 SSE，按行 send('data', chunk)
upstream.on('end', () => {
  recordTokenUsage({ userId: req.user.id, operation: 'generate', ... })
  send('done')
  res.end()
})
```

前端固定模板：`fetch` → `resp.body.getReader()` → `TextDecoder` → 按行解析 `event:` / `data:`。

`recordTokenUsage()` 的 `operation` 必填：`generate` / `analyze` / `edit` / `deai` / `outline` / `refine`。

## 涉及 RAG / 向量索引时

- 切换 embedding 模型后必须重建索引（维度变化会导致 load 失败）
- [`index_meta.json`](web/server/rag/index_meta.json) 记录 embedKey + 维度，`retrieveRelevant` 会检测不匹配并返回空
- 兜底：无 API Key 时自动用 `LocalEmbeddings`（multilingual-e5-small，384 维）

## 涉及前端右侧面板组件时

- `ContentStats` 等右侧面板需要回写文章内容时，必须加 `onArticleChange?: (content: string) => void` prop，由 `ArticleEditor` 注入
- 组件内**不能**直接 import zustand store；状态从父组件 props 传入

## 文件路径与端口

- 后端固定端口 3000，前端 dev 5173，Vite proxy `/api` → `:3000`
- 业务数据/输出目录路径**只能**通过 [`config.js`](web/server/config.js) 导出的常量获取，禁止在路由里写绝对路径
- SQLite 实例**只能**通过 [`db.js`](web/server/db.js) 暴露的 helper 函数操作，禁止 `new Database()` 重新打开
