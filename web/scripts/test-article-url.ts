import assert from "node:assert/strict"
import {
  articleSlugFromId,
  articleWorkspacePath,
  slugifyArticleTitle,
} from "../shared/articleUrl.ts"

assert.equal(slugifyArticleTitle("Writing Better URLs"), "writing-better-urls")
assert.equal(slugifyArticleTitle("  写作，也有小无相功  "), "写作-也有小无相功")
assert.equal(slugifyArticleTitle("SEO_url__Guide"), "seo-url-guide")
assert.equal(slugifyArticleTitle("Don't Repeat---Separators"), "dont-repeat-separators")
assert.equal(slugifyArticleTitle("___"), "untitled-article")

assert.equal(articleSlugFromId("20260929-Writing_URLs"), "writing-urls")
assert.equal(articleSlugFromId("local:20260929-我的第一篇文章"), "我的第一篇文章")
assert.equal(articleSlugFromId("20260929"), "untitled-article")

assert.equal(
  articleWorkspacePath("editor", "20260929-writing", "Writing Better URLs"),
  "/articles/20260929-writing/writing-better-urls",
)
assert.equal(
  articleWorkspacePath("preview", "local:20260929-中文标题", "中文标题"),
  "/previews/local%3A20260929-%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98/%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98",
)

console.log("Semantic article URL generation passed")
