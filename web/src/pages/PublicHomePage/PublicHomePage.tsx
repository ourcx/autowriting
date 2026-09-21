import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle,
  FileText,
  LayoutTemplate,
  Library,
  LogIn,
  PenLine,
  Send,
  UserPlus,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import './PublicHomePage.css'

const WORKFLOW = [
  { icon: Library, label: '素材', detail: '收进来' },
  { icon: BookOpen, label: '选题', detail: '想清楚' },
  { icon: PenLine, label: '写作', detail: '写出来' },
  { icon: LayoutTemplate, label: '排版', detail: '定下来' },
  { icon: Send, label: '发布', detail: '送出去' },
]

const PRODUCT_POINTS = [
  {
    number: '01',
    title: '素材和文章不再分家',
    detail: '采访、网页和往期内容都留在同一个创作上下文里。',
  },
  {
    number: '02',
    title: '每一版都知道改了什么',
    detail: '候选稿、审核状态和返工记录沿着文章继续走。',
  },
  {
    number: '03',
    title: '成稿直接进入发布准备',
    detail: '排版、封面和平台设置确认后，再写入微信草稿箱。',
  },
]

function ProductStudio() {
  return (
    <div className="ph-studio" aria-label="Dashy 写作工作台界面示意">
      <div className="ph-studio-bar">
        <div className="ph-studio-brand">
          <span>D</span>
          Dashy
        </div>
        <div className="ph-studio-state">
          <CheckCircle size={14} />
          已保存
        </div>
      </div>

      <div className="ph-studio-body">
        <aside className="ph-source-pane">
          <p className="ph-tool-label">本篇素材</p>
          <button className="ph-source-item is-active" type="button">
            <FileText size={15} />
            采访纪要
          </button>
          <button className="ph-source-item" type="button">
            <BookOpen size={15} />
            往期文章
          </button>
          <button className="ph-source-item" type="button">
            <Library size={15} />
            网页资料
          </button>
          <div className="ph-source-note">
            <span>已引用</span>
            <strong>8 条</strong>
          </div>
        </aside>

        <article className="ph-writing-page">
          <div className="ph-writing-meta">
            <span>公众号文章</span>
            <span>自动保存</span>
          </div>
          <h2>把零散素材，写成一篇完整文章</h2>
          <p className="ph-writing-lead">
            素材有出处，观点有上下文，编辑过程也有记录。
          </p>
          <div className="ph-copy-lines" aria-hidden="true">
            <span />
            <span />
            <span className="is-short" />
          </div>
          <blockquote>
            <span>重点</span>
            内容是主角，工具应该退到后面。
          </blockquote>
          <div className="ph-copy-lines ph-copy-lines--lower" aria-hidden="true">
            <span />
            <span className="is-medium" />
          </div>
        </article>

        <aside className="ph-publish-pane">
          <p className="ph-tool-label">发布准备</p>
          <div className="ph-publish-row">
            <Check size={14} />
            标题与摘要
          </div>
          <div className="ph-publish-row">
            <Check size={14} />
            封面与排版
          </div>
          <div className="ph-publish-row">
            <Check size={14} />
            原创与留言
          </div>
          <div className="ph-publish-target">
            <span className="ph-wechat-mark">微</span>
            <span>
              <small>发布到</small>
              微信草稿箱
            </span>
          </div>
          <div className="ph-publish-action">
            写入草稿
            <ArrowRight size={15} />
          </div>
        </aside>
      </div>
    </div>
  )
}

