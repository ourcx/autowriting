/**
 * 智能网络搜索与素材收集工具
 *
 * 功能：
 * 1. LLM 生成搜索计划（关键词 + 爬取目标 + 清洗规则）
 * 2. 执行 Bing Search API 聚合搜索
 * 3. 爬取指定 URL 获取详细内容
 * 4. 清洗和整理素材数据
 * 5. 生成结构化素材数据集
 */

import { buildLLMRequest, callLLMWithRetry } from "./public.ts"
import { nowDay } from "./date.ts"
import { logger } from "../logger.ts"
import type { AIConfig, SearchPlan, SearchItem, CrawlResult, MaterialsDataset } from "../types.ts"

// ── 1. LLM 生成搜索计划 ────────────────────────────────────────────────────────

/**
 * 使用 LLM 生成智能搜索计划
 */
export async function generateSearchPlan(topic: string, aiConfig: AIConfig): Promise<SearchPlan> {
  const { url, model, headers } = buildLLMRequest(aiConfig)
  const today = nowDay()

  const systemPrompt = `你是一个专业的信息检索专家，擅长设计高效的搜索策略。
你的任务是根据文章主题，生成一个详细的搜索和采集计划。

输出格式必须是纯 JSON，不要任何解释文字，格式如下：
{
  "search_queries": ["关键词1", "关键词2"],
  "crawl_targets": [
    {
      "url": "https://example.com/page",
      "reason": "为什么要爬这个页面",
      "extract_hint": "提取什么内容（标题/正文/表格/数据等）"
    }
  ],
  "clean_scripts": ["去除HTML标签", "统一日期格式", "去重"],
  "max_results": 10,
  "priority": "timeliness"
}`

  const userPrompt = `今天是 ${today}

文章主题：${topic}

请为这个主题生成一个搜索计划：

1. **search_queries**（3-5个关键词）：
   - 包含时间范围（如 "2026-07" "最近" "最新"）
   - 包含领域关键词（AI、大模型、融资、技术等）
   - 适合搜索引擎的格式

2. **crawl_targets**（0-3个特定URL，可选）：
   - 只在需要权威数据源时提供（如政府统计、知名机构报告）
   - 提供 url、reason、extract_hint

3. **clean_scripts**（数据清洗规则）：
   - 从以下选项中选择：["strip_html", "deduplicate", "extract_numbers", "unify_dates", "remove_ads"]

4. **max_results**：每个搜索词返回的最大结果数（建议 5-10）

5. **priority**：优先级，可选值：
   - "timeliness" - 时效性优先（新闻、热点）
   - "authority" - 权威性优先（研究报告、官方数据）
   - "diversity" - 多样性优先（多角度观点）

只输出 JSON，不要任何其他文字。`

  try {
    const resp = await callLLMWithRetry(url, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }, headers)

    const content = resp.data.choices[0].message.content.trim()

    // 清理可能的 markdown 代码块标记
    const jsonStr = content
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim()

    const plan = JSON.parse(jsonStr) as SearchPlan

    // 验证必需字段
    if (!plan.search_queries || !Array.isArray(plan.search_queries)) {
      throw new Error("搜索计划缺少 search_queries 字段")
    }

    // 设置默认值
    plan.crawl_targets = plan.crawl_targets || []
    plan.clean_scripts = plan.clean_scripts || ["strip_html", "deduplicate"]
    plan.max_results = plan.max_results || 10
    plan.priority = plan.priority || "timeliness"

    logger.info("SEARCH", "搜索计划已生成", {
      queries: plan.search_queries.length,
      targets: plan.crawl_targets.length,
    })

    return plan
  } catch (err: unknown) {
    const e = err as Error
    logger.error("SEARCH", "生成搜索计划失败", { error: e.message })
    throw new Error(`生成搜索计划失败: ${e.message}`)
  }
}

// ── 2. 执行搜索 ────────────────────────────────────────────────────────────────

interface SearchOptions {
  count?: number
  freshness?: string
  mkt?: string
}

/**
 * 执行 Bing Search API 搜索（支持时效性过滤）
 */
