---
name: API设计规范
stages:
  - design
  - coding
source: project
priority: high
---

# API 设计规范

> 基于 autowriting 项目实际代码提炼，2026-06-03

## 接口规范

### 路径命名

- RESTful 风格，资源名用复数小写：`/api/articles`、`/api/templates`
- 嵌套资源：`/api/articles/:articleId/generate`
- 操作类 endpoint（非 CRUD）用动词后缀：`/generate`、`/analyze`、`/stream`

### 响应格式

**成功（返回数据）**：直接返回数据对象或数组，不包装额外字段

```
GET /api/articles      → [{ id, title, status, ... }]
GET /api/articles/:id  → { task, materials, article, title }
```

**成功（无数据返回）**：

```json
{ "success": true }
```

**失败**：

```json
{ "error": "可读的错误信息，直接面向用户" }
```

### HTTP 状态码

| 状态码 | 场景 |
|---|---|
| `200` | 成功 |
| `400` | 参数错误 / 业务规则校验失败 |
| `401` | 未登录（Token 缺失或无效） |
| `403` | 无权限（非管理员访问 admin 接口） |
| `500` | 服务器内部错误 |

**特殊说明**：文章不存在时返回空字符串而非 404。这是有意设计——草稿可能处于「目录已创建但内容未生成」的中间态，空字符串表示「内容为空」，不是「资源不存在」。

## 错误处理规范

路由 catch 块统一写法（`logger.js` 已有，用它）：

```js
} catch (error) {
  logger.error('MODULE_NAME', '操作失败描述', { error: error.message })
  res.status(500).json({ error: error.message })
}
```

- 禁止在路由层用 `console.error`，统一用 `logger.error`
- 已预期的非致命错误用 `logger.warn`（如配置缺失、文件不存在）
- `console.log` 只允许临时调试，合并前必须删除

## 鉴权方式

- JWT Bearer Token，通过 `Authorization: Bearer <token>` 头传递
- 整个 router 统一挂 `authMiddleware`，不在单个路由挂：`router.use(authMiddleware)`
- 管理员路由用 `requireAdmin`
- 前端 Token 从 `localStorage.getItem('auth_token')` 获取
- AI 配置从 `loadAIConfig()` 读本地配置

## SSE 流式接口固定模式

新建 SSE 接口必须按以下顺序：

1. 设置 4 个固定响应头
2. `res.flushHeaders()`
3. 逐行解析上游 data
4. `on('end')` 时：调 `recordTokenUsage()` → `send('done')` → `res.end()`

```js
res.setHeader('Content-Type', 'text/event-stream')
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('Connection', 'keep-alive')
res.setHeader('X-Accel-Buffering', 'no')
res.flushHeaders()
```

## Token 用量记录

每个 AI 操作结束时必须调 `recordTokenUsage()`，`operation` 字段固定值：

| 操作 | operation |
|---|---|
| 文章生成 | `generate` |
| 内容分析 | `analyze` |
| 内容编辑 | `edit` |
| 去 AI 化 | `deai` |
| 大纲生成 | `outline` |
| 内容打磨 | `refine` |

## 版本管理

当前无版本前缀（`/api/xxx`），如未来需要引入，统一加 `/api/v2/xxx`，旧接口保持兼容。
