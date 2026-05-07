# 🔗 功能集成指南

## 快速开始

### 1. 启动开发服务器

```bash
cd web
npm install
npm run dev
```

### 2. 启动后端服务器

```bash
# 在另一个终端
cd web
npm run server
```

### 3. 访问应用

打开浏览器访问 `http://localhost:5173`

---

## 功能使用指南

### 📊 内容分析

#### 如何使用
1. 编辑文章内容
2. 点击「📊 内容分析」标签页
3. 查看实时分析结果

#### 分析结果说明

**基础统计**
- 字数：文章总字数
- 段落：段落总数
- 句子：句子总数
- 阅读时间：预计阅读时间

**关键词分析**
- 自动提取的关键词列表
- 每个关键词的密度百分比
- 平均关键词密度

**SEO 评分**
- 0-100 的综合评分
- 标题长度检查
- 关键词数量检查
- 内容长度检查

**优化建议**
- ❌ 错误：必须修复的问题
- ⚠️ 警告：建议改进的地方
- ℹ️ 信息：参考建议

### 🖼️ 生成封面

#### 如何使用
1. 编辑文章内容
2. 点击「🖼️ 生成封面」标签页
3. 选择设计风格和颜色
4. 点击「✨ 生成封面」按钮
5. 预览并下载封面

#### 风格说明

| 风格 | 描述 | 适用场景 |
|------|------|---------|
| 🎨 现代风格 | 简洁现代的设计 | 科技、工具类文章 |
| ⚪ 极简风格 | 极简主义设计 | 思考、观点类文章 |
| 🌈 渐变风格 | 彩色渐变背景 | 创意、设计类文章 |
| 🎭 插画风格 | 手绘插画风格 | 教程、指南类文章 |
| 📸 摄影风格 | 高质量摄影背景 | 案例、分享类文章 |
| 🌀 抽象风格 | 抽象艺术设计 | 理论、分析类文章 |

#### 颜色说明

| 颜色 | 代码 | 适用场景 |
|------|------|---------|
| 🟢 抹茶绿 | #078a52 | 生长、成功、积极 |
| 🔵 冰沙蓝 | #3bd3fd | 创新、科技、清爽 |
| 🟡 柠檬黄 | #fbbd41 | 温暖、能量、注意 |
| 🟣 紫薯紫 | #43089f | 创意、神秘、高级 |
| 🔴 石榴红 | #fc7981 | 热情、活力、警告 |
| 🟦 蓝莓蓝 | #01418d | 专业、信任、稳定 |

---

## API 集成

### 后端 API 端点

#### 获取文章列表
```
GET /articles
响应：
[
  {
    date: "20260430",
    title: "文章标题",
    status: "draft|generated",
    createdAt: "2026-04-30T..."
  }
]
```

#### 获取单篇文章
```
GET /articles/:dateDir
响应：
{
  task: "任务要求...",
  materials: "素材...",
  article: "文章内容..."
}
```

#### 保存文章
```
POST /articles/:dateDir
请求体：
{
  task: "任务要求...",
  materials: "素材...",
  article: "文章内容..."
}
响应：
{ success: true }
```

#### 生成文章
```
POST /articles/:dateDir/generate
请求体：
{
  task: "任务要求...",
  materials: "素材..."
}
响应：
{
  article: "生成的文章内容..."
}
```

#### 生成封面
```
POST /api/generate-cover
请求体：
{
  title: "文章标题",
  content: "文章内容...",
  style: "modern|minimalist|gradient|illustration|photography|abstract",
  color: "matcha|slushie|lemon|ube|pomegranate|blueberry",
  provider: "local|stability|openai"
}
响应：
{
  imageUrl: "data:image/svg+xml;base64,..."
}
```

---

## 配置和自定义

### 修改分析指标

编辑 [`web/src/utils/contentAnalysis.ts`](web/src/utils/contentAnalysis.ts)：

```typescript
// 修改字数目标
const TARGET_WORD_COUNT = 1500

// 修改关键词数量
const KEYWORD_LIMIT = 10

// 修改 SEO 评分权重
const SEO_WEIGHTS = {
  titleLength: 10,
  keywordCount: 15,
  contentLength: 20,
  // ...
}
```

### 修改封面样式

编辑 [`web/src/components/CoverGenerator.tsx`](web/src/components/CoverGenerator.tsx)：

```typescript
// 添加新风格
const COVER_STYLES: CoverStyle[] = [
  {
    id: 'custom',
    name: '自定义风格',
    description: '自定义设计风格',
    icon: '✨'
  },
  // ...
]

// 添加新颜色
const COVER_COLORS: CoverColor[] = [
  { id: 'custom', name: '自定义色', hex: '#123456' },
  // ...
]
```

### 修改样式主题

编辑 [`web/src/index.css`](web/src/index.css)：

```css
:root {
  --color-primary: #078a52;      /* 主色 */
  --color-secondary: #fbbd41;    /* 次色 */
  --color-background: #faf9f7;   /* 背景 */
  --color-border: #dad4c8;       /* 边框 */
  /* ... */
}
```

---

## 故障排除

### 问题 1：分析面板不显示

**症状**：点击「📊 内容分析」标签页后没有内容显示

**解决**：
1. 检查浏览器控制台是否有错误
2. 确保文章内容不为空
3. 清除浏览器缓存并刷新

### 问题 2：生成封面失败

**症状**：点击「✨ 生成封面」后报错

**解决**：
1. 确保标题不为空
2. 检查网络连接
3. 查看浏览器控制台错误信息
4. 尝试切换 API 提供商

### 问题 3：关键词提取不准确

**症状**：提取的关键词不相关或重复

**解决**：
1. 这是当前简单分词算法的限制
2. 后续会集成更强大的 NLP 库
3. 可以手动编辑关键词

### 问题 4：SEO 评分过低

**症状**：即使内容很好，评分仍然很低

**解决**：
1. 检查标题长度（建议 10-60 字）
2. 确保关键词数量足够（3-5 个）
3. 增加内容长度（建议 500+ 字）
4. 检查关键词密度（1-3%）

---

## 性能优化建议

### 前端优化
```typescript
// 使用 React.memo 缓存组件
export const ContentAnalysisPanel = React.memo(({ title, content }) => {
  // ...
})

// 使用 useMemo 缓存计算结果
const analysis = useMemo(() => analyzeContent(content), [content])

// 使用 useCallback 缓存函数
const handleGenerate = useCallback(() => {
  // ...
}, [dependencies])
```

### 后端优化
```javascript
// 添加缓存
const cache = new Map()

app.post('/api/generate-cover', async (req, res) => {
  const cacheKey = JSON.stringify(req.body)
  if (cache.has(cacheKey)) {
    return res.json(cache.get(cacheKey))
  }
  
  // ... 生成封面
  
  cache.set(cacheKey, result)
  res.json(result)
})
```

---

## 下一步

### 立即可做
- [ ] 测试所有功能
- [ ] 收集用户反馈
- [ ] 修复 bug

### 本周计划
- [ ] 集成 Stability AI API
- [ ] 添加更多分析指标
- [ ] 优化用户界面

### 后续计划
- [ ] 实现批量操作
- [ ] 添加数据分析
- [ ] 支持协作编辑

---

## 联系和支持

如有问题或建议，请：
1. 查看 [功能路线图](./FEATURE_ROADMAP.md)
2. 查看 [功能实现文档](./FEATURES_IMPLEMENTATION.md)
3. 检查浏览器控制台错误
4. 提交 Issue 或 PR

---

**更新日期**：2026-04-30  
**版本**：1.0.0  
**维护者**：Peter
