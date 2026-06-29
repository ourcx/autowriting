/**
 * 全局 Toast 通知组件
 * 用法：
 *   import { toast } from '../Toast/Toast'
 *   toast.success('保存成功')
 *   toast.error('保存失败')
 *   toast.warn('请先配置 Key')
 *   toast.info('已复制到剪贴板')
 *   toast.confirm('确定删除？', () => doDelete())
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import './Toast.css'

// ── 类型定义 ────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'warn' | 'info'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastItem {
  id: number
  type: ToastType
  message: string
  duration: number   // 0 = 不自动消失
  action?: ToastAction
}

interface ConfirmItem {
  id: number
  message: string
  detail?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel?: () => void
}

// ── 全局事件总线 ─────────────────────────────────────────────

interface ToastOptions {
  duration?: number
  action?: ToastAction
}

type ToastEvent = { type: ToastType; message: string } & ToastOptions
type ConfirmEvent = Omit<ConfirmItem, 'id'>

let _toastDispatch: ((e: ToastEvent) => void) | null = null
let _confirmDispatch: ((e: ConfirmEvent) => void) | null = null
let _idSeq = 0

// ── 公开 API ─────────────────────────────────────────────────

export const toast = {
  success: (msg: string, opts?: ToastOptions | number) => {
    const o = typeof opts === 'number' ? { duration: opts } : opts
    _toastDispatch?.({ type: 'success', message: msg, duration: 2500, ...o })
  },
  error: (msg: string, opts?: ToastOptions | number) => {
    // 错误默认不自动消失（duration: 0），需要用户手动关闭
    const o = typeof opts === 'number' ? { duration: opts } : opts
    _toastDispatch?.({ type: 'error', message: msg, duration: 0, ...o })
  },
  warn: (msg: string, opts?: ToastOptions | number) => {
    const o = typeof opts === 'number' ? { duration: opts } : opts
    _toastDispatch?.({ type: 'warn', message: msg, duration: 4000, ...o })
  },
  info: (msg: string, opts?: ToastOptions | number) => {
    const o = typeof opts === 'number' ? { duration: opts } : opts
    _toastDispatch?.({ type: 'info', message: msg, duration: 2500, ...o })
  },
}

export function showConfirm(opts: Omit<ConfirmItem, 'id'>) {
  _confirmDispatch?.(opts)
}

// ── Toast Provider ────────────────────────────────────────────

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error:   <XCircle size={16} />,
  warn:    <AlertTriangle size={16} />,
  info:    <Info size={16} />,
}

export default function ToastProvider() {
  const [toasts, setToasts]     = useState<ToastItem[]>([])
  const [confirms, setConfirms] = useState<ConfirmItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.map(t =>
      t.id === id ? { ...t, _exiting: true } as ToastItem & { _exiting: boolean } : t
    ))
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 300)
  }, [])

  const addToast = useCallback((e: ToastEvent) => {
    const id = ++_idSeq
    const item: ToastItem = {
      id, type: e.type, message: e.message,
      duration: e.duration ?? 2500,
      action: e.action,
    }
    setToasts(prev => [...prev, item])
    // duration=0 时不自动消失
    if (item.duration > 0) {
      const t = setTimeout(() => removeToast(id), item.duration)
      timers.current.set(id, t)
    }
  }, [removeToast])

  const addConfirm = useCallback((e: ConfirmEvent) => {
    const id = ++_idSeq
    setConfirms(prev => [...prev, { ...e, id }])
  }, [])

  useEffect(() => {
    _toastDispatch  = addToast
    _confirmDispatch = addConfirm
    return () => {
      _toastDispatch  = null
      _confirmDispatch = null
    }
  }, [addToast, addConfirm])

  const handleConfirmOk = (item: ConfirmItem) => {
    item.onConfirm()
    setConfirms(prev => prev.filter(c => c.id !== item.id))
  }
  const handleConfirmCancel = (item: ConfirmItem) => {
    item.onCancel?.()
    setConfirms(prev => prev.filter(c => c.id !== item.id))
  }

  return (
    <>
      {/* ── Toast 堆叠 ── */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`toast-item toast-${t.type}`}
          >
            <span className="toast-icon">{ICONS[t.type]}</span>
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => { t.action!.onClick(); removeToast(t.id) }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-close" onClick={e => { e.stopPropagation(); removeToast(t.id) }}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* ── Confirm 对话框 ── */}
      {confirms.map(c => (
        <div key={c.id} className="toast-overlay" onClick={() => handleConfirmCancel(c)}>
          <div className="toast-dialog" onClick={e => e.stopPropagation()}>
            <p className="toast-dialog-msg">{c.message}</p>
            {c.detail && <p className="toast-dialog-detail">{c.detail}</p>}
            <div className="toast-dialog-actions">
              <button
                className="toast-dialog-cancel"
                onClick={() => handleConfirmCancel(c)}
              >
                {c.cancelText ?? '取消'}
              </button>
              <button
                className={`toast-dialog-confirm ${c.danger ? 'danger' : ''}`}
                onClick={() => handleConfirmOk(c)}
              >
                {c.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  )
}
