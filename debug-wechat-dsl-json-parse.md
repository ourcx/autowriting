# Debug Session: wechat-dsl-json-parse
- **Status**: [OPEN]
- **Issue**: AI block generation intermittently ends with "AI 未返回可解析的公众号块 DSL" instead of a hydrated block document.
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-wechat-dsl-json-parse.ndjson`

## Reproduction Steps
1. Open the local `/canvas` page for a non-empty article.
2. Select HTML block layout.
3. Run "AI 生成块排版".
4. Observe the terminal failure after the initial completion and repair attempt.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | The completion is truncated with `finish_reason=length`. | High | Low | Pending |
| B | Valid JSON is returned in a provider-specific field not included in completion candidates. | Medium | Low | Pending |
| C | JSON is valid but wrapped in an unsupported top-level shape or contains an empty parsed block array. | Medium | Low | Pending |
| D | Richness validation and syntax failures share one repair path, causing an unnecessarily large second response. | High | Low | Pending |
| E | The expanded DSL plus per-source output exceeds the current completion budget on long articles. | High | Medium | Pending |

## Log Evidence

Instrumentation added at:

- Block request sizing before the first model call.
- First completion shape before parsing.
- First parse/richness rejection.
- Repair completion shape before parsing.
- Repair parse/richness rejection.

No article text or raw model response is reported.

Pre-fix reproduction attempt 1:

- `POST /api/canvas/generate-block/stream` returned HTTP 400 in 1 ms.
- Local browser storage does not contain `wx-ai-config-v1`.
- No debug event file was created, proving execution stopped before the model request.
- This is an environment blocker, not evidence for or against hypotheses A-E.

## Verification Conclusion

Pending one reproduction from a local browser profile with a configured article model.