export async function searchBing(query: string, apiKey: string, options: SearchOptions = {}): Promise<SearchItem[]> {
  const {
    count = 10,
    freshness = "Day",  // Day / Week / Month / Year
    mkt = "zh-CN",
  } = options

  if (!apiKey) {
    throw new Error("未配置 Bing API Key")
  }

  try {
    const params = new URLSearchParams({
      q: query,
      mkt,
      count: String(count),
      responseFilter: "WebPages",
    })

    // 添加时效性过滤（针对新闻和热点）
    if (freshness) {
      params.append("freshness", freshness)
    }

    const resp = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?${params}`,
      {
        headers: { "Ocp-Apim-Subscription-Key": apiKey },
        signal: AbortSignal.timeout(15000),
      }
    )

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Bing API 错误 ${resp.status}: ${errText.slice(0, 200)}`)
    }

    const data = await resp.json() as {
      webPages?: { value?: Array<{
        name?: string
        snippet?: string
        url?: string
        datePublished?: string
      }> }
    }
    const webPages = data.webPages?.value || []

    const results: SearchItem[] = webPages.map((item) => ({
      title: item.name || "",
      snippet: item.snippet || "",
      url: item.url || "",
      source: extractDomain(item.url || ""),
      datePublished: item.datePublished || null,
    }))

    logger.debug("SEARCH", `Bing 搜索完成: ${query}`, { count: results.length })
    return results
  } catch (err: unknown) {
    const e = err as Error
    logger.error("SEARCH", "Bing 搜索失败", { query, error: e.message })
    throw err
  }
}

/**
 * 批量执行多个搜索查询
 */
export async function executeSearchBatch(queries: string[], apiKey: string, options: SearchOptions = {}): Promise<SearchItem[]> {
  const allResults: SearchItem[] = []

  for (const query of queries) {
    try {
      const results = await searchBing(query, apiKey, options)
      allResults.push(...results)

      // 限流：避免触发 Bing API 的 QPS 限制（3次/秒）
      await new Promise((resolve) => setTimeout(resolve, 350))
    } catch (err: unknown) {
      const e = err as Error
      logger.warn("SEARCH", `搜索失败，跳过: ${query}`, { error: e.message })
    }
  }

  // 去重（同一 URL 只保留第一次出现）
  const uniqueResults: SearchItem[] = []
  const seenUrls = new Set<string>()

  for (const result of allResults) {
    if (!seenUrls.has(result.url)) {
      seenUrls.add(result.url)
      uniqueResults.push(result)
    }
  }

  logger.info("SEARCH", "批量搜索完成", {
    queries: queries.length,
    total: allResults.length,
    unique: uniqueResults.length,
  })

  return uniqueResults
}

// ── 3. 爬取 URL ────────────────────────────────────────────────────────────────

/**
 * 爬取单个 URL 的详细内容
 */
export async function crawlUrl(url: string, jinaApiKey = ""): Promise<string> {
  try {
    // 优先使用 Jina Reader（更干净的提取）
    if (jinaApiKey) {
      try {
        const content = await fetchJinaText(url, jinaApiKey)
        logger.debug("SEARCH", `Jina 爬取成功: ${url}`)
        return content
      } catch (jinaErr: unknown) {
        const e = jinaErr as Error
        logger.warn("SEARCH", `Jina 失败，降级直接爬取: ${e.message}`)
      }
    }

    // 降级：直接 fetch
    const content = await fetchDirectText(url)
    logger.debug("SEARCH", `直接爬取成功: ${url}`)
    return content
  } catch (err: unknown) {
    const e = err as Error
    logger.error("SEARCH", `爬取失败: ${url}`, { error: e.message })
    return ""
  }
}

/**
 * 批量爬取多个 URL（并发限制）
 */
export async function crawlUrlsBatch(
  targets: Array<{ url: string; reason: string; extract_hint: string }>,
  jinaApiKey = ""
): Promise<CrawlResult[]> {
  const CONCURRENCY = 3
  const results: CrawlResult[] = []

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(async (target) => {
        const content = await crawlUrl(target.url, jinaApiKey)
        return {
          url: target.url,
          reason: target.reason,
          extract_hint: target.extract_hint,
          content,
          ok: content.length > 0,
        }
      })
    )

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j]
      if (r.status === "fulfilled") {
        results.push(r.value)
      } else {
        results.push({
          url: batch[j].url,
          reason: batch[j].reason,
          extract_hint: batch[j].extract_hint,
          content: "",
          ok: false,
          error: (r.reason as Error)?.message || "爬取失败",
        })
      }
    }

    // 限流
    if (i + CONCURRENCY < targets.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  logger.info("SEARCH", "批量爬取完成", {
    targets: targets.length,
    success: results.filter((r) => r.ok).length,
  })

  return results
}

