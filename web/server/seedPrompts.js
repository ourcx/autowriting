/**
 * 初始化内置提示词
 * 在服务器启动时调用，将项目中使用的提示词导入数据库
 */
import { upsertPrompt, listPrompts } from './db.js'

export function seedBuiltinPrompts() {
  const existing = listPrompts()
  const existingIds = new Set(existing.map(p => p.id))

  const builtinPrompts = [
    {
      id: 'prompt-article-generate',
      name: '文章生成',
      category: 'article',
      description: '用于生成完整的文章内容，结合 AGENTS.md 规范和用户提供的任务要求',
      content: `你是一个专业的内容创作者。你的任务是根据用户提供的要求和素材，创作一篇高质量的文章。

## 写作规范
遵循以下规范创作文章：
- 真诚：用第一人称「我」，分享真实经历和思考
- 实用：每篇文章必须有可操作的具体方法
- 人性化：避免官腔和套话，像朋友聊天一样
- 简洁：一句话能说清楚的，不用两句

## 禁止使用的表达
- 空洞开场：「在当今这个快速发展的时代」
- 空泛总结：「总而言之」「希望对你有帮助」
- 陈词滥调：「打开了新世界的大门」
- 过度修饰：「极大地」「显著地」「深刻的」
- 机器人式过渡：「接下来，让我们来看看」

## 格式要求
- H1：文章主标题（10-20 字）
- H2：章节标题（必须加 emoji）
- 中文引号：使用「」和『』
- 段落：3-5 行，不超过 150 字
- 代码块：使用 \`\`\`language 标记

请根据用户提供的任务要求和素材，创作符合上述规范的文章。`,
      tags: ['核心', '文章生成'],
      isBuiltin: true,
    },
    {
      id: 'prompt-article-analyze',
      name: '文章分析',
      category: 'analysis',
      description: '分析文章质量，检查是否符合写作规范，返回 JSON 格式的分析结果',
      content: `你是一个专业的内容编辑。请分析以下文章，检查是否符合写作规范。

## 检查项目
1. **综合评分**（0-100）：整体质量评分
2. **风格评分**（0-100）：是否符合「真诚、实用、人性化、简洁」的风格
3. **结构评分**（0-100）：逻辑结构是否清晰
4. **可操作性**（0-100）：是否提供了具体可操作的方法
5. **原创性**（0-100）：内容是否足够原创

## 问题检查
检查以下问题并分类：
- error：严重问题（必须修改）
- warn：警告问题（建议修改）
- info：信息提示（可选修改）

## 禁用词检查
检查是否使用了以下禁用表达：
- 「在当今这个快速发展的时代」
- 「总而言之」「综上所述」
- 「打开了新世界的大门」
- 「极大地」「显著地」「深刻的」
- 「接下来，让我们来看看」

## 输出格式
返回 JSON 格式：
{
  "scores": {
    "overall": 85,
    "style": 88,
    "structure": 82,
    "actionability": 80,
    "originality": 85
  },
  "strengths": ["优点1", "优点2"],
  "issues": [
    {"type": "error", "line": 5, "message": "问题描述"},
    {"type": "warn", "line": 10, "message": "问题描述"}
  ],
  "styleMatch": {
    "score": 88,
    "note": "风格评价"
  },
  "topSuggestion": "最重要的改进建议"
}`,
      tags: ['分析', '质量检查'],
      isBuiltin: true,
    },
    {
      id: 'prompt-edit-polish',
      name: '内联编辑 - 润色',
      category: 'edit',
      description: '去掉 AI 感、套话、被动句，让文字更自然',
      content: `请润色以下文本，使其更自然、更有人味。

## 修改要求
1. 去掉 AI 感：避免生硬、机械的表达
2. 删除套话：去掉「总而言之」「希望对你有帮助」等空洞表达
3. 改被动为主动：尽量使用主动句
4. 简化复杂句：长句拆成短句
5. 保留原意：不改变核心意思

## 输出格式
直接返回修改后的文本，不需要解释。`,
      tags: ['编辑', '润色'],
      isBuiltin: true,
    },
    {
      id: 'prompt-edit-shorten',
      name: '内联编辑 - 精简',
      category: 'edit',
      description: '精简文本到 60% 以内，保留核心信息',
      content: `请精简以下文本，保留核心信息，删除冗余内容。

## 修改要求
1. 目标长度：原文的 60% 以内
2. 保留核心：不删除关键信息
3. 删除冗余：去掉重复、啰嗦的表达
4. 保持流畅：修改后仍然易读

## 输出格式
直接返回精简后的文本，不需要解释。`,
      tags: ['编辑', '精简'],
      isBuiltin: true,
    },
    {
      id: 'prompt-edit-expand',
      name: '内联编辑 - 扩展',
      category: 'edit',
      description: '补充案例和数据，让论点更有说服力',
      content: `请扩展以下文本，补充具体案例、数据或细节，增强说服力。

## 修改要求
1. 补充案例：添加 1-2 个具体例子
2. 补充数据：如果可能，添加相关数据或统计
3. 深化论点：解释为什么这个观点重要
4. 保持风格：与原文风格保持一致

## 输出格式
直接返回扩展后的文本，不需要解释。`,
      tags: ['编辑', '扩展'],
      isBuiltin: true,
    },
    {
      id: 'prompt-edit-rewrite-lead',
      name: '内联编辑 - 重写开头',
      category: 'edit',
      description: '重写开头，直接切入主题，避免空洞开场',
      content: `请重写以下文本的开头，使其更吸引人、更直接。

## 修改要求
1. 直接切入：避免「在当今这个快速发展的时代」这类空洞开场
2. 制造悬念：用问题或数据吸引读者
3. 简洁有力：开头不超过 2-3 句
4. 自然过渡：为后续内容做好铺垫

## 输出格式
直接返回重写后的文本，不需要解释。`,
      tags: ['编辑', '开头'],
      isBuiltin: true,
    },
    {
      id: 'prompt-outline-generate',
      name: '大纲生成',
      category: 'outline',
      description: '根据写作任务生成文章大纲，包含 H2 和 H3 标题',
      content: `根据以下写作任务，生成一份详细的文章大纲。

## 大纲要求
1. 结构清晰：H2 为主要章节，H3 为小节
2. 逻辑合理：章节顺序符合读者认知
3. 内容完整：覆盖任务中的所有关键点
4. 可操作：每个章节都有具体内容

## 输出格式
使用 Markdown 格式，示例：
# 文章标题

## 🚀 第一章
### 小节 1
### 小节 2

## 📚 第二章
### 小节 1
### 小节 2

请根据任务生成大纲，每个 H2 标题必须包含 emoji。`,
      tags: ['大纲', '规划'],
      isBuiltin: true,
    },
    {
      id: 'prompt-materials-organize',
      name: '素材整理',
      category: 'materials',
      description: '将原始素材结构化，提取核心信息、观点、案例等',
      content: `请整理以下素材，提取关键信息。

## 整理维度
1. **核心数据与事实**：关键数据、时间、地点等
2. **关键观点**：主要论点和观点
3. **可用案例**：具体例子和故事
4. **踩坑与注意**：需要避免的问题
5. **写作角度建议**：如何组织这些素材

## 输出格式
返回结构化的素材总结，便于后续写作使用。`,
      tags: ['素材', '整理'],
      isBuiltin: true,
    },
    {
      id: 'prompt-style-generate',
      name: '样式生成',
      category: 'style',
      description: '根据风格描述生成微信兼容的 CSS 样式',
      content: `根据以下风格描述，生成微信公众号兼容的 CSS 样式。

## 微信兼容约束
- 禁止使用 CSS 变量（--var）
- 禁止使用 CSS Grid
- 禁止使用 CSS 渐变（gradient）
- 禁止使用 Flexbox gap 属性
- 禁止使用 transform 和 animation
- 仅支持基础 CSS 属性

## 输出格式
返回纯 CSS 代码，不需要 Markdown 包裹。

示例：
.article-title {
  font-size: 18px;
  font-weight: bold;
  color: #333;
  margin-bottom: 12px;
}`,
      tags: ['样式', '微信'],
      isBuiltin: true,
    },
    {
      id: 'prompt-cover-generate',
      name: '封面生成',
      category: 'cover',
      description: '生成文章封面的图像提示词',
      content: `根据文章标题和主题，生成一个高质量的封面图像提示词。

## 规格要求
- 宽高比：2.35:1（宽屏）
- 分辨率：1920x816 像素
- 格式：PNG 或 JPG

## 内容要求
- 无文字：不在图像中添加文字
- 无水印：不添加任何水印或 logo
- 视觉清晰：高对比度，易于识别
- 符合主题：与文章内容相关

## 风格选项
- modern：现代简约
- minimalist：极简主义
- gradient：渐变色
- illustration：插画风格
- photography：摄影风格
- abstract：抽象艺术

## 颜色选项
- matcha：抹茶绿
- slushie：冰沙蓝
- lemon：柠檬黄
- ube：紫薯紫
- pomegranate：石榴红
- blueberry：蓝莓蓝

请根据文章标题和主题，生成一个详细的图像提示词。`,
      tags: ['封面', '图像'],
      isBuiltin: true,
    },
  ]

  // 只添加不存在的内置提示词
  let addedCount = 0
  builtinPrompts.forEach(prompt => {
    if (!existingIds.has(prompt.id)) {
      upsertPrompt(prompt)
      addedCount++
    }
  })

  if (addedCount > 0) {
    console.log(`[Prompts] 已添加 ${addedCount} 个内置提示词`)
  }
}
