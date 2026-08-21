import { ReactNode } from "react"
import { ArrowLeft } from "lucide-react"
import "./PageHeader.css"

interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  backLabel?: string
  onBack?: () => void
  className?: string
}

export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  backLabel = "返回",
  onBack,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`page-header ${className}`.trim()}>
      <div className="page-header__identity">
        {onBack ? (
          <button className="page-header__back" onClick={onBack}>
            <ArrowLeft size={15} />
            <span>{backLabel}</span>
          </button>
        ) : null}
        <div className="page-header__heading">
          <div className="page-header__title">
            {icon ? <span className="page-header__icon">{icon}</span> : null}
            <div className="page-header__title-text">{title}</div>
          </div>
          {subtitle ? <div className="page-header__subtitle">{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  )
}
