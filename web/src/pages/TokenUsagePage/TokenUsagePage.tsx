/**
 * Token 用量统计面板  /token-usage
 * 展示：8 指标总览、趋势、I/O 比例、模型分布、操作横向图、明细表
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, TrendingUp, BarChart3, RefreshCw, Cpu } from 'lucide-react'
import PageHeader from '../../components/PageHeader/PageHeader'
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
} from 'recharts'
import './TokenUsagePage.css'

/* ── 类型定义 ── */
interface ByOperation {
  operation:     string
  model:         string
  input_tokens:  number
  output_tokens: number
  total_tokens:  number
  call_count:    number
}
interface ByDay {
  day:          string
  total_tokens: number
  call_count:   number
}
interface Totals {
  input_tokens:  number
  output_tokens: number
  total_tokens:  number
  call_count:    number
  active_days:   number
}
interface UsageData {
  days:        number
  byOperation: ByOperation[]
  byDay:       ByDay[]
  totals:      Totals | null
}

/* ── 操作标签 ── */
const OP_LABELS: Record<string, string> = {
  generate:  '生成文章',
  stream:    '流式生成',
  analyze:   '内容分析',
  refine:    '素材整理',
  outline:   '生成大纲',
  style:     '风格分析',
  cover:     '封面生成',
  materials: '素材生成',
}

/* Clay 品牌色（hex，recharts 不支持 CSS var）*/
const CLAY_HEX = [
  '#a4d4c5', // mint
  '#ffb084', // peach
  '#e8b94a', // ochre
  '#ff4d8b', // pink
  '#ff6b5a', // coral
  '#b8a4ed', // lavender（仅图表内部用）
]
function clayColor(idx: number) { return CLAY_HEX[idx % CLAY_HEX.length] }

/* ── 工具函数 ── */
const PRICE_IN  = 5   // $5  / 1M input
const PRICE_OUT = 15  // $15 / 1M output

function fmtNum(n: number) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
function estimateCost(inp: number, out: number) {
  const c = (inp / 1e6) * PRICE_IN + (out / 1e6) * PRICE_OUT
  return c < 0.01 ? '< $0.01' : `$${c.toFixed(2)}`
}
function fmtDay(day: string) {
  const [, m, d] = day.split('-')
  return `${parseInt(m)}/${parseInt(d)}`
}
function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100)
}

/* ── 自定义 Tooltip（趋势图）── */
function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const tokens = payload.find((p: any) => p.dataKey === 'total_tokens')?.value ?? 0
  const calls  = payload.find((p: any) => p.dataKey === 'call_count')?.value ?? 0
  return (
    <div className="tu-tooltip">
      <div className="tu-tt-date">{label}</div>
      <div className="tu-tt-row">
        <span className="tu-tt-dot" style={{ background: '#a4d4c5' }} />
        <span>Tokens</span>
        <strong>{fmtNum(tokens)}</strong>
      </div>
      <div className="tu-tt-row">
        <span className="tu-tt-dot" style={{ background: '#ff4d8b' }} />
        <span>调用</span>
        <strong>{calls} 次</strong>
      </div>
    </div>
  )
}

/* ── 自定义 Tooltip（操作图）── */
function OpTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="tu-tooltip">
      <div className="tu-tt-date">{OP_LABELS[row.operation] ?? row.operation}</div>
      <div className="tu-tt-row">
        <span>Tokens</span><strong>{fmtNum(row.total_tokens)}</strong>
      </div>
      <div className="tu-tt-row">
        <span>调用</span><strong>{row.call_count} 次</strong>
      </div>
      <div className="tu-tt-row">
        <span>均次</span>
        <strong>{fmtNum(row.call_count ? Math.round(row.total_tokens / row.call_count) : 0)}</strong>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════
   主组件
