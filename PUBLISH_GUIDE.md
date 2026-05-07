# 1. 创建新文章
./scripts/new_article.sh $(date +%Y%m%d) "文章主题"

# 2. 编辑 task.md 和 materials.md

# 3. 生成文章
./scripts/generate_article.sh

# 4. 生成封面
./scripts/generate_cover.sh

# 5. 发布到草稿箱
./scripts/publish_wechat.sh