export default function PublicHomePage() {
  return (
    <div className="ph-root">
      <header className="ph-header">
        <Link className="ph-brand" to="/" aria-label="Dashy 首页">
          <span className="ph-brand-mark">D</span>
          <span>Dashy</span>
        </Link>

        <nav className="ph-nav" aria-label="官网导航">
          <a href="#workflow">工作流</a>
          <a href="#product">产品</a>
          <a href="#publish">发布</a>
        </nav>

        <div className="ph-account-actions">
          <Link className="ph-login-link" to="/login">
            <LogIn size={16} />
            登录
          </Link>
          <Link className="ph-button ph-button--primary" to="/register">
            <UserPlus size={16} />
            开始使用
          </Link>
        </div>
      </header>

      <main>
        <section className="ph-hero" aria-labelledby="ph-title">
          <div className="ph-hero-copy">
            <p className="ph-eyebrow">给个人创作者的内容工作台</p>
            <h1 id="ph-title">Dashy</h1>
            <p className="ph-hero-statement">把下一篇文章，从素材带到草稿箱。</p>
            <p className="ph-hero-detail">
              写作、审核、排版和发布在一条清楚的链路里完成。
            </p>
            <div className="ph-hero-actions">
              <Link className="ph-button ph-button--accent" to="/register">
                开始创作
                <ArrowRight size={17} />
              </Link>
              <Link className="ph-secondary-link" to="/login">已有账号</Link>
            </div>
          </div>

          <ProductStudio />

          <div className="ph-hero-foot">
            <span>从空白页到微信草稿</span>
            <span>一条内容生产线</span>
          </div>
        </section>

        <section className="ph-workflow" id="workflow" aria-labelledby="workflow-title">
          <div className="ph-section-intro">
            <p className="ph-section-label">工作流</p>
            <h2 id="workflow-title">写文章的五件事，终于在一个地方。</h2>
          </div>
          <ol className="ph-workflow-list">
            {WORKFLOW.map(({ icon: Icon, label, detail }, index) => (
              <li key={label}>
                <span className="ph-workflow-number">{String(index + 1).padStart(2, '0')}</span>
                <Icon size={22} aria-hidden="true" />
                <div>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="ph-product" id="product" aria-labelledby="product-title">
          <div className="ph-product-heading">
            <p className="ph-section-label">产品</p>
            <h2 id="product-title">内容是主角，工具退到后面。</h2>
            <p>Dashy 记住素材从哪里来，也记住文章走到了哪一步。</p>
          </div>
          <div className="ph-product-list">
            {PRODUCT_POINTS.map((point) => (
              <article key={point.number}>
                <span>{point.number}</span>
                <div>
                  <h3>{point.title}</h3>
                  <p>{point.detail}</p>
                </div>
                <ArrowRight size={20} aria-hidden="true" />
              </article>
            ))}
          </div>
        </section>

        <section className="ph-publish" id="publish" aria-labelledby="publish-title">
          <div className="ph-publish-copy">
            <p className="ph-section-label">发布</p>
            <h2 id="publish-title">写完之后，不用再搬一次。</h2>
            <p>确认排版和发布设置，成稿直接写入微信草稿箱。</p>
            <Link className="ph-button ph-button--light" to="/register">
              创建账号
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="ph-publish-proof" aria-label="微信草稿发布状态示意">
            <div className="ph-proof-head">
              <span className="ph-wechat-mark">微</span>
              <div>
                <small>微信公众号</small>
                <strong>草稿已写入</strong>
              </div>
              <CheckCircle size={22} />
            </div>
            <div className="ph-proof-line">
              <span>文章内容</span>
              <strong>已同步</strong>
            </div>
            <div className="ph-proof-line">
              <span>排版样式</span>
              <strong>已应用</strong>
            </div>
            <div className="ph-proof-line">
              <span>发布设置</span>
              <strong>已确认</strong>
            </div>
          </div>
        </section>

        <section className="ph-final" aria-labelledby="final-title">
          <p className="ph-section-label">Dashy</p>
          <h2 id="final-title">下一篇，从这里开始。</h2>
          <div>
            <Link className="ph-button ph-button--primary" to="/register">
              开始使用
              <ArrowRight size={17} />
            </Link>
            <Link className="ph-final-login" to="/login">登录工作台</Link>
          </div>
        </section>
      </main>

      <footer className="ph-footer">
        <span>Dashy</span>
        <span className="ph-footer-filing" aria-label="ICP备案信息">ICP备案号待更新</span>
        <span className="ph-footer-description">AI 公众号写作与内容发布工作台</span>
      </footer>
    </div>
  )
}
