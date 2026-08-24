# ADR：公众号视觉画板架构

- 状态：Accepted
- 日期：2026-08-24
- 范围：`/canvas` 视觉排版、微信复制与草稿推送

## 决策

公众号视觉排版采用“受控模板 + 内容源 + 安全 Scene DSL + 双交付通道”，不允许 AI 直接生成可执行 HTML、CSS 或完整 SVG 文档。

```text
ArticleData
  -> CanvasSource（不可变正文与图片）
  -> Design Template（可信结构、Token、防重叠规则）
  -> User Prompt / Design File（不可信参考）
  -> AI 仅映射 sourceId 与安全布局参数
  -> Server Hydration / Validation
  -> HTML Block Renderer 或 Freeform SVG Renderer
  -> 微信兼容 HTML / PNG
```

## 模型边界

### 内容层

`CanvasSource` 是唯一正文事实源。AI 不能返回正文或图片地址，只能引用 `sourceId`。服务端负责：

- 按原顺序回填全部正文与图片。
- 去重并补齐模型遗漏内容。
- 拒绝不存在的 `sourceId`。
- 拒绝脚本、任意 HTML、CSS 和不安全 SVG Path。

### 设计层

`canvasDesignTemplates.ts` 提供可信模板，包含：

- 图表或文章类型。
- 结构要求。
- UI 规范。
- 视觉 Token。
- 防重叠约束。

用户提示词与上传的 `.txt`、`.md`、`.json`、`.svg`、`.xml`、`.drawio` 文件均标记为不可信参考。服务端只提取视觉与布局信息，并限制长度；文件内容不能覆盖系统约束。

Design 文件格式不固定，代码不维护格式专用解析器。生成流程先将原始文件直接交给 AI 形成设计计划，再把设计计划、原始文件和文章内容源一并交给布局模型。代码只负责验证安全 DSL、内容完整性和最低设计丰富度。

### 布局层

HTML Block 支持：

- `content`：单个内容源。
- `section`：组合 2-8 个连续内容源，支持纵向、双栏、主体对比和重点加双栏。
- `decoration`：锚定到内容源前后的安全 SVG Path。

`section.itemStyles` 按 `sourceId` 保存内部文字的独立样式，保证组合布局中的文字仍可单独选择和修改。

扩展视觉能力包括 `editorial` 布局、`lede` 导语、`overline` 眉题、`metric` 数据强调、顶部/左侧/底部强调边、三色轨道和可选阴影。上传 Design 文件时，若 AI 没有使用这些结构形成明显区别于 Markdown 的结果，服务端会重试而不是静默回退为普通正文。

自由画板保留 SVG Scene Graph。服务端会对 AI 坐标执行：

- 画布边界夹紧。
- 文字高度重新计算。
- 内容节点碰撞检测与下移消解。
- 原文与图片强制回填。

## 微信交付

### 富文本通道

HTML Block 通过专用编译器导出，不直接复制预览 DOM：

- 清除编辑器 class、data 属性和交互状态。
- 根容器改为百分比宽度。
- 双栏使用 `table`，不依赖 Grid/Flex。
- 图片强制 `width:100%;height:auto`。
- SVG 装饰降级为稳定分割线。
- 同时写入剪贴板 `text/html` 与 `text/plain`。

### 复杂视觉通道

自由画板继续导出 SVG/PNG。下载时按 6000px 分段；推送公众号时按 2400px 分段光栅化为 PNG，控制单图体积后由服务端转存为微信正文图片，避免微信富文本清洗破坏绝对定位、SVG、图表标签或复杂 CSS。

### 草稿推送

块排版复用 `/api/wechat/draft`：

- 使用本地绑定的公众号凭据。
- 优先将文章首图或封面上传为永久素材。
- 服务端将正文图片转存为微信内容图片。
- 推送成功后返回草稿 `media_id`。

## 不采用的方案

- 直接复制秀米运行时 DOM：依赖私有属性和外部 CDN，结构不稳定。
- 让 AI 输出任意 HTML/CSS：无法稳定验证内容完整性、安全性和微信兼容性。
- 所有内容都绘制为一个 SVG：长文编辑、复制、无障碍和微信兼容性差。
- 仅靠自然语言提示防止重叠：约束不可验证，必须配合模板编译和服务端几何校验。
