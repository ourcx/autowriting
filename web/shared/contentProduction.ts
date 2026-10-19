export type PublishingPlatform = "wechat" | "toutiao" | "xiaohongshu"

export type WritingDnaLayer =
  | "language"
  | "structure"
  | "angle"
  | "material"
  | "cognition"
  | "visual"

export type CreatorFeedbackLayer = WritingDnaLayer | "general"

export const WRITING_DNA_LAYER_LABELS: Record<WritingDnaLayer, string> = {
  language: "词句与节奏",
  structure: "篇章结构",
  angle: "切入视角",
  material: "素材选择",
  cognition: "观点与判断",
  visual: "图文与视觉",
}

export const ARTICLE_WRITING_BASELINE = `# 中文成文底线
- 全文禁止使用 emoji、表情包和装饰性符号，标题与各级小标题也不例外。
- 保留素材中的事实、数字、专有名词、关系、条件、因果方向和结论强度；没有依据的经历、数据、人物与判断不得补写。
- 专业术语保留原词，不为追求口语化替换成含义相近但不等价的说法。
- 从具体事实、问题或场景进入正文，不写“在当今时代”“随着不断发展”“大家好”等空洞开场。
- 删除“总而言之”“综上所述”“希望本文对你有所帮助”“让我们一起”等机器人式收尾。
- 少用“首先、其次、最后”“值得注意的是”“不得不说”等机械过渡。章节标题直接表达本节判断，不用“一、二、三”或“三板斧、五个维度”给内容贴标签。
- 避免连续使用“不是……而是……”及“看似……实则……”“真正……的是……”等翻案句，也不要凑整齐三连句、口号式排比。能一句说清的，不扩成三句。
- 优先使用准确动词和具体事实，少用“赋能、深度、全面、显著提升”等没有证据的抽象表达。
- 不为生动而编造比喻。比喻只用于解释确实难懂的概念，不能代替事实和推理。

# 不用英文骨架写中文
- 把名词化的动作还原成动词。“对代码进行验证”写成“验证代码”，少用“进行、作出、实现、完成、导致、构成、具有”托着名词走。
- 能用普通动词说清时，删掉“XX 化、XX 性、XX 度、XX 型”和“这一环节、这一过程、这一维度”；有准确含义的专业术语不动。
- 少套“是……的”判断句。被动句能改主动就改主动，不用“前者、后者、上述、此”让读者回头找主语。
- 不用破折号撑停顿或补金句。修饰成分尽量放在主干前面；一句话里“的”字太多，或一口气读不完，就调整语序或断句。
- 段末不拔高，不写“这标志着一场深刻变革”“这不仅是……更是……”，也不在每个判断后补“当然，也不能忽视……”。
- “抓手、底层逻辑、心智、闭环、范式、颗粒度”等词没有准确专业含义时，换成普通说法或直接讲清所指。
- 先写具体事实，再让读者自己看出结论。句子长短错开，长句留出停顿，但不要把严谨书面语硬改成口水话。
- 输出前通读全文，核对事实、结构、套话和节奏。把可疑句子默读着翻回英文，几乎不用调整就能翻顺的，按中文习惯重写。只输出最终正文，不解释修改过程。`

export interface CreatorWritingProfile {
  audience: string
  stance: string
  tone: string
  languageStyle: string
  bannedPhrases: string[]
  preferredStructure: string
  anglePreference: string
  materialPreference: string
  defaultPlatforms: PublishingPlatform[]
  visualStyle: string
}

export const EMPTY_CREATOR_WRITING_PROFILE: CreatorWritingProfile = {
  audience: "",
  stance: "",
  tone: "",
  languageStyle: "",
  bannedPhrases: [],
  preferredStructure: "",
  anglePreference: "",
  materialPreference: "",
  defaultPlatforms: ["wechat"],
  visualStyle: "",
}

const PLATFORM_SET = new Set<PublishingPlatform>(["wechat", "toutiao", "xiaohongshu"])

function text(value: unknown, maxLength = 300): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

export function normalizeCreatorWritingProfile(value: unknown): CreatorWritingProfile {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const bannedPhrases = Array.isArray(source.bannedPhrases)
    ? source.bannedPhrases.flatMap(item => {
        const phrase = text(item, 40)
        return phrase ? [phrase] : []
      }).slice(0, 30)
    : typeof source.bannedPhrases === "string"
      ? source.bannedPhrases.split(/[，,、\n]/).map(item => item.trim()).filter(Boolean).slice(0, 30)
      : []
  const defaultPlatforms = Array.isArray(source.defaultPlatforms)
    ? [...new Set(source.defaultPlatforms.filter((item): item is PublishingPlatform => PLATFORM_SET.has(item as PublishingPlatform)))]
    : []
  return {
    audience: text(source.audience),
    stance: text(source.stance),
    tone: text(source.tone),
    languageStyle: text(source.languageStyle, 800),
    bannedPhrases,
    preferredStructure: text(source.preferredStructure, 500),
    anglePreference: text(source.anglePreference, 500),
    materialPreference: text(source.materialPreference, 500),
    defaultPlatforms: defaultPlatforms.length ? defaultPlatforms : ["wechat"],
    visualStyle: text(source.visualStyle),
  }
}

