import type { ArticleWorkflowStage } from "../../shared/articleWorkflow"
import { articleWorkspacePath } from "../../shared/articleUrl"

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

interface ArticleUrlOptions {
  title?: string
  platform?: PublishPlatform
}

export function articleEditorUrl(articleId: string, options: ArticleUrlOptions = {}): string {
  const path = articleWorkspacePath("editor", articleId, options.title)
  return options.platform ? `${path}?tab=publish&platform=${options.platform}` : path
}

export function articlePreviewUrl(articleId: string, title?: string, platform?: PublishPlatform): string {
  const path = articleWorkspacePath("preview", articleId, title)
  return platform ? `${path}?platform=${platform}` : path
}
