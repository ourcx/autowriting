/**
 * 改进的 Markdown 渲染器
 * 支持更多的 Markdown 语法
 */

export function markdownToHtml(markdown: string): string {
  let html = markdown

  // 转义 HTML 特殊字符（除了我们要处理的标记）
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 代码块（需要在其他处理之前）
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const language = code.split('\n')[0].trim()
    const codeContent = code.replace(/^[^\n]*\n/, '').trim()
    return `<pre><code class="language-${language}">${codeContent}</code></pre>`
  })

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // 标题
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>')

  // 加粗
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')

  // 斜体
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  html = html.replace(/_(.+?)_/g, '<em>$1</em>')

  // 删除线
  html = html.replace(/~~(.*?)~~/g, '<del>$1</del>')

  // 链接
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')

  // 图片
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" />')

  // 有序列表
  html = html.replace(/^\d+\. (.*?)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*?<\/li>)/s, '<ol>$1</ol>')

  // 无序列表
  html = html.replace(/^[\*\-\+] (.*?)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*?<\/li>)/s, (match) => {
    if (match.includes('<ol>')) return match
    return `<ul>${match}</ul>`
  })

  // 引用块
  html = html.replace(/^> (.*?)$/gm, '<blockquote>$1</blockquote>')

  // 水平线
  html = html.replace(/^[\*\-_]{3,}$/gm, '<hr />')

  // 段落
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br />')

  // 包装段落
  if (!html.startsWith('<')) {
    html = `<p>${html}</p>`
  }

  // 清理多余的标签
  html = html.replace(/<p><\/p>/g, '')
  html = html.replace(/<p>(<h[1-6]>)/g, '$1')
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1')
  html = html.replace(/<p>(<ul>|<ol>|<blockquote>|<pre>)/g, '$1')
  html = html.replace(/(<\/ul>|<\/ol>|<\/blockquote>|<\/pre>)<\/p>/g, '$1')

  return html
}

/**
 * 提取 Markdown 中的标题
 */
export function extractTitle(markdown: string): string {
  const match = markdown.match(/^#\s+(.+?)$/m)
  return match ? match[1].trim() : ''
}

/**
 * 提取 Markdown 中的摘要（前 200 字）
 */
export function extractSummary(markdown: string, length: number = 200): string {
  const text = markdown
    .replace(/[#*`\[\]()]/g, '')
    .replace(/\n+/g, ' ')
    .trim()
  
  return text.length > length ? text.substring(0, length) + '...' : text
}

/**
 * 计算阅读时间（假设平均每分钟 200 字）
 */
export function calculateReadingTime(markdown: string): number {
  const text = markdown.replace(/[#*`\[\]()]/g, '').trim()
  const wordCount = text.length
  return Math.ceil(wordCount / 200)
}

/**
 * 统计 Markdown 中的字数
 */
export function countWords(markdown: string): number {
  const text = markdown.replace(/[#*`\[\]()]/g, '').trim()
  return text.length
}

/**
 * 生成目录
 */
export function generateTableOfContents(markdown: string): Array<{ level: number; title: string; id: string }> {
  const headings: Array<{ level: number; title: string; id: string }> = []
  const lines = markdown.split('\n')
  
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)$/)
    if (match) {
      const level = match[1].length
      const title = match[2].trim()
      const id = `heading-${index}`
      headings.push({ level, title, id })
    }
  })
  
  return headings
}

/**
 * 验证 Markdown 语法
 */
export function validateMarkdown(markdown: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // 检查括号匹配
  const brackets = markdown.match(/[\[\]()]/g) || []
  let openBrackets = 0
  let openParens = 0
  
  brackets.forEach(char => {
    if (char === '[') openBrackets++
    if (char === ']') openBrackets--
    if (char === '(') openParens++
    if (char === ')') openParens--
  })
  
  if (openBrackets !== 0) errors.push('方括号不匹配')
  if (openParens !== 0) errors.push('圆括号不匹配')
  
  // 检查代码块
  const codeBlocks = (markdown.match(/```/g) || []).length
  if (codeBlocks % 2 !== 0) errors.push('代码块标记不匹配')
  
  return {
    valid: errors.length === 0,
    errors
  }
}
