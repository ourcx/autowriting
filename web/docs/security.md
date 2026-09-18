# Web 服务安全配置

服务端默认执行以下应用层保护：

- 普通 JSON 请求体上限为 1MB，图片 Base64、封面和画布接口上限为 30MB。
- URL 编码表单上限为 1MB。
- 登录接口按“客户端 IP + 用户名”计数，15 分钟内最多允许 5 次失败尝试；登录成功不计入限制。
- 同源请求默认允许。跨域请求必须在 `CORS_ALLOWED_ORIGINS` 中明确配置。
- JSON 解析错误、请求体过大和未处理异常由统一错误处理中间件返回，不向客户端暴露堆栈或本地路径。

## 环境变量

```bash
# 多个来源使用英文逗号分隔，只填写完整 origin，不带路径
CORS_ALLOWED_ORIGINS=https://example.com,https://admin.example.com

# 可选，默认 15 分钟和 5 次失败
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX=5
```

限流状态保存在当前 Node.js 进程内，适合项目当前的单实例部署。改成 PM2 cluster 或多副本部署前，应接入 Redis 等共享存储，否则各实例会分别计数。

若通过 Nginx 或负载均衡转发流量，不要直接把 Express 的 `trust proxy` 设置成 `true`。应按真实代理层数配置，并确认外部请求不能伪造用于限流的客户端 IP。
