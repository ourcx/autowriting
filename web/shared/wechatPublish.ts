import { z } from "zod"

export const wechatCommentModeSchema = z.enum(["keep", "all", "fans", "off"])

export const wechatBrowserPublishOptionsSchema = z.object({
  declareOriginal: z.boolean().default(false),
  commentMode: wechatCommentModeSchema.default("keep"),
  enableAllAds: z.boolean().default(false),
})

export type WechatCommentMode = z.infer<typeof wechatCommentModeSchema>
export type WechatBrowserPublishOptions = z.infer<typeof wechatBrowserPublishOptionsSchema>

export const DEFAULT_WECHAT_BROWSER_PUBLISH_OPTIONS: WechatBrowserPublishOptions = {
  declareOriginal: false,
  commentMode: "keep",
  enableAllAds: false,
}
