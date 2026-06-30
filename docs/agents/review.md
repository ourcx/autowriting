# Review 优先级

## 一定先看（会炸的）

1. **鉴权与多用户隔离**
   - [`web/server/routes/*.js`](web/server/routes)：是否漏挂 `authMiddleware` / `requireAdmin`
   - 草稿、文章、cron 任务是否按 `req.user.id` 隔离目录
   - 路径拼接是否有 `..` 逃逸风险
2. **数据落盘**
   - [`web/server/db.js`](web/server/db.js)：新增列是否兼容老库（启动期 migration）
   - [`web/server/config.js`](web/server/config.js)：新增配置读取入口是否复用
3. **写作生成链路**
   - `AGENTS.md` 注入是否会污染生成正文
   - RAG 上下文是否切换 embedding 后未重建索引
   - cron 自动生成是否同时受影响
4. **Electron / 打包**
   - `electron:dev` / `electron:build` / [`scripts/postinstall.cjs`](web/scripts/postinstall.cjs)
   - `file://` 路径在生产模式下能否解析（[`web/src/main.tsx`](web/src/main.tsx) 兼容）

## 再看（影响交付质量的）

- SSE 4 个响应头 + `flushHeaders` + `recordTokenUsage` 是否齐全
- 后端 catch 是否用 `logger.error`（**注意**：现有 122 处 console.\* 是存量，不强求一次清完）
- ESLint / typecheck 是否在改动文件上"零新增报错"

## 最后看（样式）

- 视觉规范：[`.codewiz/rules/DESIGN.md`](.codewiz/rules/DESIGN.md)
- 命名是否符合 [`structure.md`](docs/agents/structure.md) 的命名约定

## 文档冲突处理

文档与代码冲突时，以以下文件为准，并在 review 中标记文档过期点：

- [`web/package.json`](web/package.json) 的 scripts
- [`web/server/config.js`](web/server/config.js) 的配置项
- [`.github/workflows/electron-build.yml`](.github/workflows/electron-build.yml) 的 CI 流程
