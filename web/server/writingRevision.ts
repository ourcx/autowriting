import { z } from "zod"
import { stripEmoji } from "../shared/contentProduction.ts"
import { describeWritingModelFailure, type StartWritingStep } from "./articleWritingAgent.ts"
import { draftAnchorIssues, WRITING_EDITOR_RULES, WRITING_REVIEW_RULES } from "./writingAgentPolicy.ts"

const reviewSchema = z.object({ issues: z.array(z.object({
  excerpt: z.string().trim().min(1),
  action: z.string().trim().min(1),
})) })

interface WritingRevisionOptions {
  draft: string
  signal: AbortSignal
  model: string
  startStep: StartWritingStep
  progress: (_message: string) => void
  complete: (_system: string, _user: string, _timeout: number) => Promise<string>
}

export async function reviseArticleDraft({ draft, signal, model, startStep, progress, complete }: WritingRevisionOptions) {
  progress("独立审稿正在检查初稿")
  const finishReview = startStep("review", "独立审稿", model)
  let notes: string[] = []
  try {
    const raw = await complete(WRITING_REVIEW_RULES, draft, 45_000)
    signal.throwIfAborted()
    const review = reviewSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")))
    notes = review.issues.filter(issue => draft.includes(issue.excerpt)).map(issue => `原句：${issue.excerpt}\n修改建议：${issue.action}`)
    finishReview({
      status: notes.length ? "changes_requested" : "done",
      output: notes.length ? notes.join("\n\n") : "未发现需要定向修改的句子，交给优化 Agent 做最后通读。",
    })
  } catch (error) {
    signal.throwIfAborted()
    const reason = error instanceof SyntaxError ? "审稿回复不是有效 JSON。"
      : error instanceof z.ZodError ? "审稿回复缺少有效的原句或修改建议。" : describeWritingModelFailure(error)
    finishReview({ status: "failed", output: `${reason} 优化 Agent 会按文章表达规则独立通读。` })
  }

  let issues: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted()
    progress(attempt === 0 ? "优化 Agent 正在修改初稿" : "优化 Agent 正按复核意见重改")
    const finishEdit = startStep("edit", attempt === 0 ? "优化文章表达" : "按复核意见返工", model)
    let edited: string
    try {
      // 两次都从同一初稿修改，避免把上一次错引的数据带进返工稿。
      edited = stripEmoji(await complete(WRITING_EDITOR_RULES, JSON.stringify({
        draft, notes, corrections: issues,
      }), 90_000)).trim()
      signal.throwIfAborted()
      finishEdit({ output: `收到 ${edited.length} 字改稿，等待复核。` })
    } catch (error) {
      signal.throwIfAborted()
      finishEdit({ status: "failed", output: describeWritingModelFailure(error) })
      issues = ["上次没有拿到完整正文。重新从初稿改写，返回全文和结尾。"]
      continue
    }

    const finishVerify = startStep("verify", "核对改稿", `${attempt + 1} 次核对`)
    issues = draftAnchorIssues(draft, edited)
    if (!issues.length) {
      finishVerify({ output: edited === draft ? "数字、引文和链接核对通过，正文无需改动。" : "数字、引文和链接核对通过，已采用优化稿。" })
      return { content: edited, approved: true }
    }
    finishVerify({ status: attempt === 0 ? "changes_requested" : "failed", output: issues.join("\n") })
  }

  return { content: draft, approved: false }
}
