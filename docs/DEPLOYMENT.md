# 服务器部署指南

本文档提供多种部署方案，根据你的服务器环境和需求选择合适的方式。

## 目录

- [环境要求](#环境要求)
- [方案一：简单部署（快速上手）](#方案一简单部署快速上手)
- [方案二：PM2 生产部署（推荐）](#方案二pm2-生产部署推荐)
- [方案三：Docker 部署](#方案三docker-部署)
- [方案四：Nginx 反向代理](#方案四nginx-反向代理)
- [常见问题](#常见问题)

---

## 环境要求

### 必需

- **Node.js**: >= 16.x（推荐 18.x 或 20.x LTS）
- **pnpm**: >= 8.x（或使用 npm）
- **内存**: 至少 1GB RAM（推荐 2GB+）
- **磁盘**: 至少 2GB 可用空间

### 编译工具（原生模块依赖）

项目依赖 `better-sqlite3` 和 `hnswlib-node` 等原生模块，需要编译环境：

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install -y build-essential python3 git
```

**CentOS/RHEL:**

```bash
sudo yum groupinstall -y "Development Tools"
sudo yum install -y python3 git
```

---

## 方案二：PM2 生产部署（推荐）

PM2 是 Node.js 进程管理工具，提供自动重启、日志管理、负载均衡等功能。

### 1. 安装 PM2

```bash
npm install -g pm2
```

### 2. 创建 PM2 配置文件

在 `web/` 目录下创建 `ecosystem.config.cjs`：

```bash
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'autowriting',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  }]
}
EOF
```

### 3. 启动服务

```bash
# 确保已构建前端
pnpm build

# 启动 PM2
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status

# 查看日志
pm2 logs autowriting

# 设置开机自启
pm2 startup
pm2 save
```

### 4. 常用 PM2 命令

```bash
pm2 restart autowriting   # 重启
pm2 stop autowriting      # 停止
pm2 delete autowriting    # 删除
pm2 reload autowriting    # 零停机重启
pm2 monit                 # 实时监控
```

---

## 方案三：Docker 部署

容器化部署，环境隔离，易于迁移。

### 1. 创建 Dockerfile

在项目根目录创建 `Dockerfile`：

```dockerfile
FROM node:20-alpine

# 安装编译工具（原生模块需要）
RUN apk add --no-cache python3 make g++ git

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY web/package.json web/pnpm-lock.yaml ./

# 安装 pnpm 和依赖
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# 复制项目文件
COPY web/ .

# 构建前端
RUN pnpm build

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动服务
CMD ["node", "server.js"]
```

### 2. 创建 docker-compose.yml

```yaml
version: "3.8"

services:
  autowriting:
    build: .
    container_name: autowriting
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      # 持久化数据
      - ./data:/app/.cache
      - ./drafts:/app/../公众号写作/drafts
    environment:
      - NODE_ENV=production
      - PORT=3000
      - ARTICLE_PROVIDER=openai
      - ARTICLE_API_KEY=${ARTICLE_API_KEY}
      - ARTICLE_BASE_URL=https://api.openai.com/v1
      - ARTICLE_MODEL=gpt-4o
    env_file:
      - web/.env
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### 3. 构建和启动

```bash
# 构建镜像
docker-compose build

# 启动容器
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

---

## 方案四：Nginx 反向代理

配合 PM2 或 Docker 使用，提供域名访问、HTTPS、静态资源缓存。

### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt install -y nginx

# CentOS/RHEL
sudo yum install -y nginx
```

### 2. 配置 Nginx

创建配置文件 `/etc/nginx/sites-available/autowriting`：

```nginx
# 后端 API 服务（Node.js）
upstream autowriting_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name your-domain.com;  # 修改为你的域名

    # 访问日志
    access_log /var/log/nginx/autowriting_access.log;
    error_log /var/log/nginx/autowriting_error.log;

    # 请求体大小限制（支持大文件上传）
    client_max_body_size 50M;

    # API 代理
    location /api/ {
        proxy_pass http://autowriting_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # 健康检查
    location /health {
        proxy_pass http://autowriting_backend;
        access_log off;
    }

    # 前端静态资源
    location / {
        root /opt/autowriting/web/dist;
        try_files $uri $uri/ /index.html;

        # 静态资源缓存
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss image/svg+xml;
}
```

### 3. 启用配置

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/autowriting /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

### 4. HTTPS 配置（可选但推荐）

使用 Let's Encrypt 免费证书：

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 申请证书（自动配置 Nginx）
sudo certbot --nginx -d your-domain.com

# 自动续期（已自动配置 cron）
sudo certbot renew --dry-run
```

---

## 推荐的完整部署流程

### 生产环境最佳实践

1. **服务器准备**

   ```bash
   # 创建专用用户
   sudo useradd -m -s /bin/bash autowriting
   sudo su - autowriting

   # 安装 Node.js 和 pnpm（使用 nvm）
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 20
   npm install -g pnpm pm2
   ```

2. **部署项目**

   ```bash
   cd ~
   git clone https://github.com/ourcx/autowriting.git
   cd autowriting/web

   # 配置环境变量
   cp .env.example .env
   nano .env  # 填入 API Keys

   # 安装和构建
   pnpm install
   pnpm build

   # 启动服务
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup  # 按提示执行命令
   ```

3. **配置 Nginx**

   ```bash
   # 回到 root 用户
   exit

   # 配置 Nginx（参考上面的配置）
   sudo nano /etc/nginx/sites-available/autowriting
   sudo ln -s /etc/nginx/sites-available/autowriting /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

4. **配置防火墙**

   ```bash
   # 允许 HTTP/HTTPS
   sudo ufw allow 'Nginx Full'

   # 如果直接访问 Node.js（不推荐）
   sudo ufw allow 3000/tcp
   ```

5. **验证部署**

   ```bash
   # 检查服务状态
   pm2 status

   # 检查端口监听
   sudo netstat -tlnp | grep :3000

   # 访问健康检查
   curl http://localhost:3000/health
   # 应返回: {"status":"ok"}
   ```

---

## 更新部署

### 使用 PM2 更新

```bash
cd /opt/autowriting/web

# 拉取最新代码
git pull

# 安装新依赖
pnpm install

# 重新构建前端
pnpm build

# 零停机重启
pm2 reload autowriting
```

### 使用 Docker 更新

```bash
cd /opt/autowriting

# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build
```

## 性能优化建议

1. **启用 Gzip 压缩**（Nginx 配置中已包含）
2. **静态资源 CDN**（可选，适合高流量）
3. **数据库定期备份**
   ```bash
   # 添加 cron 任务
   crontab -e
   # 每天凌晨 3 点备份
   0 3 * * * cd /opt/autowriting && tar -czf backup-$(date +\%Y\%m\%d).tar.gz web/.cache/app.db
   ```
4. **日志轮转**
   ```bash
   # PM2 自动管理，或使用 logrotate
   sudo nano /etc/logrotate.d/autowriting
   ```

---

## 安全建议

1. **不要在代码中硬编码 API Keys**，使用环境变量
2. **限制服务器访问**：只开放必要端口（80/443）
3. **定期更新依赖**：`pnpm update`
4. **使用 HTTPS**：Let's Encrypt 免费证书
5. **设置防火墙**：`ufw` 或云服务商安全组
6. **定期备份数据库**

---

## 监控和日志

### PM2 监控

```bash
# 实时监控
pm2 monit

# 查看日志
pm2 logs autowriting --lines 100

# 日志文件位置
ls web/logs/
```

### 系统日志

```bash
# Nginx 日志
sudo tail -f /var/log/nginx/autowriting_access.log
sudo tail -f /var/log/nginx/autowriting_error.log

# 系统日志
journalctl -u nginx -f
```
