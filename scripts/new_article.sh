#!/bin/bash
# 创建新文章目录结构
# 用法: ./new_article.sh [日期，默认今天] [文章主题]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 参数
DATE_DIR=${1:-$(date +%Y%m%d)}
ARTICLE_TOPIC=${2:-"待定主题"}

DRAFT_DIR="$PROJECT_ROOT/公众号写作/drafts/$DATE_DIR"

echo -e "${GREEN}=== 创建新文章 ===${NC}"
echo -e "日期: ${YELLOW}$DATE_DIR${NC}"
echo -e "主题: ${YELLOW}$ARTICLE_TOPIC${NC}"

# 创建目录结构
mkdir -p "$DRAFT_DIR"/{prompt,raw,final}
echo -e "${GREEN}✓ 目录创建成功${NC}"

# 创建 task.md 模板
cat > "$DRAFT_DIR/prompt/task.md" << 'EOF'
# 写作任务要求

## 基本信息
- **文章主题**：[在这里填写主题]
- **目标字数**：1500-2000 字
- **发布平台**：微信公众号

## 结构要求
使用标准结构模板（参考 AGENTS.md）：
1. 开场：直接切入痛点或场景
2. 🧠 这是什么：解释核心概念
3. ⚙️ 怎么做：分步骤说明
4. 🔍 踩过的坑：分享真实问题
5. ⚡ 值不值得做：给出明确判断

## 风格要求
- 必须用第一人称「我」
- 多用具体数据（如"节省 2 小时"而非"节省时间"）
- 每个 H2 标题必须加 emoji
- 引号使用「」而非 ""

## 禁用词清单
严格禁止使用：
- "在当今这个快速发展的时代"
- "随着科技的不断进步"
- "总而言之/综上所述"
- "希望本文对你有所帮助"
- "极大地/显著地/大幅度地"
- "接下来，让我们来看看"

## 必须包含的元素
- [ ] 至少 1 个真实数据或案例
- [ ] 至少 1 个可直接执行的操作
- [ ] 至少 1 个代码片段/截图/命令行
- [ ] 至少 1 个个人观点或判断

## 特殊要求
[在这里填写特殊要求，如必须提到某个工具、某个概念等]
EOF

# 创建 materials.md 模板
cat > "$DRAFT_DIR/prompt/materials.md" << 'EOF'
# 素材整理

## 核心数据
- [数据点 1]
- [数据点 2]
- [数据点 3]

## 技术栈/工具
- **工具 1**：简短描述
- **工具 2**：简短描述

## 踩过的坑
### 坑1：[问题描述]
- **问题**：[具体问题]
- **原因**：[为什么出现]
- **解决**：[怎么解决的]

### 坑2：[问题描述]
- **问题**：[具体问题]
- **原因**：[为什么出现]
- **解决**：[怎么解决的]

## 个人观点
- [观点 1]
- [观点 2]

## 目标读者
- [读者画像 1]
- [读者画像 2]

## 行动建议
[给读者的明确建议]
EOF

echo -e "${GREEN}✓ 模板文件创建成功${NC}"
echo ""
echo -e "${GREEN}下一步操作：${NC}"
echo "1. 编辑任务要求：$DRAFT_DIR/prompt/task.md"
echo "2. 整理写作素材：$DRAFT_DIR/prompt/materials.md"
echo "3. 生成文章：./scripts/generate_article.sh $DATE_DIR"
echo ""
echo -e "${YELLOW}提示：请先完成步骤 1 和 2，再执行步骤 3${NC}"
