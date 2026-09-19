import { useEffect } from "react"
import { recordEditingActivity } from "../../utils/apiHelpers"

export function useEditingActivity(articleId: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const sessionId = crypto.randomUUID()
    let lastInteraction = 0
    let lastTick = Date.now()
    let totalMs = 0
    let acknowledged = 0
    let pending = false
    const activity = () => { lastInteraction = Date.now() }
    const tick = () => {
      const now = Date.now()
      if (document.visibilityState === "visible" && document.hasFocus() && now - lastInteraction <= 30000) {
        totalMs += Math.min(5000, Math.max(0, now - lastTick))
      }
      lastTick = now
    }
    const flush = () => {
      if (pending || totalMs === acknowledged) return
      pending = true
      const checkpoint = totalMs
      void recordEditingActivity(articleId, sessionId, checkpoint).then(() => {
        acknowledged = checkpoint
      }).catch(() => {
        // The next cumulative checkpoint retries without double counting.
      }).finally(() => { pending = false })
    }
    const visibility = () => {
      tick()
      if (document.visibilityState !== "visible") { lastInteraction = 0; flush() }
    }
    const events = ["keydown", "input", "pointerdown", "scroll"] as const
    events.forEach(event => window.addEventListener(event, activity, { capture: true, passive: true }))
    document.addEventListener("visibilitychange", visibility)
    const sampleTimer = window.setInterval(tick, 5000)
    const flushTimer = window.setInterval(flush, 30000)
    return () => {
      tick()
      flush()
      window.clearInterval(sampleTimer)
      window.clearInterval(flushTimer)
      events.forEach(event => window.removeEventListener(event, activity, true))
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [articleId, enabled])
}
