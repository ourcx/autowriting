export interface YuanbaoArticle {
  url: string
  title: string
  source: string
  snippet: string
  content: string
}

export interface YuanbaoSearchResult {
  answer: string
  articles: YuanbaoArticle[]
}
