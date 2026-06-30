# AGENTS.md

- 本文件是当前仓库的开发代理规则。`web/server/config.js` 也会在文章生成流程里读取它，所以生成文章时禁止把这里的路径、命令、review 规则写进正文。

## 项目结构

- 根目录只放仓库级文件、环境变量示例、遗留脚本、草稿目录和缓存；默认不要把业务代码加在根目录。
- `web/` 是主应用；前端、后端、Electron 改动默认都在这里完成。
- `web/src/pages/` 放路由页；新增页面时同步修改 `web/src/App.tsx`。
- `web/src/components/` 放复用组件；组件样式和组件放在同目录，沿用现有 `*.css` 配对方式。
- `web/src/store/` 放全局状态，`web/src/utils/` 放纯工具函数；不要在页面里重复造轮子。
- `web/server/routes/` 放 Express 路由；共享能力优先复用 `web/server/*.js` 里的配置、DB、RAG、日志和调度模块。
- `web/electron/` 只处理桌面壳、进程通信和打包相关逻辑；涉及本地路径或打包时同步检查 `web/electron-builder.config.cjs`。
- `web/docs/` 放长期维护文档；新增长期功能时，优先把说明补在这里。
- `scripts/` 是遗留 shell 工作流；除非任务明确要求，否则不要继续往这里加主流程。
- `web/dist/`、`web/dist-electron/`、`.cache/` 默认视为产物或运行数据，禁止手改。

## 运行命令

- 安装依赖：`pnpm --dir web install`
- 联调前后端：`pnpm --dir web start`
- 仅前端开发：`pnpm --dir web dev`
- 仅后端开发：`pnpm --dir web server`
- Electron 开发：`pnpm --dir web electron:dev`
- Web 构建：`pnpm --dir web build`
- Electron 打包：`pnpm --dir web electron:build`
- 原生模块重编译：`pnpm --dir web rebuild:native`
- 执行 lint 检查：`pnpm --dir web lint` `pnpm --dir web lint:fix`

## 测试命令

- 默认验收命令：`pnpm --dir web build`
- 触及 TypeScript 文件时额外运行：`pnpm --dir web exec tsc --noEmit`
- 当前仓库存在存量 `TS6133` 未使用导入报错；没有修这些旧问题时，不要声称 typecheck 全绿，至少要保证改动文件没有新增 TS 报错。
- 当前没有可信的 `test` script、Vitest、Jest 或 Playwright 配置；改接口、鉴权、路由或持久化时要补手工 smoke check。

## 代码风格

- 包管理器以 `pnpm` 为准；锁文件只认 `web/pnpm-lock.yaml`，不要新增 `package-lock.json` 或 `yarn.lock`。
- 前端是 React 18 + TypeScript strict；不要用 `any`、`@ts-ignore` 或跳过空值处理来糊过去，除非用户明确要求。
- 后端是 ESM JavaScript；保持现有无分号、单引号、按模块分区注释的风格，不做全文件格式化。
- 页面放 `pages/`，可复用 UI 放 `components/`，共享状态放 `store/`，共享逻辑放 `utils/`；不要把大块业务逻辑塞回组件 JSX。
- 配置、数据目录和密钥读取统一走 `web/server/config.js` 或设置表；不要在路由里临时直读新的环境变量或散落文件。
- 任何 API 路径、baseURL 或本地文件路径改动，都要同时考虑 Vite 代理、`web/src/main.tsx` 的 `file://` 兼容和 Electron 生产模式。
- 文章、草稿、定时任务相关改动默认要保留多用户隔离；非管理员场景不要绕过 `req.user.id`、`authMiddleware` 或 `requireAdmin`。

## 禁止事项

- 不要手改 `web/dist*`、`.cache/`、`公众号写作/drafts/`、日志文件，除非任务明确要求处理这些产物或数据。
- 不要把根目录 `package.json` 当成主应用配置；真实运行脚本和依赖以 `web/package.json` 为准。
- 不要照抄 `README.md` 或 `web/README.md` 里过时的 `npm` 命令；以 `web/package.json` 和 CI workflow 为准。
- 不要把 API Key、账号、Cookie 或 token 写进代码、文档、截图示例或测试数据。
- 不要为了省事关闭鉴权、弱化管理员边界或移除多用户目录隔离。
- 不要顺手修与当前任务无关的脏文件，也不要做大范围重命名或重排版。

## 完成标准

- 改动落在正确层级，没有把页面逻辑、服务端逻辑和打包逻辑混在一起。
- `pnpm --dir web build` 通过。
- 如果改了 TypeScript 文件，运行过 `pnpm --dir web exec tsc --noEmit`；若仍被存量问题挡住，明确说明残留报错不是本次引入。
- 如果改了 API 契约、鉴权、文件路径、设置项或 Electron 相关逻辑，做过对应的端到端或最小 smoke 验证。
- 如果新增了长期维护功能、配置入口或操作流程，更新最近的文档入口，而不是只改代码不留说明。

## Review 标准

- 先报会导致错误、越权、数据错乱、构建失败的发现，再谈样式问题。
- 优先检查鉴权、多用户隔离、路径拼接和文件落盘；尤其是 `web/server/routes/*`、`web/server/db.js`、`web/server/config.js`。
- 触及写作生成链路时，额外检查 `AGENTS.md` 注入、副作用 prompt、RAG 上下文和 cron 自动生成是否一起被影响。
- 触及 Electron、原生依赖或打包时，额外检查 `electron:dev`、`electron:build`、`scripts/postinstall.cjs` 和系统 Node 假设。
- 文档与代码冲突时，以 `web/package.json`、`web/server/config.js`、`.github/workflows/electron-build.yml` 为准，并在 review 里指出文档过期点。
- 样式问题可以参考 `.codewiz/rules/DESIGN.md`

## Docs 索引

- `README.md`：项目背景和高层入口，命令部分偏旧。
- `web/README.md`：Web 版说明，仍有 `npm` 命令和旧配置描述；只当背景文档，不当唯一事实来源。
- `web/docs/PROMPTS_QUICKSTART.md`：提示词页面快速上手。
- `web/docs/PROMPTS_GUIDE.md`：提示词管理功能说明。
- `web/docs/PROMPTS_ARCHITECTURE.md`：提示词系统架构。
- `.env.example`、`web/.env.example`：环境变量示例。
- `.github/workflows/electron-build.yml`：当前有效的构建和发布流程。
