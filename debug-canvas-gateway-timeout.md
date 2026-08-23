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

## Verification Conclusion

修复后连接不再在模型等待期间保持静默；持续超过 Nginx 空闲阈值时，15 秒 heartbeat 会刷新 upstream read timeout。等待用户在线上环境确认。
