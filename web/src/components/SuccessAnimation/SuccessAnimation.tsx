import React, { useEffect, useState } from 'react'
import { CheckCircle } from 'lucide-react'
import './SuccessAnimation.css'

interface SuccessAnimationProps {
  message: string
  duration?: number
  onComplete?: () => void
}

export default function SuccessAnimation({
  message,
  duration = 2000,
  onComplete,
}: SuccessAnimationProps) {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      onComplete?.()
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onComplete])

  if (!isVisible) return null

  return (
    <div className="success-animation">
      <div className="success-content">
        <div className="success-icon">
          <CheckCircle size={64} />
        </div>
        <p className="success-message">{message}</p>
      </div>
    </div>
  )
}