══════════════════════════════════════════════ */
export default function TokenUsagePage() {
  const navigate = useNavigate()

  const [data,    setData]    = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days,    setDays]    = useState(30)

  function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('auth_token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function fetchUsage(d: number) {
    setLoading(true)
    try {
      const res = await fetch(`/api/settings/token-usage?days=${d}`, { headers: authHeaders() })
      if (!res.ok) throw new Error('拉取失败')
      setData(await res.json())
    } catch { setData(null) }
    finally  { setLoading(false) }
  }

  useEffect(() => { fetchUsage(days) }, [days])

  /* ── 派生数据 ── */
  const totals = data?.totals

  // 操作类型合并（同 op 不同 model）
  const opMerged = (data?.byOperation ?? []).reduce<Record<string, ByOperation>>((acc, row) => {
    if (!acc[row.operation]) { acc[row.operation] = { ...row } }
    else {
      acc[row.operation].input_tokens  += row.input_tokens
      acc[row.operation].output_tokens += row.output_tokens
      acc[row.operation].total_tokens  += row.total_tokens
      acc[row.operation].call_count    += row.call_count
    }
    return acc
  }, {})
  const opList  = Object.values(opMerged).sort((a, b) => b.total_tokens - a.total_tokens)
  const opKeys  = opList.map(o => o.operation)
  const totalForBar = opList.reduce((s, r) => s + r.total_tokens, 0) || 1

  // 模型分布
  const modelMerged = (data?.byOperation ?? []).reduce<Record<string, { total_tokens: number; call_count: number }>>((acc, row) => {
    if (!acc[row.model]) acc[row.model] = { total_tokens: 0, call_count: 0 }
    acc[row.model].total_tokens += row.total_tokens
    acc[row.model].call_count   += row.call_count
    return acc
  }, {})
  const modelList = Object.entries(modelMerged)
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.total_tokens - a.total_tokens)

  // 趋势图数据
  const chartData = (data?.byDay ?? []).map(d => ({ ...d, label: fmtDay(d.day) }))

  // 峰值日
  const peakDay = (data?.byDay ?? []).reduce<ByDay | null>(
    (max, d) => (!max || d.total_tokens > max.total_tokens ? d : max), null
  )

  // 均次消耗
  const avgPerCall = totals && totals.call_count
    ? Math.round(totals.total_tokens / totals.call_count)
    : 0

  // 日均
  const avgPerDay = totals && totals.active_days
    ? Math.round(totals.total_tokens / totals.active_days)
    : 0

  // I/O 比例
  const inputPct  = pct(totals?.input_tokens  ?? 0, totals?.total_tokens ?? 1)
  const outputPct = pct(totals?.output_tokens ?? 0, totals?.total_tokens ?? 1)

  // 估算费用细目
  const costIn  = ((totals?.input_tokens  ?? 0) / 1e6) * PRICE_IN
  const costOut = ((totals?.output_tokens ?? 0) / 1e6) * PRICE_OUT
  const costTotal = costIn + costOut

  /* ── 横向 BarChart 数据（含 label）── */
  const opChartData = opList.map(op => ({
    ...op,
    label: OP_LABELS[op.operation] ?? op.operation,
  }))

  return (
    <div className="tu-root">

      <PageHeader
        title="Token 用量"
        icon={<Zap size={15} className="tu-header-icon" />}
        onBack={() => navigate(-1)}
        actions={<div className="tu-days-switch">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              className={`tu-day-btn${days === d ? ' tu-day-btn--active' : ''}`}
              onClick={() => setDays(d)}
            >{d}天</button>
          ))}
        </div>}
      />

      {/* ══ 加载 ══ */}
      {loading && (
        <div className="tu-loading">
          <RefreshCw size={18} className="tu-spin" />
          加载中...
        </div>
      )}

      {/* ══ 空态 ══ */}
      {!loading && !data && (
        <div className="tu-empty">
          <BarChart3 size={40} strokeWidth={1.5} />
          <p className="tu-empty-title">暂无用量数据</p>
          <p className="tu-empty-sub">生成文章、分析内容后，这里会显示消耗统计</p>
        </div>
      )}

      {/* ══ 主体内容 ══ */}
      {!loading && data && (
        <main className="tu-body">

          {/* ── 4 大指标卡 ── */}
          <div className="tu-kpi-grid">
            <div className="tu-kpi tu-kpi--mint">
              <div className="tu-kpi-label">总消耗</div>
              <div className="tu-kpi-value">{fmtNum(totals?.total_tokens ?? 0)}</div>
              <div className="tu-kpi-sub">tokens · {days} 天</div>
            </div>
            <div className="tu-kpi tu-kpi--peach">
              <div className="tu-kpi-label">调用次数</div>
              <div className="tu-kpi-value">{totals?.call_count ?? 0}</div>
              <div className="tu-kpi-sub">次 AI 调用</div>
            </div>
            <div className="tu-kpi tu-kpi--ochre">
              <div className="tu-kpi-label">活跃天数</div>
              <div className="tu-kpi-value">{totals?.active_days ?? 0}</div>
              <div className="tu-kpi-sub">天 / 共 {days} 天</div>
            </div>
            <div className="tu-kpi tu-kpi--teal">
              <div className="tu-kpi-label">估算费用</div>
              <div className="tu-kpi-value tu-kpi-value--sm">
                {costTotal < 0.01 ? '< $0.01' : `$${costTotal.toFixed(2)}`}
              </div>
              <div className="tu-kpi-sub">GPT-4o 价格参考</div>
            </div>
          </div>

          {/* ── 4 个派生指标小条 ── */}
          <div className="tu-derived-row">
            <div className="tu-derived-cell">
              <span className="tu-derived-label">输入 tokens</span>
              <span className="tu-derived-value">{fmtNum(totals?.input_tokens ?? 0)}</span>
              <span className="tu-derived-pct">{inputPct}%</span>
            </div>
            <div className="tu-derived-cell">
              <span className="tu-derived-label">输出 tokens</span>
              <span className="tu-derived-value">{fmtNum(totals?.output_tokens ?? 0)}</span>
              <span className="tu-derived-pct">{outputPct}%</span>
            </div>
            <div className="tu-derived-cell">
              <span className="tu-derived-label">均次消耗</span>
              <span className="tu-derived-value">{fmtNum(avgPerCall)}</span>
              <span className="tu-derived-pct">tokens/次</span>
            </div>
            <div className="tu-derived-cell">
              <span className="tu-derived-label">日均消耗</span>
              <span className="tu-derived-value">{fmtNum(avgPerDay)}</span>
              <span className="tu-derived-pct">tokens/天</span>
            </div>
          </div>

          {/* ── 中部双列布局 ── */}
          <div className="tu-mid-grid">

            {/* 左列：趋势图 */}
            {chartData.length > 0 && (
              <section className="tu-card tu-card--left">
                <div className="tu-card-hd">
                  <div className="tu-card-title">
                    <TrendingUp size={13} />
                    每日用量趋势
                  </div>
                  <span className="tu-card-hint">柱=tokens · 线=调用次数</span>
                </div>

                <div className="tu-trend-chart">
                  <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart
                      data={chartData}
                      barCategoryGap="32%"
                      margin={{ top: 4, right: 16, left: -10, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} stroke="#e5e5e5" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: '#9a9a9a' }}
                        axisLine={false}
                        tickLine={false}
                        interval={chartData.length > 20 ? 4 : chartData.length > 10 ? 2 : 0}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10, fill: '#9a9a9a' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => fmtNum(v)}
                        width={44}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10, fill: '#ff4d8b' }}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                      />
                      <Tooltip content={<TrendTooltip />} cursor={{ fill: '#f5f0e022' }} />
                      <Bar yAxisId="left" dataKey="total_tokens" radius={[3, 3, 0, 0]} maxBarSize={24}>
                        {chartData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={i === chartData.length - 1 ? '#e8b94a' : '#a4d4c5'}
                          />
                        ))}
                      </Bar>
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="call_count"
                        stroke="#ff4d8b"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: '#ff4d8b' }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* 峰值日小结 */}
                {peakDay && (
                  <div className="tu-peak-row">
                    <span className="tu-peak-label">峰值日</span>
                    <span className="tu-peak-date">{fmtDay(peakDay.day)}</span>
                    <span className="tu-peak-val">{fmtNum(peakDay.total_tokens)} tokens</span>
                    <span className="tu-peak-calls">{peakDay.call_count} 次调用</span>
                  </div>
                )}
              </section>
            )}

            {/* 右列：I/O 比例 + 模型分布 */}
            <div className="tu-right-col">

              {/* I/O 比例卡 */}
              <section className="tu-card">
                <div className="tu-card-hd">
                  <div className="tu-card-title">
                    <Zap size={13} />
                    输入 / 输出比例
                  </div>
                </div>
                {/* 比例条 */}
                <div className="tu-io-bar-wrap">
                  <div className="tu-io-bar-in"  style={{ width: `${inputPct}%` }} />
                  <div className="tu-io-bar-out" style={{ width: `${outputPct}%` }} />
                </div>
                <div className="tu-io-legend">
                  <div className="tu-io-item">
                    <span className="tu-io-dot tu-io-dot--in" />
                    <div>
                      <div className="tu-io-stat">{fmtNum(totals?.input_tokens ?? 0)}</div>
                      <div className="tu-io-meta">输入 · {inputPct}% · ≈${costIn.toFixed(3)}</div>
                    </div>
                  </div>
                  <div className="tu-io-item">
                    <span className="tu-io-dot tu-io-dot--out" />
                    <div>
                      <div className="tu-io-stat">{fmtNum(totals?.output_tokens ?? 0)}</div>
                      <div className="tu-io-meta">输出 · {outputPct}% · ≈${costOut.toFixed(3)}</div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 模型分布卡 */}
              {modelList.length > 0 && (
                <section className="tu-card">
                  <div className="tu-card-hd">
                    <div className="tu-card-title">
                      <Cpu size={13} />
                      模型分布
                    </div>
                  </div>
                  <div className="tu-model-list">
                    {modelList.map((m, i) => (
                      <div key={m.model} className="tu-model-row">
                        <div className="tu-model-left">
                          <span
                            className="tu-model-dot"
                            style={{ background: clayColor(i) }}
                          />
                          <span className="tu-model-name" title={m.model}>
                            {m.model.length > 20 ? m.model.slice(0, 18) + '…' : m.model}
                          </span>
                        </div>
                        <div className="tu-model-right">
                          <div
                            className="tu-model-bar-wrap"
                          >
                            <div
                              className="tu-model-bar"
                              style={{
                                width: `${pct(m.total_tokens, totals?.total_tokens ?? 1)}%`,
                                background: clayColor(i),
                              }}
                            />
                          </div>
                          <span className="tu-model-val">{fmtNum(m.total_tokens)}</span>
                          <span className="tu-model-calls">{m.call_count}次</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>

          {/* ── 操作类型横向 BarChart（全宽）── */}
          {opList.length > 0 && (
            <section className="tu-card">
              <div className="tu-card-hd">
                <div className="tu-card-title">
                  <BarChart3 size={13} />
                  操作类型消耗对比
                </div>
                <span className="tu-card-hint">横轴为 tokens 数量</span>
              </div>
              <div className="tu-op-chart">
                <ResponsiveContainer width="100%" height={Math.max(160, opChartData.length * 42)}>
                  <BarChart
                    layout="vertical"
                    data={opChartData}
                    margin={{ top: 0, right: 64, left: 0, bottom: 0 }}
                    barCategoryGap="28%"
                  >
                    <CartesianGrid horizontal={false} stroke="#e5e5e5" strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#9a9a9a' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={v => fmtNum(v)}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={72}
                      tick={{ fontSize: 12, fill: '#3a3a3a', fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<OpTooltip />} cursor={{ fill: '#f5f0e022' }} />
                    <Bar dataKey="total_tokens" radius={[0, 4, 4, 0]} maxBarSize={20}>
                      {opChartData.map((entry) => (
                        <Cell
                          key={entry.operation}
                          fill={clayColor(opKeys.indexOf(entry.operation))}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* 百分比小条列表 */}
              <div className="tu-op-pct-row">
                {opList.map((row, i) => (
                  <div key={row.operation} className="tu-op-chip">
                    <span className="tu-op-chip-dot" style={{ background: clayColor(i) }} />
                    <span className="tu-op-chip-name">{OP_LABELS[row.operation] ?? row.operation}</span>
                    <span className="tu-op-chip-pct">{pct(row.total_tokens, totalForBar)}%</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── 操作 × 模型明细表 ── */}
          {data.byOperation.length > 0 && (
            <section className="tu-card">
              <div className="tu-card-hd">
                <div className="tu-card-title">
                  <Zap size={13} />
                  操作 × 模型明细
                </div>
                <span className="tu-card-hint">费用按 GPT-4o 公开价格估算，实际以账单为准</span>
              </div>
              <div className="tu-table-wrap">
                <table className="tu-table">
                  <thead>
                    <tr>
                      <th>操作</th>
                      <th>模型</th>
                      <th className="tu-th-r">次数</th>
                      <th className="tu-th-r">输入</th>
                      <th className="tu-th-r">输出</th>
                      <th className="tu-th-r">合计</th>
                      <th className="tu-th-r">均次</th>
                      <th className="tu-th-r">估算费用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byOperation.map((row, i) => {
                      const color = clayColor(opKeys.indexOf(row.operation))
                      const avg   = row.call_count ? Math.round(row.total_tokens / row.call_count) : 0
                      return (
                        <tr key={i}>
                          <td>
                            <span
                              className="tu-op-tag"
                              style={{ background: `${color}30`, color: '#1a1a1a' }}
                            >
                              {OP_LABELS[row.operation] ?? row.operation}
                            </span>
                          </td>
                          <td className="tu-td-model">{row.model}</td>
                          <td className="tu-td-r">{row.call_count}</td>
                          <td className="tu-td-r">{fmtNum(row.input_tokens)}</td>
                          <td className="tu-td-r">{fmtNum(row.output_tokens)}</td>
                          <td className="tu-td-r tu-td-bold">{fmtNum(row.total_tokens)}</td>
                          <td className="tu-td-r tu-td-muted">{fmtNum(avg)}</td>
                          <td className="tu-td-r">{estimateCost(row.input_tokens, row.output_tokens)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        </main>
      )}
    </div>
  )
}
