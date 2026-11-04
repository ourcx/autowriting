import assert from 'node:assert/strict'
import { openRouterForbiddenMessage } from '../server/utils/openrouterError.ts'

const denied = openRouterForbiddenMessage({
  error: { message: 'The request is prohibited due to a violation of provider Terms Of Service.', code: 403 },
  user_id: 'private-user-id',
})
assert.match(denied, /服务商条款拒绝/)
assert.doesNotMatch(denied, /private-user-id|Terms Of Service/)
assert.match(openRouterForbiddenMessage({ error: { message: 'Request blocked by guardrail' } }), /模型权限、预算和内容规则/)

console.log('OpenRouter 403 错误提示测试通过')
