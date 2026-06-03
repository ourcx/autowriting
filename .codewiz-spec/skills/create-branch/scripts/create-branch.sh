#!/bin/bash

# 创建功能分支脚本
# 用法: ./create-branch.sh <branch-name>

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
	   echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
	   echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
	   echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
	   echo -e "${RED}[ERROR]${NC} $1"
}

# 检查参数
if [ $# -eq 0 ]; then
	   print_error "请提供分支名称"
	   echo "用法: $0 <branch-name>"
	   echo "示例: $0 feature/user-login"
	   exit 1
fi

BRANCH_NAME=$1

# 验证分支名格式
if [[ ! $BRANCH_NAME =~ ^(feature|bugfix|hotfix|refactor|docs)/.+ ]]; then
	   print_warning "分支名建议使用格式: type/description"
	   print_warning "例如: feature/user-login, bugfix/fix-login-error"
	   read -p "是否继续? (y/N): " -n 1 -r
	   echo
	   if [[ ! $REPLY =~ ^[Yy]$ ]]; then
	       print_info "操作已取消"
	       exit 0
	   fi
fi

print_info "开始创建分支: $BRANCH_NAME"

# 检查是否在 Git 仓库中
if ! git rev-parse --git-dir > /dev/null 2>&1; then
	   print_error "当前目录不是 Git 仓库"
	   exit 1
fi

# 检查工作区是否干净
if ! git diff-index --quiet HEAD --; then
	   print_error "工作区有未提交的更改，请先提交或暂存"
	   git status --short
	   exit 1
fi

# 获取默认分支名（main 或 master）
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')
if [ -z "$DEFAULT_BRANCH" ]; then
	   # 如果没有设置，尝试检测
	   if git show-ref --verify --quiet refs/remotes/origin/main; then
	       DEFAULT_BRANCH="main"
	   elif git show-ref --verify --quiet refs/remotes/origin/master; then
	       DEFAULT_BRANCH="master"
	   else
	       print_error "无法确定默认分支，请手动指定"
	       exit 1
	   fi
fi

print_info "默认分支: $DEFAULT_BRANCH"

# 切换到默认分支
print_info "切换到 $DEFAULT_BRANCH 分支..."
git checkout $DEFAULT_BRANCH

# 拉取最新代码
print_info "拉取最新代码..."
git pull origin $DEFAULT_BRANCH

# 检查分支是否已存在
if git show-ref --verify --quiet refs/heads/$BRANCH_NAME; then
	   print_error "分支 '$BRANCH_NAME' 已存在"
	   exit 1
fi

if git show-ref --verify --quiet refs/remotes/origin/$BRANCH_NAME; then
	   print_error "远程分支 'origin/$BRANCH_NAME' 已存在"
	   exit 1
fi

# 创建并切换到新分支
print_info "创建新分支: $BRANCH_NAME"
git checkout -b $BRANCH_NAME

# 推送到远程
print_info "推送分支到远程仓库..."
git push -u origin $BRANCH_NAME

print_success "分支 '$BRANCH_NAME' 创建成功！"
print_info "当前分支: $(git branch --show-current)"
print_info "可以开始开发了 🚀"
