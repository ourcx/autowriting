import type { NextFunction, Response } from "express"
import type { AuthedRequest } from "./types.ts"

const MAX_ARTICLE_ID_LENGTH = 160

function containsUnsafeCharacter(articleId: string): boolean {
  if (articleId.includes("/") || articleId.includes("\\")) return true
  return Array.from(articleId).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

export function validateArticleId(req: AuthedRequest, res: Response, next: NextFunction): void {
  const articleId = req.params.articleId
  if (
    typeof articleId !== "string"
    || articleId.length === 0
    || articleId.length > MAX_ARTICLE_ID_LENGTH
    || articleId === "."
    || articleId === ".."
    || containsUnsafeCharacter(articleId)
  ) {
    res.status(400).json({ error: "文章 ID 格式不正确" })
    return
  }
  next()
}
