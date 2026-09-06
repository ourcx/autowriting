import type { ButtonHTMLAttributes } from "react"
import "./Button.css"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "secondary" | "primary" | "danger"
}

// 只统一原生按钮的外观与交互，页面负责权限、请求和加载状态。
export default function Button({ variant = "secondary", className = "", type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} className={`ui-button ui-button--${variant} ${className}`.trim()} />
}