export function getCompletedWritingDnaLayers(profile: CreatorWritingProfile): WritingDnaLayer[] {
  const completion: Record<WritingDnaLayer, boolean> = {
    language: Boolean(profile.tone || profile.languageStyle || profile.bannedPhrases.length),
    structure: Boolean(profile.preferredStructure),
    angle: Boolean(profile.anglePreference),
    material: Boolean(profile.materialPreference),
    cognition: Boolean(profile.stance),
    visual: Boolean(profile.visualStyle),
  }
  return (Object.keys(completion) as WritingDnaLayer[]).filter(layer => completion[layer])
}

export function formatCreatorProfileForPrompt(profile: CreatorWritingProfile): string {
  const layers = [
    {
      title: "L1 词句与节奏",
      rows: [
        profile.tone && `- 语气：${profile.tone}`,
        profile.languageStyle && `- 句式、节奏与标点：${profile.languageStyle}`,
        profile.bannedPhrases.length && `- 禁用表达：${profile.bannedPhrases.join("、")}`,
      ].filter(Boolean),
    },
    {
      title: "L2 篇章结构",
      rows: [profile.preferredStructure && `- 常用结构：${profile.preferredStructure}`].filter(Boolean),
    },
    {
      title: "L3 切入视角",
      rows: [profile.anglePreference && `- 常用切入：${profile.anglePreference}`].filter(Boolean),
    },
    {
      title: "L4 素材选择",
      rows: [profile.materialPreference && `- 素材偏好：${profile.materialPreference}`].filter(Boolean),
    },
    {
      title: "L5 观点与判断",
      rows: [profile.stance && `- 长期立场：${profile.stance}`].filter(Boolean),
    },
    {
      title: "L6 图文与视觉",
      rows: [profile.visualStyle && `- 视觉倾向：${profile.visualStyle}`].filter(Boolean),
    },
  ].filter(layer => layer.rows.length)
  if (!layers.length && !profile.audience) return ""
  return `
# 账号写作 DNA
适用情境：${profile.audience ? `主要读者为${profile.audience}` : "以本篇任务指定的读者为准"}。
${layers.map(layer => `## ${layer.title}\n${layer.rows.join("\n")}`).join("\n")}

这些是长期偏好，只在当前情境适用时采用。本篇任务和素材优先。缺少作者观点或真实经历时明确指出，不得代替作者编造。
`
}

const EMOJI_PATTERN = /(?:[#*0-9]\uFE0F?\u20E3)|(?:\p{Regional_Indicator}|\p{Emoji_Modifier})|(?:\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0E|\uFE0F)?)*)/gu

export function stripEmoji(value: string): string {
  return value
    .replace(EMOJI_PATTERN, "")
    .replace(/(?:\u200D|\u20E3|\uFE0E|\uFE0F)/g, "")
}

function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export interface PlatformVersionComparison {
  sourceCharacters: number
  targetCharacters: number
  lengthDeltaPercent: number
  sharedParagraphPercent: number
  changed: boolean
}

export function comparePlatformVersions(source: string, target: string): PlatformVersionComparison {
  const sourcePlain = plainText(source)
  const targetPlain = plainText(target)
  const sourceParagraphs = source.split(/\n\s*\n/).map(plainText).filter(item => item.length >= 8)
  const targetParagraphs = new Set(target.split(/\n\s*\n/).map(plainText).filter(item => item.length >= 8))
  const shared = sourceParagraphs.filter(item => targetParagraphs.has(item)).length
  const sourceCharacters = Array.from(sourcePlain).length
  const targetCharacters = Array.from(targetPlain).length
  return {
    sourceCharacters,
    targetCharacters,
    lengthDeltaPercent: sourceCharacters
      ? Math.round(((targetCharacters - sourceCharacters) / sourceCharacters) * 100)
      : 0,
    sharedParagraphPercent: sourceParagraphs.length ? Math.round((shared / sourceParagraphs.length) * 100) : 0,
    changed: sourcePlain !== targetPlain,
  }
}

export interface SourceAuditResult {
  sources: Array<{ label: string; url: string }>
  claims: Array<{ text: string; supported: boolean }>
  unsupportedCount: number
}

function normalizeEvidence(value: string): string {
  return value.replace(/[\s,，。％%年月日:：]/g, "").toLowerCase()
}

export function auditArticleSources(article: string, materials: string): SourceAuditResult {
  const sources: Array<{ label: string; url: string }> = []
  const seen = new Set<string>()
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)\]}>]+)/g
  for (const match of materials.matchAll(linkPattern)) {
    const url = match[2] || match[3]
    if (!url || seen.has(url)) continue
    seen.add(url)
    let hostname = "来源链接"
    try { hostname = new URL(url).hostname || hostname } catch { /* 保留通用标签 */ }
    sources.push({ label: (match[1] || hostname).slice(0, 80), url })
  }

  const materialEvidence = normalizeEvidence(materials)
  const sentences = plainText(article).split(/(?<=[。！？!?；;])|\n/).map(item => item.trim()).filter(Boolean)
  const claims = sentences.flatMap(sentence => {
    const tokens = sentence.match(/\d+(?:\.\d+)?(?:%|％|万|亿|元|人|个|次|年|月|日|小时|分钟)?/g) || []
    if (!tokens.length) return []
    const supported = tokens.every(token => materialEvidence.includes(normalizeEvidence(token)))
    return [{ text: sentence.slice(0, 160), supported }]
  }).slice(0, 20)
  return { sources, claims, unsupportedCount: claims.filter(claim => !claim.supported).length }
}
