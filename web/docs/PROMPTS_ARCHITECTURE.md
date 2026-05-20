# 提示词可视化系统架构

## 系统概览

提示词可视化系统是一个完整的提示词管理解决方案，包括：

- **后端 API**：提示词的 CRUD、版本管理、统计
- **前端 UI**：可视化编辑、预览、版本管理
- **数据库**：SQLite 存储提示词和版本历史
- **初始化系统**：内置提示词的自动加载

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     前端 (React + TypeScript)                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           PromptsPage.tsx                            │   │
│  │  ┌────────────────┐  ┌──────────────────────────┐   │   │
│  │  │  提示词列表    │  │  提示词详情/编辑面板    │   │   │
│  │  │  - 搜索        │  │  - 内容编辑             │   │   │
│  │  │  - 分类过滤    │  │  - 实时预览             │   │   │
│  │  │  - 快速创建    │  │  - 版本管理             │   │   │
│  │  └────────────────┘  └──────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           PromptsPage.css                            │   │
│  │  - 响应式布局                                        │   │
│  │  - 编辑器样式                                        │   │
│  │  - 统计栏样式                                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓ HTTP API
┌─────────────────────────────────────────────────────────────┐
│                  后端 (Node.js + Express)                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        routes/prompts.js (API 路由)                  │   │
│  │  - GET  /list              获取所有提示词            │   │
│  │  - GET  /category/:cat     按分类获取                │   │
│  │  - GET  /:id               获取单个提示词            │   │
│  │  - POST /create            创建提示词                │   │
│  │  - POST /:id/update        更新提示词                │   │
│  │  - POST /:id/delete        删除提示词                │   │
│  │  - GET  /:id/versions      获取版本历史              │   │
│  │  - POST /:id/restore/:v    恢复版本                  │   │
│  │  - GET  /stats/summary     获取统计                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        db.js (数据库操作)                            │   │
│  │  - upsertPrompt()          创建/更新提示词           │   │
│  │  - listPrompts()           获取所有提示词            │   │
│  │  - getPrompt()             获取单个提示词            │   │
│  │  - updatePromptContent()   更新内容（自动版本化）    │   │
│  │  - deletePrompt()          删除提示词                │   │
│  │  - listPromptVersions()    获取版本历史              │   │
│  │  - getPromptVersion()      获取特定版本              │   │
│  │  - recordPromptUsage()     记录使用次数              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │        seedPrompts.js (初始化)                       │   │
│  │  - seedBuiltinPrompts()    加载内置提示词            │   │
│  │  - 9 个内置提示词                                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓ SQL
┌─────────────────────────────────────────────────────────────┐
│                    SQLite 数据库                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  prompts 表                                          │   │
│  │  - id (TEXT PRIMARY KEY)                             │   │
│  │  - name, category, description                       │   │
│  │  - content, version, tags                            │   │
│  │  - is_builtin, usage_count                           │   │
│  │  - created_at, updated_at                            │   │
│  │  - 索引: category, tags                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  prompt_versions 表                                  │   │
│  │  - id (TEXT PRIMARY KEY)                             │   │
│  │  - prompt_id (FOREIGN KEY)                           │   │
│  │  - version, content, change_note                     │   │
│  │  - created_at                                        │   │
│  │  - 索引: prompt_id, version DESC                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. 前端 UI (PromptsPage.tsx)

**职责**：
- 提示词列表展示和交互
- 提示词详情查看
- 提示词编辑和预览
- 版本管理界面

**关键功能**：
- 搜索和分类过滤
- 实时预览编辑内容
- 版本历史查看和恢复
- 统计信息展示

**状态管理**：
```typescript
- prompts: Prompt[]           // 所有提示词
- selectedPrompt: Prompt      // 当前选中的提示词
- editingPrompt: Partial<Prompt> // 编辑中的提示词
- versions: PromptVersion[]   // 版本历史
- stats: Stats                // 统计信息
```

### 2. 后端 API (routes/prompts.js)

**职责**：
- 处理提示词的 CRUD 操作
- 版本管理和恢复
- 使用统计

**API 端点**：

| 方法 | 路由 | 功能 |
|------|------|------|
| GET | /list | 获取所有提示词 |
| GET | /category/:category | 按分类获取 |
| GET | /:id | 获取单个提示词 |
| POST | /create | 创建提示词 |
| POST | /:id/update | 更新内容 |
| POST | /:id/delete | 删除提示词 |
| GET | /:id/versions | 获取版本历史 |
| GET | /:id/versions/:version | 获取特定版本 |
| POST | /:id/restore/:version | 恢复版本 |
| GET | /stats/summary | 获取统计 |

### 3. 数据库操作 (db.js)

**职责**：
- 提示词的数据持久化
- 版本历史管理
- 使用统计记录

**关键函数**：

```javascript
// 提示词管理
upsertPrompt(prompt)              // 创建/更新
listPrompts()                     // 获取所有
getPrompt(id)                     // 获取单个
updatePromptContent(id, content)  // 更新内容（自动版本化）
deletePrompt(id)                  // 删除

// 版本管理
listPromptVersions(promptId)      // 获取版本历史
getPromptVersion(promptId, version) // 获取特定版本

// 统计
recordPromptUsage(id)             // 记录使用
```

