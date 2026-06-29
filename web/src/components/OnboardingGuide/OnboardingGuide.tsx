import React, { useState, useEffect } from 'react'
import { ChevronRight, X, CheckCircle, Zap, BookOpen, Settings } from 'lucide-react'
import './OnboardingGuide.css'

interface GuideStep {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
  completed?: boolean
  targetSelector?: string
}

interface OnboardingGuideProps {
  onComplete?: () => void
  autoHide?: boolean
}

export default function OnboardingGuide({ onComplete, autoHide = true }: OnboardingGuideProps) {
  const [isVisible, setIsVisible] = useState(true)
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)

  const steps: GuideStep[] = [
    {
      id: 'welcome',
      title: '欢迎使用 AI 自动写作系统',
      description: '这是一个强大的 AI 驱动的内容创作平台，可以帮助你快速生成高质量的文章。',
      icon: <Zap size={32} />,
    },
    {
      id: 'create-article',
      title: '创建你的第一篇文章',
      description: '点击"新建文章"按钮开始创作。系统会引导你输入主题和描述。',
      icon: <BookOpen size={32} />,
      action: {
        label: '创建文章',
        href: '/',
      },
      targetSelector: '[data-onboarding="create-article"]',
    },
    {
      id: 'ai-settings',
      title: '配置 AI 模型',
      description: '在设置中选择你喜欢的 AI 模型和参数。我们提供了多个预设方案供快速选择。',
      icon: <Settings size={32} />,
      action: {
        label: '前往设置',
        href: '/settings',
      },
      targetSelector: '[data-onboarding="ai-settings"]',
    },
    {
      id: 'generate-content',
      title: '生成文章内容',
      description: '使用 AI 自动生成文章。系统会根据你的主题和风格偏好生成高质量内容。',
      icon: <Zap size={32} />,
      targetSelector: '[data-onboarding="generate-content"]',
    },
    {
      id: 'complete',
      title: '开始创作吧！',
      description: '现在你已经了解了基本功能。开始创作你的第一篇文章，体验 AI 的强大能力。',
      icon: <CheckCircle size={32} />,
    },
  ]

  // 更新目标元素的位置
  useEffect(() => {
    const step = steps[currentStep]
    if (step.targetSelector) {
      const element = document.querySelector(step.targetSelector)
      if (element) {
        setTargetRect(element.getBoundingClientRect())
      } else {
        setTargetRect(null)
      }
    } else {
      setTargetRect(null)
    }

    // 监听窗口大小变化
    const handleResize = () => {
      if (step.targetSelector) {
        const element = document.querySelector(step.targetSelector)
        if (element) {
          setTargetRect(element.getBoundingClientRect())
        }
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [currentStep, steps])

  const handleStepComplete = (stepId: string) => {
    const newCompleted = new Set(completedSteps)
    newCompleted.add(stepId)
    setCompletedSteps(newCompleted)

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else if (autoHide) {
      setTimeout(() => {
        setIsVisible(false)
        onComplete?.()
      }, 1000)
    }
  }

  const handleClose = () => {
    setIsVisible(false)
    onComplete?.()
  }

  if (!isVisible) return null

  const step = steps[currentStep]

  return (
    <>
      {/* 聚焦遮罩层 */}
      {targetRect && (
        <div className="onboarding-spotlight">
          <svg className="onboarding-spotlight-svg" width="100%" height="100%">
            <defs>
              <mask id="spotlight-mask">
                <rect width="100%" height="100%" fill="white" />
                <rect
                  x={targetRect.left - 8}
                  y={targetRect.top - 8}
                  width={targetRect.width + 16}
                  height={targetRect.height + 16}
                  rx="12"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(10, 10, 10, 0.6)"
              mask="url(#spotlight-mask)"
            />
          </svg>
        </div>
      )}

      {/* 引导弹窗 */}
      <div className="onboarding-overlay">
        <div className="onboarding-container">
          {/* 关闭按钮 */}
          <button className="onboarding-close" onClick={handleClose} title="关闭引导">
            <X size={20} />
          </button>

          {/* 内容区域 - 固定高度 */}
          <div className="onboarding-content">
            {/* 图标 */}
            <div className="onboarding-icon">
              {step.icon}
            </div>

            {/* 标题和描述 */}
            <h2 className="onboarding-title">{step.title}</h2>
            <p className="onboarding-description">{step.description}</p>

            {/* 步骤指示器 */}
            <div className="onboarding-steps">
              {steps.map((s, idx) => (
                <div
                  key={s.id}
                  className={`onboarding-step-dot ${
                    idx === currentStep ? 'active' : idx < currentStep ? 'completed' : ''
                  }`}
                  onClick={() => setCurrentStep(idx)}
                >
                  {idx < currentStep ? <CheckCircle size={16} /> : idx + 1}
                </div>
              ))}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="onboarding-actions">
            {currentStep > 0 && (
              <button
                className="onboarding-btn onboarding-btn-secondary"
                onClick={() => setCurrentStep(currentStep - 1)}
              >
                上一步
              </button>
            )}

            {step.action ? (
              <a
                href={step.action.href}
                className="onboarding-btn onboarding-btn-primary"
                onClick={(e) => {
                  if (step.action?.onClick) {
                    e.preventDefault()
                    step.action.onClick()
                  }
                  handleStepComplete(step.id)
                }}
              >
                {step.action.label}
                <ChevronRight size={16} />
              </a>
            ) : (
              <button
                className="onboarding-btn onboarding-btn-primary"
                onClick={() => handleStepComplete(step.id)}
              >
                {currentStep === steps.length - 1 ? '开始创作' : '下一步'}
                <ChevronRight size={16} />
              </button>
            )}
          </div>

          {/* 跳过按钮 */}
          <button className="onboarding-skip" onClick={handleClose}>
            跳过引导
          </button>
        </div>
      </div>
    </>
  )
}
