# 🔧 API 路由修复总结

**修复日期**：2026-04-30  
**问题**：前端 404 错误 - API 路由不匹配  
**状态**：✅ 已修复

---

## 📋 问题描述

### 错误信息
```
Failed to load resource: the server responded with a status of 404 (Not Found)
CoverGenerator.tsx:116 Cover generation error: Error: 生成封面失败
POST http://localhost:5173/api/generate-cover 404 (Not Found)
```

### 根本原因

1. **Vite 代理配置问题**
   - 原配置：`rewrite: (path) => path.replace(/^\/api/, '')`
   - 问题：把 `/api/generate-cover` 改写成 `/generate-cover`
   - 后端期望：`/api/generate-cover`

2. **后端路由不统一**
   - 大部分路由：`/articles`（无 `/api` 前缀）
   - 生成封面路由：`/api/generate-cover`（有 `/api` 前缀）
   - 前端期望：所有路由都有 `/api` 前缀

3. **TypeScript 类型检查问题**
   - CSS 导入缺少类型声明
   - 需要 `vite-env.d.ts` 文件

---

## ✅ 修复方案

### 1. 修复 Vite 代理配置

**文件**：`web/vite.config.ts`

```typescript
// ❌ 之前（错误）
proxy: {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, '')  // 移除 /api 前缀
  }
}

// ✅ 之后（正确）
proxy: {
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true
    // 不需要 rewrite，保留 /api 前缀
  }
}
```

**原理**：
- Vite 代理会把 `/api/*` 的请求转发到 `http://localhost:3000/api/*`
- 不需要移除 `/api` 前缀，后端已经期望这个前缀

### 2. 统一后端路由

**文件**：`web/server.js`

所有路由都添加 `/api` 前缀：

```javascript
// ❌ 之前
app.get('/articles', ...)
app.get('/articles/:dateDir', ...)
app.post('/articles/:dateDir', ...)
app.post('/articles/:dateDir/generate', ...)
app.delete('/articles/:dateDir', ...)

// ✅ 之后
app.get('/api/articles', ...)
app.get('/api/articles/:dateDir', ...)
app.post('/api/articles/:dateDir', ...)
app.post('/api/articles/:dateDir/generate', ...)
app.delete('/api/articles/:dateDir', ...)
```

**修改的路由**：
- `GET /api/articles` - 获取文章列表
- `GET /api/articles/:dateDir` - 获取单篇文章
- `POST /api/articles/:dateDir` - 保存文章
- `POST /api/articles/:dateDir/generate` - 生成文章
- `POST /api/generate-cover` - 生成封面（已有 `/api` 前缀）
- `DELETE /api/articles/:dateDir` - 删除文章

### 3. 添加 TypeScript 类型声明

**文件**：`web/src/vite-env.d.ts`（新建）

```typescript
/// <reference types="vite/client" />

declare module '*.css' {
  const content: string
  export default content
}
```

**原理**：
- TypeScript 需要知道如何处理 CSS 导入
- 这个声明告诉 TypeScript CSS 模块导出一个字符串

### 4. 更新 TypeScript 配置

**文件**：`web/tsconfig.json`

```json
{
  "compilerOptions": {
    // ... 其他配置
    "types": ["vite/client"]  // 添加这一行
  }
}
```

---

## 🔍 验证修复

### 前端 API 调用（已正确）

**Dashboard.tsx**：
```typescript
const response = await axios.get('/api/articles')
await axios.delete(`/api/articles/${date}`)
```

**ArticleEditor.tsx**：
```typescript
const response = await axios.get(`/api/articles/${dateDir}`)
await axios.post(`/api/articles/${dateDir}`, data)
await axios.post(`/api/articles/${dateDir}/generate`, { task, materials })
```

**CoverGenerator.tsx**：
```typescript
const response = await fetch('/api/generate-cover', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title, content, style, color, provider })
})
```

### 后端路由（已修复）

所有路由现在都使用 `/api` 前缀，与前端请求一致。

---

## 🚀 如何测试

### 1. 启动后端服务器
```bash
cd web
npm run server
# 输出：🚀 Server running at http://localhost:3000
```

### 2. 启动前端开发服务器
```bash
cd web
npm run dev
# 输出：VITE v... ready in ... ms
```

### 3. 测试 API 调用

**测试获取文章列表**：
```bash
curl http://localhost:3000/api/articles
```

**测试生成封面**：
```bash
curl -X POST http://localhost:3000/api/generate-cover \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试文章",
    "content": "这是测试内容",
    "style": "modern",
    "color": "matcha",
    "provider": "local"
  }'
```

### 4. 在浏览器中测试

1. 打开 http://localhost:5173
2. 创建新文章
3. 编辑文章
4. 生成封面（应该成功）
5. 查看控制台，不应该有 404 错误

---

## 📊 修复前后对比

| 项目 | 修复前 | 修复后 |
|------|--------|--------|
| Vite 代理 | 移除 `/api` 前缀 | 保留 `/api` 前缀 |
| 后端路由 | 混合（有/无 `/api`） | 统一使用 `/api` |
| 前端请求 | `/api/articles` | `/api/articles` ✅ |
| 生成封面 | 404 错误 | 成功 ✅ |
| TypeScript | CSS 类型错误 | 正确声明 ✅ |

---

## 📝 修改清单

- [x] 修改 `web/vite.config.ts` - 移除 rewrite 规则
- [x] 修改 `web/server.js` - 添加 `/api` 前缀到所有路由
- [x] 创建 `web/src/vite-env.d.ts` - CSS 类型声明
- [x] 修改 `web/tsconfig.json` - 添加 vite/client 类型

---

## 🎯 后续建议

1. **API 文档**：创建 API 文档，明确所有路由的前缀规范
2. **环境变量**：考虑使用环境变量配置 API 基础 URL
3. **错误处理**：添加更详细的错误日志和用户提示
4. **测试**：添加 API 集成测试，确保前后端通信正常

---

## 📞 相关文件

- [`web/vite.config.ts`](./web/vite.config.ts) - Vite 配置
- [`web/server.js`](./web/server.js) - Express 后端
- [`web/src/vite-env.d.ts`](./web/src/vite-env.d.ts) - TypeScript 声明
- [`web/tsconfig.json`](./web/tsconfig.json) - TypeScript 配置

---

**修复完成**：✅ 所有 API 路由已统一，前端应该能正常调用后端 API。

如果仍有问题，请检查：
1. 后端服务器是否运行在 3000 端口
2. 前端开发服务器是否运行在 5173 端口
3. 浏览器控制台是否有其他错误信息
