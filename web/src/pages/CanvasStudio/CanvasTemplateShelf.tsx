import { useRef } from "react"
import { WechatBlockRenderer } from "../../components/WechatBlockEditor/WechatBlockEditor"
import { compileCanvasDesignSystem } from "../../../shared/canvasDesignSystem"
import { CANVAS_DESIGN_TEMPLATES, type CanvasDesignTemplateId } from "../../../shared/canvasDesignTemplates"
import { createWechatBlockDocument } from "../../../shared/wechatBlockDsl"
import type { CanvasSource } from "../../../shared/canvasArticle"

// 缩略图使用真实排版器，避免样板好看、应用到文章后却是另一套样式。
const previewSources: CanvasSource[] = [
  { id: "title", kind: "title", text: "把日常观察，写成有用的分享" },
  { id: "intro", kind: "paragraph", text: "好的表达，始于一个具体的问题。" },
  { id: "lead", kind: "paragraph", text: "从真实经历出发，让读者看到方法，也看到行动的可能。" },
  { id: "heading", kind: "heading", text: "01 从一个小问题开始" },
  { id: "body", kind: "paragraph", text: "记录一个细节，解释一次选择。把复杂的经验拆成清晰的步骤。" },
]
const previews = CANVAS_DESIGN_TEMPLATES.filter(template => template.id !== "design-reference").map(template => ({
  ...template,
  document: compileCanvasDesignSystem(createWechatBlockDocument(template.name, previewSources), previewSources, template.id),
}))

function TemplateThumbnail({ template }: { template: typeof previews[number] }) {
  const ref = useRef<HTMLElement>(null)
  return <div className="cs-template-thumb" aria-hidden="true"><div>
    <WechatBlockRenderer document={template.document} sources={previewSources} selectedId={null} contentRef={ref} onSelect={() => {}} />
  </div></div>
}

interface CanvasTemplateShelfProps {
  selected: CanvasDesignTemplateId
  onSelect: (id: CanvasDesignTemplateId) => void
}

export default function CanvasTemplateShelf({ selected, onSelect }: CanvasTemplateShelfProps) {
  return <div className="cs-template-shelf" role="group" aria-label="文章模板">
    <div className="cs-template-intro"><strong>选择文章的气质</strong><span>先选风格，再应用到正文</span></div>
    {previews.map(template => <button key={template.id} className={`cs-template-card${selected === template.id ? " is-active" : ""}`} aria-pressed={selected === template.id} onClick={event => { onSelect(template.id); event.currentTarget.closest("details")?.removeAttribute("open") }}>
      <TemplateThumbnail template={template} />
      <span><strong>{template.name}</strong><small>{template.description}</small></span>
      <span className="cs-template-check" aria-hidden="true">{selected === template.id ? "✓" : ""}</span>
    </button>)}
  </div>
}