// ── 4. 数据清洗 ────────────────────────────────────────────────────────────────

/**
 * 清洗素材数据
 */
export function cleanMaterials(rawData: SearchItem[], scripts: string[] = []): SearchItem[] {
  let cleaned: SearchItem[] = [...rawData]

  for (const script of scripts) {
    switch (script) {
      case "strip_html":
        cleaned = cleaned.map((item) => ({
          ...item,
          snippet: item.snippet ? stripHtml(item.snippet) : item.snippet,
          content: item.content ? stripHtml(item.content) : item.content,
        }))
        break

      case "deduplicate":
        cleaned = deduplicateByUrl(cleaned)
        break

      case "extract_numbers":
        cleaned = cleaned.map((item) => ({
          ...item,
          extracted_data: extractNumbers(item.content || item.snippet || ""),
        }))
        break

      case "unify_dates":
        cleaned = cleaned.map((item) => ({
          ...item,
          datePublished: item.datePublished ? unifyDate(item.datePublished) : null,
        }))
        break

      case "remove_ads":
        cleaned = cleaned.filter((item) => !isAd(item.title, item.snippet))
        break

      default:
        logger.warn("SEARCH", `未知的清洗脚本: ${script}`)
    }
  }

  logger.info("SEARCH", "数据清洗完成", {
    before: rawData.length,
    after: cleaned.length,
    scripts: scripts.join(", "),
  })

  return cleaned
}

// ── 5. 主入口：智能素材收集 ────────────────────────────────────────────────────

interface SearchConfig {
  bingApiKey: string
  jinaApiKey?: string
}

/**
 * 智能素材收集主流程
 */
export async function collectMaterials(topic: string, aiConfig: AIConfig, searchConfig: SearchConfig = { bingApiKey: "" }): Promise<MaterialsDataset> {
  const { bingApiKey, jinaApiKey = "" } = searchConfig

  try {
    // Step 1: LLM 生成搜索计划
    logger.info("SEARCH", "开始生成搜索计划", { topic })
    const plan = await generateSearchPlan(topic, aiConfig)

    // Step 2: 执行搜索
    logger.info("SEARCH", "开始执行搜索", { queries: plan.search_queries })

    const searchOptions = {
      count: plan.max_results,
      freshness: plan.priority === "timeliness" ? "Day" : "Week",
    }

    const searchResults = await executeSearchBatch(
      plan.search_queries,
      bingApiKey,
      searchOptions
    )

    // Step 3: 爬取指定 URL
    let crawledContents: CrawlResult[] = []
    if (plan.crawl_targets.length > 0) {
      logger.info("SEARCH", "开始爬取指定 URL", { targets: plan.crawl_targets.length })
      crawledContents = await crawlUrlsBatch(plan.crawl_targets, jinaApiKey)
    }

    // Step 4: 清洗数据
    logger.info("SEARCH", "开始清洗数据", { scripts: plan.clean_scripts })
    const allRawData: SearchItem[] = [
      ...searchResults,
      ...crawledContents.map((c) => ({
        title: `[爬取] ${c.reason}`,
        url: c.url,
        content: c.content,
        source: extractDomain(c.url),
        snippet: "",
        datePublished: null,
      })),
    ]

    const cleaned = cleanMaterials(allRawData, plan.clean_scripts)

    // Step 5: 生成结构化素材数据集
    const dataset: MaterialsDataset = {
      topic,
      generatedAt: new Date().toISOString(),
      plan,
      searchResults: cleaned.slice(0, plan.max_results * plan.search_queries.length),
      crawledContents: crawledContents.filter((c) => c.ok),
      summary: {
        totalItems: cleaned.length,
        searchQueries: plan.search_queries.length,
        crawledUrls: crawledContents.filter((c) => c.ok).length,
      },
    }

    logger.info("SEARCH", "素材收集完成", dataset.summary)
    return dataset
  } catch (err: unknown) {
    const e = err as Error
    logger.error("SEARCH", "素材收集失败", { topic, error: e.message })
    throw err
  }
}

