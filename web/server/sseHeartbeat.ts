import type { ServerResponse } from 'node:http'

/** 等待检索或模型首段输出时保持下行活跃，避免代理按空闲连接超时切断 SSE。 */
export function startSseHeartbeat(response: ServerResponse): void {
  const stop = () => {
    clearInterval(timer)
    response.off('close', stop)
    response.off('finish', stop)
  }
  const ping = () => {
    if (response.destroyed || response.writableEnded) {
      stop()
      return
    }
    // SSE 注释不会触发业务事件，也不会混进文章正文。
    response.write(': heartbeat\n\n')
  }
  const timer = setInterval(ping, 15_000)
  timer.unref()
  // 正常结束和客户端中断都清理定时器，不让断连的请求继续发送心跳。
  response.once('close', stop)
  response.once('finish', stop)
  ping()
}
