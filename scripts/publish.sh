#!/bin/bash
# 文章发布到草稿箱脚本（不会直接发布）
# 用法: ./publish.sh [日期目录]

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

DRAFT_DIR="$PROJECT_ROOT/公众号写作/drafts/$DATE_DIR"
RAW_FILE="$DRAFT_DIR/raw/article_raw.md"
FINAL_FILE="$DRAFT_DIR/final/article_final.md"
COVER_FILE="$DRAFT_DIR/final/cover.png"

echo -e "${GREEN}=== 文章发布到草稿箱（不会直接发布）===${NC}"
echo -e "日期目录: ${YELLOW}$DATE_DIR${NC}"
echo -e "${YELLOW}注意：文章将发布到草稿箱，需要在公众号后台手动审核后发布${NC}"
echo ""

# 检查必要文件
if [ ! -f "$RAW_FILE" ]; then
    echo -e "${RED}错误：找不到原稿文件 $RAW_FILE${NC}"
    echo "请先运行: ./scripts/generate_article.sh $DATE_DIR"
    exit 1
fi

# 检查 wenyan-cli
if ! command -v wenyan &> /dev/null; then
    echo -e "${RED}错误：未安装 wenyan-cli${NC}"
    echo "请运行: npm install -g @wenyan-md/cli"
    exit 1
fi

# 如果没有最终版，复制原稿
if [ ! -f "$FINAL_FILE" ]; then
    echo -e "${YELLOW}未找到最终版，使用原稿${NC}"
    mkdir -p "$DRAFT_DIR/final"
    cp "$RAW_FILE" "$FINAL_FILE"
fi

# 检查封面
if [ ! -f "$COVER_FILE" ]; then
    echo -e "${YELLOW}警告：未找到封面图${NC}"
    echo "是否继续发布？(y/n)"
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "请先运行: ./scripts/generate_cover.sh $DATE_DIR"
        exit 1
    fi
fi

# 提取文章标题
TITLE=$(head -n 1 "$FINAL_FILE" | sed 's/^# //')
if [ -z "$TITLE" ]; then
    echo -e "${RED}错误：无法提取文章标题${NC}"
    echo "请确保文章第一行是 Markdown 标题格式：# 标题"
    exit 1
fi

echo -e "文章标题: ${YELLOW}$TITLE${NC}"
echo ""

# 文章预览
echo -e "${GREEN}文章预览：${NC}"
echo -e "${YELLOW}────────────────────────────────${NC}"
head -n 30 "$FINAL_FILE"
echo -e "${YELLOW}────────────────────────────────${NC}"
echo ""

echo "确认发布到公众号草稿箱？(y/n)"
read -r confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "已取消发布"
    exit 0
fi

# 发布到草稿箱
echo -e "${GREEN}正在发布到草稿箱...${NC}"

# 直接使用文件内容发布
if wenyan publish -f "$FINAL_FILE"; then
    echo -e "${GREEN}✓ 成功发布到草稿箱！${NC}"
    echo ""
    echo -e "${YELLOW}下一步操作：${NC}"
    echo "1. 登录微信公众号后台（mp.weixin.qq.com）"
    echo "2. 进入「素材管理」→「草稿箱」"
    echo "3. 找到刚才发布的文章"
    echo "4. 预览检查无误后，点击「发布」"
    echo ""
    echo -e "${GREEN}文章已安全保存到草稿箱，不会直接发布 ✓${NC}"
    
    # 记录发布日志
    LOG_FILE="$PROJECT_ROOT/publish.log"
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $DATE_DIR - $TITLE - 发布成功" >> "$LOG_FILE"
else
    echo -e "${RED}✗ 发布失败${NC}"
    echo ""
    echo "常见问题排查："
    echo "1. 检查微信公众号 IP 白名单"
    echo "   本机 IP: $(curl -s ifconfig.me 2>/dev/null || echo '无法获取')"
    echo ""
    echo "2. 检查 wenyan 配置文件"
    echo "   配置路径: ~/.config/wenyan/config.json"
    echo ""
    echo "3. 检查 AppID 和 AppSecret 是否正确"
    cat ~/.config/wenyan/config.json 2>/dev/null || echo "   配置文件不存在"
    echo ""
    echo "4. 尝试手动发布："
    echo "   a. 使用在线工具：https://md.openwrite.cn/"
    echo "   b. 复制文章内容手动粘贴到公众号后台"
    exit 1
fi
