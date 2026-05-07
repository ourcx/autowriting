#!/bin/bash
# AI 文章生成脚本（使用 MaaS API - DeepSeek v4 Pro）
# 用法: ./generate_article.sh [日期目录，默认今天]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 默认使用今天的日期
DATE_DIR=${1:-$(date +%Y%m%d)}
DRAFT_DIR="$PROJECT_ROOT/公众号写作/drafts/$DATE_DIR"

echo -e "${GREEN}=== AI 文章生成脚本（MaaS - DeepSeek v4 Pro）===${NC}"
echo -e "日期目录: ${YELLOW}$DATE_DIR${NC}"

# 检查目录是否存在
if [ ! -d "$DRAFT_DIR" ]; then
    echo -e "${RED}错误：目录不存在 $DRAFT_DIR${NC}"
    echo "是否创建目录结构? (y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        mkdir -p "$DRAFT_DIR"/{prompt,raw,final}
        echo -e "${GREEN}✓ 目录创建成功${NC}"
    else
        exit 1
    fi
fi

# 检查必要文件
PROMPT_DIR="$DRAFT_DIR/prompt"
RAW_DIR="$DRAFT_DIR/raw"
AGENTS_FILE="$PROJECT_ROOT/AGENTS.md"

if [ ! -f "$PROMPT_DIR/task.md" ] || [ ! -f "$PROMPT_DIR/materials.md" ]; then
    echo -e "${RED}错误：缺少必要文件${NC}"
    echo "请确保以下文件存在："
    echo "  - $PROMPT_DIR/task.md"
    echo "  - $PROMPT_DIR/materials.md"
    exit 1
fi

# MaaS API 配置
MAAS_API_KEY="REDACTED_MAAS_API_KEY"
MAAS_BASE_URL="https://maas.devops.xiaohongshu.com/v1"
MAAS_USER_EMAIL="zhuxinhao@xiaohongshu.com"
MAAS_APP_ID="qs-api"

# 读取文件内容
TASK_CONTENT=$(cat "$PROMPT_DIR/task.md")
MATERIALS_CONTENT=$(cat "$PROMPT_DIR/materials.md")
AGENTS_CONTENT=$(cat "$AGENTS_FILE")

# 构建完整的提示词
FULL_PROMPT="你是一个专业的内容创作助手。请严格按照以下要求完成文章写作任务。

# 写作规范（必须严格遵守）
$AGENTS_CONTENT

# 本次任务要求
$TASK_CONTENT

# 素材参考
$MATERIALS_CONTENT

---

现在请根据以上规范和素材，直接输出完整的文章内容（纯 Markdown 格式，不要有任何其他说明）："

# 生成文章
echo -e "${GREEN}正在调用 MaaS API 生成文章...${NC}"

# 使用 MaaS API
RESPONSE=$(curl -s "$MAAS_BASE_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -H "api-key: $MAAS_API_KEY" \
  -H "x-maas-user-email: $MAAS_USER_EMAIL" \
  -H "x-maas-app-id: $MAAS_APP_ID" \
  -d "{
    \"model\": \"deepseek-v4-pro\",
    \"messages\": [
      {
        \"role\": \"system\",
        \"content\": \"你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。\"
      },
      {
        \"role\": \"user\",
        \"content\": $(echo "$FULL_PROMPT" | jq -Rs .)
      }
    ],
    \"temperature\": 0.9,
    \"max_tokens\": 4096,
    \"stream\": false
  }")

# 检查响应
if echo "$RESPONSE" | grep -q "error"; then
    echo -e "${RED}✗ API 调用失败${NC}"
    echo "错误信息："
    echo "$RESPONSE" | jq .
    exit 1
fi

# 提取文章内容
ARTICLE_CONTENT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content')

if [ -z "$ARTICLE_CONTENT" ] || [ "$ARTICLE_CONTENT" = "null" ]; then
    echo -e "${RED}✗ 文章生成失败${NC}"
    echo "API 响应："
    echo "$RESPONSE"
    exit 1
fi

# 保存文章
echo "$ARTICLE_CONTENT" > "$RAW_DIR/article_raw.md"

# 统计字数（中文字符）
WORD_COUNT=$(echo "$ARTICLE_CONTENT" | wc -m | tr -d ' ')

echo -e "${GREEN}✓ 文章生成成功${NC}"
echo -e "文件路径: ${YELLOW}$RAW_DIR/article_raw.md${NC}"
echo -e "字符统计: ${YELLOW}约 $WORD_COUNT 字符${NC}"
echo ""
echo -e "${GREEN}下一步操作：${NC}"
echo "1. 审阅文章：cat $RAW_DIR/article_raw.md"
echo "2. 生成封面：./scripts/generate_cover.sh $DATE_DIR"
echo "3. 发布文章：./scripts/publish.sh $DATE_DIR"
