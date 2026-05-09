# AI 配置使用指南

## 两种配置方式

### 方式一：浏览器本地配置（推荐新用户）

打开 `/settings` 页面（右上角「AI 配置」按钮），填写 API Key 后点「保存配置」。

**特点：**
- 配置只保存在当前浏览器，不上传任何服务器
- 支持多人共用同一套后端，各自用自己的 Key
- 换浏览器或清缓存后需要重新填写

**支持的文章生成服务商：**

| 服务商 | Base URL | 填写内容 |
|--------|----------|---------|
| OpenAI | `https://api.openai.com/v1` | API Key |
| 自定义（OpenAI 兼容） | 自填（Claude/DeepSeek/Gemini 等） | Base URL + API Key + 模型名 |
| MaaS（内部） | `https://maas.devops.xiaohongshu.com/v1` | API Key + Email |

**封面生成服务：**

| 服务 | 说明 |
|------|------|
| SVG 占位（默认） | 免费，无需 Key，矢量格式 |
| DALL-E 3 | 需要 OpenAI Key |
| Stability AI | 需要 Stability API Key |

### 方式二：服务端环境变量（适合团队部署）

在 `.env` 文件中配置，所有用户共用：

```bash
# 文章生成（选一种配置）
MAAS_API_KEY=sk-xxx
MAAS_USER_EMAIL=your@xiaohongshu.com
MAAS_BASE_URL=https://maas.devops.xiaohongshu.com/v1

# 或 OpenAI
OPENAI_API_KEY=sk-xxx

# 封面生成（可选）
STABILITY_API_KEY=sk-xxx
```

**特点：**
- 用户无需在浏览器填写 Key，直接可用
- `/settings` 页面会显示服务端已配置的状态（绿色标记）
- 浏览器本地配置优先级更高，可以覆盖服务端配置

## 配置状态说明

### AISettings 页面的「服务端配置状态」面板

进入 `/settings` 页面时，顶部会显示当前服务端配置情况：

- **绿色「已配置」** — 对应 Key 在 `.env` 中有效，可直接使用
- **灰色「未配置」** — 对应服务商未在服务端配置

如果服务端已配置文章生成 Key，页面会提示「服务端已配置可用的文章生成 Key，浏览器本地不填也可直接生成文章」。

### Dashboard 和编辑器的「未配置」横幅

当检测到**本地和服务端都没有可用的 Key** 时，会出现黄色横幅提示配置。

条件：`本地 Key 为空` AND `服务端 articleReady = false`

## 连通性测试

点击「测试连接」会向对应 API 发送一个最小化请求（`max_tokens=1`），验证 Key 和 Base URL 是否有效。支持所有兼容 OpenAI Chat Completions 格式的服务商，不依赖 `/models` 端点。

## 常见问题

**Q：浏览器 Key 和服务端 Key 哪个优先？**
浏览器本地配置优先。后端合并逻辑：`{ ...服务端配置, ...浏览器本地配置 }`。

**Q：我配置了 Key 但横幅还没消失？**
横幅的条件是「本地或服务端任意一个可用」。保存配置后横幅会立即消失（无需刷新）。

**Q：多个用户共用一套后端，能各自用不同的 Key 吗？**
可以。每个用户在自己的浏览器 `/settings` 页配置，配置保存在各自浏览器本地，互不影响。
