# Debug Session: design-analysis-timeout
- **Status**: [OPEN]
- **Issue**: HTML 块排版进入设计文件分析后持续收到 heartbeat，约 135 秒后报错，未进入可用结果。
- **Debug Server**: Pending
- **Log File**: `.dbg/trae-debug-log-design-analysis-timeout.ndjson`

## Reproduction Steps
1. 打开公众号画布并选择 HTML 块排版模式。
2. 上传 Design 文件并点击“AI 生成块排版”。
3. 等待“正在阅读并分析设计文件...”阶段。
4. 观察约 135 秒后的 SSE error 内容。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Design Planner 单次上游请求达到 90 秒超时 | High | Low | Pending: planner error code should be `ECONNABORTED` or timeout |
| B | Planner 超时被重试，累计等待超过 135 秒 | High | Low | Pending: multiple request attempts with cumulative elapsed time |
| C | Planner 降级后主块生成请求再次超时 | Medium | Low | Pending: planner failure followed by block request start and timeout |
| D | SSE/Nginx 连接中断，而非上游模型失败 | Low | Low | Pending: missing upstream error while client stream closes |
| E | 上游返回明确 HTTP 状态码而非超时 | Medium | Low | Pending: response status present in request failure |

## Log Evidence

- 用户提供的 SSE 在 15–135 秒持续收到 heartbeat，证明浏览器到 Node/Nginx 的流连接保持正常。
- 用户提供的请求体约 17KB，包含 37 个内容源和完整 Design 文件，属于长上下文、长输出请求。
- `web/server/utils/public.ts` 对所有非流式 LLM 请求固定使用 `timeout: 90000`。
- `callLLMWithRetry` 会重试网络错误和超时，因此一次画布生成可能经历多个 90 秒等待窗口。

## Verification Conclusion

- A Confirmed: 当前单次上游调用存在 90 秒硬超时。
- B Confirmed: 超时属于可重试错误，会累计多个等待窗口。
- C Inconclusive: 现有请求文件不包含最终服务端错误，无法确认 Planner 降级后主生成是否再次超时。
- D Rejected: 135 秒内 SSE heartbeat 持续正常。
- E Inconclusive: 请求文件不包含上游响应状态。

最小修复：仅为 Canvas 结构化生成设置 300 秒单次超时，保留其他 LLM 调用的 90 秒默认值。
