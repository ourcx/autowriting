export interface ArticleData {
  task: string
  materials: string
  article: string
  title: string
  articleToutiao: string
  xiaohongshuTitle: string
}

export function createEmptyArticleData(): ArticleData {
  return {
    task: "",
    materials: "",
    article: "",
    title: "",
    articleToutiao: "",
    xiaohongshuTitle: "",
  }
}

export function normalizeArticleData(value: unknown): ArticleData {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {}
  const empty = createEmptyArticleData()
  return Object.fromEntries(
    Object.keys(empty).map((key) => [key, typeof source[key] === "string" ? source[key] : ""]),
  ) as unknown as ArticleData
}

export function getLocalArticleStorageKey(articleId: string): string {
  return `local_article_data_${articleId}`
}

export function loadLocalArticleData(articleId: string): ArticleData {
  try {
    return normalizeArticleData(JSON.parse(localStorage.getItem(getLocalArticleStorageKey(articleId)) || "null"))
  } catch {
    return createEmptyArticleData()
  }
}
