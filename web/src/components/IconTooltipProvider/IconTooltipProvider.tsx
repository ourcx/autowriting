import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import "./IconTooltipProvider.css"

interface TooltipState {
  text: string
  left: number
  top: number
  placement: "top" | "bottom"
}

const INTERACTIVE_SELECTOR = '[data-tooltip], button, a[href], [role="button"]'

const SYMBOL_LABELS: Record<string, string> = {
  "×": "关闭",
  "✕": "关闭",
  "✖": "关闭",
}

const ICON_LABELS: Record<string, string> = {
  "lucide-arrow-down": "下移",
  "lucide-arrow-up": "上移",
  "lucide-copy": "复制",
  "lucide-download": "下载",
  "lucide-edit": "编辑",
  "lucide-external-link": "在新窗口打开",
  "lucide-eye": "显示",
  "lucide-eye-off": "隐藏",
  "lucide-link-2-off": "解绑",
  "lucide-move-vertical": "适应内容高度",
  "lucide-pen": "编辑",
  "lucide-redo-2": "重做",
  "lucide-refresh-cw": "刷新",
  "lucide-save": "保存",
  "lucide-trash-2": "删除",
  "lucide-undo-2": "撤销",
  "lucide-x": "关闭",
}

function inferredIconLabel(target: HTMLElement): string {
  const icon = target.querySelector("svg")
  if (!icon) return ""
  for (const className of icon.classList) {
    if (ICON_LABELS[className]) return ICON_LABELS[className]
  }
  return ""
}

function getTooltipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  const target = node.closest<HTMLElement>(INTERACTIVE_SELECTOR)
  if (!target) return null

  const forcedText = target.dataset.tooltip?.trim()
  const visibleText = target.innerText.replace(/\s+/g, " ").trim()
  const isSymbolOnly = Boolean(SYMBOL_LABELS[visibleText])
  if (!forcedText && visibleText && !isSymbolOnly) return null

  const text = getTooltipText(target)
  return text ? target : null
}

function getTooltipText(target: HTMLElement): string {
  const visibleText = target.innerText.replace(/\s+/g, " ").trim()
  return (
    target.dataset.tooltip?.trim()
    || target.getAttribute("title")?.trim()
    || target.getAttribute("aria-label")?.trim()
    || SYMBOL_LABELS[visibleText]
    || inferredIconLabel(target)
    || ""
  )
}

export default function IconTooltipProvider() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const activeTarget = useRef<HTMLElement | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    function clearTimer() {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }

    function restoreNativeTitle(target: HTMLElement | null) {
      if (!target) return
      const title = target.dataset.tooltipNativeTitle
      if (title !== undefined) {
        target.setAttribute("title", title)
        delete target.dataset.tooltipNativeTitle
      }
    }

    function hide() {
      clearTimer()
      restoreNativeTitle(activeTarget.current)
      activeTarget.current = null
      setTooltip(null)
    }

    function show(target: HTMLElement, delay: number) {
      const text = getTooltipText(target)
      if (!text) return
      if (activeTarget.current !== target) {
        restoreNativeTitle(activeTarget.current)
        activeTarget.current = target
      }
      const nativeTitle = target.getAttribute("title")
      if (nativeTitle !== null && target.dataset.tooltipNativeTitle === undefined) {
        target.dataset.tooltipNativeTitle = nativeTitle
        target.removeAttribute("title")
      }
      clearTimer()
      timer.current = window.setTimeout(() => {
        const rect = target.getBoundingClientRect()
        const estimatedWidth = Math.min(240, Math.max(48, Array.from(text).length * 12 + 18))
        const halfWidth = Math.min(estimatedWidth / 2, Math.max(0, (window.innerWidth - 24) / 2))
        const center = rect.left + rect.width / 2
        const placement = rect.top >= 56 ? "top" : "bottom"
        setTooltip({
          text: text.slice(0, 160),
          left: Math.min(Math.max(center, 12 + halfWidth), window.innerWidth - 12 - halfWidth),
          top: placement === "top" ? rect.top - 9 : rect.bottom + 9,
          placement,
        })
        timer.current = null
      }, delay)
    }

    function handlePointerOver(event: PointerEvent) {
      if (event.pointerType === "touch") return
      const target = getTooltipTarget(event.target)
      if (!target || target === activeTarget.current) return
      show(target, 280)
    }

    function handlePointerOut(event: PointerEvent) {
      const target = activeTarget.current
      if (!target) return
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return
      hide()
    }

    function handleFocusIn(event: FocusEvent) {
      const target = getTooltipTarget(event.target)
      if (target) show(target, 80)
    }

    function handleFocusOut(event: FocusEvent) {
      const target = activeTarget.current
      if (!target) return
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return
      hide()
    }

    document.addEventListener("pointerover", handlePointerOver)
    document.addEventListener("pointerout", handlePointerOut)
    document.addEventListener("focusin", handleFocusIn)
    document.addEventListener("focusout", handleFocusOut)
    document.addEventListener("pointerdown", hide)
    window.addEventListener("scroll", hide, true)
    window.addEventListener("resize", hide)
    return () => {
      clearTimer()
      restoreNativeTitle(activeTarget.current)
      activeTarget.current = null
      document.removeEventListener("pointerover", handlePointerOver)
      document.removeEventListener("pointerout", handlePointerOut)
      document.removeEventListener("focusin", handleFocusIn)
      document.removeEventListener("focusout", handleFocusOut)
      document.removeEventListener("pointerdown", hide)
      window.removeEventListener("scroll", hide, true)
      window.removeEventListener("resize", hide)
    }
  }, [])

  if (!tooltip) return null
  return createPortal(
    <div
      className="icon-tooltip"
      data-placement={tooltip.placement}
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.text}
    </div>,
    document.body,
  )
}
