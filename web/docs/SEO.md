# SEO 配置

Dashy 同时包含公开产品首页和登录后的内容创作工作台。SEO 配置只让公开首页参与搜索收录，登录、注册、配置、文章、管理等页面统一禁止索引。

## 收录边界

| 地址 | 搜索策略 | 说明 |
| --- | --- | --- |
| `/` | `index, follow` | 未登录时展示公开产品首页，已登录时进入创作工作台 |
| `/login`、`/register` | `noindex` | 账号操作页 |
| 文章、素材、配置、数据和管理路由 | `noindex` | 登录后的私有工作台 |
| `/api/*` | robots 禁止抓取 | 接口没有可收录内容 |
| 未知地址 | HTTP 404 + `noindex` | 返回独立的 `404.html` |

公开首页在 [`web/index.html`](../index.html) 中保留了可直接抓取的正文。即使搜索引擎不执行 JavaScript，也能读取产品名称、定位和账号入口。浏览器执行 React 后，会由 [`PublicHomePage`](../src/pages/PublicHomePage/PublicHomePage.tsx) 展示完整首页。

已登录用户访问 `/` 时仍进入原有工作台，不改变现有使用习惯。

## 元信息

基础 title、description、Open Graph、Twitter Card、canonical 和 JSON-LD 位于 [`web/index.html`](../index.html)。

React 路由切换后，[`SeoMetadata`](../src/components/SeoMetadata/SeoMetadata.tsx) 会更新：

- 页面标题和描述
- robots 策略
- canonical
- Open Graph URL、标题和描述
- Twitter URL、标题和描述

结构化数据使用 `SoftwareApplication`，只保留项目中能确认的产品信息。不要写入无法核验的评分、用户数、价格或效率提升比例。

## robots 与 sitemap

[`robots.txt`](../public/robots.txt) 只禁止 `/api/`。私有页面不在 robots 中屏蔽，因为搜索引擎需要读取页面或响应头里的 `noindex`。

[`sitemap.xml`](../public/sitemap.xml) 只包含公开首页。新增公开页面后，需要同时满足以下条件：

- 无需登录即可访问
- 返回 HTTP 200
- 有独立 title、description 和 canonical
- 有稳定正文，不依赖用户数据
- 加入 sitemap

登录后的工作台路由不要加入 sitemap。

## 404 与私有路由

生产环境由 [`web/server.ts`](../server.ts) 区分三类页面请求：

- `/` 返回公开首页
- 已知工作台路由返回 SPA，同时添加 `X-Robots-Tag: noindex, nofollow, noarchive`
- 未知路由返回 HTTP 404 和 [`404.html`](../public/404.html)

缺失的图片、脚本和样式也会返回 404，不再回退到首页 HTML。

## Nginx 要求

Nginx 如果直接托管 `web/dist`，不能使用无条件的 `try_files $uri $uri/ /index.html`。这条规则会把未知地址和缺失图片都变成 HTTP 200。

推荐让所有页面请求交给 Express，由 Express 负责合法 SPA 路由和 404：

```nginx
location / {
    proxy_pass http://autowriting_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

静态资源可以单独缓存，但缺失资源必须返回 404：

```nginx
location /assets/ {
    root /opt/autowriting/web/dist;
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## 发布检查

```bash
pnpm --dir web verify
pnpm --dir web smoke
```

部署后再检查：

```bash
curl -I https://0oq8he.site/
curl -I https://0oq8he.site/login
curl -I https://0oq8he.site/does-not-exist
curl https://0oq8he.site/robots.txt
curl https://0oq8he.site/sitemap.xml
```

预期结果：

- `/` 返回 200，没有 `X-Robots-Tag: noindex`
- `/login` 返回 200，并带有 `X-Robots-Tag: noindex, nofollow, noarchive`
- 未知地址返回 404
- sitemap 只有真实公开页面
- 分享图地址返回图片内容，不能返回 HTML

最后在 Google Search Console 和百度搜索资源平台重新提交 sitemap。索引状态和搜索曝光以平台数据为准。