/**
 * 格式化素材数据集为 Markdown
 */
export function formatMaterialsAsMarkdown(dataset: MaterialsDataset): string {
  const lines: string[] = []

  lines.push(`# 素材收集：${dataset.topic}`)
  lines.push("")
  lines.push(`> 收集时间：${new Date(dataset.generatedAt).toLocaleString("zh-CN")}`)
  lines.push(`> 搜索关键词：${dataset.plan.search_queries.join(" / ")}`)
  lines.push(`> 素材数量：${dataset.summary.totalItems} 条`)
  lines.push("")
  lines.push("---")
  lines.push("")

  // 搜索结果
  if (dataset.searchResults.length > 0) {
    lines.push("## 搜索结果")
    lines.push("")

    for (const item of dataset.searchResults) {
      lines.push(`### ${item.title}`)
      lines.push("")
      lines.push(`- **来源**：${item.source}`)
      lines.push(`- **链接**：${item.url}`)
      if (item.datePublished) {
        lines.push(`- **日期**：${item.datePublished}`)
      }
      lines.push("")
      if (item.snippet) {
        lines.push(item.snippet)
        lines.push("")
      }
      if (item.extracted_data && item.extracted_data.length > 0) {
        lines.push(`**关键数据**：${item.extracted_data.join(", ")}`)
        lines.push("")
      }
      lines.push("---")
      lines.push("")
    }
  }

  // 爬取内容
  if (dataset.crawledContents.length > 0) {
    lines.push("## 深度内容")
    lines.push("")

    for (const item of dataset.crawledContents) {
      lines.push(`### ${item.reason}`)
      lines.push("")
      lines.push(`- **链接**：${item.url}`)
      lines.push(`- **提取提示**：${item.extract_hint}`)
      lines.push("")
      lines.push("**内容摘要**：")
      lines.push("")
      lines.push(item.content.slice(0, 2000))
      if (item.content.length > 2000) {
        lines.push("")
        lines.push("*（内容过长，已截断）*")
      }
      lines.push("")
      lines.push("---")
      lines.push("")
    }
  }

  return lines.join("\n")
}

// ── 辅助函数 ───────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "unknown"
  }
}

function stripHtml(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function deduplicateByUrl(items: SearchItem[]): SearchItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}

function extractNumbers(text: string): string[] {
  const numbers: string[] = []

  const percentMatches = text.match(/\d+\.?\d*%/g)
  if (percentMatches) numbers.push(...percentMatches)

  const currencyMatches = text.match(/[¥$€]\s*\d+\.?\d*[万亿千百]?/g)
  if (currencyMatches) numbers.push(...currencyMatches)

  const bigNumberMatches = text.match(/\d+\.?\d*[万亿千百]/g)
  if (bigNumberMatches) numbers.push(...bigNumberMatches)

  return [...new Set(numbers)].slice(0, 10)
}

function unifyDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return date.toISOString().split("T")[0]
  } catch {
    return dateStr
  }
}

function isAd(title = "", snippet = ""): boolean {
  const adKeywords = [
    "广告", "推广", "优惠", "限时", "特价", "折扣",
    "点击购买", "立即下单", "加入购物车",
  ]
  const text = `${title} ${snippet}`.toLowerCase()
  return adKeywords.some((keyword) => text.includes(keyword))
}

// Jina Reader 封装
async function fetchJinaText(url: string, apiKey = ""): Promise<string> {
  const jinaUrl = `https://r.jina.ai/${url}`
  const headers: Record<string, string> = {
    "Accept": "text/plain",
    "X-Return-Format": "markdown",
    "X-Timeout": "8",
  }
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  const resp = await fetch(jinaUrl, {
    headers,
    signal: AbortSignal.timeout(10000),
  })

  if (!resp.ok) throw new Error(`Jina ${resp.status}`)
  const text = await resp.text()
  if (text.length < 50) throw new Error("Jina 返回内容为空")
  return text.slice(0, 8000)
}

// 直接 fetch 封装
async function fetchDirectText(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; autowriting-bot/1.0)",
      "Accept": "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "zh-CN,zh;q=0.9",
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const html = await resp.text()
  const text = stripHtml(html)
  if (text.length < 100) throw new Error("页面内容为空或无法提取正文")
  return text.slice(0, 8000)
}