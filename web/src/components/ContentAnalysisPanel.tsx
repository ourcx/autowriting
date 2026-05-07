import React, { useMemo } from 'react'
import {
  analyzeContent,
  analyzeSEO,
  generateOptimizationSuggestions,
  ContentAnalysis,
  SEOAnalysis,
  OptimizationSuggestion
} from '../utils/contentAnalysis'
import './ContentAnalysisPanel.css'

interface ContentAnalysisPanelProps {
  title: string
  content: string
}

export const ContentAnalysisPanel: React.FC<ContentAnalysisPanelProps> = ({
  title,
  content
}) => {
  const analysis = useMemo(() => analyzeContent(content), [content])
  const seoAnalysis = useMemo(
    () => analyzeSEO(title, content, analysis.keywords),
    [title, content, analysis.keywords]
  )
  const suggestions = useMemo(
    () => generateOptimizationSuggestions(title, content, analysis, seoAnalysis),
    [title, content, analysis, seoAnalysis]
  )

  const getScoreColor = (score: number): string => {
    if (score >= 80) return '#078a52' // Matcha 600
    if (score >= 60) return '#fbbd41' // Lemon 500
    return '#fc7981' // Pomegranate 400
  }

  const getSeverityIcon = (severity: string): string => {
    switch (severity) {
      case 'error':
        return '❌'
      case 'warning':
        return '⚠️'
      default:
        return 'ℹ️'
    }
  }

  return (
    <div className="content-analysis-panel">
      {/* 基础统计 */}
      <div className="analysis-section">
        <h3 className="section-title">📊 基础统计</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-label">字数</div>
            <div className="stat-value">{analysis.wordCount}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">段落</div>
            <div className="stat-value">{analysis.paragraphCount}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">句子</div>
            <div className="stat-value">{analysis.sentenceCount}</div>
          </div>
          <div className="stat-item">
            <div className="stat-label">阅读时间</div>
            <div className="stat-value">{analysis.readingTime} 分钟</div>
          </div>
        </div>
      </div>

      {/* 关键词分析 */}
      <div className="analysis-section">
        <h3 className="section-title">🔑 关键词分析</h3>
        <div className="keywords-container">
          {analysis.keywords.length > 0 ? (
            <>
              <div className="keywords-list">
                {analysis.keywords.map((keyword, index) => (
                  <div key={index} className="keyword-tag">
                    <span className="keyword-text">{keyword}</span>
                    <span className="keyword-density">
                      {(analysis.keywordDensity[keyword] || 0).toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
              <div className="keyword-stats">
                <p>
                  平均关键词密度：
                  <strong>
                    {(
                      Object.values(analysis.keywordDensity).reduce((a, b) => a + b, 0) /
                      analysis.keywords.length
                    ).toFixed(2)}%
                  </strong>
                </p>
              </div>
            </>
          ) : (
            <p className="empty-state">未提取到关键词</p>
          )}
        </div>
      </div>

      {/* SEO 评分 */}
      <div className="analysis-section">
        <h3 className="section-title">📈 SEO 评分</h3>
        <div className="seo-score-container">
          <div className="score-circle">
            <div
              className="score-value"
              style={{ color: getScoreColor(seoAnalysis.score) }}
            >
              {seoAnalysis.score}
            </div>
            <div className="score-label">/100</div>
          </div>
          <div className="score-details">
            <p>
              <strong>标题长度：</strong> {seoAnalysis.titleLength} 字
              {seoAnalysis.titleLength < 10 || seoAnalysis.titleLength > 60
                ? ' ⚠️'
                : ' ✅'}
            </p>
            <p>
              <strong>关键词数：</strong> {analysis.keywords.length} 个
              {analysis.keywords.length < 3 ? ' ⚠️' : ' ✅'}
            </p>
            <p>
              <strong>内容长度：</strong> {analysis.wordCount} 字
              {analysis.wordCount < 500 ? ' ⚠️' : ' ✅'}
            </p>
          </div>
        </div>
      </div>

      {/* 优化建议 */}
      <div className="analysis-section">
        <h3 className="section-title">💡 优化建议</h3>
        <div className="suggestions-container">
          {suggestions.length > 0 ? (
            <div className="suggestions-list">
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className={`suggestion-item suggestion-${suggestion.severity}`}
                >
                  <div className="suggestion-header">
                    <span className="suggestion-icon">
                      {getSeverityIcon(suggestion.severity)}
                    </span>
                    <span className="suggestion-type">{suggestion.message}</span>
                  </div>
                  <div className="suggestion-content">{suggestion.suggestion}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">✅ 内容优化完美！</p>
          )}
        </div>
      </div>

      {/* 可读性指标 */}
      <div className="analysis-section">
        <h3 className="section-title">👁️ 可读性指标</h3>
        <div className="readability-grid">
          <div className="readability-item">
            <div className="readability-label">平均字长</div>
            <div className="readability-value">
              {analysis.avgWordLength.toFixed(2)} 字
            </div>
          </div>
          <div className="readability-item">
            <div className="readability-label">平均句长</div>
            <div className="readability-value">
              {analysis.avgSentenceLength.toFixed(2)} 字
            </div>
          </div>
          <div className="readability-item">
            <div className="readability-label">段落密度</div>
            <div className="readability-value">
              {(analysis.wordCount / Math.max(1, analysis.paragraphCount)).toFixed(0)} 字/段
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ContentAnalysisPanel
