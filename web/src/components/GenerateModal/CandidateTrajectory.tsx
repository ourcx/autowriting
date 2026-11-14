import Button from "../Button/Button"
import { useState } from "react"
import { Activity, BookOpen, CheckCircle, Circle, FileText, Globe, Loader2, Pencil, Search, SlidersHorizontal, ClipboardList, Sparkles } from "lucide-react"
import type { CandidateTraceStep, GenerationCandidate } from "../../../shared/generationCandidate"
import SourceList from "./SourceList"
import "./CandidateTrajectory.css"

interface CandidateTrajectoryProps {
  candidate: GenerationCandidate
  now: number
}

const ICONS = {
  context: FileText, history: BookOpen, decision: SlidersHorizontal, search: Search,
  read: Globe, find: Search, outline: FileText, write: Pencil, review: ClipboardList, edit: Sparkles, verify: CheckCircle,
}

const LABELS = {
  running: "进行中",
  done: "已完成",
  failed: "失败",
  skipped: "未执行",
  interrupted: "已中断",
  changes_requested: "待修改",
}

function stepStatus(step: CandidateTraceStep) {
  return step.kind === "edit" && step.status === "skipped" ? "未通过" : LABELS[step.status]
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
  const [showDecisions, setShowDecisions] = useState(false)
  const steps = candidate.trace || []
  const latest = steps[steps.length - 1]
  const visible = steps.filter(step => showDecisions || step.kind !== "decision" || step.status === "failed"
    || step.status === "running" || step.id === selectedId)
  const selected = steps.find(step => step.id === selectedId) ?? visible[visible.length - 1] ?? latest
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
  const Icon = ICONS[selected.kind] || Circle

  return <section className="ct-panel" aria-label="生成轨迹">
    <div className="ct-heading">
      <div>
        <h3>生成轨迹</h3>
        <p role="status">{candidate.message}</p>
      </div>
      {selectedId && live && <Button onClick={() => setSelectedId("")}>跟随最新</Button>}
    </div>
    <div className="ct-overview">
      <div className="ct-stages" aria-label="写作阶段">
        {([
          ["找资料", ["context", "history", "search", "read", "find", "decision"]],
          ["写初稿", ["outline", "write"]],
          ["审稿", ["review"]],
          ["优化", ["edit"]],
          ["复核", ["verify"]],
        ] as const).map(([label, kinds]) => {
          const last = [...steps].reverse().find(step => (kinds as readonly string[]).includes(step.kind))
          return <Button key={label} className="ct-stage" disabled={!last} data-status={last?.status}
            aria-pressed={Boolean(last && last.id === selected.id)} onClick={() => last && setSelectedId(last.id)}>
            {last?.status === "done" ? <CheckCircle size={13} /> : last?.status === "running" ? <Loader2 size={13} className="gc-spin" /> : <Circle size={12} />}
            {label}
          </Button>
        })}
      </div>
      <div className="ct-time"><span>本次开始</span><span>{duration(elapsed)}</span></div>
      <div className="ct-track" aria-label="步骤耗时分布">
        {group.filter(step => showDecisions || step.kind !== "decision" || step.status === "failed" || step.id === selected.id).map(step => {
          const offset = (Date.parse(step.startedAt) - start) / elapsed * 100
          const width = (endTime(step, now) - Date.parse(step.startedAt)) / elapsed * 100
          return <Button variant="plain" key={step.id} type="button" tabIndex={-1} data-kind={step.kind}
            aria-pressed={selected.id === step.id} data-status={step.status} title={step.title}
            onClick={() => setSelectedId(step.id)}
            style={{ left: `${Math.min(99.6, Math.max(0, offset))}%`, width: `${Math.max(0.4, width)}%` }} />
        })}
      </div>
    </div>
    <div className="ct-workbench">
      <div className="ct-log">
        <div className="ct-log-head">
          <strong>执行记录</strong>
          <Button className="ct-detail-toggle" aria-pressed={showDecisions} onClick={() => setShowDecisions(!showDecisions)}>
            <SlidersHorizontal size={13} />{showDecisions ? "收起决策" : "展开决策"}
          </Button>
        </div>
        <ol className="ct-steps" aria-label="执行步骤">
          {visible.map((step, index) => {
            const StepIcon = step.status === "running" ? Loader2 : ICONS[step.kind] || Circle
            return <li key={step.id}>
              {(index === 0 || step.attempt !== visible[index - 1].attempt) && <div className="ct-attempt">第 {step.attempt} 次运行</div>}
              <Button variant="plain" aria-pressed={selected.id === step.id} onClick={() => setSelectedId(step.id)}>
                <span className="ct-step-icon" data-status={step.status}><StepIcon size={15} aria-hidden="true" /></span>
                <strong>{step.title}</strong>
                <small>{stepStatus(step)}</small>
              </Button>
            </li>
          })}
        </ol>
      </div>
      <div className="ct-inspector" aria-label="步骤详情">
        <div className="ct-inspector-title"><span className="ct-step-icon" data-status={selected.status}><Icon size={17} /></span><h4>{selected.title}</h4></div>
        <p className="ct-meta">
          {stepStatus(selected)} · {new Date(selected.startedAt).toLocaleTimeString()}
          {(selected.finishedAt || selected.status === "running") && <> · {duration(selectedElapsed)}</>}
        </p>
        {selected.input && <div><h5>输入</h5><p>{selected.input}</p></div>}
        {selected.output && <div><h5>结果</h5><p>{selected.output}</p></div>}
        {!!selected.sources?.length && <div><h5>相关来源</h5><SourceList sources={selected.sources} /></div>}
        {selected.status === "running" && !selected.output && <p className="ct-meta">等待这一步返回结果</p>}
      </div>
    </div>
  </section>
}
