# 📝 更新日志

## v2.0.0 (2026-03-01) - DeepSeek + 豆包版

### 🎉 重大更新
- ✅ **替换 Claude 为 DeepSeek**：成本降低 90%，单篇文章从 ¥0.10 → ¥0.01
- ✅ **替换 KIE 为豆包**：使用国产大模型生成配图
- ✅ **保留 wenyan-cli**：继续支持自动发布到微信公众号

### 🔧 技术变更

#### 文章生成
- **之前**：使用 Claude Code CLI + Anthropic API
- **现在**：直接调用 DeepSeek API（兼容 OpenAI 格式）
- **优势**：
  - 成本降低 10 倍
  - 中文理解更好
  - API 更简单

#### 配图生成
- **之前**：使用 KIE API（GPT-4o Image）
- **现在**：使用豆包/火山引擎视觉 API
- **备用方案**：如果 API 不可用，自动生成渐变背景封面

#### 脚本更新
- `generate_article.sh`：改用 DeepSeek API，支持完整的 AGENTS.md 规范
- `generate_cover.sh`：改用豆包 API，添加备用方案
- `new_article.sh`：无变化
- `publish.sh`：无变化

### 📦 新增文件
- `API_CONFIG.md`：详细的 API 配置指南（DeepSeek + 豆包）
- `README_DEEPSEEK.md`：新版本的完整使用文档
- `CHANGELOG.md`：本文件

### 🔄 更新文件
- `AGENTS.md`：更新 API 配置说明部分
- `QUICKSTART.md`：更新为 DeepSeek 版本的快速开始
- `scripts/generate_article.sh`：完全重写，使用 DeepSeek API
- `scripts/generate_cover.sh`：完全重写，使用豆包 API

### ⚙️ 环境变量变更

#### 之前（v1.0）
```bash
export ANTHROPIC_API_KEY="sk-ant-xxx"
export KIE_API_KEY="your_kie_key"
```

#### 现在（v2.0）
```bash
export DEEPSEEK_API_KEY="sk-xxx"
export ARK_API_KEY="your_ark_key"  # 可选
```

### 💰 成本对比

| 版本 | 文章成本 | 配图成本 | 月成本（30篇） |
|------|----------|----------|----------------|
| v1.0 Claude | ¥0.10 | ¥0.20 | ¥9 |
| **v2.0 DeepSeek** | **¥0.01** | **¥0.15** | **¥5** |
| 节省 | 90% | 25% | 44% |

### 🚀 性能变化

| 指标 | v1.0 | v2.0 | 说明 |
|------|------|------|------|
| 文章生成速度 | 5-15秒 | 10-30秒 | 略慢，但可接受 |
| 文章质量 | 优秀 | 优秀 | 质量相当 |
| 中文理解 | 好 | 更好 | DeepSeek 专门优化 |
| 长文本支持 | 200K | 64K | Claude 更强 |
| 成本 | 高 | 低 | DeepSeek 便宜 10 倍 |

### 📋 迁移指南

#### 从 v1.0 迁移到 v2.0

1. **卸载旧工具**（可选）
```bash
npm uninstall -g @anthropic-ai/claude-code
```

2. **安装新工具**
```bash
brew install jq  # 新增依赖
```

3. **更新环境变量**
```bash
# 删除旧的
unset ANTHROPIC_API_KEY
unset KIE_API_KEY

# 添加新的
export DEEPSEEK_API_KEY="sk-xxx"
export ARK_API_KEY="your_ark_key"  # 可选

# 永久保存
echo 'export DEEPSEEK_API_KEY="sk-xxx"' >> ~/.zshrc
source ~/.zshrc
```

4. **更新脚本**
```bash
# 拉取最新代码
git pull

# 或手动替换脚本
cp scripts/*.sh /path/to/your/autowriting/scripts/
chmod +x scripts/*.sh
```

5. **测试生成**
```bash
./scripts/new_article.sh
# 编辑 task.md 和 materials.md
./scripts/generate_article.sh
```

### ⚠️ 注意事项

1. **AGENTS.md 兼容性**：完全兼容，无需修改
2. **旧文章**：可以继续使用，无影响
3. **素材库**：完全兼容，无需迁移
4. **审校清单**：完全兼容，无需修改

### 🐛 已知问题

1. **豆包配图**：文生图能力有限，建议使用备用方案或手动配图
2. **长文本**：DeepSeek 支持 64K，如需更长文本建议分段
3. **并发限制**：DeepSeek API 有频率限制，批量生成时注意间隔

### 🔮 未来计划

- [ ] 支持多模型切换（DeepSeek / Claude / GPT-4）
- [ ] 优化豆包配图质量
- [ ] 添加文章质量自动评分
- [ ] 支持更多发布平台（知乎、掘金）
- [ ] 添加数据分析面板

---

## v1.0.0 (2026-02-28) - 初始版本

### ✨ 功能特性
- ✅ 使用 Claude 生成文章
- ✅ 使用 KIE API 生成配图
- ✅ 使用 wenyan-cli 发布到微信公众号
- ✅ 完整的 AGENTS.md 写作规范
- ✅ 4 个自动化脚本
- ✅ 完善的文档体系

### 📦 核心组件
- Claude Code CLI
- KIE API (GPT-4o Image)
- wenyan-cli
- ImageMagick
- AGENTS.md

### 📚 文档
- README.md
- QUICKSTART.md
- DEMO.md
- PROJECT_OVERVIEW.md
- PROJECT_TREE.md
- CHEATSHEET.md
- 写作参考/审校清单.md
- 个人素材库/README.md

---

**升级建议**：如果你对成本敏感，强烈推荐升级到 v2.0！
