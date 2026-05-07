# 🚀 应用重启指南

**修复完成**：API 路由已全部修复  
**状态**：✅ 可以重新启动应用

---

## 📋 修复内容

✅ Vite 代理配置已修复  
✅ 后端路由已统一（添加 `/api` 前缀）  
✅ TypeScript 类型声明已添加  

---

## 🔄 重新启动应用

### 步骤 1：停止现有进程

如果应用仍在运行，请停止：
- 按 `Ctrl+C` 停止前端开发服务器
- 按 `Ctrl+C` 停止后端服务器

### 步骤 2：启动后端服务器

```bash
cd /Users/zhuxinhao/autowriting/web
npm run server
```

**预期输出**：
```
🚀 Server running at http://localhost:3000
📁 Project root: /Users/zhuxinhao/autowriting
📝 Drafts directory: /Users/zhuxinhao/autowriting/公众号写作/drafts
```

### 步骤 3：启动前端开发服务器（新终端）

```bash
cd /Users/zhuxinhao/autowriting/web
npm run dev
```

**预期输出**：
```
VITE v... ready in ... ms

➜  Local:   http://localhost:5173/
➜  press h to show help
```

### 步骤 4：打开浏览器

访问 http://localhost:5173

---

## ✅ 验证修复

### 检查 1：Dashboard 加载

1. 打开 http://localhost:5173
2. 应该看到「文章管理」页面
3. 浏览器控制台不应该有 404 错误

**预期**：
- ✅ 文章列表加载成功
- ✅ 没有红色错误信息

### 检查 2：创建文章

1. 点击「创建文章」按钮
2. 选择日期，点击「创建文章」
3. 应该进入编辑页面

**预期**：
- ✅ 编辑页面加载成功
- ✅ 没有 404 错误

### 检查 3：生成封面

1. 在编辑页面，点击「🖼️ 生成封面」标签
2. 输入标题（如「测试文章」）
3. 点击「✨ 生成封面」按钮
4. 应该看到生成的封面

**预期**：
- ✅ 封面生成成功
- ✅ 没有 404 错误
- ✅ 显示生成的图片

### 检查 4：浏览器控制台

打开浏览器开发者工具（F12），查看 Console 标签：

**应该看到**：
```
✅ 没有红色错误信息
✅ 没有 404 错误
✅ 可能有一些 info 或 warn 信息（正常）
```

**不应该看到**：
```
❌ Failed to load resource: the server responded with a status of 404
❌ POST http://localhost:5173/api/... 404
```

---

## 🔍 常见问题

### 问题 1：仍然看到 404 错误

**解决方案**：
1. 确保后端服务器运行在 3000 端口
2. 确保前端开发服务器运行在 5173 端口
3. 清除浏览器缓存（Ctrl+Shift+Delete）
4. 重新加载页面（Ctrl+R）

### 问题 2：后端服务器无法启动

**检查**：
```bash
# 检查 3000 端口是否被占用
lsof -i :3000

# 如果被占用，杀死进程
kill -9 <PID>

# 重新启动
npm run server
```

### 问题 3：前端开发服务器无法启动

**检查**：
```bash
# 检查 5173 端口是否被占用
lsof -i :5173

# 如果被占用，杀死进程
kill -9 <PID>

# 重新启动
npm run dev
```

### 问题 4：生成封面仍然失败

**检查步骤**：
1. 打开浏览器开发者工具（F12）
2. 查看 Network 标签
3. 点击「生成封面」按钮
4. 查看 POST 请求的响应

**预期**：
- 请求 URL：`http://localhost:5173/api/generate-cover`
- 状态码：200
- 响应：包含 `imageUrl` 字段

---

## 📊 API 路由验证

### 使用 curl 测试

**测试 1：获取文章列表**
```bash
curl http://localhost:3000/api/articles
```

**预期响应**：
```json
[
  {
    "date": "20260430",
    "title": "文章标题",
    "status": "draft",
    "createdAt": "2026-04-30T..."
  }
]
```

**测试 2：生成封面**
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

**预期响应**：
```json
{
  "imageUrl": "data:image/svg+xml;base64,..."
}
```

---

## 🎯 修复总结

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 404 错误 | Vite 代理移除了 `/api` 前缀 | 移除 rewrite 规则 |
| 路由不匹配 | 后端路由不统一 | 添加 `/api` 前缀 |
| TypeScript 错误 | CSS 类型声明缺失 | 添加 `vite-env.d.ts` |

---

## 📝 修改文件清单

- ✅ `web/vite.config.ts` - 修复代理配置
- ✅ `web/server.js` - 统一路由前缀
- ✅ `web/src/vite-env.d.ts` - 添加类型声明
- ✅ `web/tsconfig.json` - 添加 vite/client 类型

---

## 🚀 下一步

应用重启后，你可以：

1. **创建文章**：点击「创建文章」按钮
2. **编辑文章**：填写任务和素材
3. **生成文章**：点击「生成文章」按钮
4. **生成封面**：点击「生成封面」标签，选择风格和颜色
5. **发布文章**：点击「发布」按钮跳转到微信公众号

---

## 📞 需要帮助？

如果遇到问题，请检查：

1. **后端日志**：查看后端服务器的输出
2. **浏览器控制台**：F12 打开开发者工具
3. **Network 标签**：查看 API 请求和响应
4. **API_FIX_SUMMARY.md**：查看详细的修复说明

---

**准备好了吗？** 🎉

现在可以重新启动应用，所有 API 路由应该都能正常工作！
