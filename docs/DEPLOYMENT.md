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

- **Node.js**: >= 20.x（GitHub Actions 构建环境使用 24.x）
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

> 当前线上使用此方案（PM2 后端 + Nginx 前端）。本方案不会使用 Docker 的 `/app/data`、`/app/.cache` 或 Docker 命名卷。
>
> 默认数据路径保持不变：SQLite/RAG/上传文件在 `web/data/`，文章草稿在 `公众号写作/drafts/`，应用结构化日志在 `logs/`，PM2 stdout/stderr 在 `web/logs/`。不要在现有 PM2 环境设置 `DATA_DIR=/app/data` 或 `LEGACY_DATA_DIR`。
>
> GitHub Actions 使用发布包覆盖应用代码，不要求服务器 Git 工作区干净，也不执行 `git pull`。部署前会备份 SQLite、草稿、`.env` 和服务器本地源码 patch；发布包不包含这些运行数据。

### 1. 安装 PM2

```bash
npm install -g pm2
```

### 2. 创建 PM2 配置文件

在 `web/` 目录下创建 `ecosystem.config.cjs`（后端为 TypeScript，使用 tsx 运行）：

```bash
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'autowriting',
    script: './server.ts',
    interpreter: './node_modules/.bin/tsx',
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

> **注意**：项目后端使用 TypeScript（`server.ts`），不编译为 JS。PM2 通过 `tsx` interpreter 直接运行 `.ts` 文件，`tsx` 已在 `dependencies` 中，`pnpm install` 会自动安装。

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

项目根目录已经提供受版本控制的 `Dockerfile`、`docker-compose.yml` 和 `.dockerignore`，不需要手动复制 Docker 配置。镜像包含 Playwright Chromium，支持小红书自动发布流程。

### 1. 配置环境变量

环境变量文件是可选的。直接运行一键脚本时，如果 `web/.env` 不存在，脚本会创建一个权限受限的空白文件；应用启动后可在浏览器「AI 配置」页面填写模型信息。

需要在启动前统一配置服务端密钥时，再执行：

```bash
cp web/.env.example web/.env
# 编辑 web/.env
```

不要把真实 API Key、Cookie 或备份文件提交到 Git。

### 2. 一键构建和启动

```bash
# 检查环境、构建、启动并等待健康和首页
./scripts/docker-start.sh

# 查看日志
docker compose logs -f autowriting

# 查看健康状态
docker compose ps

# 执行容器级验收
./scripts/docker-smoke.sh
```

默认访问地址：`http://localhost:3000`。如需改端口，在启动前设置 `AUTOWRITING_PORT`，例如 `AUTOWRITING_PORT=8080 ./scripts/docker-start.sh`。

镜像使用多阶段构建：构建阶段包含 Vite/Electron/ESLint 等开发依赖，最终运行阶段仅保留后端生产依赖、前端 `dist/`、Playwright Chromium 和原生模块。Express 在生产模式下同时托管 API、前端静态文件和 SPA 路由回退，因此不需要额外的 Nginx 容器即可运行完整 Web 应用。

### 3. 持久化数据

Compose 使用命名卷，容器重建不会丢失数据：

| 卷 | 容器路径 | 内容 |
| --- | --- | --- |
| `autowriting_data` | `/app/data` | SQLite 数据库、WAL、RAG HNSW 索引、上传图片、小红书调试工件 |
| `autowriting_drafts` | `/app/drafts` | 文章任务、素材、公众号正文、今日头条正文、小红书标题 |
| `autowriting_logs` | `/app/logs` | 应用结构化日志 |

当前版本仍使用 SQLite 与本地 HNSW 向量索引；卷名保持稳定，为后续切换 MySQL/Qdrant 留出迁移边界。

#### 从当前本机/PM2 数据迁入 Docker

迁移前先停止 PM2 或本地后端，避免 SQLite WAL 继续写入。导入脚本会：

- 检查宿主 `3000` 端口没有后端进程；
- 用 `sqlite3 .backup` 创建一致的 SQLite 快照；
- 复制 `web/data/` 中的 RAG、图片和其他运行文件；
- 复制 `公众号写作/drafts/`；
- 默认拒绝覆盖非空 Docker 卷；
- 不删除、不修改原始目录。

