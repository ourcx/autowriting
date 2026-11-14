import { withRequestDeepSeekKey } from "./deepseekCredentials.ts"
import fs from "node:fs"
import path from "node:path"
import { DRAFTS_DIR, SERVER_AI_CONFIG } from "./config.ts"
import { readArticleContent, readArticleWorkflow } from "./articleStorage.ts"
import { createArticleModel } from "./utils/public.ts"
import { hasArticleApiKey } from "./utils/providerKeys.ts"
import {
  parseCreatorPersonaAnalysis,
  type CreatorPersona,
} from "../shared/contentProduction.ts"
import type { AIConfig } from "./types.ts"

const MAX_LOCAL_ARTICLES = 12
const MAX_PUBLISHED_ARTICLES = 20
const MAX_ARTICLE_CHARACTERS = 6000
const MAX_TOTAL_CHARACTERS = 48000

interface LocalPersonaArticle {
  id: string
  title: string
  content: string
  updatedAt: string
  sentToWechatDraft: boolean
}

export interface PublishedPersonaArticle {
  title: string
  digest: string
  publishedAt?: string
}

export interface PersonaAccountInfo {
  name: string
  description: string
  principal: string
}

export interface PersonaAnalysisInput {
  aiConfig?: unknown
  accountInfo?: unknown
  publishedArticles?: unknown
}

export interface PersonaAnalysisResult {
  persona: CreatorPersona
  sources: {
    localArticleCount: number
    publishedArticleCount: number
  }
}

export class PersonaAgentInputError extends Error {
  readonly statusCode = 400
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function normalizeAccountInfo(value: unknown): PersonaAccountInfo {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    name: cleanText(source.name, 120),
    description: cleanText(source.description, 1000),
    principal: cleanText(source.principal, 300),
  }
}

function normalizePublishedArticles(value: unknown): PublishedPersonaArticle[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const source = item as Record<string, unknown>
    const title = cleanText(source.title, 160)
    if (!title) return []
    return [{
      title,
      digest: cleanText(source.digest, 500),
      publishedAt: cleanText(source.publishedAt, 40) || undefined,
    }]
  }).slice(0, MAX_PUBLISHED_ARTICLES)
}

