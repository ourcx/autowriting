# 公众号样式与富文本渲染

公众号发布预览和样式管理页统一使用 `src/utils/wechatMarkdown.ts` 渲染 Markdown，避免预览结构与实际复制结构不一致。

## 支持的扩展结构

- 标题自动生成 `.prefix`、`.content`、`.suffix`，供主题精确装饰标题。
- Markdown 表格自动包裹为 `.table-container`。
- 普通引用块使用 `.multiquote-1`。
- GitHub Alert 写法转换为语义提示块：

```markdown
> [!NOTE] 补充说明
> [!TIP] 行动建议
> [!IMPORTANT] 核心结论
> [!WARNING] 风险提示
> [!CAUTION] 严重警告
```

- `- [x]` 和 `- [ ]` 转换为微信兼容的任务列表状态，不依赖会被微信过滤的 checkbox。
- 独占一行的 Markdown 图片转换为 `figure`；紧随其后的斜体段落转换为 `figcaption`。

## 内置主题

- 默认样式
- 东方笺谱
- 黑白小票
- 落日胶片
- 留白画册
- 经典蓝
- 莫兰迪
- 极简黑
- 夕阳橙
- 极光紫

内置主题定义集中在 `shared/defaultStyleTemplates.ts`，前端和服务端模板清单必须同时引用同一份 CSS 常量。

## 预览与复制

预览直接注入主题 CSS。复制到公众号前会读取浏览器计算样式并写回元素的内联 `style`，同时保留提示块、表格容器、图片图注和任务列表结构。

样式管理页提供：

- 文章预览与组件总览切换。
- 手机宽度与宽屏预览切换。
- 自定义 CSS 实时预览。

## 视觉画布

`/canvas` 是独立于 Markdown 的第二种文档模型。画布使用 `shared/canvasDsl.ts` 定义的 JSON DSL，并通过 SVG 渲染。

当前支持：

- `text`：文字、字号、颜色、对齐和行高。
- `image`：多图 URL、cover/contain 和圆角。
- `shape`：矩形、椭圆、填充和描边。
- `motif`：wave、dots、arch、spark、frame 五种安全 SVG 装饰。
- 节点拖拽、图层排序、属性编辑、DSL 编辑、自动保存。
- AI 根据自然语言生成或修改画布。
- 复制 DSL 和下载 SVG。

AI 不允许输出任意 HTML、JavaScript 或原始 SVG path。服务端和前端都会重新解析 DSL，并限制节点类型、数量、坐标范围、文本长度、颜色格式和图片 URL。

后续可在此模型上继续增加缩放、吸附参考线、撤销栈、组合、多选，以及将 SVG 光栅化后写入公众号素材库。
