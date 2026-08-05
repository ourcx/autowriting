# Web 端发版流水线方案

## PM2 生产部署评估

### ✅ PM2 的优势

| 特性 | 说明 | 生产环境价值 |
|------|------|------------|
| **进程守护** | 崩溃自动重启 | 高可用性 |
| **零停机重启** | `pm2 reload` 无缝切换 | 用户无感知更新 |
| **日志管理** | 自动切割、持久化 | 方便排查问题 |
| **开机自启** | `pm2 startup` 配置 | 服务器重启后自动恢复 |
| **监控面板** | `pm2 monit` 实时监控 | 快速发现问题 |
| **负载均衡** | 多实例 cluster 模式 | 充分利用多核 CPU |
| **内存限制** | `max_memory_restart` | 防止内存泄漏 |

### 📊 PM2 vs 其他方案

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **PM2** | 简单、稳定、功能全 | 单机部署 | ⭐ 中小型应用（推荐） |
| **Docker** | 环境隔离、易迁移 | 学习成本高 | 容器化基础设施 |
| **Systemd** | 系统原生、轻量 | 功能较少 | 极简场景 |
| **K8s** | 弹性伸缩、高可用 | 复杂、成本高 | 大规模集群 |

**结论：PM2 是你的最佳选择** ✅

---

## 完整发版流水线设计

### 架构图

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  本地开发   │ push │   Git 仓库   │ hook │  CI/CD 平台 │
│  git push   │─────>│  GitHub/     │─────>│  自动构建   │
│             │      │  GitLab      │      │  自动测试   │
└─────────────┘      └──────────────┘      └──────┬──────┘
                                                   │ SSH
                                                   ▼
                                          ┌─────────────────┐
                                          │   生产服务器     │
                                          │  ┌───────────┐  │
                                          │  │    PM2    │  │
                                          │  │  autowriting│
                                          │  └───────────┘  │
                                          │  ┌───────────┐  │
                                          │  │   Nginx   │  │
                                          │  │  反向代理  │  │
                                          │  └───────────┘  │
                                          └─────────────────┘
```

### 流程步骤

1. **开发者推送代码** → Git 仓库
2. **触发 CI/CD 流水线** → 自动构建和测试
3. **通过 SSH/SCP 部署** → Runner 打包当前提交和前端产物并上传到服务器
4. **服务器自动化脚本** → 解压发布包、安装依赖、重启
5. **PM2 零停机重启** → 用户无感知更新
6. **健康检查** → 确认服务正常

---

## 方案一：GitHub Actions（推荐）

### 1. 发布方式与 DNS 故障处理

当前受版本控制的 `.github/workflows/deploy.yml` 不在服务器执行 `git pull`：

1. GitHub Runner checkout 并构建当前提交；
2. Runner 使用 `git archive` 打包源码，明确剔除 `node_modules`、`.env`、`web/data/`、`公众号写作/drafts/`、`logs/` 和 `web/logs/`，再放入已构建的 `web/dist`；
3. Runner 通过 SCP 上传 `autowriting-release.tar.gz`；
4. 服务器先备份 SQLite、草稿、两类日志、环境配置和本地源码 patch，再解压发布包、安装依赖、重启 PM2。

服务器 Git 工作区是否干净、是否领先远端都不会阻断发布；线上本地源码修改会被发布版本替换，但部署前会保存到备份目录。运行数据和真实 `.env` 不会被发布包覆盖。

因此服务器无法解析 `github.com` 时，不会阻断代码发布。服务器仍需要能解析 npm registry，**仅当 `pnpm-lock.yaml` 变化且本地 pnpm 缓存没有对应依赖时**才需要下载新依赖。

若部署日志出现 `Could not resolve hostname github.com`，先在服务器确认根因：

```bash
getent hosts github.com || true
cat /etc/resolv.conf
```

应修复服务器或 VPC 的 DNS/出网配置，而不是在流水线里硬编码 GitHub IP；GitHub IP 会变化且不保证 HTTPS/SSH 可靠。

### 2. 配置 SSH 密钥（GitHub Actions 访问服务器）

```bash
# 服务器：生成部署专用密钥
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_key -N ""

# 添加公钥到 authorized_keys
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys

