import { ExternalLink, FileText } from "lucide-react"
import type { CandidateTraceSource } from "../../../shared/generationCandidate"
import { articleEditorUrl } from "../../utils/articleNavigation"

export default function SourceList({ sources }: { sources: readonly CandidateTraceSource[] }) {
  return <ul className="gc-sources" aria-label="相关来源">
    {sources.map((source, index) => {
      const href = source.articleId ? articleEditorUrl(source.articleId) : /^https?:\/\//i.test(source.url || "") ? source.url : undefined
      const detail = [source.scope === "background" ? "背景资料" : source.scope === "primary" ? "主体来源" : "", source.publishedAt || ""].filter(Boolean).join(" · ")
      const label = <><FileText size={14} aria-hidden="true" /><span>{source.title}{detail && <small>{detail}</small>}</span></>
      return <li key={`${href || source.title}-${index}`}>
        {href ? <a href={href} target="_blank" rel="noreferrer">{label}<ExternalLink size={13} aria-hidden="true" /></a> : <div>{label}</div>}
      </li>
    })}
  </ul>
}
