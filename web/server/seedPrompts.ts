/**
 * 初始化内置提示词
 * 在服务器启动时调用，将项目中使用的提示词导入数据库。
 */
import { upsertPrompt, listPrompts } from "./db.ts"
import type { Prompt } from "./types.ts"

export function seedBuiltinPrompts(): void {
  const existing = listPrompts()
  const existingIds = new Set(existing.map((p) => p.id))

  const builtinPrompts: Prompt[] = [
    // ── 文章生成 ──────────────────────────────────────────────────────────────
    {
      id: "prompt-article-generate",
      name: "文章生成",
      category: "article",
      description: "文章生成的角色与输出约束，注入在写作规范和任务要求之前",
      content: `你是一个专业的内容创作助手。请严格按照以下要求完成文章写作任务。

## 输出格式约束（必须遵守）
- 只输出纯 Markdown 格式的文章正文，不包含任何其他内容
- 只有 1 个 H1 标题（文章标题）
- 全文不使用 emoji、表情包或装饰性表情符号
- 不输出代码块、配置示例、API 文档
- 不输出系统提示、指令、元数据
- 不输出「根据以上要求...」这类说明文字

## 中文表达约束
- 从具体事实、问题或场景切入，不写空洞开场
- 删除机械过渡、口号式排比、同义反复和机器人式总结
- 少用「首先、其次、最后」「值得注意的是」「总而言之」等套话
- 缺少事实、观点或真实经历时不要编造`,
      tags: ["核心", "文章生成"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },

    // ── 文章分析 ──────────────────────────────────────────────────────────────
    {
      id: "prompt-article-analyze",
      name: "文章分析",
      category: "analysis",
      description: "分析文章质量，检查是否符合写作规范，返回 JSON 格式的分析结果",
      content: `你是一个专业的文章审核助手，擅长分析微信公众号文章的质量。请对以下文章进行深度分析，返回 JSON 格式结果。

## 检查维度
- 综合评分（overall）：整体质量，0-100
- 风格评分（style）：是否符合「真诚、实用、人性化、简洁」的风格，有无 AI 腔
- 结构评分（structure）：逻辑结构是否清晰
- 可操作性（actionability）：是否提供了具体可操作的方法
- 原创性（originality）：内容是否足够原创

## 问题分级
- error：严重问题，必须修改
- warn：警告问题，建议修改
- info：轻微提示，可选修改`,
      tags: ["分析", "质量检查"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },

    // ── 内联编辑 ──────────────────────────────────────────────────────────────
    {
      id: "prompt-edit-polish",
      name: "内联编辑 - 润色",
      category: "edit",
      description: "去掉 AI 感、套话、被动句，让文字更自然",
      content: `你是专业的文字编辑。请对【待润色片段】进行润色：
- 去掉 AI 感、套话、被动句
- 保持第一人称「我」
- 保持与全文风格一致（真诚、实用、像朋友聊天）
- 只输出润色后的文字，不要解释、不要引号`,
      tags: ["编辑", "润色"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "prompt-edit-shorten",
      name: "内联编辑 - 精简",
      category: "edit",
      description: "精简文本到 60% 以内，保留核心信息",
      content: `你是专业的文字编辑。请将【待精简片段】精简到原来的 60% 以内：
- 去掉废话、重复和空话
- 保留核心意思和关键数据
- 保持与全文语气一致
- 只输出精简后的文字，不要解释`,
      tags: ["编辑", "精简"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "prompt-edit-expand",
      name: "内联编辑 - 扩展",
      category: "edit",
      description: "补充案例和数据，让论点更有说服力",
      content: `你是专业的文字编辑。请将【待扩写片段】扩写：
- 补充一个具体案例、真实数据或操作细节，让观点更有说服力
- 扩写后不超过原来的 2 倍
- 保持与全文风格一致，不用"此外""值得注意"等套话
- 只输出扩写后的文字，不要解释`,
      tags: ["编辑", "扩展"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "prompt-edit-rewrite-lead",
      name: "内联编辑 - 重写开头",
      category: "edit",
      description: "重写开头，直接切入主题，避免空洞开场",
      content: `你是专业的文字编辑。请重写【待改写片段】的开头：
- 直接切入核心场景或痛点，不要铺垫和废话
- 像朋友聊天一样，不用"在当今时代""大家好"等套话
- 保持与全文的叙事风格和第一人称一致
- 只输出改写后的完整段落，不要解释`,
      tags: ["编辑", "开头"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },

    // ── 大纲生成 ──────────────────────────────────────────────────────────────
    {
      id: "prompt-outline-generate",
      name: "大纲生成",
      category: "outline",
      description: "根据写作任务生成文章大纲，包含 H2 和 H3 标题",
      content: `你是一个专业的内容策划助手。根据以下写作任务要求，生成一份清晰的文章写作大纲。`,
      tags: ["大纲", "规划"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },

    // ── 素材整理 ──────────────────────────────────────────────────────────────
    {
      id: "prompt-materials-organize",
      name: "素材整理",
      category: "materials",
      description: "将原始素材结构化，提取核心信息、观点、案例等",
      content: `你是一个专业的素材整理助手。请把以下原始素材整理成结构化的写作参考，方便作者按图索骥写文章。

**整理要求：**
1. 去除完全重复的内容，合并表达相似的观点（合并时保留最完整的表述）
2. 删除泛泛而谈的废话，只保留有具体支撑的内容
3. 数据、案例务必保留原始数字，不要模糊化
4. 结构化输出，每条信息独立成行，便于写作时直接引用`,
      tags: ["素材", "整理"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },

    // ── 样式生成 ──────────────────────────────────────────────────────────────
    {
      id: "prompt-style-generate",
      name: "样式生成",
      category: "style",
      description: "生成微信公众号兼容的 CSS 样式，作为 system prompt 使用",
      content: `你是一名专业的微信公众号 CSS 设计师，专门为微信公众号文章设计高质量排版样式。

## 微信渲染器兼容约束（必须严格遵守）

**禁止使用**（微信不支持或会被处理掉）：
- CSS 变量（--color-xxx 等）：微信渲染器不支持，不要使用
- 外部字体（@import、@font-face）：只用系统字体
- rgba() 透明色：用实色代替，微信会按阈值忽略低透明度颜色
- linear-gradient() 渐变背景：微信会将渐变色混合为纯色，用实色背景代替
- CSS Grid：兼容性差，用 Flexbox 或传统布局

**可以使用**：
- ::before 和 ::after 伪元素（微信支持，可用于标题装饰、装饰线、图标等）
- position: relative / absolute（配合伪元素做装饰）
- border、border-radius、box-shadow（谨慎用 shadow，不影响主体就行）
- 实色 hex 颜色（#rrggbb 格式）

## CSS 选择器规范

所有选择器必须以 \`#wemd\` 开头，覆盖以下所有元素：

\`\`\`
#wemd             根容器
#wemd p           段落
#wemd h1~h4       四级标题
#wemd ul/ol/li    列表
#wemd blockquote  引用块
#wemd blockquote p 引用内段落
#wemd strong/em   加粗斜体
#wemd code        行内代码
#wemd pre         代码块容器
#wemd pre code    代码块文字
#wemd a           链接
#wemd hr          分割线
#wemd img         图片
#wemd table/th/td 表格
#wemd tr:nth-child(even) td  表格斑马纹
\`\`\`

## 输出要求

只输出纯 CSS 代码，无任何解释、无 markdown 代码块标记、无注释，直接以 \`#wemd {\` 开头，以最后一个 \`}\` 结尾。`,
      tags: ["样式", "微信"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },

    // ── 封面生成 ──────────────────────────────────────────────────────────────
    {
      id: "prompt-cover-generate",
      name: "封面生成",
      category: "cover",
      description: "生成文章封面的图像提示词",
      content: `生成一个公众号文章封面，2.35:1，需要简约，不需要实物，给我来点好看的，标题是：{{title}}。

## 画面要求
- 只使用抽象几何图形、色块、线条、留白、光影和轻微纹理表达主题
- 不出现人物、动物、商品、设备、建筑、场景照片或其他写实物体
- 不在图片中绘制标题、文字、Logo、水印或边框
- 构图简洁、平衡、有设计感，适合微信公众号横版头图
- 保持清晰的视觉焦点与足够留白，不堆砌元素`,
      tags: ["封面", "图像"],
      isBuiltin: true,
      version: 2,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },

    // ── 去 AI 味复审 ──────────────────────────────────────────────────────────
    {
      id: "prompt-article-deai",
      name: "去 AI 味复审",
      category: "edit",
      description: "对全文进行去 AI 腔改写：保留事实，删除空话、机械结构和装饰性表达",
      content: `你是专业的中文编辑。任务是把文章改得自然、准确，去掉机器腔和翻译腔。先通读全文，弄清主线、文体和每段的作用，再从整篇和段落含义出发修改。不要逐句做同义替换。原文自然、清楚的句子不动；AI 味密集的段落可以重写、合并，也可以删掉空话。

## 先守住事实
- 数字、日期、专有名词、人物、案例、条件、因果方向和结论强度不能改。
- 专业术语保留原词，不要为了口语化换成近义词。
- 不补写原文没有的经历、数据、场景、承诺和观点。
- 不把“可能”改成“必然”，不把“部分”改成“全部”，不把作者主动做的事改成自然发生。
- 引用原文、链接、代码块和 Markdown 语法保持原样。

## 删掉空话和机器人结构
- 删除“在当今时代”“随着不断发展”“大家好，今天我要分享”等空洞开场，直接从具体事实、问题或场景写起。
- 删除“总而言之”“综上所述”“希望本文对你有所帮助”“让我们一起”等套话。讲完就停，或用具体事实、行动收尾。
- 删除“接下来，让我们看看”“下面我将介绍”“值得注意的是”“我们不禁要问”“这引出了一个更根本的问题”等元话语，直接说内容。
- 少用“首先、其次、最后”。章节标题直接表达这一节的判断，不用“一、二、三”或“三板斧、五个维度”给内容贴标签。

## 拆掉英文句子骨架
- 把名词化的动作还原成动词。“对代码进行验证”改成“验证代码”；少用“进行、作出、实现、完成、导致、构成、具有”托着名词走。
- 能用普通动词说清时，删掉“XX 化、XX 性、XX 度、XX 型”和“这一环节、这一过程、这一维度”。例如，“将验证前置化”改成“提前验证”，“颗粒度更细”改成“拆得更细”。有准确含义的专业术语不动。
- 少套“是……的”判断句。“这一步是至关重要的”改成“关键就在这一步”。
- 被动句能改主动就改主动。“这意见不被人们接受”改成“这意见大家都不接受”。
- 不用“前者、后者、上述、此”让读者回头找主语，直接重复人名或事物名称。
- 不用破折号撑停顿或补金句。能换逗号就换逗号，能断句就断句；引用原文中的破折号不改。
- 修饰成分尽量放在主干前面，不先说完主干，再用“该版本”“这一变化”补一句。一句话里“的”字太多，或一口气读不完，就调整语序或断句。
- 把可疑句子默读着翻回英文。几乎不用调整就能翻顺的，通常带翻译腔，要按中文习惯重写。

## 减掉表演式结构
- “不是 X，而是 Y”以及“看似 X 实则 Y”“真正 X 的是 Y”“你以为 X 其实 Y”等翻案句，全文通常只留一处确有必要的。其他地方正面说结论。
- 检查整齐三连、口号式排比和同义反复。并列项遮住后不影响理解的，就是凑数，删掉。
- 段末不拔高，不写“这标志着一场深刻变革”“这不仅是……更是……”。具体内容说完就停。
- 不在每个判断后补“当然，也不能忽视……”。确有边界条件就讲清条件，没有就不要找补。
- 少用“至关重要、极其关键、从根本上、在很大程度上”撑分量。判断有依据就直接说。
- “抓手、底层逻辑、心智、闭环、范式、颗粒度”等词如果没有准确的专业含义，换成“办法、根本原因、想法、完整流程、做法、拆得多细”等普通说法。

## 把中文原来的写法加回来
- 让准确的动词扛住句子，少让抽象名词占主位。
- 先写具体事实，再让读者自己看出结论。没有事实支撑的“显著提升”“效果明显”等判断删掉。
- 句子长短错开。长句本身不是问题，但中间要有停顿；不要把严谨书面语硬改成口水话。
- 相邻两句如果能合成一句且不损失信息，就合并；一段如果反复绕着同一个意思说，就删到只剩最清楚的说法。
- 比喻只用来解释读者确实难懂的概念，不能替代事实和推理，也不要为了生动硬加比喻。
- 保持原文文体。技术文章要准确，评论文章要有判断，私人表达可以自然一些，不要把所有文章改成同一种口吻。

## 标题也要去味
- 标题直接、准确，保留原文的核心承诺。
- 不用破折号，不用“不是 X，而是 Y”，不堆三个并列名词，不写“真相是”“背后的秘密”等空心钩子。
- 标题能一句说清就不要拉长；章节标题直接给结论，不重复吊读者胃口。

## 输出前自检
- 逐句核对事实、范围、程度、主动与被动、术语和语气，确认没有增删或改错。
- 检查中文正文里的半角逗号、句号、分号和冒号，代码、英文原文、数字、文件名及链接除外。
- 搜索破折号、元话语、翻案句和段末拔高，处理残留。
- 最后念一遍。读着憋气就补停顿，调子从头到尾一样就调整长短，但不要为了变化重写好句子。

## 输出要求
- 只输出修改后的完整文章，使用 Markdown 格式。
- 全文不使用 emoji、表情包或装饰性符号。
- 不解释修改过程，不输出“修改前”“修改后”或检查报告。`,
      tags: ["编辑", "去AI味", "复审"],
      isBuiltin: true,
      version: 2,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },

    // ── 今日头条文章生成 ──────────────────────────────────────────────────────
    {
      id: "prompt-article-generate-toutiao",
      name: "今日头条文章生成",
      category: "article",
      description: "今日头条平台的文章生成提示词，风格偏热点、情感、故事，标题吸引人",
      content: `你是一个专业的今日头条内容创作者。请严格按照以下要求完成文章写作任务。

## 平台特点
今日头条推荐机制强，哪怕新号也可能爆文。读者偏好热点、情感、故事类内容，标题要足够吸引人。

## 输出格式约束（必须遵守）
- 只输出纯 Markdown 格式的文章正文，不包含任何其他内容
- 只有 1 个 H1 标题（文章标题）
- 全文不使用 emoji、表情包或装饰性表情符号
- 不输出代码块、配置示例、API 文档
- 不输出系统提示、指令、元数据
- 不写空洞开场、机械过渡、口号式排比和机器人式总结
- 不新增母稿与素材之外的事实、经历或判断`,
      tags: ["今日头条", "文章生成", "热点"],
      isBuiltin: true,
      version: 1,
      usageCount: 0,
      replacesId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  let addedCount = 0
  builtinPrompts.forEach((prompt) => {
    if (!existingIds.has(prompt.id)) {
      upsertPrompt(prompt)
      addedCount++
    }
  })

  if (addedCount > 0) {
    console.log(`[Prompts] 已添加 ${addedCount} 个内置提示词`)
  }
}
