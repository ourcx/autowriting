import type { ArticleWorkflowStage } from "../../shared/articleWorkflow"

export type EditorTab = "task" | "materials" | "article" | "analysis" | "publish" | "toutiao" | "xiaohongshu" | "cover" | "library"
export type PublishPlatform = "wechat" | "toutiao" | "xiaohongshu"

const EDITOR_TABS: EditorTab[] = ["task", "materials", "article", "analysis", "publish", "toutiao", "xiaohongshu", "cover", "library"]
const STAGE_TABS: Record<ArticleWorkflowStage, EditorTab> = {
  brief: "task",
  materials: "materials",
  drafting: "article",
  review: "analysis",
  ready: "publish",
  wechat_draft: "publish",
}

export function resolveEditorTab(value: string | null, stage: ArticleWorkflowStage): EditorTab {
  return EDITOR_TABS.find(tab => tab === value) || STAGE_TABS[stage]
}

export function resolvePublishPlatform(value: string | null): PublishPlatform {
  return value === "toutiao" || value === "xiaohongshu" ? value : "wechat"
}

export function articleEditorUrl(articleId: string, platform?: PublishPlatform): string {
  const path = `/editor/${encodeURIComponent(articleId)}`
  return platform ? `${path}?tab=publish&platform=${platform}` : path
}
