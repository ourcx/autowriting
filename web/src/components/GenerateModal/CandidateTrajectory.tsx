import { useState } from "react"
import { Activity, ExternalLink } from "lucide-react"
import type { CandidateTraceStep, GenerationCandidate } from "../../../shared/generationCandidate"
import { articleEditorUrl } from "../../utils/articleNavigation"
import "./CandidateTrajectory.css"

interface CandidateTrajectoryProps {
  candidate: GenerationCandidate
  now: number
}

const LABELS = {
  running: "进行中",
  done: "已完成",
  failed: "失败",
  skipped: "未执行",
  interrupted: "已中断",
}

function duration(ms: number): string {
  if (ms < 1000) return "< 1 秒"
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`
  return `${Math.floor(ms / 60_000)} 分 ${Math.floor((ms % 60_000) / 1000)} 秒`
}

function endTime(step: CandidateTraceStep, now: number): number {
  if (step.finishedAt) return Date.parse(step.finishedAt)
  return step.status === "running" ? now : Date.parse(step.startedAt)
}

export default function CandidateTrajectory({ candidate, now }: CandidateTrajectoryProps) {
  const [selectedId, setSelectedId] = useState("")
  const steps = candidate.trace || []
  const selected = steps.find(step => step.id === selectedId) ?? steps[steps.length - 1]
  if (!selected) {
    const pending = candidate.status === "queued" || candidate.status === "generating"
    return <div className="gc-empty ct-empty">
      <Activity size={26} />
      <span>{pending ? "等待 Agent 开始执行" : "这篇候选稿还没有可查看的轨迹"}</span>
      {candidate.status === "interrupted" && <span>{candidate.message}</span>}
    </div>
  }

  const group = steps.filter(step => step.attempt === selected.attempt)
  const start = Date.parse(group[0].startedAt)
  const elapsed = Math.max(1, Math.max(...group.map(step => endTime(step, now))) - start)
  const selectedElapsed = Math.max(0, endTime(selected, now) - Date.parse(selected.startedAt))
  const live = candidate.status === "generating"

  return <section className="ct-panel" aria-label="生成轨迹">
    <div className="ct-heading">
      <div>
        <h3>生成轨迹</h3>
        <p role="status">{candidate.message}</p>
      </div>
      {selectedId && live && <button className="gm-btn-secondary" onClick={() => setSelectedId("")}>跟随最新</button>}
    </div>
    <div className="ct-overview">
      <div className="ct-time"><span>本次开始</span><span>{duration(elapsed)}</span></div>
      <div className="ct-track" aria-label="步骤耗时分布">
        {group.map(step => {
          const offset = (Date.parse(step.startedAt) - start) / elapsed * 100
          const width = (endTime(step, now) - Date.parse(step.startedAt)) / elapsed * 100
          return <button key={step.id} type="button" tabIndex={-1} data-kind={step.kind}
            aria-pressed={selected.id === step.id} data-status={step.status} title={step.title}
            onClick={() => setSelectedId(step.id)}
            style={{ left: `${Math.min(99.6, Math.max(0, offset))}%`, width: `${Math.max(0.4, width)}%` }} />
        })}
      </div>
    </div>
    <div className="ct-workbench">
      <ol className="ct-steps" aria-label="执行步骤">
        {steps.map((step, index) => <li key={step.id}>
          {(index === 0 || step.attempt !== steps[index - 1].attempt) && <div className="ct-attempt">第 {step.attempt} 次运行</div>}
          <button type="button" aria-pressed={selected.id === step.id} onClick={() => setSelectedId(step.id)}>
            <span className="ct-dot" data-status={step.status} aria-hidden="true" />
            <strong>{step.title}</strong>
            <small>{LABELS[step.status]}</small>
          </button>
        </li>)}
      </ol>
      <div className="ct-inspector" aria-label="步骤详情">
        <h4>{selected.title}</h4>
        <p className="ct-meta">
          {LABELS[selected.status]} · {new Date(selected.startedAt).toLocaleTimeString()}
          {(selected.finishedAt || selected.status === "running") && <> · {duration(selectedElapsed)}</>}
        </p>
        {selected.input && <div><h5>输入</h5><p>{selected.input}</p></div>}
        {selected.output && <div><h5>结果</h5><p>{selected.output}</p></div>}
        {Boolean(selected.sources?.length) && <div><h5>相关来源</h5><ul>{selected.sources?.map((source, index) => {
          const href = source.articleId ? articleEditorUrl(source.articleId) : /^https?:\/\//i.test(source.url || "") ? source.url : undefined
          return <li key={`${href || source.title}-${index}`}>
            {href ? <a href={href} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={12} /></a> : source.title}
            {source.publishedAt && <small>{source.publishedAt}</small>}
          </li>
        })}</ul></div>}
        {selected.status === "running" && !selected.output && <p className="ct-meta">等待这一步返回结果</p>}
      </div>
    </div>
  </section>
}
