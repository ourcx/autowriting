# 写作资产与文风控制

## 目标

写作资产页把长期文风、背景记忆、提示词、素材、候选稿、作者反馈和历史表现集中展示，但不复制这些数据。各类资产继续由原有模块保存，聚合接口只返回统计和已确认的写作取舍。

文章生成遵守两条固定规则：

- 标题和正文不使用 emoji、表情包或装饰性表情符号。
- AI 只能读取作者已经确认的长期偏好，不能把模型推断自动写回文风。

## 资产边界

| 资产 | 用途 | 存储 |
| --- | --- | --- |
| 写作 DNA | 长期表达选择 | `settings.creator_writing_profile:<userId>` |
| 长期背景 | 身份、领域和稳定事实 | `settings.global_memory:<userId>` |
| 提示词 | 生成、分析和编辑指令 | `prompts`、`prompt_versions` |
| 单篇素材 | 本篇事实和来源 | 文章目录下的 `prompt/materials*.md` |
| 候选稿 | 模型原稿及输入快照 | `DATA_DIR/generation-candidates/` |
| 写作取舍 | 作者明确确认的修改原因 | `settings.creator_experiences:<userId>` |
| 表现证据 | 微信数据和人工评分 | 微信分析快照、`article_scores` |

高低表现文章只用于提出选题和内容假设。阅读量还会受到发布时间、账号体量、推荐流量和旧文长尾影响，因此不能直接推导出某种句式、篇幅或模板有效。

## 六层写作 DNA

- `language`：用词、句长、断句、标点和禁用表达。
- `structure`：开头方式、章节顺序、详略分配和结尾方式。
- `angle`：面对题目时常用的切入问题和叙述视角。
- `material`：偏好的事实、经历、数据、案例和引用方式。
- `cognition`：长期立场、判断原则和不能交给模型补写的观点。
- `visual`：配图、截图、排版和视觉表达的职责。

旧写作档案无需迁移。新增字段为空时按旧配置继续生成，保存后仍写入同一条用户隔离设置。

## 生成上下文

`server/writingContext.ts` 是文章生成的统一上下文入口。候选稿、同步生成、流式生成和定时任务按同一顺序读取：

1. 中文成文底线。
2. 本篇任务与素材。
3. 通用写作规范和六层写作 DNA。
4. 作者已确认的写作取舍。
5. 长期背景。
6. 历史表现和当次选择的往期文章。

本篇任务和素材拥有更高优先级。长期背景最多读取前 12000 字，避免无边界内容挤占上下文。

## emoji 处理

提示词要求模型不输出 emoji。服务端仍会在保存和流式返回前调用 `stripEmoji`，处理模型偶尔不遵守要求的情况。该清理只作用于 AI 新生成的正文、候选稿、局部编辑、大纲和去 AI 味结果，不改写用户手工保存的原文。

## 作者反馈

审核页保存写作取舍时，需要选择“综合取舍”或六层中的一层。保存动作本身就是作者确认，系统不会根据未修改段落、文章评分或模型分析自动创建长期规则。

已有反馈缺少层级时按“综合取舍”读取，保持旧数据兼容。

## 接口

- `GET /api/creator-profile/assets`：返回六层完成度、长期背景字数、提示词、素材文章、候选稿、表现样本和确认取舍统计。
- `GET /api/creator-profile`：读取写作 DNA。
- `PUT /api/creator-profile`：保存写作 DNA。
- `GET /api/settings/global_memory`：读取当前账号长期背景。
- `PUT /api/settings/global_memory`：保存当前账号长期背景。

所有接口均要求登录，并按当前用户隔离。

## 验证

```bash
pnpm --dir web test:production
pnpm --dir web smoke
pnpm --dir web verify
```

浏览器回归使用：

```bash
WORKBENCH_URL=http://127.0.0.1:5173 pnpm --dir web test:writing-assets
```
