import assert from "node:assert/strict"
import test from "node:test"
import { shouldSkipApiRateLimit } from "../server/utils/rateLimit.ts"

test("浏览器图片请求不占用通用 API 限流配额", () => {
  assert.equal(shouldSkipApiRateLimit("GET", "/wechat/proxy-img"), true)
  assert.equal(shouldSkipApiRateLimit("GET", "/images/uploads/cover.png"), true)
})

test("业务接口和图片写操作仍受通用 API 限流保护", () => {
  assert.equal(shouldSkipApiRateLimit("GET", "/articles"), false)
  assert.equal(shouldSkipApiRateLimit("POST", "/wechat/proxy-img"), false)
  assert.equal(shouldSkipApiRateLimit("DELETE", "/images/uploads/cover.png"), false)
  assert.equal(shouldSkipApiRateLimit("OPTIONS", "/articles"), true)
})
