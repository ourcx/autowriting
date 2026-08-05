# 远程 Agent API

远程 Agent API 复用现有已鉴权 Web API，不复制文章生成或发布逻辑。配置一个服务密钥后，Agent 可用指定平台用户的身份管理文章、调用 AI 生成，并使用该用户已绑定的平台账号执行今日头条或小红书发布。

## 启用

在 `web/.env` 中添加：

```dotenv
AGENT_API_KEY=请替换为高强度随机密钥
AGENT_USERNAME=admin
```

可用 `openssl rand -hex 32` 生成密钥。重启 PM2 后生效：

```bash
pm2 restart autowriting --update-env
```

未配置 `AGENT_API_KEY` 时远程能力保持关闭。`AGENT_USERNAME` 必须是平台中已存在且未禁用的用户；Agent 只能访问该用户的数据和账号绑定。

## 认证

所有请求添加：

```http
X-Agent-API-Key: <AGENT_API_KEY>
```

先检查连接和能力：

```bash
curl https://your-domain.example/api/agent/status \
  -H "X-Agent-API-Key: $AGENT_API_KEY"
```

不要把密钥放在 URL、代码仓库、聊天记录或浏览器前端中。建议在 Nginx 或防火墙层限制来源 IP，并只通过 HTTPS 暴露。

## 写文章

创建文章 ID 并保存任务、素材：

```bash
ARTICLE_ID="$(date +%Y%m%d)-agent-demo"

curl "https://your-domain.example/api/articles/$ARTICLE_ID" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Agent-API-Key: $AGENT_API_KEY" \
  -d '{
    "title": "远程 Agent 示例",
    "task": "写一篇面向大学生家长的政策解读文章",
    "materials": "在这里放来源可靠的素材"
  }'
```

调用服务端 AI 配置生成正文：

```bash
curl "https://your-domain.example/api/articles/$ARTICLE_ID/generate" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Agent-API-Key: $AGENT_API_KEY" \
  -d '{
    "task": "写一篇面向大学生家长的政策解读文章",
    "materials": "在这里放来源可靠的素材"
  }'
```

读取结果：

```bash
curl "https://your-domain.example/api/articles/$ARTICLE_ID" \
  -H "X-Agent-API-Key: $AGENT_API_KEY"
```

也可以通过 `POST /api/articles/:articleId` 直接写入 `article`、`articleToutiao`、`xiaohongshuTitle` 等字段。

## 发布

Agent 可调用现有发布接口，例如：

- `POST /api/toutiao/publish`
- `POST /api/xiaohongshu/publish`

发布接口仍要求对应用户已在平台中绑定账号或提供有效 Cookie，并保留现有参数校验与发布记录。微信公众号接口暂未纳入远程 Agent API。建议先让 Agent 创建和生成文章，再由人工确认内容后触发发布。
