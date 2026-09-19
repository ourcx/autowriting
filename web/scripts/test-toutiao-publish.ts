import assert from "node:assert/strict"
import { assertToutiaoPublishConfirmed, isToutiaoPublishEndpoint, verifyToutiaoPublishResponse } from "../server/utils/toutiaoPublish.ts"

assert.equal(isToutiaoPublishEndpoint("https://mp.toutiao.com/mp/article/publish/"), true)
assert.equal(isToutiaoPublishEndpoint("https://mp.toutiao.com/mp/article/save_draft/"), false)
assert.equal(isToutiaoPublishEndpoint("https://mp.toutiao.com/profile_v4/graphic/publish", "GET"), false)

assert.deepEqual(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":0,"data":{"article_id":"1"}}'),
  { confirmed: true, detail: "发布接口明确返回成功" },
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":1,"message":"审核参数缺失","data":{"article_id":"1"}}').confirmed,
  false,
  "响应中带 article_id 不能覆盖失败 code",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":1,"success":true}').confirmed,
  false,
  "明确失败 code 不能被 success 字段覆盖",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"success":false,"message":"success"}').confirmed,
  false,
  "明确 success=false 不能被成功文案覆盖",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":0,"success":false}').confirmed,
  false,
  "明确 success=false 不能被零错误码覆盖",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":"0"}').confirmed,
  true,
  "字符串零错误码也应识别为成功",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/save_draft/", 200, '{"code":0,"message":"success"}').confirmed,
  false,
  "保存草稿不能算发布成功",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 500, '{"code":0,"message":"success"}').confirmed,
  false,
  "非 2xx 响应不能算发布成功",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, "<html>login</html>").confirmed,
  false,
  "登录页或 HTML 响应不能算发布成功",
)
assert.throws(
  () => assertToutiaoPublishConfirmed(false),
  /未收到今日头条的发布成功确认/,
  "未确认发布时不得返回成功",
)
assert.doesNotThrow(() => assertToutiaoPublishConfirmed(true))

process.stdout.write("toutiao publish evidence tests passed\n")
