import React from 'react'
import './AnimatedLoader.css'

interface AnimatedLoaderProps {
  message?: string
  progress?: number
  steps?: string[]
  currentStep?: number
}

export default function AnimatedLoader({
  message = '处理中...',
  progress,
  steps,
  currentStep = 0,
}: AnimatedLoaderProps) {
  return (
    <div className="animated-loader">
      <div className="loader-content">
        {/* 动画加载器 */}
        <div className="loader-spinner">
          <div className="spinner-ring"></div>
          <div className="spinner-ring"></div>
          <div className="spinner-ring"></div>
        </div>

        {/* 消息 */}
        <p className="loader-message">{message}</p>

        {/* 进度条 */}
        {progress !== undefined && (
          <div className="loader-progress">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
            <span className="progress-text">{Math.round(progress)}%</span>
          </div>
        )}

        {/* 步骤指示器 */}
        {steps && steps.length > 0 && (
          <div className="loader-steps">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className={`step-item ${
                  idx < currentStep ? 'completed' : idx === currentStep ? 'active' : ''
                }`}
              >
                <div className="step-indicator">
                  {idx < currentStep ? '✓' : idx + 1}
                </div>
                <span className="step-label">{step}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
