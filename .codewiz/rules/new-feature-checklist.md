---
alwaysApply: true
---

# 新增功能注意事项（autowriting 项目）

## 涉及内置提示词时

1. 在 `web/server/seedPrompts.js` 的 `builtinPrompts` 数组末尾添加新条目
2. **必须重启后端服务器**，`seedBuiltinPrompts()` 在启动时才执行 —— 不重启则新提示词不会写入数据库
3. 重启命令：`lsof -ti :3000 | xargs kill -9 && node server.js &`
4. 在 `web/src/pages/PromptsPage.tsx` 的 `PROMPT_USAGE_TIPS` 对象里补充对应的说明文字

## 涉及新 API 路由时

- 路由文件：`web/server/routes/articles.js`（文章相关）
- SSE 流式路由固定模式：设置 4 个响应头（Content-Type / Cache-Control / Connection / X-Accel-Buffering）→ `res.flushHeaders()` → 逐行解析上游 data → `on('end')` 时调 `recordTokenUsage()` + `send('done')` + `res.end()`
- 所有文章路由都有 `authMiddleware`，Token 来自 `req.user.id`

## 涉及前端组件时

- AI 操作统一读取 `loadAIConfig()` 拿本地配置，Token 从 `localStorage.getItem('auth_token')` 拿
- SSE 读取固定模式：`fetch` → `resp.body.getReader()` → `TextDecoder` → 按行解析 `event:` / `data:` → dispatch
- `ContentStats` 等右侧面板组件如果需要回写文章内容，必须加 `onArticleChange?: (content: string) => void` prop，由 `ArticleEditor` 传入

## 涉及 RAG / 向量索引时

- 切换 embedding 模型后必须重建索引（维度变化会导致 load 报错）
- `index_meta.json` 记录 embedKey + 维度，`retrieveRelevant` 会检测不匹配并返回空
- 本地 embedding 兜底：无 API Key 时自动用 `LocalEmbeddings`（multilingual-e5-small，384 维）

## 通用注意事项

- 服务端端口固定 3000，前端 dev server 5173，通过 Vite proxy 转发 `/api`
- 数据库用 SQLite（better-sqlite3），操作函数在 `web/server/db.js`
- Token 用量每个 AI 操作都要调 `recordTokenUsage()`，operation 字段区分类型（generate / analyze / edit / deai / outline / refine）
