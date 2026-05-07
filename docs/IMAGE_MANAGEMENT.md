# 图片管理系统指南

本文档介绍了 AI 自动写作系统的图片管理系统，包括图片库、分类、标签和搜索功能。

## 📋 目录

- [系统概述](#系统概述)
- [核心功能](#核心功能)
- [使用指南](#使用指南)
- [API 参考](#api-参考)
- [最佳实践](#最佳实践)

## 系统概述

图片管理系统是一个完整的图片库解决方案，用于存储、组织和管理 AI 生成的封面图片。

### 主要特性

- 📦 **图片存储**：支持最多 500 张图片
- 🏷️ **分类管理**：按类别组织图片
- 🔖 **标签系统**：灵活的多标签支持
- 🔍 **搜索筛选**：按分类和标签快速查找
- 📊 **统计信息**：实时统计图片库数据
- 🗑️ **删除管理**：安全删除不需要的图片
- 📝 **元数据**：记录图片的详细信息

### 存储结构

```
.cache/
├── images/                    # 图片文件目录
│   ├── image_1.png
│   ├── image_2.png
│   └── ...
└── images_metadata.json       # 图片元数据文件
```

## 核心功能

### 1. 图片库浏览

在「编辑文章」页面的「图片库」标签页中：

1. 查看所有生成的图片
2. 查看图片统计信息（总数、分类数、来源数）
3. 按分类筛选图片
4. 按标签筛选图片
5. 删除不需要的图片

### 2. 分类管理

每张图片都属于一个分类，常见分类包括：

- **article** - 文章封面
- **social** - 社交媒体图片
- **banner** - 横幅图片
- **thumbnail** - 缩略图
- **custom** - 自定义分类

### 3. 标签系统

标签用于更细粒度的分类，例如：

- **style**: modern, minimalist, gradient, illustration, photography, abstract
- **color**: matcha, slushie, lemon, ube, pomegranate, blueberry
- **provider**: local, stability, openai
- **quality**: high, medium, low
- **status**: draft, published, archived

### 4. 搜索和筛选

**按分类筛选**：
- 点击分类按钮快速筛选
- 支持单选，选择「全部」查看所有图片

**按标签筛选**：
- 点击标签按钮进行多选
- 支持多个标签组合筛选
- 显示匹配所有选中标签的图片

## 使用指南

### 访问图片库

1. 打开「编辑文章」页面
2. 点击「图片库」标签页
3. 查看所有生成的图片

### 筛选图片

**按分类筛选**：
```
1. 在「分类」部分点击要筛选的分类
2. 图片列表会自动更新
3. 点击「全部」返回所有图片
```

**按标签筛选**：
```
1. 在「标签」部分点击要筛选的标签
2. 支持多选，点击多个标签
3. 图片列表会显示匹配所有标签的图片
4. 再次点击标签可取消选择
```

### 删除图片

1. 将鼠标悬停在图片上
2. 点击右上角的删除按钮（🗑️）
3. 确认删除
4. 图片会从库中移除

### 查看图片详情

点击图片卡片可以查看：
- 图片标题
- 所属分类
- 关联标签
- 生成来源（local/stability/openai）
- 创建日期

### 统计信息

图片库顶部显示：
- **总计**：库中图片总数
- **分类**：不同分类的数量
- **来源**：不同生成来源的数量

## API 参考

### 获取图片列表

**请求**：
```http
GET /api/images?category=article&tags=modern,matcha
```

**参数**：
- `category` (可选)：分类名称
- `tags` (可选)：标签列表，用逗号分隔

**响应**：
```json
[
  {
    "id": "image_1",
    "title": "文章标题",
    "category": "article",
    "tags": ["modern", "matcha"],
    "provider": "stability",
    "imageUrl": "data:image/png;base64,...",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
]
```

### 获取分类列表

**请求**：
```http
GET /api/images/categories
```

**响应**：
```json
["article", "social", "banner", "thumbnail"]
```

### 获取标签列表

**请求**：
```http
GET /api/images/tags
```

**响应**：
```json
["modern", "minimalist", "gradient", "matcha", "slushie", "stability", "openai"]
```

### 获取统计信息

**请求**：
```http
GET /api/images/stats
```

**响应**：
```json
{
  "totalImages": 42,
  "categories": 4,
  "providers": 2,
  "byCategory": {
    "article": 25,
    "social": 12,
    "banner": 5
  },
  "byProvider": {
    "stability": 30,
    "openai": 12
  }
}
```

### 删除图片

**请求**：
```http
DELETE /api/images/{id}
```

**响应**：
```json
{
  "success": true,
  "message": "Image deleted successfully"
}
```

### 更新图片信息

**请求**：
```http
PATCH /api/images/{id}
Content-Type: application/json

{
  "title": "新标题",
  "category": "social",
  "tags": ["modern", "matcha", "published"]
}
```

**响应**：
```json
{
  "id": "image_1",
  "title": "新标题",
  "category": "social",
  "tags": ["modern", "matcha", "published"],
  "updatedAt": "2024-01-15T11:00:00Z"
}
```

## 最佳实践

### 1. 命名规范

为图片使用清晰的标题：
- ✅ "AI 写作系统介绍 - 现代风格"
- ❌ "image_1"

### 2. 分类策略

根据用途分类：
- **article** - 文章封面
- **social** - 社交媒体分享
- **banner** - 网站横幅
- **thumbnail** - 缩略图

### 3. 标签策略

使用标签记录关键属性：
- 风格：modern, minimalist, gradient 等
- 颜色：matcha, slushie, lemon 等
- 来源：stability, openai, local
- 状态：draft, published, archived

### 4. 定期维护

- 定期删除不需要的图片
- 保持库中图片数量在 500 以内
- 定期检查统计信息

### 5. 备份策略

- 定期备份 `.cache/images_metadata.json` 文件
- 保存重要图片的副本
- 记录图片的生成参数

## 常见问题

### Q1：图片库最多能存储多少张图片？

A：系统支持最多 500 张图片。当达到限制时，需要删除旧图片才能生成新图片。

### Q2：删除的图片能恢复吗？

A：不能。删除是永久的，请谨慎操作。建议在删除前备份重要图片。

### Q3：如何导出图片库中的所有图片？

A：目前没有内置的导出功能，但可以：
1. 手动下载每张图片
2. 或者直接访问 `.cache/images/` 目录

### Q4：如何批量删除图片？

A：目前需要逐个删除。如果需要批量操作，可以：
1. 直接删除 `.cache/images/` 目录中的文件
2. 清空 `.cache/images_metadata.json` 文件

### Q5：图片的元数据存储在哪里？

A：存储在 `.cache/images_metadata.json` 文件中，包含所有图片的信息。

## 相关文档

- [AI 模型指南](./AI_MODELS_GUIDE.md)
- [快速开始](./QUICK_START.md)
- [API 文档](./API_REFERENCE.md)
- [故障排除](./TROUBLESHOOTING.md)
