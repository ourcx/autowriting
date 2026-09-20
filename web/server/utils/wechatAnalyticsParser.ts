interface WechatDailyMetricRow {
  date?: unknown
  scene?: unknown
  read_uv?: unknown
  share_uv?: unknown
  collection_uv?: unknown
  source_uv?: unknown
  mass_pv?: unknown
}

const chinaDateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function readNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function parseWechatDailyMetrics(rows: unknown) {
  if (!Array.isArray(rows)) throw new Error("微信数据概览返回异常")
  const daily = rows.flatMap(row => {
    if (!row || typeof row !== "object") return []
    const source = row as WechatDailyMetricRow
    if (Number(source.scene) !== 9999) return []
    const timestamp = readNonnegativeInteger(source.date)
    const readers = readNonnegativeInteger(source.read_uv)
    const sharers = readNonnegativeInteger(source.share_uv)
    const collectors = readNonnegativeInteger(source.collection_uv)
    const sourceReaders = readNonnegativeInteger(source.source_uv)
    const publishedArticles = readNonnegativeInteger(source.mass_pv)
    if (
      timestamp === null
      || timestamp <= 0
      || readers === null
      || sharers === null
      || collectors === null
      || sourceReaders === null
      || publishedArticles === null
    ) {
      throw new Error("微信数据概览字段发生变化")
    }
    return [{
      date: chinaDateFormatter.format(new Date(timestamp * 1000)),
      readers,
      sharers,
      collectors,
      sourceReaders,
      publishedArticles,
    }]
  }).sort((left, right) => left.date.localeCompare(right.date))
  if (!daily.length) throw new Error("微信数据概览没有可用的每日数据")
  return daily
}