# 查看私钥（复制到 GitHub Secrets）
cat ~/.ssh/deploy_key
```

### 3. 在 GitHub 仓库配置 Secrets

进入 GitHub 仓库 → Settings → Secrets and variables → Actions，添加：

| Secret 名称 | 值 | 说明 |
|------------|-----|------|
| `SERVER_HOST` | `your-server-ip` | 服务器 IP 或域名 |
| `SERVER_USER` | `autowriting` | 服务器用户名 |
| `SSH_PRIVATE_KEY` | 私钥内容 | 上面生成的 `deploy_key` |

### 4. 服务器前置条件

服务器需要 Node.js 20+、pnpm、PM2、`tar`、`mktemp`，并提前创建项目目录。GitHub Actions 自身使用 Node.js 24：

```bash
mkdir -p /home/admin/autowriting
```

首次部署或变更依赖后，需要保证服务器能访问 pnpm registry；仅更新业务代码时，前端由 Runner 构建，不会在服务器执行 Vite 构建。

### 5. 测试部署

```bash
# 推送代码触发自动部署
git add .
git commit -m "feat: 添加自动部署流水线"
git push origin main

# 或手动触发（GitHub 网页 Actions 标签页）
```

---

## 方案二：GitLab CI/CD

### 1. 创建 `.gitlab-ci.yml`

```yaml
stages:
  - build
  - deploy

variables:
  PROJECT_DIR: "/opt/autowriting"

build:
  stage: build
  image: node:20-alpine
  only:
    - main
  script:
    - cd web
    - npm install -g pnpm
    - pnpm install
    - pnpm build
  artifacts:
    paths:
      - web/dist/
    expire_in: 1 hour

deploy:
  stage: deploy
  only:
    - main
  before_script:
    - 'which ssh-agent || ( apt-get update -y && apt-get install openssh-client -y )'
    - eval $(ssh-agent -s)
    - echo "$SSH_PRIVATE_KEY" | tr -d '\r' | ssh-add -
    - mkdir -p ~/.ssh
    - chmod 700 ~/.ssh
    - ssh-keyscan $SERVER_HOST >> ~/.ssh/known_hosts
    - chmod 644 ~/.ssh/known_hosts
  script:
    - ssh $SERVER_USER@$SERVER_HOST "bash $PROJECT_DIR/deploy.sh"
  environment:
    name: production
    url: http://$SERVER_HOST
```

### 2. 配置 GitLab CI/CD 变量

Settings → CI/CD → Variables，添加：
- `SERVER_HOST`
- `SERVER_USER`
- `SSH_PRIVATE_KEY`（类型：File，Masked）

---

## 方案三：手动部署脚本（适合小团队）

### 本地一键部署脚本

创建 `scripts/deploy-to-server.sh`：

```bash
#!/bin/bash

# 配置
SERVER_USER="autowriting"
SERVER_HOST="your-server-ip"
PROJECT_DIR="/opt/autowriting"

echo "🚀 部署到服务器 $SERVER_HOST"

# 1. 确认部署
read -p "确认部署到生产环境？(yes/no) " -r
if [[ ! $REPLY =~ ^yes$ ]]; then
  echo "❌ 取消部署"
  exit 1
fi

# 2. 推送代码
echo "📤 推送代码到 Git..."
git push origin main

# 3. SSH 到服务器执行部署脚本
echo "🔗 连接服务器..."
ssh $SERVER_USER@$SERVER_HOST "bash $PROJECT_DIR/deploy.sh"

echo "✅ 部署完成！"
```

使用方法：
```bash
chmod +x scripts/deploy-to-server.sh
./scripts/deploy-to-server.sh
```

---

## PM2 配置优化

### 生产环境 ecosystem.config.cjs

```javascript
module.exports = {
  apps: [{
    name: 'autowriting',
    script: './server.js',
    
    // 多实例配置（根据 CPU 核心数）
    instances: 1,  // 单核服务器用 1，多核可用 'max' 或具体数字
    exec_mode: 'fork',  // cluster 模式适合无状态应用
    
    // 自动重启策略
    autorestart: true,
    max_restarts: 10,  // 10 次重启后停止（防止无限重启）
    min_uptime: '10s',  // 至少运行 10 秒才算成功启动
    max_memory_restart: '500M',  // 内存超过 500M 自动重启
    
    // 环境变量
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // 日志配置
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // 优雅退出
    kill_timeout: 5000,  // 5 秒后强制杀死
    listen_timeout: 3000,  // 3 秒内未监听端口视为启动失败
    
    // 监控文件变化（生产环境关闭）
    watch: false,
    
    // cron 重启（可选，每天凌晨 4 点重启）
    // cron_restart: '0 4 * * *',
  }]
}
```

### PM2 常用命令

```bash
# 启动
pm2 start ecosystem.config.cjs

