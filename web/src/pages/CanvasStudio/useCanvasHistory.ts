import { useCallback, useState } from "react"
import type { WechatBlockDocument } from "../../../shared/wechatBlockDsl"

// 文档状态只能表达当前排版；额外保留有限历史，支持试排和属性修改后撤销，切换文章时清空。
export function useCanvasHistory(initial: () => WechatBlockDocument) {
  const [history, setHistory] = useState(() => ({
    past: [] as WechatBlockDocument[], present: initial(), future: [] as WechatBlockDocument[],
  }))
  const change = useCallback((document: WechatBlockDocument) => {
    setHistory(current => ({ past: [...current.past.slice(-29), current.present], present: document, future: [] }))
  }, [])
  const reset = useCallback((document: WechatBlockDocument) => {
    setHistory({ past: [], present: document, future: [] })
  }, [])
  const undo = useCallback(() => setHistory(current => {
    const previous = current.past[current.past.length - 1]
    return previous ? {
      past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future],
    } : current
  }), [])
  const redo = useCallback(() => setHistory(current => {
    const next = current.future[0]
    return next ? {
      past: [...current.past, current.present], present: next, future: current.future.slice(1),
    } : current
  }), [])
  return { document: history.present, change, reset, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0 }
}