```bash
# 首次导入空卷
./scripts/docker-import-local-data.sh --yes

# 导入后验证首页、API、卷、SQLite、草稿写入和 Playwright
./scripts/docker-smoke.sh
```

只有确认 Docker 卷已有独立备份时，才可以使用 `--force` 覆盖非空卷；脚本会先创建覆盖前卷快照：

```bash
./scripts/docker-import-local-data.sh --yes --force
```

原始 `web/data/` 和 `公众号写作/drafts/` 至少保留 7–30 天，不要在容器首次启动后立即删除。

#### 从旧 `/app/.cache` 升级

> 此小节**只适用于 Docker 部署**。当前 PM2 + Nginx 线上环境不读取 `/app/data`，也不会触发该迁移逻辑。

旧版 Docker 示例错误地将宿主机 `./data` 挂载到 `/app/.cache`。新版仍以只读方式挂载该旧目录，并在首次启动时执行一次迁移：

- 仅当新卷 `/app/data` 中不存在 `app.db` 时复制旧目录；
- 会迁移 SQLite 数据库与 WAL、RAG 索引、上传图片、封面缓存和小红书调试工件；
- 新卷已有 `app.db` 时不做任何覆盖；
- 草稿目录由独立的 `autowriting_drafts` 卷管理，不受本次数据路径修正影响。

升级前先停止旧容器，避免复制运行中的 SQLite WAL 文件：

```bash
# 旧版本在运行时先停止，不要带 -v
docker compose down

# 确认旧数据仍在项目根目录的 data/
test -f ./data/app.db

# 启动新版；首次启动日志应出现“已从旧数据目录迁移”
docker compose up -d --build
docker compose logs --tail=100 autowriting
```

确认应用可正常访问后，`./data` 暂时保留作为只读迁移源；完成备份并稳定运行后才可人工归档。不要在未确认迁移成功前删除它。

### 4. 小红书调试工件清理

小红书发布失败时会保存页面 HTML 和截图。服务会在启动时和每天凌晨 2 点清理：

- `XIAOHONGSHU_DEBUG_RETENTION_DAYS`：默认 `7`，超过天数的工件会删除；
- `XIAOHONGSHU_DEBUG_MAX_BYTES`：默认 `104857600`（100MB），超出时按最旧文件优先删除；
- 设为 `0` 可关闭对应限制。

可在 `docker-compose.yml` 同目录创建 `.env` 覆盖 Compose 变量，例如：

```env
XIAOHONGSHU_DEBUG_RETENTION_DAYS=14
XIAOHONGSHU_DEBUG_MAX_BYTES=209715200
```

### 5. 停止和更新

```bash
# 停止服务，保留所有命名卷
docker compose down

# 拉取最新代码后重建
git pull --ff-only
./scripts/docker-start.sh
```

不要执行 `docker compose down -v`，它会删除命名卷中的运行时数据。

### 6. 备份和恢复

备份脚本会先短暂停止应用，确保 SQLite/WAL 和文件快照一致；完成后恢复原运行状态。备份目录权限为 `0700`，归档和校验文件为 `0600`。

```bash
# 默认写入 backups/YYYYmmdd-HHMMSS/
./scripts/docker-backup.sh

# 也可指定目录
./scripts/docker-backup.sh /secure/path/autowriting-backup
```

备份包含：

- `data.tar.gz`：SQLite、WAL、RAG/HNSW、上传、图片和调试工件；
- `drafts.tar.gz`：文章、任务素材和各平台侧边文件；
- `logs.tar.gz`：运行日志；
- `web.env`：如果存在；
- `SHA256SUMS` 和运行版本信息。

恢复会覆盖当前卷，因此必须显式传入 `--yes`。恢复前脚本会自动把当前卷保存到 `backups/pre-restore-*`：

```bash
./scripts/docker-restore.sh backups/<timestamp> --yes
./scripts/docker-smoke.sh
```

备份中可能含 API Key、用户文章和 Cookie 相关数据，应按敏感文件保管，不要提交 Git 或上传到公开位置。

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
git pull --ff-only