# 重启（零停机）
pm2 reload autowriting

# 查看状态
pm2 status
pm2 info autowriting

# 查看日志
pm2 logs autowriting --lines 100
pm2 logs autowriting --err  # 只看错误日志

# 监控
pm2 monit

# 清理日志
pm2 flush

# 保存配置（开机自启）
pm2 save
pm2 startup
```

---

## 回滚方案

### 快速回滚脚本

```bash
#!/bin/bash
# rollback.sh

cd /opt/autowriting

# 查看最近 5 次提交
echo "最近的提交："
git log --oneline -5

# 输入要回滚的 commit hash
read -p "输入要回滚到的 commit hash: " COMMIT

# 回滚
git reset --hard $COMMIT

# 重新部署
bash deploy.sh
```

---

## 监控和告警

### 健康检查脚本

创建 `/opt/autowriting/healthcheck.sh`：

```bash
#!/bin/bash

HEALTH_URL="http://localhost:3000/health"
MAX_RETRIES=3

for i in $(seq 1 $MAX_RETRIES); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)
  
  if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 健康检查通过 ($i/$MAX_RETRIES)"
    exit 0
  else
    echo "❌ 健康检查失败 ($i/$MAX_RETRIES) - HTTP $HTTP_CODE"
    sleep 5
  fi
done

echo "❌ 服务异常，自动重启..."
pm2 restart autowriting
```

### 定时健康检查（cron）

```bash
crontab -e

# 每 5 分钟检查一次
*/5 * * * * /opt/autowriting/healthcheck.sh >> /opt/autowriting/logs/health.log 2>&1
```

---

## 常见问题

### Q1: PM2 启动失败

```bash
# 查看详细日志
pm2 logs autowriting --err --lines 50

# 检查端口占用
sudo lsof -i :3000

# 检查环境变量
pm2 env 0
```

### Q2: 部署后前端 404

```bash
# 检查构建产物
ls -la web/dist/

# 重新构建
cd web
pnpm build
pm2 reload autowriting
```

### Q3: 原生模块编译失败

```bash
# 清理缓存
cd web
rm -rf node_modules pnpm-lock.yaml

# 重新安装
pnpm install
```

---

## 性能优化

### 1. 启用集群模式（多核 CPU）

```javascript
// ecosystem.config.cjs
instances: 'max',  // 使用所有 CPU 核心
exec_mode: 'cluster'
```

### 2. Nginx 缓存配置

```nginx
# 添加到 /etc/nginx/sites-available/autowriting

# 缓存配置
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m max_size=1g inactive=60m;

location /api/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 5m;  # 成功响应缓存 5 分钟
    add_header X-Cache-Status $upstream_cache_status;
    # ... 其他配置
}
```

---

## 总结

### ✅ 推荐方案

**PM2 + GitHub Actions + 自动部署脚本**

1. **稳定性**: PM2 提供进程守护和零停机重启
2. **自动化**: 推送代码自动触发部署
3. **可回滚**: Git 版本控制，随时回滚
4. **易维护**: 一键部署，无需手动操作

### 📝 部署检查清单

- [ ] 服务器安装 Node.js、pnpm、PM2
- [ ] 配置 SSH 密钥（GitHub → 服务器）
- [ ] 创建 `/opt/autowriting/deploy.sh` 脚本
- [ ] 配置 GitHub Secrets（或 GitLab Variables）
- [ ] 创建 `.github/workflows/deploy.yml`
- [ ] 测试部署流程
- [ ] 配置 Nginx 反向代理（可选）
- [ ] 设置健康检查和监控

### 📚 相关文档

- [完整部署指南](./DEPLOYMENT.md)
- [PM2 官方文档](https://pm2.keymetrics.io/)
