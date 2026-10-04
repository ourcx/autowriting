import assert from "node:assert/strict"
import { generatePrompt } from "../server/utils/coverPrompt.ts"

const title = "人工智能如何改变内容创作"
const prompt = generatePrompt(title, "这是一篇介绍内容创作工作流的文章。", "photography", "blueberry")

assert.ok(
  prompt.startsWith(`生成一个公众号文章封面，2.35:1，需要简约，不需要实物，给我来点好看的，标题是：${title}。`),
  "默认提示词应使用约定的公众号封面模板并带入标题",
)
assert.match(prompt, /不出现人物、动物、商品、设备、建筑、场景照片或其他写实物体/)
assert.match(prompt, /不使用照片、人物、场景或写实物体/)
assert.match(prompt, /不在图片中绘制标题、文字、Logo、水印或边框/)

console.log("封面默认提示词测试通过")
