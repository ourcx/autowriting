export type ArticleWorkspace = "editor" | "preview"

const DEFAULT_ARTICLE_SLUG = "untitled-article"
const MAX_SLUG_LENGTH = 80

export function slugifyArticleTitle(value: string, fallback = DEFAULT_ARTICLE_SLUG): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/['’]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "")

  return normalized || fallback
}

export function articleSlugFromId(articleId: string): string {
  const withoutStoragePrefix = articleId.replace(/^local:/i, "")
  const withoutDatePrefix = withoutStoragePrefix.replace(/^\d{8}(?:[-_]+)?/, "")
  return slugifyArticleTitle(withoutDatePrefix)
}

export function articleWorkspacePath(
  workspace: ArticleWorkspace,
  articleId: string,
  title?: string,
): string {
  const resource = workspace === "preview" ? "previews" : "articles"
  const slug = title?.trim() ? slugifyArticleTitle(title) : articleSlugFromId(articleId)
  return `/${resource}/${encodeURIComponent(articleId)}/${encodeURIComponent(slug)}`
}
