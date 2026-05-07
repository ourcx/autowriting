import { ExternalLink, CheckCircle, AlertCircle } from 'lucide-react'
import './PublishGuide.css'

interface PublishGuideProps {
  dateDir: string
  articleTitle: string
}

export default function PublishGuide({ dateDir, articleTitle }: PublishGuideProps) {
  const handleOpenWeChat = () => {
    window.open('https://mp.weixin.qq.com/', '_blank')
  }

  const steps = [
    {
      number: 1,
      title: '复制文章内容',
      description: '在「文章内容」标签中，复制生成的完整文章内容'
    },
    {
      number: 2,
      title: '打开微信公众号后台',
      description: '点击下方按钮打开微信公众号平台',
      action: true
    },
    {
      number: 3,
      title: '创建新文章',
      description: '进入「素材管理」→「新增」→「图文消息」'
    },
    {
      number: 4,
      title: '粘贴内容',
      description: '将复制的内容粘贴到编辑器中'
    },
    {
      number: 5,
      title: '保存到草稿箱',
      description: '点击「保存」按钮，文章将保存到草稿箱'
    },
    {
      number: 6,
      title: '预览和发布',
      description: '预览检查无误后，点击「发布」按钮'
    }
  ]

  return (
    <div className="publish-guide">
      <div className="guide-header">
        <h2>📤 发布指南</h2>
        <p>按照以下步骤将文章发布到微信公众号</p>
      </div>

      <div className="guide-info">
        <div className="info-card">
          <h3>📋 文章信息</h3>
          <div className="info-content">
            <p><strong>日期：</strong> {dateDir}</p>
            <p><strong>标题：</strong> {articleTitle || '未命名'}</p>
          </div>
        </div>
      </div>

      <div className="guide-steps">
        <h3>发布步骤</h3>
        <div className="steps-list">
          {steps.map((step) => (
            <div key={step.number} className="step-item">
              <div className="step-number">{step.number}</div>
              <div className="step-content">
                <h4>{step.title}</h4>
                <p>{step.description}</p>
                {step.action && (
                  <button className="btn btn-primary" onClick={handleOpenWeChat}>
                    <ExternalLink size={16} />
                    打开微信公众号平台
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="guide-tips">
        <h3>💡 发布建议</h3>
        <div className="tips-list">
          <div className="tip-item">
            <CheckCircle size={20} />
            <div>
              <strong>检查格式</strong>
              <p>确保标题、段落、链接等格式正确</p>
            </div>
          </div>
          <div className="tip-item">
            <CheckCircle size={20} />
            <div>
              <strong>添加配图</strong>
              <p>为文章添加吸引人的配图和封面</p>
            </div>
          </div>
          <div className="tip-item">
            <CheckCircle size={20} />
            <div>
              <strong>设置摘要</strong>
              <p>编写简洁的文章摘要，提高点击率</p>
            </div>
          </div>
          <div className="tip-item">
            <AlertCircle size={20} />
            <div>
              <strong>避免敏感词</strong>
              <p>检查文章是否包含敏感词汇</p>
            </div>
          </div>
        </div>
      </div>

      <div className="guide-faq">
        <h3>❓ 常见问题</h3>
        <div className="faq-list">
          <div className="faq-item">
            <h4>Q: 如何修改已发布的文章？</h4>
            <p>A: 在微信公众号后台的「素材管理」中找到文章，点击「编辑」进行修改。修改后需要重新发布。</p>
          </div>
          <div className="faq-item">
            <h4>Q: 文章发布后多久能看到？</h4>
            <p>A: 文章发布后立即可见。如果是定时发布，会在设定的时间自动发布。</p>
          </div>
          <div className="faq-item">
            <h4>Q: 如何添加阅读原文链接？</h4>
            <p>A: 在微信公众号编辑器中，点击「阅读原文」按钮，输入链接地址即可。</p>
          </div>
          <div className="faq-item">
            <h4>Q: 如何定时发布文章？</h4>
            <p>A: 在发布前，点击「定时发布」按钮，选择发布时间即可。</p>
          </div>
        </div>
      </div>
    </div>
  )
}
