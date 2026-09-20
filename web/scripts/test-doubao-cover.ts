import assert from "node:assert/strict"
import {
  buildDoubaoImageRequest,
  parseDoubaoImageResponse,
} from "../server/utils/doubaoImage.ts"

assert.deepEqual(
  buildDoubaoImageRequest("一张克制的公众号封面", "ep-test"),
  {
    model: "ep-test",
    prompt: "一张克制的公众号封面",
    size: "2048x1152",
    response_format: "b64_json",
  },
)

assert.equal(
  parseDoubaoImageResponse({
    data: [{ b64_json: "aGVsbG8=", output_format: "jpeg" }],
  }),
  "data:image/jpeg;base64,aGVsbG8=",
)

assert.equal(
  parseDoubaoImageResponse({
    data: [{ url: "https://example.com/cover.png" }],
  }),
  "https://example.com/cover.png",
)

assert.throws(
  () => parseDoubaoImageResponse({ data: [] }),
  /未返回图片/,
)

process.stdout.write("doubao cover adapter tests passed\n")
