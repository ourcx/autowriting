# Web 服务安全配置

服务端默认执行以下应用层保护：

- 普通 JSON 请求体上限为 1MB，图片 Base64、封面和画布接口上限为 30MB。
- URL 编码表单上限为 1MB。
- 登录接口按“客户端 IP + 用户名”计数，15 分钟内最多允许 5 次失败尝试；登录成功不计入限制。
- 同源请求默认允许。跨域请求必须在 `CORS_ALLOWED_ORIGINS` 中明确配置。
- JSON 解析错误、请求体过大和未处理异常由统一错误处理中间件返回，不向客户端暴露堆栈或本地路径。
- Helmet 会隐藏 Express 标识并设置点击劫持、MIME 嗅探、下载、Referrer、HSTS 等响应头。CSP 当前使用 Report-Only，确认线上无违规后再切换为强制模式。
- API 默认 15 分钟最多 300 次请求；AI 生成、RAG、封面和发布等高成本写操作最多 30 次。
- API 默认返回 `Cache-Control: no-store`，SSE 和确需缓存的资源可由具体路由覆盖。
- JWT 只接受 HS256。用户登出、修改密码、被管理员禁用或重置密码后，旧 Token 会立即失效。
- 认证、管理员用户操作和配置写入使用 Zod 校验。所有 `dangerouslySetInnerHTML` 入口统一通过 DOMPurify。
- 旧的封面、提示词、样式模板、发布记录和微信公众号路由统一要求登录；上传图片读取地址保留原有兼容行为，供文章预览中的 `<img>` 直接加载。
- 网页抓取和自定义 SearXNG 地址只允许 HTTP/HTTPS 公网地址，并逐次检查重定向目标，阻止常见 localhost、内网和链路本地地址。

## 环境变量

```bash
# 多个来源使用英文逗号分隔，只填写完整 origin，不带路径
CORS_ALLOWED_ORIGINS=https://example.com,https://admin.example.com

# 可选，默认 15 分钟和 5 次失败
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX=5

# 可选，全局 API 和高成本操作限流
API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=300
EXPENSIVE_RATE_LIMIT_WINDOW_MS=900000
EXPENSIVE_RATE_LIMIT_MAX=30
```

限流状态保存在当前 Node.js 进程内，适合项目当前的单实例部署。改成 PM2 cluster 或多副本部署前，应接入 Redis 等共享存储，否则各实例会分别计数。

若通过 Nginx 或负载均衡转发流量，不要直接把 Express 的 `trust proxy` 设置成 `true`。应按真实代理层数配置，并确认外部请求不能伪造用于限流的客户端 IP。

## 查询与输出边界

SQLite 查询继续使用 `better-sqlite3` 参数绑定。动态更新语句只拼接代码内固定字段名，用户值均通过占位符传入；当前没有为了形式统一引入 ORM。新增动态排序、字段选择或表名时，必须使用固定白名单，不能直接拼接请求参数。

`Content-Security-Policy-Report-Only` 保留了当前页面需要的内联样式、HTTPS 外链、`data:` 与 `blob:` 图片。上线后应观察违规报告，再逐步移除不需要的来源并切换为强制 CSP。
