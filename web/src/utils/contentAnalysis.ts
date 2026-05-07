/**
 * 内容分析工具库
 * 用于分析文章内容、提取关键词、生成优化建议
 */

export interface ContentAnalysis {
  wordCount: number
  charCount: number
  paragraphCount: number
  sentenceCount: number
  readingTime: number
  keywords: string[]
  keywordDensity: Record<string, number>
  avgWordLength: number
  avgSentenceLength: number
}

export interface SEOAnalysis {
  score: number
  suggestions: string[]
  titleLength: number
  descriptionLength: number
  keywordDensity: number
  headingStructure: string[]
}

export interface OptimizationSuggestion {
  type: 'title' | 'keyword' | 'content' | 'format' | 'seo'
  severity: 'info' | 'warning' | 'error'
  message: string
  suggestion: string
}

/**
 * 分析文章内容
 */
export function analyzeContent(content: string): ContentAnalysis {
  // 移除 Markdown 标记
  const cleanContent = removeMarkdown(content)
  
  // 基础统计
  const wordCount = countWords(cleanContent)
  const charCount = cleanContent.length
  const paragraphCount = cleanContent.split('\n\n').filter(p => p.trim()).length
  const sentenceCount = countSentences(cleanContent)
  const readingTime = Math.ceil(wordCount / 200) // 假设每分钟 200 字

  // 关键词提取
  const keywords = extractKeywords(cleanContent)
  const keywordDensity = calculateKeywordDensity(cleanContent, keywords)

  // 平均值
  const avgWordLength = wordCount > 0 ? charCount / wordCount : 0
  const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0

  return {
    wordCount,
    charCount,
    paragraphCount,
    sentenceCount,
    readingTime,
    keywords,
    keywordDensity,
    avgWordLength,
    avgSentenceLength
  }
}

/**
 * SEO 分析
 */
export function analyzeSEO(title: string, content: string, keywords: string[]): SEOAnalysis {
  const suggestions: string[] = []
  let score = 100

  // 标题检查
  const titleLength = title.length
  if (titleLength < 10) {
    suggestions.push('标题过短，建议 10-60 个字符')
    score -= 10
  } else if (titleLength > 60) {
    suggestions.push('标题过长，建议 10-60 个字符')
    score -= 5
  }

  // 关键词检查
  if (keywords.length === 0) {
    suggestions.push('未提取到关键词，建议添加 3-5 个关键词')
    score -= 15
  } else if (keywords.length < 3) {
    suggestions.push('关键词过少，建议添加 3-5 个关键词')
    score -= 10
  }

  // 内容长度检查
  const wordCount = countWords(content)
  if (wordCount < 500) {
    suggestions.push('内容过短，建议至少 500 字')
    score -= 10
  } else if (wordCount > 5000) {
    suggestions.push('内容过长，建议分成多篇文章')
    score -= 5
  }

  // 关键词密度检查
  const keywordDensity = calculateAverageKeywordDensity(content, keywords)
  if (keywordDensity < 1) {
    suggestions.push('关键词密度过低，建议 1-3%')
    score -= 10
  } else if (keywordDensity > 5) {
    suggestions.push('关键词密度过高，可能被认为是堆砌')
    score -= 10
  }

  // 标题中是否包含关键词
  const titleHasKeyword = keywords.some(k => title.includes(k))
  if (!titleHasKeyword && keywords.length > 0) {
    suggestions.push('标题中未包含主要关键词，建议在标题中添加')
    score -= 5
  }

  // 段落结构检查
  const headingStructure = extractHeadings(content)
  if (headingStructure.length === 0) {
    suggestions.push('缺少标题结构，建议添加 H2 和 H3 标题')
    score -= 10
  }

  return {
    score: Math.max(0, score),
    suggestions,
    titleLength,
    descriptionLength: 0,
    keywordDensity,
    headingStructure
  }
}

/**
 * 生成优化建议
 */
export function generateOptimizationSuggestions(
  title: string,
  content: string,
  analysis: ContentAnalysis,
  seoAnalysis: SEOAnalysis
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = []

  // 标题优化
  if (title.length < 10) {
    suggestions.push({
      type: 'title',
      severity: 'warning',
      message: '标题过短',
      suggestion: '建议标题长度在 10-60 个字符之间'
    })
  }

  // 关键词优化
  if (analysis.keywords.length < 3) {
    suggestions.push({
      type: 'keyword',
      severity: 'warning',
      message: '关键词过少',
      suggestion: `建议添加 3-5 个关键词，当前只有 ${analysis.keywords.length} 个`
    })
  }

  // 内容长度
  if (analysis.wordCount < 500) {
    suggestions.push({
      type: 'content',
      severity: 'warning',
      message: '内容过短',
      suggestion: `当前 ${analysis.wordCount} 字，建议至少 500 字`
    })
  }

  // 段落结构
  if (analysis.paragraphCount < 3) {
    suggestions.push({
      type: 'format',
      severity: 'info',
      message: '段落过少',
      suggestion: '建议将内容分成 3-5 个段落，提高可读性'
    })
  }

  // AI 套话检查
  const aiPhrases = detectAIPhrases(content)
  if (aiPhrases.length > 0) {
    suggestions.push({
      type: 'content',
      severity: 'warning',
      message: '检测到 AI 套话',
      suggestion: `检测到 ${aiPhrases.length} 处 AI 套话，建议修改：${aiPhrases.slice(0, 3).join('、')}`
    })
  }

  // SEO 建议
  seoAnalysis.suggestions.forEach(suggestion => {
    suggestions.push({
      type: 'seo',
      severity: 'info',
      message: 'SEO 优化建议',
      suggestion
    })
  })

  return suggestions
}

