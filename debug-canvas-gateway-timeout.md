# Debug Session: canvas-gateway-timeout
- **Status**: [OPEN]
- **Issue**: AI 生成视觉画布时，线上 Nginx 返回 504 Gateway Time-out。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-canvas-gateway-timeout.ndjson`

## Reproduction Steps
1. 打开线上 `/canvas`。
2. 输入画布描述并点击“AI 生成画布”。
3. 等待请求结束，页面出现 `504 Gateway Time-out`。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 线上 Nginx 未应用 300 秒读取超时 | High | Low | Inconclusive：仓库文档为 300s，无法直接读取线上生效配置 |
| B | 上游生成超过网关空闲窗口，后端期间无响应字节 | High | Low | Confirmed：客户端 2.002s 超时且收到 0 bytes，Node 4.027s 后才完成 |
| C | 90 秒超时与三次重试放大总耗时 | High | Low | Confirmed risk：单次 90s，最多 3 次 |
| D | 当前画布与 4000 token 输出上限使请求过慢 | Medium | Low | Rejected as primary：8 字 prompt、无当前画布仍表现为零输出等待 |
| E | 前端 Axios 主动超时 | Low | Low | Rejected：调用未配置前端 timeout |

## Log Evidence
1. `request-entry`：promptLength=8，hasDocument=false。
2. `before-upstream`：3ms 时进入 mock 模型调用。
3. 客户端在 2.002s 超时，下载 0 bytes。
4. `upstream-complete`：Node 在 4.027s 后完成，outputLength=274。

## Root Cause

同步 JSON 路由在上游模型返回前不发送响应，导致代理的 upstream idle timeout 可先于业务完成触发。

## Fix

- 新增 `POST /api/canvas/generate/stream`。
- 建连后立即 flush，并发送 `progress` 事件。
- 模型等待期间每 15 秒发送 `heartbeat`。
- 最终使用 `result` 或 `error` 事件结束响应。
- 前端改为增量解析 SSE，原 JSON 接口继续保留兼容。

## Post-fix Evidence

1. `stream-open` 在 0ms 记录。
2. 客户端首字节时间从“2.002s 超时仍为 0 bytes”变为 0.002987s。
3. 上游 4.024s 完成后成功发送 `result`，总响应 4.026941s、HTTP 200。
4. 响应包含 374 bytes，事件顺序为 `progress` → `result`。

## Follow-up: invalid model output

用户确认网关超时后出现 `AI 未返回有效画布 JSON`。

| ID | Hypothesis | Result |
| --- | --- | --- |
| F1 | 模型结果不在纯字符串 `message.content` | Pending |
| F2 | 响应包含多个 JSON/解释文字，贪婪正则解析失败 | Confirmed design flaw |
| F3 | 推理模型耗尽输出预算，`content` 为空 | Pending |
| F4 | 供应商未启用结构化 JSON 输出 | Confirmed design flaw |

修复策略：请求 `response_format=json_object`，不支持时自动降级；兼容数组 content、tool call arguments 和 reasoning content；使用平衡括号提取多个 JSON 候选；首轮失败后执行一次低温度 JSON 修复调用。

### Repair verification

1. 首轮返回 17 字解释文字、无 JSON，结构日志正常记录且不包含正文。
2. 服务端发送“正在修复模型输出”进度事件。
3. 第二轮返回 276 字合法 JSON，最终成功输出 `result`，`repaired=true`。
4. 单独验证 `message.content=null + tool_calls[].function.arguments`，无需修复即可生成画布。

## Follow-up: canvas content fidelity

线上旧画布包含 12 个节点：7 个占位文本、4 个装饰、1 个形状、0 张图片。根因是请求没有携带公众号文章，模型同时承担了内容生成与排版。

修复后：

1. 文章被确定性拆分为标题、章节、正文、引用、列表和图片内容源。
2. AI 只返回 `sourceId`、坐标和视觉属性，不能返回正文或图片地址。
3. 服务端覆盖 AI 伪造内容，并按文章顺序补齐漏排内容。
4. 最坏场景测试中，AI 仅排版 1 个来源并伪造文字；最终仍保留全部 5 个原文文本和 1 张图片，伪造文字为 0。
5. 浏览器测试中，示例文章完整生成 7 个文本块和 3 张图片，画布自动扩展至 2405px。

## Verification Conclusion

修复后连接不再在模型等待期间保持静默；持续超过 Nginx 空闲阈值时，15 秒 heartbeat 会刷新 upstream read timeout。等待用户在线上环境确认。
