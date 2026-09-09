export type PublishingPlatform = "wechat" | "toutiao" | "xiaohongshu"

export interface CreatorWritingProfile {
  audience: string
  stance: string
  tone: string
  bannedPhrases: string[]
  preferredStructure: string
  defaultPlatforms: PublishingPlatform[]
  visualStyle: string
}

export const EMPTY_CREATOR_WRITING_PROFILE: CreatorWritingProfile = {
  audience: "",
  stance: "",
  tone: "",
  bannedPhrases: [],
  preferredStructure: "",
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
    bannedPhrases,
    preferredStructure: text(source.preferredStructure, 500),
    defaultPlatforms: defaultPlatforms.length ? defaultPlatforms : ["wechat"],
    visualStyle: text(source.visualStyle),
  }
}

export function formatCreatorProfileForPrompt(profile: CreatorWritingProfile): string {
  const rows = [
    profile.audience && `- 目标读者：${profile.audience}`,
    profile.stance && `- 内容立场：${profile.stance}`,
    profile.tone && `- 语气：${profile.tone}`,
    profile.preferredStructure && `- 常用结构：${profile.preferredStructure}`,
    profile.visualStyle && `- 视觉倾向：${profile.visualStyle}`,
    profile.bannedPhrases.length && `- 禁用表达：${profile.bannedPhrases.join("、")}`,
  ].filter(Boolean)
  return rows.length ? `\n# 账号写作档案（在不冲突时遵守，本篇任务要求优先）\n${rows.join("\n")}\n` : ""
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