### 4. 初始化系统 (seedPrompts.js)

**职责**：
- 在服务器启动时加载内置提示词
- 确保内置提示词始终是最新版本

**内置提示词**：
1. 文章生成
2. 文章分析
3. 内联编辑（4 种）
4. 大纲生成
5. 素材整理
6. 样式生成
7. 封面生成

## 数据流

### 创建提示词流程

```
用户输入
  ↓
PromptsPage.tsx (handleSaveNew)
  ↓
POST /api/prompts/create
  ↓
routes/prompts.js (验证 + 调用 db)
  ↓
db.js (upsertPrompt)
  ↓
SQLite (INSERT INTO prompts)
  ↓
返回新提示词
  ↓
更新前端状态
```

### 更新提示词流程

```
用户编辑内容
  ↓
PromptsPage.tsx (handleSave)
  ↓
POST /api/prompts/:id/update
  ↓
routes/prompts.js (验证 + 调用 db)
  ↓
db.js (updatePromptContent)
  ├─ 保存当前版本到 prompt_versions
  └─ 更新 prompts 表（version + 1）
  ↓
SQLite (INSERT + UPDATE)
  ↓
返回更新后的提示词
  ↓
更新前端状态
```

### 版本恢复流程

```
用户点击「恢复此版本」
  ↓
PromptsPage.tsx (handleRestoreVersion)
  ↓
POST /api/prompts/:id/restore/:version
  ↓
routes/prompts.js (验证 + 调用 db)
  ↓
db.js (updatePromptContent)
  ├─ 获取历史版本内容
  ├─ 保存当前版本到 prompt_versions
  └─ 更新 prompts 表
  ↓
SQLite (INSERT + UPDATE)
  ↓
返回恢复后的提示词
  ↓
更新前端状态
```

## 版本管理机制

### 版本号规则

- 初始版本：v1
- 每次修改：版本号 + 1
- 版本号永不重复

### 版本历史保存

每次修改时：
1. 当前版本的内容保存到 `prompt_versions` 表
2. `prompts` 表的 `version` 字段 + 1
3. `prompts` 表的 `content` 字段更新为新内容

### 版本恢复

恢复到历史版本时：
1. 获取历史版本的内容
2. 将当前版本保存到 `prompt_versions`
3. 更新 `prompts` 表为历史版本的内容
4. 版本号继续递增

## 统计机制

### 使用次数统计

- 每次通过 API 获取提示词时，`usage_count` + 1
- 统计信息用于识别最常用的提示词

### 统计查询

```javascript
GET /api/prompts/stats/summary
返回：
{
  total: 总提示词数,
  byCategory: { 分类: { count, totalUsage } },
  byBuiltin: { builtin, custom },
  totalUsage: 总使用次数,
  topPrompts: 最常用的 10 个提示词
}
```

## 安全性考虑

### 权限控制

- 内置提示词不能修改或删除
- 自定义提示词可以修改和删除
- 版本历史不能删除（审计追踪）

### 数据验证

- 必填字段检查（name, category, content）
- 提示词存在性检查
- 权限检查（内置 vs 自定义）

### 错误处理

- 404：提示词不存在
- 403：无权限修改
- 400：参数验证失败
- 500：服务器错误

## 性能优化

### 数据库索引

```sql
CREATE INDEX idx_prompts_category ON prompts(category);
CREATE INDEX idx_prompts_tags ON prompts(tags);
CREATE INDEX idx_prompt_versions_prompt ON prompt_versions(prompt_id, version DESC);
```

### 查询优化

- 按分类查询时使用索引
- 版本历史按版本号倒序排列
- 统计查询使用聚合函数

### 缓存策略

- 前端缓存提示词列表
- 避免重复请求相同数据

## 扩展性

### 添加新的内置提示词

1. 在 `seedPrompts.js` 中添加新的提示词对象
2. 设置 `isBuiltin: true`
3. 服务器启动时自动加载

### 集成到其他功能

1. 在需要的地方调用 `/api/prompts/:id` 获取提示词
2. 使用 `recordPromptUsage(id)` 记录使用
3. 在 LLM 调用时使用提示词内容

### 导出/导入

- 通过 API 获取 JSON 格式的提示词
- 支持批量导入（需要扩展 API）

## 故障恢复

### 数据备份

- SQLite 数据库文件：`.cache/app.db`
- 定期备份数据库文件

### 版本恢复

- 所有版本历史都保存在数据库中
- 可以恢复到任何历史版本

### 数据一致性

- 使用事务确保数据一致性
- 版本号和内容同步更新

## 监控和日志

### 日志记录

- 提示词创建/更新/删除操作
- API 调用统计
- 错误日志

### 性能监控

- API 响应时间
- 数据库查询性能
- 使用统计趋势

## 未来改进

1. **提示词模板**：支持参数化提示词
2. **A/B 测试**：对比不同版本的效果
3. **协作编辑**：多人编辑提示词
4. **提示词评分**：用户评分和反馈
5. **自动优化**：基于使用数据优化提示词
6. **导入/导出**：支持批量导入导出
7. **提示词市场**：分享和下载社区提示词
