# SEO 优化文档

本文档记录 Dashy 项目的 SEO（搜索引擎优化）配置和最佳实践。

## 已实施的 SEO 优化

### 1. HTML Meta 标签优化

**位置**: `web/index.html`

#### 基础 Meta 标签
- **Title**: `Dashy - AI 公众号写作助手 | 智能内容创作工具`
- **Description**: 简洁描述产品核心功能和价值
- **Keywords**: 包含主要关键词（dashy, AI写作, 公众号写作等）
- **Author**: Dashy Team
- **Language**: zh-CN
- **Robots**: index, follow（允许搜索引擎索引）

#### Open Graph（社交媒体分享）
- 完整的 OG 标签配置
- 针对 Facebook、微信等社交平台优化
- 需要添加 `og-image.png`（1200x630px）

#### Twitter Card
- 使用 `summary_large_image` 格式
- 需要添加 `twitter-image.png`（1200x600px）

#### 结构化数据（JSON-LD）
- Schema.org SoftwareApplication 格式
- 包含应用类型、价格、评分、功能列表
- 帮助搜索引擎理解产品信息

### 2. robots.txt

**位置**: `web/public/robots.txt`

#### 配置内容
- 允许所有搜索引擎抓取主要页面
- 禁止抓取 `/api/`、`/admin/`、`/user/`、`/drafts/`
- 针对 Google、百度、Bing 的特定优化
- 指向 sitemap.xml

#### 爬取延迟
- 默认: 1 秒
- Googlebot: 0 秒（优先）
- Baiduspider: 1 秒
- Bingbot: 1 秒

### 3. sitemap.xml

**位置**: `web/public/sitemap.xml`

#### 包含的页面
- 首页（priority: 1.0, daily）
- 编辑器（priority: 0.9, weekly）
- 历史记录（priority: 0.8, weekly）
- 设置（priority: 0.7, monthly）
- 样式管理（priority: 0.7, monthly）
- 文档（priority: 0.6, monthly）
- 关于（priority: 0.5, monthly）

#### 更新频率
- **daily**: 首页（内容更新频繁）
- **weekly**: 功能页面
- **monthly**: 设置和文档页面

### 4. 性能优化

#### 资源预加载
- `preconnect`: Google Fonts
- `dns-prefetch`: 提前解析域名

#### Canonical URL
- 防止重复内容问题
- 指向主域名: `https://dashy.app/`

## 待完成的优化任务

### 必需任务

1. **创建社交媒体分享图片**
   - [ ] `web/public/og-image.png` (1200x630px)
   - [ ] `web/public/twitter-image.png` (1200x600px)
   - 建议内容：产品 logo + 核心功能说明

2. **配置实际域名**
   - [ ] 将 `dashy.app` 替换为实际域名
   - [ ] 更新所有 meta 标签中的 URL
   - [ ] 更新 robots.txt 和 sitemap.xml

3. **验证搜索引擎**
   - [ ] Google Search Console 验证
   - [ ] 百度站长平台验证
   - [ ] 提交 sitemap.xml

### 进阶优化

4. **内容优化**
   - [ ] 为每个页面添加独特的 title 和 description
   - [ ] 使用语义化 HTML（`<article>`, `<section>`, `<nav>`）
   - [ ] 添加 alt 属性到所有图片

5. **性能优化**
   - [ ] 启用 Gzip/Brotli 压缩
   - [ ] 配置 CDN
   - [ ] 优化图片（WebP 格式）
   - [ ] 代码分割和懒加载

6. **移动端优化**
   - [x] 响应式 viewport 配置
   - [ ] 移动端性能测试
   - [ ] Touch 事件优化

7. **国际化（可选）**
   - [ ] 添加 `hreflang` 标签
   - [ ] 多语言 sitemap

## SEO 检查清单

### 发布前检查

- [x] HTML meta 标签完整
- [x] robots.txt 正确配置
- [x] sitemap.xml 包含所有页面
- [x] 结构化数据正确
- [ ] 社交媒体分享图片准备完毕
- [ ] 实际域名配置完成
- [ ] 所有链接可访问（无 404）

### 定期维护

- [ ] 每月更新 sitemap.xml 的 lastmod
- [ ] 监控 Google Search Console 错误
- [ ] 检查页面加载速度（< 3 秒）
- [ ] 移动端友好性测试
- [ ] 检查外链和内链有效性

## 关键指标

### Core Web Vitals
- **LCP (Largest Contentful Paint)**: < 2.5s
- **FID (First Input Delay)**: < 100ms
- **CLS (Cumulative Layout Shift)**: < 0.1

### SEO 工具

推荐使用以下工具监控和优化：

1. **Google Search Console**: 索引状态、搜索表现
2. **Google PageSpeed Insights**: 性能评分
3. **Google Lighthouse**: 综合评估
4. **百度站长平台**: 百度搜索优化
5. **Ahrefs / Semrush**: 关键词排名和竞品分析

## 关键词策略

### 主要关键词
- dashy
- AI 写作
- 公众号写作
- 智能写作助手
- 内容创作工具

### 长尾关键词
- AI 公众号写作工具
- 公众号智能编辑器
- RAG 写作系统
- 自动配图生成工具
- 提示词工程平台

### 关键词密度
- 保持 1-2% 的自然密度
- 避免关键词堆砌
- 优先考虑用户体验

## 常见问题

### Q: 为什么要用 JSON-LD 而不是 Microdata？
A: JSON-LD 更易维护，不侵入 HTML 结构，Google 推荐。

### Q: 多久能看到 SEO 效果？
A: 通常需要 3-6 个月。新站建议先做好内容和技术优化。

### Q: sitemap.xml 需要多久更新一次？
A: 有新页面时立即更新，现有页面至少每月更新一次 lastmod。

### Q: 如何处理重复内容？
A: 使用 canonical 标签指向主页面，或在 robots.txt 中屏蔽。

## 参考资源

- [Google 搜索中心文档](https://developers.google.com/search/docs)
- [百度搜索资源平台](https://ziyuan.baidu.com/)
- [Schema.org 结构化数据](https://schema.org/)
- [Open Graph Protocol](https://ogp.me/)
- [Twitter Cards 文档](https://developer.twitter.com/en/docs/twitter-for-websites/cards/)

---

**最后更新**: 2026-07-02  
**维护者**: Dashy Team