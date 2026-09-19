import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { ARTICLE_BACKUP_DIR, DRAFTS_DIR } from "./config.ts"
import {
  normalizeArticleWorkflow,
  type ArticleWorkflow,
  type ArticleWorkflowContent,
  type ArticleWorkflowEvent,
} from "../shared/articleWorkflow.ts"

export class ArticleContentConflictError extends Error {
  readonly statusCode = 409
}

// All production metadata uses the same user-owned draft directory as the text.
export function resolveArticleFiles(userId: string, articleId: string) {
  for (const part of [userId, articleId]) {
    if (typeof part !== "string" || !part || part.length > 160 || /[/\\\0]/.test(part) || part.includes("..")) {
      throw new ArticleContentConflictError("文章标识不正确")
    }
  }
  const base = path.join(DRAFTS_DIR, userId)
  const direct = path.join(base, articleId)
  const [date, ...parts] = articleId.split("-")
  const suffix = parts.length ? `-${parts.join("-")}` : ""
  const dir = fs.existsSync(direct) ? direct : path.join(base, date)
  const fileSuffix = fs.existsSync(direct) ? "" : suffix
  const files = {
    task: path.join(dir, "prompt", `task${fileSuffix}.md`),
    materials: path.join(dir, "prompt", `materials${fileSuffix}.md`),
    article: path.join(dir, "raw", `article_raw${fileSuffix}.md`),
    title: path.join(dir, `title${fileSuffix}.txt`),
  }
  // Reject symlink escapes, including existing leaf files, before any write.
  for (const file of Object.values(files)) {
    let existing = file
    while (!fs.existsSync(existing) && existing !== path.dirname(existing)) existing = path.dirname(existing)
    const real = fs.realpathSync(existing)
    let root = DRAFTS_DIR
    while (!fs.existsSync(root) && root !== path.dirname(root)) root = path.dirname(root)
    const expected = path.resolve(fs.realpathSync(root), path.relative(root, existing))
    if (real !== expected) throw new ArticleContentConflictError("文章路径不正确")
  }
  return files
}

export function readArticleContent(articlePath: string): ArticleWorkflowContent {
  const rawName = path.basename(articlePath)
  const directory = path.dirname(path.dirname(articlePath))
  const read = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  return {
    article: read(articlePath),
    task: read(path.join(directory, "prompt", rawName.replace("article_raw", "task"))),
    materials: read(path.join(directory, "prompt", rawName.replace("article_raw", "materials"))),
  }
}

