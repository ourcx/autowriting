#!/bin/bash
# AI 封面图生成脚本
# 用法: ./generate_cover.sh [日期目录] [封面描述]

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
COVER_PROMPT=${2:-"简洁专业的科技配图，蓝色渐变背景，现代风格"}

DRAFT_DIR="$PROJECT_ROOT/公众号写作/drafts/$DATE_DIR"
FINAL_DIR="$DRAFT_DIR/final"

echo -e "${GREEN}=== 封面图生成脚本 ===${NC}"
echo -e "日期目录: ${YELLOW}$DATE_DIR${NC}"

# 检查目录
if [ ! -d "$FINAL_DIR" ]; then
    mkdir -p "$FINAL_DIR"
fi

# 检查 ImageMagick（支持新版 magick 命令）
CONVERT_CMD="convert"
if command -v magick &> /dev/null; then
    CONVERT_CMD="magick"
elif ! command -v convert &> /dev/null; then
    echo -e "${RED}错误：未安装 ImageMagick${NC}"
    echo "请运行: brew install imagemagick"
    exit 1
fi

echo -e "${GREEN}正在生成封面图...${NC}"

# 生成渐变背景封面（不使用字体，避免字体问题）
# 创建一个美观的渐变背景
$CONVERT_CMD -size 1536x1024 \
  -define gradient:direction=diagonal \
  gradient:'#1a73e8-#00bcd4' \
  -blur 0x2 \
  "$FINAL_DIR/cover_original.png"

# 添加一些装饰元素（使用纯图形，不需要字体）
$CONVERT_CMD "$FINAL_DIR/cover_original.png" \
  \( -size 400x400 xc:none -fill 'rgba(255,255,255,0.1)' -draw "circle 200,200 200,50" \) \
  -gravity northeast -geometry +100+100 -composite \
  \( -size 300x300 xc:none -fill 'rgba(255,255,255,0.08)' -draw "circle 150,150 150,30" \) \
  -gravity southwest -geometry +150+150 -composite \
  \( -size 200x200 xc:none -fill 'rgba(255,255,255,0.05)' -draw "circle 100,100 100,20" \) \
  -gravity center -geometry +200-100 -composite \
  "$FINAL_DIR/cover_original.png"

echo -e "${GREEN}✓ 封面图生成成功${NC}"

# 裁切为微信尺寸 (2.35:1)
echo -e "${GREEN}正在裁切图片...${NC}"
$CONVERT_CMD "$FINAL_DIR/cover_original.png" \
  -gravity center \
  -crop 1536x653+0+0 \
  +repage \
  "$FINAL_DIR/cover.png"

echo -e "${GREEN}✓ 封面处理完成${NC}"
echo -e "原始图片: ${YELLOW}$FINAL_DIR/cover_original.png${NC} (1536x1024)"
echo -e "微信封面: ${YELLOW}$FINAL_DIR/cover.png${NC} (1536x653)"

echo ""
echo -e "${GREEN}下一步操作：${NC}"
echo "1. 查看封面：open $FINAL_DIR/cover.png"
echo "2. 发布文章：./scripts/publish.sh $DATE_DIR"
echo ""
echo -e "${YELLOW}提示：${NC}如果需要更专业的配图，建议："
echo "  - 使用 Midjourney、Stable Diffusion 等专业工具"
echo "  - 手动替换 $FINAL_DIR/cover.png"
echo "  - 或使用在线设计工具（如 Canva、创客贴）"
