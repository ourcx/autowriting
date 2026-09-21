import { ArrowRight, BarChart3, BookOpen, FileText, LogIn, Send, Shapes, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import './PublicHomePage.css'

const WORKFLOW_ITEMS = [
  { icon: BookOpen, label: '素材', detail: '统一收集与检索' },
  { icon: BarChart3, label: '选题', detail: '结合内容数据判断' },
  { icon: FileText, label: '写作', detail: '生成、审核与返工' },
  { icon: Shapes, label: '排版', detail: '公众号样式预览' },
  { icon: Send, label: '发布', detail: '写入微信草稿箱' },
]

export default function PublicHomePage() {
  return (
    <div className="ph-root">
      <header className="ph-header">
        <Link className="ph-brand" to="/" aria-label="Dashy 首页">
          <span className="ph-brand-mark">D</span>
          <span>Dashy</span>
        </Link>
        <nav className="ph-actions" aria-label="账号入口">
          <Link className="ph-button ph-button--quiet" to="/login">
            <LogIn size={16} />
            登录
          </Link>
          <Link className="ph-button ph-button--primary" to="/register">
            <UserPlus size={16} />
            注册
          </Link>
        </nav>
      </header>

      <main>
        <section className="ph-hero" aria-labelledby="ph-title">
          <div className="ph-hero-product" aria-hidden="true">
            <div className="ph-product-sidebar">
              <div className="ph-product-brand">D</div>
              <span className="is-active" />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="ph-product-surface">
              <div className="ph-product-topbar">
                <strong>创作工作台</strong>
                <span />
              </div>
              <div className="ph-product-metrics">
                <div><strong>128</strong><span>内容素材</span></div>
                <div><strong>24</strong><span>候选选题</span></div>
                <div><strong>15</strong><span>待审核</span></div>
              </div>
              <div className="ph-product-workspace">
                <div className="ph-product-queue">
                  <strong>文章流程</strong>
                  <span className="is-selected" />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="ph-product-editor">
                  <span className="ph-product-title-line" />
                  <span />
                  <span />
                  <span className="is-short" />
                  <div className="ph-product-media" />
                  <span />
                  <span className="is-short" />
                </div>
              </div>
            </div>
          </div>
          <div className="ph-hero-shade" />
          <div className="ph-hero-content">
            <p className="ph-eyebrow">AI 公众号写作与内容发布工作台</p>
            <h1 id="ph-title">Dashy</h1>
            <p className="ph-lead">
              从素材、选题、写作、审核到排版和微信草稿发布，
              个人创作者需要的内容生产流程都在这里。
            </p>
            <div className="ph-hero-actions">
              <Link className="ph-button ph-button--hero" to="/register">
                开始创作
                <ArrowRight size={17} />
              </Link>
              <Link className="ph-hero-login" to="/login">已有账号，直接登录</Link>
            </div>
          </div>
        </section>

        <section className="ph-workflow" aria-labelledby="ph-workflow-title">
          <div className="ph-section-heading">
            <p>内容生产流程</p>
            <h2 id="ph-workflow-title">少切换工具，把时间留给内容</h2>
          </div>
          <ol className="ph-workflow-list">
            {WORKFLOW_ITEMS.map(({ icon: Icon, label, detail }, index) => (
              <li key={label}>
                <span className="ph-workflow-index">{String(index + 1).padStart(2, '0')}</span>
                <Icon size={20} aria-hidden="true" />
                <strong>{label}</strong>
                <span>{detail}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="ph-product-band" aria-labelledby="ph-product-title">
          <div className="ph-product-copy">
            <p>一个工作台</p>
            <h2 id="ph-product-title">文章状态、编辑进度和发布结果放在同一条链路里</h2>
          </div>
          <div className="ph-product-points">
            <p>围绕个人创作者设计，不把内容工作拆成零散后台。</p>
            <p>保留审核与返工状态，发布动作清晰可追踪。</p>
          </div>
        </section>

        <section className="ph-cta" aria-labelledby="ph-cta-title">
          <h2 id="ph-cta-title">打开 Dashy，继续下一篇</h2>
          <Link className="ph-button ph-button--primary" to="/register">
            创建账号
            <ArrowRight size={17} />
          </Link>
        </section>
      </main>

      <footer className="ph-footer">
        <span>Dashy</span>
        <span>AI 公众号写作与内容发布工作台</span>
      </footer>
    </div>
  )
}
