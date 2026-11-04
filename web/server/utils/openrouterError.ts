export function openRouterForbiddenMessage(data: unknown): string {
  const response = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const error = response.error && typeof response.error === 'object'
    ? response.error as Record<string, unknown>
    : {}
  const providerTermsDenied = typeof error.message === 'string'
    && /violation of provider terms of service/i.test(error.message)

  if (providerTermsDenied) {
    return 'OpenRouter 的服务商条款拒绝了 GPT Image 2 请求（403）。请在 OpenRouter 控制台核对该模型的访问资格；如仍被拒绝，请联系 OpenRouter 支持。'
  }
  return 'OpenRouter 拒绝了图片生成请求（403）。请检查该 Key 的模型权限、预算和内容规则。'
}