# 重新构建并启动
docker compose up -d --build
```

## 性能优化建议

1. **启用 Gzip 压缩**（Nginx 配置中已包含）
2. **静态资源 CDN**（可选，适合高流量）
3. **定期备份**：当前 SQLite/HNSW 版本至少备份三个 Docker 卷；后续迁移 MySQL/Qdrant 后分别执行逻辑备份和快照。
   ```bash
   # 当前版本：备份 SQLite、RAG、上传和小红书调试文件
   mkdir -p backups
   docker run --rm \
     -v autowriting_autowriting_data:/source:ro \
     -v "$PWD/backups:/backup" \
     alpine tar -czf "/backup/autowriting-data-$(date +%Y%m%d-%H%M%S).tar.gz" -C /source .

   # 当前版本：备份文章草稿和独立标题
   docker run --rm \
     -v autowriting_autowriting_drafts:/source:ro \
     -v "$PWD/backups:/backup" \
     alpine tar -czf "/backup/autowriting-drafts-$(date +%Y%m%d-%H%M%S).tar.gz" -C /source .

   # 当前版本：备份日志（可选）
   docker run --rm \
     -v autowriting_autowriting_logs:/source:ro \
     -v "$PWD/backups:/backup" \
     alpine tar -czf "/backup/autowriting-logs-$(date +%Y%m%d-%H%M%S).tar.gz" -C /source .
   ```

   未来接入 MySQL 和 Qdrant 后，使用以下方式备份（服务名、账户和 collection 名按最终 Compose 调整）：

   ```bash
   # MySQL：逻辑备份
   docker compose exec -T mysql \
     mysqldump -uautowriting -p"$MYSQL_PASSWORD" --single-transaction --routines --events autowriting \
     > "backups/mysql-$(date +%Y%m%d-%H%M%S).sql"

   # Qdrant：collection snapshot
   curl -X POST "http://127.0.0.1:6333/collections/article_chunks/snapshots"
   curl -O "http://127.0.0.1:6333/collections/article_chunks/snapshots/<snapshot-name>"
   ```

   命名卷实际前缀可能因 Compose project name 改变，可先运行 `docker volume ls` 确认。
4. **日志轮转**
   ```bash
   # PM2 自动管理，或使用 logrotate
   sudo nano /etc/logrotate.d/autowriting
   ```

---

## 安全建议

1. **不要在代码中硬编码 API Keys**，使用环境变量
2. **限制服务器访问**：只开放必要端口（80/442）
3. **定期更新依赖**：`pnpm update`
4. **使用 HTTPS**：Let's Encrypt 免费证书
5. **设置防火墙**：`ufw` 或云服务商安全组
6. **定期备份数据库**

---

## 常见问题

### PM2 报 `ERR_MODULE_NOT_FOUND: server.js`

**原因**：PM2 缓存了旧进程配置，仍尝试加载不存在的 `server.js`（项目后端入口是 `server.ts`）。

**解决**：
```bash
# 删除旧进程（清除缓存），重新启动
pm2 delete autowriting
pm2 start ecosystem.config.cjs
pm2 save
```

### 本地向量模型报 `sharp 模块加载失败` / `Cannot find module '../build/Release/sharp-linux-x64.node'`

**原因**：`@xenova/transformers` 依赖 `sharp` 原生模块，Linux 服务器上缺少预编译二进制。`sharp` 已在 `package.json` 的 `dependencies` 中，`pnpm install` 会自动安装并触发 `postinstall` 脚本重建。

**解决**：
```bash
# 方法 1（推荐）：重新安装依赖（会自动触发 postinstall 重建 sharp）
cd web
pnpm install

# 方法 2：手动重建 sharp 原生模块
pnpm rebuild sharp

# 方法 3：重新执行 postinstall 脚本
pnpm rebuild:native

# 方法 4：如果以上都失败，切换到远端 Embedding API
# 在设置页面配置 Embedding API Key，无需本地 sharp
```

> **注意**：`sharp` 需要从 GitHub 下载 `libvips` 预编译包。如果服务器无法访问 GitHub（如内网环境），会超时失败。此时建议使用远端 Embedding API。

### Embedding API 报 `429 Too Many Requests` / `余额不足`

**原因**：Embedding API 配额耗尽或余额不足。

**解决**：
1. 等待配额恢复或充值
2. 切换到本地向量模型（需先解决 sharp 依赖问题，见上条）
3. 更换 Embedding API 提供商（在设置页面修改 `Embedding Base URL` 和 `API Key`）

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