function readLocalPersonaArticles(userId: string): LocalPersonaArticle[] {
  if (!userId || /[/\\\0]/.test(userId) || userId.includes("..")) return []
  const userDirectory = path.join(DRAFTS_DIR, userId)
  if (!fs.existsSync(userDirectory)) return []
  const articles: LocalPersonaArticle[] = []

  for (const directoryEntry of fs.readdirSync(userDirectory, { withFileTypes: true })) {
    if (!directoryEntry.isDirectory() || !/^\d{8}/.test(directoryEntry.name)) continue
    const directory = path.join(userDirectory, directoryEntry.name)
    const rawDirectory = path.join(directory, "raw")
    if (!fs.existsSync(rawDirectory)) continue

    for (const articleEntry of fs.readdirSync(rawDirectory, { withFileTypes: true })) {
      if (!articleEntry.isFile() || !/^article_raw(?:-[A-Za-z0-9_-]+)?\.md$/.test(articleEntry.name)) continue
      const articlePath = path.join(rawDirectory, articleEntry.name)
      const content = readArticleContent(articlePath)
      if (content.article.trim().length < 200) continue
      const suffix = articleEntry.name.slice("article_raw".length, -".md".length)
      const articleId = suffix ? `${directoryEntry.name.slice(0, 8)}${suffix}` : directoryEntry.name
      const titlePath = path.join(directory, `title${suffix}.txt`)
      const firstLine = content.article.split("\n")[0]?.replace(/^#+\s*/, "").trim() || ""
      const title = fs.existsSync(titlePath)
        ? fs.readFileSync(titlePath, "utf8").trim() || firstLine
        : firstLine
      const workflow = readArticleWorkflow(articlePath, content)
      articles.push({
        id: articleId,
        title: title || `文章 ${articleId}`,
        content: content.article.trim().slice(0, MAX_ARTICLE_CHARACTERS),
        updatedAt: workflow.updatedAt,
        sentToWechatDraft: Boolean(workflow.wechatDraftAt),
      })
    }
  }

  return articles
    .sort((left, right) => {
      if (left.sentToWechatDraft !== right.sentToWechatDraft) return left.sentToWechatDraft ? -1 : 1
      return right.updatedAt.localeCompare(left.updatedAt)
    })
    .slice(0, MAX_LOCAL_ARTICLES)
}

function formatLocalArticles(articles: LocalPersonaArticle[]): string {
  let usedCharacters = 0
  const sections: string[] = []
  for (const article of articles) {
    const remaining = MAX_TOTAL_CHARACTERS - usedCharacters
    if (remaining <= 0) break
    const content = article.content.slice(0, remaining)
    usedCharacters += content.length
    sections.push(`## ${article.title}
本地稿件 ID：${article.id}
状态：${article.sentToWechatDraft ? "已写入公众号草稿箱" : "本地成稿"}

${content}`)
  }
  return sections.join("\n\n")
}

function formatPublishedArticles(articles: PublishedPersonaArticle[]): string {
  return articles.map(article => {
    const date = article.publishedAt ? `；发布时间：${article.publishedAt}` : ""
    return `- ${article.title}${date}${article.digest ? `；摘要：${article.digest}` : ""}`
  }).join("\n")
}

export async function analyzeCreatorPersona(
  userId: string,
  input: PersonaAnalysisInput,
  requestKey?: string,
): Promise<PersonaAnalysisResult> {
  const rawConfig = input.aiConfig
  if (rawConfig !== undefined && (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig))) {
    throw new PersonaAgentInputError("AI 配置不正确")
  }
  const config = withRequestDeepSeekKey({ ...SERVER_AI_CONFIG, ...(rawConfig as Partial<AIConfig> || {}) }, requestKey)
  if (!hasArticleApiKey(config)) throw new PersonaAgentInputError("请先配置文章生成模型的 API Key")

  const accountInfo = normalizeAccountInfo(input.accountInfo)
  const publishedArticles = normalizePublishedArticles(input.publishedArticles)
  const localArticles = readLocalPersonaArticles(userId)
  if (!localArticles.length && !publishedArticles.length) {
    throw new PersonaAgentInputError("没有可分析的历史文章，请先生成文章或连接可读取已发布列表的公众号")
  }

  const sourceTitles = [...new Set([
    ...publishedArticles.map(article => article.title),
    ...localArticles.map(article => article.title),
  ])].slice(0, 20)
  const sourceArticleCount = localArticles.length + publishedArticles.length
  const prompt = `请根据账号资料和历史文章，提炼一个可供后续写作使用的作者人设。

# 账号资料
- 名称：${accountInfo.name || "未提供"}
- 简介：${accountInfo.description || "未提供"}
- 主体信息：${accountInfo.principal || "未提供"}

# 公众号已发布文章列表
${formatPublishedArticles(publishedArticles) || "未获取到已发布列表"}

# 当前工作台中的历史成稿
${formatLocalArticles(localArticles) || "没有本地成稿"}

# 分析要求
1. 只根据给定资料总结，不补造年龄、学历、职业、公司、家庭、地点和个人经历。
2. personalExperiences 只写文章中明确以第一人称陈述、且能够确认属于作者的经历；没有证据就返回空字符串。
3. historicalArticles 总结长期主题、常见内容类型和代表性文章，不评价流量效果。
4. speakingStyle 描述作者平时如何说话和建立语气，不要复制长句，也不要与文章结构规则混为一谈。
5. accountInfo、expertise、values、audienceRelationship 和 otherNotes 都要区分事实与推断；证据不足就留空。
6. 返回一个 JSON 对象，不要 Markdown，不要解释。必须包含这些字符串字段：
accountName、accountInfo、personalExperiences、historicalArticles、speakingStyle、expertise、values、audienceRelationship、otherNotes。`

  const { complete } = createArticleModel(config)
  const response = await complete({
    messages: [
      {
        role: "system",
        content: "你是账号人设分析 Agent。你的职责是从证据中提炼稳定身份与表达特征，明确区分事实、归纳和未知信息，绝不编造人物经历。",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 2500,
    stream: false,
  })
  const content = response.data.choices[0]?.message?.content
  if (!content) throw new Error("人设分析没有返回内容")
  return {
    persona: parseCreatorPersonaAnalysis(content, {
      accountName: accountInfo.name,
      sourceArticleCount,
      sourceArticleTitles: sourceTitles,
    }),
    sources: {
      localArticleCount: localArticles.length,
      publishedArticleCount: publishedArticles.length,
    },
  }
}
