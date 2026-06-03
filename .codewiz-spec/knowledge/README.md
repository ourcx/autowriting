---
name: 知识库说明
stages:
  - all
source: base
---
# 知识库说明

本目录包含项目相关的知识库文档，各阶段的 SubAgent 会按需加载匹配的文档。

## 如何添加知识库文档

1. 在此目录下创建 `.md` 文件
2. 在文件开头添加 frontmatter（YAML 格式）：

```yaml
---
name: 文档名称
stages:
  - design
  - coding
source: custom
---
```

3. 在 frontmatter 之后编写文档内容

## stages 可选值

- `all`: 所有阶段都会加载此文档
- `userStory`: 需求理解与澄清阶段
- `design`: 方案设计阶段
- `taskList`: 任务拆分阶段
- `coding`: 代码实现阶段

可以指定多个阶段，例如：`stages: [design, coding]`

## source 可选值

- `base`: 内置文档（初始化时生成）
- `remote`: 从远端同步的文档（预留）
- `custom`: 用户自定义文档

## 提示

- 文档内容会作为上下文注入到对应阶段的 SubAgent
- 建议保持文档简洁，避免过长影响 token 使用
- 可以按需删除不需要的 base 文档
