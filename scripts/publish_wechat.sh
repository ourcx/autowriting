#!/bin/bash
# 微信公众号草稿箱发布脚本（直接调用微信 API）
# 用法: ./publish_wechat.sh [日期目录]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 微信公众号配置
APP_ID="REDACTED_WECHAT_APP_ID"
APP_SECRET="REDACTED_WECHAT_APP_SECRET"

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 参数
DATE_DIR=${1:-$(date +%Y%m%d)}

DRAFT_DIR="$PROJECT_ROOT/公众号写作/drafts/$DATE_DIR"
RAW_FILE="$DRAFT_DIR/raw/article_raw.md"
FINAL_FILE="$DRAFT_DIR/final/article_final.md"
COVER_FILE="$DRAFT_DIR/final/cover.png"

echo -e "${GREEN}=== 微信公众号草稿箱发布 ===${NC}"
echo -e "日期目录: ${YELLOW}$DATE_DIR${NC}"
echo ""

# 检查必要文件
if [ ! -f "$RAW_FILE" ] && [ ! -f "$FINAL_FILE" ]; then
    echo -e "${RED}错误：找不到文章文件${NC}"
    exit 1
fi

# 使用 final 文件，如果没有则用 raw
ARTICLE_FILE="$FINAL_FILE"
if [ ! -f "$FINAL_FILE" ]; then
    ARTICLE_FILE="$RAW_FILE"
    mkdir -p "$DRAFT_DIR/final"
    cp "$RAW_FILE" "$FINAL_FILE"
fi

# 提取标题（第一行去掉 # ）
TITLE=$(head -n 1 "$ARTICLE_FILE" | sed 's/^#[[:space:]]*//')
echo -e "文章标题: ${YELLOW}$TITLE${NC}"

# 提取正文（跳过标题）
CONTENT=$(tail -n +2 "$ARTICLE_FILE")

# 1. 获取 access_token
echo -e "${GREEN}正在获取 access_token...${NC}"
TOKEN_RESPONSE=$(curl -s "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=$APP_ID&secret=$APP_SECRET")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
    echo -e "${RED}✗ 获取 access_token 失败${NC}"
    echo "错误信息："
    echo "$TOKEN_RESPONSE" | jq .
    echo ""
    echo "可能的原因："
    echo "1. AppID 或 AppSecret 错误"
    echo "2. IP 不在白名单"
    echo "   本机 IP: $(curl -s ifconfig.me)"
    echo "   请在公众号后台添加 IP 白名单"
    exit 1
fi

echo -e "${GREEN}✓ 获取 access_token 成功${NC}"

# 2. 使用 wenyan 渲染 Markdown 为 HTML
echo -e "${GREEN}正在渲染文章...${NC}"
HTML_CONTENT=$(wenyan render -f "$ARTICLE_FILE" 2>/dev/null || cat "$ARTICLE_FILE")

# 转义 JSON 特殊字符
HTML_ESCAPED=$(echo "$HTML_CONTENT" | jq -Rs .)
TITLE_ESCAPED=$(echo "$TITLE" | jq -Rs .)

# 3. 上传封面图（如果有）
THUMB_MEDIA_ID=""
if [ -f "$COVER_FILE" ]; then
    echo -e "${GREEN}正在上传封面图...${NC}"
    UPLOAD_RESPONSE=$(curl -s -X POST \
        "https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=$ACCESS_TOKEN&type=image" \
        -F "media=@$COVER_FILE")
    
    THUMB_MEDIA_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.media_id')
    
    if [ -z "$THUMB_MEDIA_ID" ] || [ "$THUMB_MEDIA_ID" = "null" ]; then
        echo -e "${YELLOW}⚠ 封面上传失败，将使用无封面模式${NC}"
        echo "$UPLOAD_RESPONSE" | jq .
    else
        echo -e "${GREEN}✓ 封面上传成功${NC}"
    fi
fi

# 4. 创建草稿
echo -e "${GREEN}正在创建草稿...${NC}"

# 构建请求体
if [ -n "$THUMB_MEDIA_ID" ] && [ "$THUMB_MEDIA_ID" != "null" ]; then
    REQUEST_BODY=$(cat <<EOF
{
    "articles": [
        {
            "title": $TITLE_ESCAPED,
            "author": "",
            "digest": "",
            "content": $HTML_ESCAPED,
            "content_source_url": "",
            "thumb_media_id": "$THUMB_MEDIA_ID",
            "need_open_comment": 0,
            "only_fans_can_comment": 0
        }
    ]
}
EOF
)
else
    # 无封面时，需要先上传一个默认图片
    echo -e "${YELLOW}⚠ 没有封面图，正在生成默认封面...${NC}"
    
    # 生成封面
    "$SCRIPT_DIR/generate_cover.sh" "$DATE_DIR" > /dev/null 2>&1
    
    if [ -f "$COVER_FILE" ]; then
        UPLOAD_RESPONSE=$(curl -s -X POST \
            "https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=$ACCESS_TOKEN&type=image" \
            -F "media=@$COVER_FILE")
        THUMB_MEDIA_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.media_id')
    fi
    
    REQUEST_BODY=$(cat <<EOF
{
    "articles": [
        {
            "title": $TITLE_ESCAPED,
            "author": "",
            "digest": "",
            "content": $HTML_ESCAPED,
            "content_source_url": "",
            "thumb_media_id": "$THUMB_MEDIA_ID",
            "need_open_comment": 0,
            "only_fans_can_comment": 0
        }
    ]
}
EOF
)
fi

# 发送请求
DRAFT_RESPONSE=$(curl -s -X POST \
    "https://api.weixin.qq.com/cgi-bin/draft/add?access_token=$ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_BODY")

MEDIA_ID=$(echo "$DRAFT_RESPONSE" | jq -r '.media_id')

if [ -z "$MEDIA_ID" ] || [ "$MEDIA_ID" = "null" ]; then
    echo -e "${RED}✗ 创建草稿失败${NC}"
    echo "错误信息："
    echo "$DRAFT_RESPONSE" | jq .
    exit 1
fi

echo -e "${GREEN}✓ 成功发布到草稿箱！${NC}"
echo ""
echo -e "草稿 media_id: ${YELLOW}$MEDIA_ID${NC}"
echo ""
echo -e "${YELLOW}下一步操作：${NC}"
echo "1. 登录微信公众号后台（mp.weixin.qq.com）"
echo "2. 进入「素材管理」→「草稿箱」"
echo "3. 找到文章「$TITLE」"
echo "4. 预览检查无误后，点击「发布」"
echo ""
echo -e "${GREEN}文章已安全保存到草稿箱，不会直接发布 ✓${NC}"

# 记录发布日志
LOG_FILE="$PROJECT_ROOT/publish.log"
echo "$(date '+%Y-%m-%d %H:%M:%S') - $DATE_DIR - $TITLE - media_id: $MEDIA_ID" >> "$LOG_FILE"
