import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { ARTICLE_BACKUP_DIR } from "./config.ts"
import {
  normalizeArticleWorkflow,
  type ArticleWorkflow,
  type ArticleWorkflowContent,
  type ArticleWorkflowEvent,
} from "../shared/articleWorkflow.ts"

export class ArticleContentConflictError extends Error {
  readonly statusCode = 409
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
  return normalizeArticleWorkflow(stored, content, createdAt)
}

export function recordArticleWorkflowEvent(input: {
  articlePath: string
  content: ArticleWorkflowContent
  event: ArticleWorkflowEvent
  at?: string
}): ArticleWorkflow {
  const now = input.at || new Date().toISOString()
  const workflow = readArticleWorkflow(input.articlePath, input.content, now)
  if (input.event === "generated" && !workflow.firstGeneratedAt) workflow.firstGeneratedAt = now
  if (input.event === "generated") {
    delete workflow.lastReviewedAt
    delete workflow.wechatDraftOpenedAt
    delete workflow.wechatDraftAt
  }
  if (input.event === "reviewed") workflow.lastReviewedAt = now
  if (input.event === "wechat_draft_opened") workflow.wechatDraftOpenedAt = now
  if (input.event === "wechat_draft_pushed") workflow.wechatDraftAt = now
  workflow.updatedAt = now
  workflow.currentStage = normalizeArticleWorkflow(workflow, input.content, workflow.createdAt).currentStage

  const workflowPath = getArticleSidecarPath(input.articlePath, "article_workflow", "json")
  fs.mkdirSync(path.dirname(workflowPath), { recursive: true })
  const tempPath = `${workflowPath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tempPath, JSON.stringify(workflow, null, 2), "utf8")
    fs.renameSync(tempPath, workflowPath)
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
  }
  return workflow
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
