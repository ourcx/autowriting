# DeepSeek 应用能力

## 当前范围

在「AI 配置 → 快速开始」可一次选择 DeepSeek 文章模型和素材搜索，也可分别设置。文章模型使用 `deepseek-flash`，供大纲、素材整理、候选稿、段落编辑和审核使用。DeepSeek 审核完完整正文后，服务端才把结果交给原有编辑流程。

在文章「素材」页，可直接搜索网页、读取原文、OCR 解析、转写语音，或发起带联网、读链接和附件的调研。调研引用和搜索来源会随选中的素材一起保存。「审核」页可朗读当前公众号正文。独立的 `/deepseek` 入口支持把搜索和文本结果追加到已有文章。

配置位于 `server/config.ts`，默认关闭：

```dotenv
DEEPSEEK_APP_ENABLED=false
DEEPSEEK_API_KEY=
```

启用前在服务端私有环境填入自己的 DeepSeek Key。禁止放入 `VITE_` 变量、前端存储或 Git。客户端仅请求 `https://api.deepseek.com`，禁用重定向，不接受浏览器传来的自定义服务地址。构造方式：

```ts
import { DEEPSEEK_APP_CONFIG } from '../config.ts'
import { createDeepSeekClient } from './deepseek.ts'
const deepseek = createDeepSeekClient(DEEPSEEK_APP_CONFIG)
```

## HTTP 接口与使用

均在 `/api/deepseek` 下，要求当前用户 JWT 登录；Agent API Key 不获得额外权限。

- `GET /status`：仅返回 enabled/configured，不返回密钥。
- `POST /chat`：JSON `{prompt, thinking?, webSearch?, readUrl?, confirmedCost:true}`；也可 multipart 加一个 `file` 及 `purpose`。不会接受外部 file_id 或任意聊天历史。
- `POST /search`：JSON `{query, count?, confirmedCost:true}`。
- `POST /fetch`：JSON `{url, confirmedCost:true}`。
- `POST /ocr`：multipart `file`、`purpose`、`confirmedCost=true`。
- `POST /asr`：multipart `file`、`confirmedCost=true`。
- `POST /tts`：JSON `{text, voice?, confirmedCost:true}`，返回 audio/wav。

默认关闭时 POST 返回 503，未登录返回 401，缺少费用确认/非法参数返回 400。接口严格拒绝额外字段。工作台和素材采集在调用前确认数据发送与费用。写作使用选定的文章服务，审核页朗读在提交正文前确认。DeepSeek 调用不自动重试。

上传内容会传给 DeepSeek；`/files` 文件保留遵循上游政策，本应用不提供上传后立即删除保证。不要上传未经授权的隐私资料。当前语音是上传 WAV/Ogg 和下载/播放 WAV，不请求麦克风权限、不隐式录音。

## 内部方法

- `chat`：固定 `deepseek-flash`，可选深度思考、联网搜索、链接阅读；支持文本和顶层 `file_id` 文件内容。始终开启 `safety_check: { level: 'high' }`。采用非流式返回，避免安全审核前暴露正文；拒答和不完整输出不会作为文章返回。不与 JSON mode、logprobs 混用。
- `search`：独立 Search，最多 128 Unicode 字符查询、1–50 个结果。
- `fetchUrl`：独立 Fetch，复用项目公共 HTTP(S) 地址检查，拒绝凭据和私网地址。
- `uploadFile`：文件输入。底层支持上游最大限制，但工作台/HTTP 入口为控制内存统一限制文档为 32 MiB。multipart 严格先 `purpose` 再 `file`；`user_data` 最多 32 MiB，解析最多 100 MiB。解析页数上限 1000 页由上游校验。
- `ocr`：独立 OCR，返回页面文本及合并文本。
- `transcribe`：独立 ASR，文件最多 8 MiB，支持 WAV / Ogg 签名检查。上游只支持 16-bit PCM WAV 或 Ogg Opus、最长 120 秒；调用方需提供合规编码，不支持直接上传浏览器 WebM。
- `speak`：独立 TTS，`stella` / `tide`，输出 WAV；过滤 Markdown，中文每字按 2 计费字符检查，总量不超过 10000 计费字符及 64 KiB。

`chat` 返回 `annotations`（引用位置以 Unicode code point 为单位，不是 JS UTF-16 下标）、`serverToolCalls`（含服务端签名，应作为下一轮 assistant 消息的 `server_tool_calls` 原样传回）及完整 `usage`。不能将服务端文件 ID / 工具上下文作为跨用户共享状态。当前 HTTP 接口不接收文件 ID 或历史工具上下文，上传后仅在同一个请求中引用，防止跨用户复用。服务端固定每用户 15 分钟最多 20 次、同用户一次在途请求、全局最多 4 次在途请求。取消浏览器等待不保证上游取消或免收费用。

## 费用及安全

Token、搜索、读取、解析和语音分别计费。工具可能在单轮中多次调用，不能按一次聊天估算固定费用。`usage.server_tool_use` 的查询计数可用于展示工具用量，不是数据库已有的 Token 用量字段。客户端没有自动重试，以免请求超时后重复计费。

当前测试均为本地 mock，没有实际付费调用，没有验证账号配额、上游可用性或真实文件识别质量。启用生产服务前需要受控的真实验证。安全审核不替代服务提供方的合规义务。

## 验证与回滚

```sh
pnpm --dir web test:deepseek
pnpm --dir web verify
```

`test:deepseek` 使用临时数据库验证登录、默认关闭、费用确认、额外字段/跨用户文件 ID 拒绝、文件校验、限流和拒答；同时覆盖请求路径和参数、multipart 字段顺序、安全拒答、不完整回答、HTTP 200 内嵌错误、不重试、输入长度、内网 URL、音频响应类型和签名上下文保留。不需要 Key。`pnpm --dir web smoke` 另覆盖真实服务中的 DeepSeek 鉴权与默认关闭状态。

关闭 `DEEPSEEK_APP_ENABLED` 会停用 DeepSeek 模型和工具。可在 AI 配置切换文章模型和搜索服务，已入库素材继续可用。

## 官方来源（2026-11-13 核实）

- https://api-docs.deepseek.com/guides/build_a_chatbot/
- https://api-docs.deepseek.com/guides/web_tools/
- https://api-docs.deepseek.com/guides/document_parsing/
- https://api-docs.deepseek.com/guides/ocr/
- https://api-docs.deepseek.com/guides/asr/
- https://api-docs.deepseek.com/guides/tts/
- https://api-docs.deepseek.com/api/search/
- https://api-docs.deepseek.com/api/fetch/
