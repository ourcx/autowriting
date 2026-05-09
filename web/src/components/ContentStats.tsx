import { BarChart3, Clock, FileText, Eye } from 'lucide-react'
import './ContentStats.css'

interface ContentStatsProps {
  content: string
  title?: string
}

function countWords(text: string): number {
  return text.replace(/[#*`\[\]()]/g, '').trim().length
}

function calculateReadingTime(text: string): number {
  return Math.ceil(countWords(text) / 200)
}

function generateTableOfContents(markdown: string): Array<{ level: number; title: string }> {
  return markdown.split('\n').reduce<Array<{ level: number; title: string }>>((acc, line) => {
    const m = line.match(/^(#{1,6})\s+(.+?)$/)
    if (m) acc.push({ level: m[1].length, title: m[2].trim() })
    return acc
  }, [])
}

export default function ContentStats({ content }: ContentStatsProps) {
  const wordCount = countWords(content)
  const readingTime = calculateReadingTime(content)
  const headings = generateTableOfContents(content)
  const paragraphs = content.split('\n\n').filter(p => p.trim()).length

  return (
    <div className="content-stats">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">
            <FileText size={20} />
          </div>
          <div className="stat-content">
            <div className="stat-label">字数</div>
            <div className="stat-value">{wordCount}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <Clock size={20} />
          </div>
          <div className="stat-content">
            <div className="stat-label">阅读时间</div>
            <div className="stat-value">{readingTime} 分钟</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <BarChart3 size={20} />
          </div>
          <div className="stat-content">
            <div className="stat-label">段落数</div>
            <div className="stat-value">{paragraphs}</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <Eye size={20} />
          </div>
          <div className="stat-content">
            <div className="stat-label">标题数</div>
            <div className="stat-value">{headings.length}</div>
          </div>
        </div>
      </div>

      {headings.length > 0 && (
        <div className="toc-section">
          <h4>文章目录</h4>
          <ul className="toc-list">
            {headings.map((heading, index) => (
              <li
                key={index}
                className={`toc-item level-${heading.level}`}
                style={{ paddingLeft: `${(heading.level - 1) * 16}px` }}
              >
                {heading.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="stats-tips">
        <p>💡 建议：</p>
        <ul>
          <li>文章字数建议在 1500-2500 字之间</li>
          <li>阅读时间在 5-15 分钟为最佳</li>
          <li>使用 3-5 个标题来组织内容</li>
          <li>段落数在 8-15 个为最佳</li>
        </ul>
      </div>
    </div>
  )
}