export function findArticleIdByTitle(userId: string, title: string): string | undefined {
  const userDir = path.join(DRAFTS_DIR, userId)
  if (!fs.existsSync(userDir)) return undefined
  const normalized = title.replace(/^#+\s*/, "").trim()
  const matches: string[] = []
  for (const directoryName of fs.readdirSync(userDir).filter(name => /^\d{8}/.test(name))) {
    const directory = path.join(userDir, directoryName)
    if (!fs.statSync(directory).isDirectory()) continue
    const titleFiles = fs.readdirSync(directory).filter(name => /^title.*\.txt$/.test(name))
    for (const name of titleFiles) {
      if (fs.readFileSync(path.join(directory, name), "utf8").trim() !== normalized) continue
      const suffix = name.slice("title".length, -".txt".length)
      matches.push(name === "title.txt" ? directoryName : `${directoryName.slice(0, 8)}${suffix}`)
    }
    const rawDirectory = path.join(directory, "raw")
    if (!fs.existsSync(rawDirectory)) continue
    for (const name of fs.readdirSync(rawDirectory).filter(name => /^article_raw.*\.md$/.test(name))) {
      const firstLine = fs.readFileSync(path.join(rawDirectory, name), "utf8").split("\n")[0]?.replace(/^#+\s*/, "").trim()
      if (firstLine !== normalized) continue
      const suffix = name.slice("article_raw".length, -".md".length)
      matches.push(suffix ? `${directoryName.slice(0, 8)}${suffix}` : directoryName)
    }
  }
  return [...new Set(matches)].length === 1 ? matches[0] : undefined
}

export function getArticleSidecarPath(
  articlePath: string,
  targetPrefix: string,
  extension = "md",
): string {
  const filename = path.basename(articlePath)
  if (!filename.startsWith("article_raw") || !filename.endsWith(".md")) {
    throw new Error(`无法从正文路径生成 ${targetPrefix} 路径`)
  }
  const suffix = filename.slice("article_raw".length, -".md".length)
  return path.join(path.dirname(articlePath), `${targetPrefix}${suffix}.${extension}`)
}

export function readArticleWorkflow(
  articlePath: string,
  content: ArticleWorkflowContent,
  createdAt?: string,
): ArticleWorkflow {
  const workflowPath = getArticleSidecarPath(articlePath, "article_workflow", "json")
  let stored: unknown = null
  try {
    if (fs.existsSync(workflowPath)) stored = JSON.parse(fs.readFileSync(workflowPath, "utf8"))
  } catch {
    stored = null
  }
  const rawName = path.basename(articlePath)
  const directory = path.dirname(path.dirname(articlePath))
  const times = [
    articlePath, path.join(directory, "prompt", rawName.replace("article_raw", "task")),
    path.join(directory, "prompt", rawName.replace("article_raw", "materials")),
  ].filter(file => fs.existsSync(file)).map(file => fs.statSync(file).birthtimeMs)
  const initial = times.length ? new Date(Math.min(...times)).toISOString() : createdAt
  return normalizeArticleWorkflow(stored, content, initial)
}

export function recordArticleWorkflowEvent(input: {
  articlePath: string
  content: ArticleWorkflowContent
  event: ArticleWorkflowEvent
  at?: string
  metadata?: {
    platforms?: Array<"wechat" | "toutiao">
    referenceArticleIds?: string[]
    promptIds?: string[]
    templateId?: string
  }
}): ArticleWorkflow {
  const now = input.at || new Date().toISOString()
  const workflow = readArticleWorkflow(input.articlePath, input.content, now)
  if (input.event === "generated" && !workflow.firstGeneratedAt) workflow.firstGeneratedAt = now
  if (input.event === "generated") {
    if (workflow.lastReviewedAt) workflow.reworkCount = (workflow.reworkCount || 0) + 1
    delete workflow.lastReviewedAt
    delete workflow.wechatDraftOpenedAt
    delete workflow.wechatDraftAt
    if (input.metadata) {
      workflow.generationContext = {
        platforms: input.metadata.platforms || workflow.generationContext?.platforms || [],
        referenceArticleIds: input.metadata.referenceArticleIds || workflow.generationContext?.referenceArticleIds || [],
        promptIds: input.metadata.promptIds || workflow.generationContext?.promptIds || [],
      }
    }
  }
  if (input.event === "reviewed") workflow.lastReviewedAt = now
  if (input.event === "wechat_draft_opened") workflow.wechatDraftOpenedAt = now
  if (input.event === "wechat_draft_pushed") {
    workflow.wechatDraftAt = now
    if (!workflow.firstWechatDraftAt) {
      if (workflow.activityTrackedAt) workflow.firstDraftActiveMs = workflow.activeEditingMs || 0
      workflow.firstDraftReworkCount = workflow.reworkCount || 0
    }
    workflow.firstWechatDraftAt ||= now
    if (input.metadata?.templateId) workflow.publishContext = { templateId: input.metadata.templateId }
  }
  workflow.updatedAt = now
  const normalized = normalizeArticleWorkflow(workflow, input.content, workflow.createdAt)

  saveArticleWorkflow(input.articlePath, normalized)
  return normalized
}

export function saveArticleWorkflow(articlePath: string, workflow: ArticleWorkflow): void {
  const workflowPath = getArticleSidecarPath(articlePath, "article_workflow", "json")
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true })
  const tempPath = `${workflowPath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(workflow, null, 2), "utf8")
    fs.renameSync(tempPath, workflowPath)
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
  }
}

export function writeArticleSafely(input: {
  articlePath: string
  articleId: string
  userId: string
  content: string
}): void {
  const existing = fs.existsSync(input.articlePath)
    ? fs.readFileSync(input.articlePath, "utf8")
    : ""
  if (existing.trim() && !input.content.trim()) {
    throw new ArticleContentConflictError("为保护原文，不能用空内容覆盖已有公众号正文")
  }
  if (existing === input.content) return

  if (existing) {
    const backupDir = path.join(ARTICLE_BACKUP_DIR, input.userId, input.articleId)
    fs.mkdirSync(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    fs.writeFileSync(
      path.join(backupDir, `${timestamp}-${crypto.randomUUID()}.md`),
      existing,
      "utf8",
    )
  }

  fs.mkdirSync(path.dirname(input.articlePath), { recursive: true })
  const tempPath = `${input.articlePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tempPath, input.content, "utf8")
    fs.renameSync(tempPath, input.articlePath)
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
  }
}
