import { ArrowRight, FileText } from "lucide-react"
import { Link } from "react-router-dom"
import "./PublicHomePage.css"

const WORKFLOW = [
  {
    title: "收集素材",
    detail: "粘贴笔记或解析文章链接，把这次要用的内容放进素材库。",
  },
  {
    title: "编辑草稿",
    detail: "让 AI 根据写作要求和素材生成候选稿，再选一版继续修改。",
  },
  {
    title: "预览与发布",
    detail: "先看手机上的排版效果。连接公众号后，可以把成稿写入微信草稿箱。",
  },
]

function ProductStudio() {
  return (
    <figure className="ph-studio">
      <figcaption className="ph-board-caption">文章编辑与公众号预览示意</figcaption>
      <div className="ph-editor-sheet">
        <div className="ph-editor-bar">
          <span><FileText size={15} aria-hidden="true" /> 文章编辑</span>
          <span>公众号</span>
        </div>
        <div className="ph-editor-grid">
          <div className="ph-source-pane">
            <p>素材库</p>
            <ul>
              <li>项目 README</li>
              <li>最初的写作脚本</li>
              <li>公众号发布笔记</li>
            </ul>
          </div>
          <div className="ph-preview-pane">
            <p className="ph-preview-label">发布预览</p>
            <div className="ph-preview-paper">
              <h2>一个公众号的编辑器是怎么做出来的</h2>
              <p>最早只有几条命令，生成草稿之后，还要自己处理图片和排版。后来发文多了，就把这些步骤搬到同一个网页里。</p>
              <h3>写完先预览</h3>
              <p>手机一屏能放下多少字？图和标题隔多远？先在预览里看一遍，再写入公众号草稿箱。</p>
            </div>
          </div>
        </div>
      </div>
    </figure>
  )
}

export default function PublicHomePage() {
  return (
    <div className="ph-root">
      <header className="ph-header">
        <div className="ph-header-inner">
          <Link className="ph-brand" to="/" aria-label="Dashy 首页">
            <span className="ph-brand-mark" aria-hidden="true">D</span>
            Dashy
          </Link>
          <nav aria-label="官网导航">
            <a href="#workflow">工作流</a>
            <Link to="/login">登录</Link>
          </nav>
        </div>
      </header>

      <main className="ph-main">
        <section className="ph-hero" aria-labelledby="ph-title">
          <div className="ph-hero-copy">
            <h1 id="ph-title">从素材到<br className="ph-title-break" />公众号草稿</h1>
            <p>在 Dashy 整理资料、用 AI 起草文章，再预览排版，写入微信草稿箱。</p>
            <Link className="ph-primary-link" to="/register">
              创建账号 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
          <ProductStudio />
        </section>

        <section className="ph-workflow" id="workflow" aria-labelledby="workflow-title">
          <h2 id="workflow-title">一篇文章怎么写</h2>
          <ol>
            {WORKFLOW.map(({ title, detail }) => (
              <li key={title}>
                <strong>{title}</strong>
                <span>{detail}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="ph-footer">
        <div>
          <span>Dashy</span>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer" aria-label="ICP备案信息">
            粤ICP备2025430004号-2
          </a>
        </div>
      </footer>
    </div>
  )
}