/**
 * 移除 Markdown 标记
 */
function removeMarkdown(content: string): string {
  return content
    .replace(/^#+\s+/gm, '') // 移除标题
    .replace(/\*\*(.*?)\*\*/g, '$1') // 移除加粗
    .replace(/\*(.*?)\*/g, '$1') // 移除斜体
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // 移除链接
    .replace(/`(.*?)`/g, '$1') // 移除代码
    .replace(/^[-*+]\s+/gm, '') // 移除列表
    .replace(/^>\s+/gm, '') // 移除引用
}

/**
 * 计算字数
 */
function countWords(content: string): number {
  // 中文字数 + 英文单词数
  const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishWords = (content.match(/\b[a-zA-Z]+\b/g) || []).length
  return chineseChars + englishWords
}

/**
 * 计算句数
 */
function countSentences(content: string): number {
  const sentences = content.match(/[。！？\.\!\?]/g) || []
  return Math.max(1, sentences.length)
}

/**
 * 提取关键词
 */
function extractKeywords(content: string, limit: number = 10): string[] {
  // 移除停用词
  const stopwords = new Set([
    '的', '一', '是', '在', '不', '了', '有', '和', '人', '这',
    '中', '大', '为', '上', '个', '国', '我', '以', '要', '他',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to'
  ])

  // 分词（简单实现）
  const words = content
    .toLowerCase()
    .match(/[\u4e00-\u9fa5]+|[a-z]+/g) || []

  // 计算词频
  const frequency: Record<string, number> = {}
  words.forEach(word => {
    if (!stopwords.has(word) && word.length > 1) {
      frequency[word] = (frequency[word] || 0) + 1
    }
  })

  // 排序并返回前 N 个
  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word)
}

/**
 * 计算关键词密度
 */
function calculateKeywordDensity(
  content: string,
  keywords: string[]
): Record<string, number> {
  const wordCount = countWords(content)
  const density: Record<string, number> = {}

  keywords.forEach(keyword => {
    const regex = new RegExp(keyword, 'g')
    const matches = content.match(regex) || []
    density[keyword] = wordCount > 0 ? (matches.length / wordCount) * 100 : 0
  })

  return density
}

/**
 * 计算平均关键词密度
 */
function calculateAverageKeywordDensity(content: string, keywords: string[]): number {
  const density = calculateKeywordDensity(content, keywords)
  const values = Object.values(density)
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

/**
 * 提取标题
 */
function extractHeadings(content: string): string[] {
  const headings = content.match(/^#+\s+(.+)$/gm) || []
  return headings.map(h => h.replace(/^#+\s+/, ''))
}

/**
 * 检测 AI 套话
 */
function detectAIPhrases(content: string): string[] {
  const aiPhrases = [
    '在当今这个快速发展的时代',
    '随着科技的不断进步',
    '总而言之',
    '综上所述',
    '希望本文对你有所帮助',
    '极大地',
    '显著地',
    '大幅度地',
    '接下来，让我们来看看',
    '首先',
    '其次',
    '最后',
    '不得不说',
    '值得一提的是',
    '打开了新世界的大门',
    '深刻的',
    '深度的',
    '全面的'
  ]

  const detected: string[] = []
  aiPhrases.forEach(phrase => {
    if (content.includes(phrase)) {
      detected.push(phrase)
    }
  })

  return detected
}

/**
 * 生成文章摘要
 */
export function generateSummary(content: string, length: number = 100): string {
  const cleanContent = removeMarkdown(content)
  const sentences = cleanContent.split(/[。！？\n]/).filter(s => s.trim())
  
  let summary = ''
  for (const sentence of sentences) {
    if ((summary + sentence).length <= length) {
      summary += sentence + '。'
    } else {
      break
    }
  }

  return summary || cleanContent.substring(0, length)
}

/**
 * 生成 Meta 描述
 */
export function generateMetaDescription(title: string, content: string): string {
  const summary = generateSummary(content, 155)
  return summary || title
}
