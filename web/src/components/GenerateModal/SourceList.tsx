import { ExternalLink, FileText } from "lucide-react"
import type { CandidateTraceSource } from "../../../shared/generationCandidate"
import { articleEditorUrl } from "../../utils/articleNavigation"

export default function SourceList({ sources }: { sources: readonly CandidateTraceSource[] }) {
  return <ul className="gc-sources" aria-label="相关来源">
    {sources.map((source, index) => {
      const href = source.articleId ? articleEditorUrl(source.articleId) : /^https?:\/\//i.test(source.url || "") ? source.url : undefined
      const label = <><FileText size={14} aria-hidden="true" /><span>{source.title}{source.publishedAt && <small>{source.publishedAt}</small>}</span></>
      return <li key={`${href || source.title}-${index}`}>
        {href ? <a href={href} target="_blank" rel="noreferrer">{label}<ExternalLink size={13} aria-hidden="true" /></a> : <div>{label}</div>}
      </li>
    })}
  </ul>
}
