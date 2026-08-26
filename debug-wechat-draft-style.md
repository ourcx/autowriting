# Debug Session: wechat-draft-style

- **Status**: [OPEN]
- **Issue**: 推送到微信公众号草稿后，正文文字和整篇出现黑色边框、图标背景变黑，并且没有携带封面。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: `.dbg/trae-debug-log-wechat-draft-style.ndjson`

## Reproduction Steps

1. 在 `/canvas` 生成 HTML 块排版。
2. 选择封面并点击“推送公众号”。
3. 在公众号草稿箱打开推文。
4. 检查正文边框、图标背景和封面。

## Hypotheses & Verification

| ID | Hypothesis | Likelihood | Effort | Evidence |
| --- | --- | --- | --- | --- |
| A | 编辑器选中态或 outline 被计算样式内联进导出 HTML | High | Low | Pending: compiled HTML contains black border/outline |
| B | SVG/图标透明背景经微信转换后变成黑色 | High | Low | Pending: icon payload uses transparent SVG/background |
| C | gutter table 或正文根容器导出了非零黑色 border | Medium | Low | Pending: root/table/td inline border values |
| D | 前端草稿请求没有发送当前封面字段 | High | Low | Pending: request payload cover fields are empty |
| E | 服务端收到封面但上传失败或错误降级 | Medium | Low | Pending: cover selection and upload result differ |

## Log Evidence

Instrumentation installed:

- A/B/C: compiled HTML black-border count, selected-state count, gutter border and SVG data-icon count.
- D/E: resolved cover source, cover upload outcome and draft request `thumb_media_id`.
- A/B/C/D/E: final server-side WeChat payload summary before `/draft/add`.

Static evidence:

- A/C Confirmed: WeChat-compatible layout uses multiple `table`/`td` elements, but the export path did not explicitly emit `border="0"` or `style="border:0"` for presentation tables and unbordered cells.
- B Confirmed: icons were exported as transparent SVG data URLs; `prepareWechatArticleImage()` treated SVG as non-PNG and converted it to JPEG, which can render transparent pixels as black.
- D Confirmed: Canvas preferred the first body image over `cover_image_<articleId>` when resolving the cover.
- E Confirmed: cover upload errors were caught and the draft continued with a generated blank default cover.

## Verification Conclusion

Minimal fix applied:

- Presentation table, row, gutter cell and editor wrappers explicitly remove default borders while preserving intentional divider borders.
- SVG and PNG content images preserve transparency by uploading as PNG.
- The explicitly selected cover is preferred; missing or failed cover now blocks the draft push instead of silently substituting a blank cover.

Awaiting post-fix verification with `runId=post-fix`.

Post-fix local evidence:

- Log line 1: a 48-block article compiled to 56,108 bytes with `blackBorderCount: 0`.
- Transparent SVG conversion test: output is PNG, `hasAlpha: true`, 24x24, 130 bytes.
- Frontend targeted lint passed.
- Changed-file TypeScript check passed.
- Architecture check passed with 0 new violations.
- Production build passed.
- API smoke passed: 23/23.
