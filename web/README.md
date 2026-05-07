# AI 自动写作系统 - Web 版本

一个现代化的 Web 应用，用于管理和生成公众号文章。

## 🎯 功能特性

- ✨ **可视化界面** - 告别命令行，使用现代化的 Web UI
- 📝 **文章编辑** - 在线编辑任务要求和素材
- 🤖 **AI 生成** - 一键调用 MaaS API 生成文章
- 👁️ **实时预览** - 支持 Markdown 预览
- 📊 **文章管理** - 查看、编辑、删除文章
- 💾 **自动保存** - 支持草稿自动保存

## 🚀 快速开始

### 1. 安装依赖

```bash
cd web
npm install
```

### 2. 启动开发服务器

```bash
npm start
```

这会同时启动：
- 前端开发服务器：http://localhost:5173
- 后端 API 服务器：http://localhost:3000

### 3. 打开浏览器

访问 http://localhost:5173 开始使用

## 📁 项目结构

```
web/
├── src/
│   ├── main.tsx              # 入口文件
│   ├── App.tsx               # 主应用组件
│   ├── App.css               # 主样式
│   ├── index.css             # 全局样式
│   └── pages/
│       ├── Dashboard.tsx      # 仪表板页面
│       ├── Dashboard.css
│       ├── ArticleEditor.tsx  # 文章编辑页面
│       └── ArticleEditor.css
├── server.js                 # Express 后端服务器
├── vite.config.ts            # Vite 配置
├── tsconfig.json             # TypeScript 配置
├── package.json              # 项目依赖
└── index.html                # HTML 模板
```

## 🔧 API 端点

### 获取文章列表
```
GET /api/articles
```

### 获取单篇文章
```
GET /api/articles/:dateDir
```

### 保存文章
```
POST /api/articles/:dateDir
Body: { task, materials, article }
```

### 生成文章
```
POST /api/articles/:dateDir/generate
Body: { task, materials }
```

### 删除文章
```
DELETE /api/articles/:dateDir
```

## 🎨 设计系统

采用 Clay 设计系统的风格：
- 温暖的奶油色背景 (#faf9f7)
- 命名色板：Matcha、Slushie、Lemon、Ube 等
- 圆润的边角（24px 卡片，40px 部分）
- 多层阴影效果
- 流畅的交互动画

## 🔐 配置

MaaS API 配置已内置在 `server.js` 中：

```javascript
const MAAS_CONFIG = {
  apiKey: 'REDACTED_MAAS_API_KEY',
  baseUrl: 'https://maas.devops.xiaohongshu.com/v1',
  userEmail: 'zhuxinhao@xiaohongshu.com',
  appId: 'qs-api'
}
```

如需修改，编辑 `server.js` 中的配置即可。

## 📦 生产构建

```bash
npm run build
```

生成的文件在 `dist/` 目录中。

## 🌐 部署

### 使用 Vercel（推荐）

1. 将代码推送到 GitHub
2. 在 Vercel 中导入项目
3. 设置环境变量（如需要）
4. 部署

### 使用 Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 3000 5173

CMD ["npm", "start"]
```

## 🐛 常见问题

### Q: 生成文章时报错 "API 调用失败"

A: 检查以下几点：
1. 网络连接是否正常
2. MaaS API Key 是否有效
3. 任务和素材是否完整

### Q: 文件保存失败

A: 确保 `公众号写作/drafts/` 目录存在且有写入权限。

### Q: 前端无法连接到后端

A: 检查后端服务器是否运行在 http://localhost:3000

## 📝 开发指南

### 添加新功能

1. 在 `src/pages/` 中创建新组件
2. 在 `App.tsx` 中添加路由
3. 在 `server.js` 中添加 API 端点

### 修改样式

- 全局样式：`src/index.css`
- 组件样式：对应的 `.css` 文件
- 颜色变量：在 `:root` 中定义

### 调试

```bash
# 前端调试
npm run dev

# 后端调试
node server.js
```

## 🤝 贡献

欢迎提交 Issue 和 PR！

## 📄 许可证

MIT License

---

**提示**：这是一个完整的 Web 应用，可以替代命令行脚本，提供更好的用户体验。
