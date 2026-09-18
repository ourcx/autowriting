import type { RequestHandler } from "express"
import { z } from "zod"

const username = z.string().trim().min(2).max(32).regex(/^[\w\u4e00-\u9fff-]+$/)
const password = z.string().min(6).max(256)

export const authSchemas = {
  register: z.object({ username, password }).strict(),
  login: z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) }).strict(),
  changePassword: z.object({ oldPassword: z.string().min(1).max(256), newPassword: password }).strict(),
}

export const adminSchemas = {
  createUser: z.object({
    username: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/),
    password,
    role: z.enum(["user", "admin"]).default("user"),
  }).strict(),
  setDisabled: z.object({ disabled: z.boolean() }).strict(),
  resetPassword: z.object({ password }).strict(),
}

export const settingsSchemas = {
  updateOne: z.object({ value: z.json() }).strict(),
  updateMany: z.record(
    z.string().min(1).max(128),
    z.json(),
  ).refine((value) => Object.keys(value).length <= 100, "一次最多更新 100 项配置"),
}

export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({
        error: "请求参数不合法",
        fields: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      })
      return
    }
    req.body = result.data
    next()
  }
}
