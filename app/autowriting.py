#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 自动写作工具 - 跨平台版本
支持 Windows (.exe) 和 macOS

功能：
1. 创建新文章
2. 生成文章（调用 DeepSeek API）
3. 生成封面
4. 发布到微信公众号草稿箱
"""

import os
import sys
import json
import requests
import subprocess
from datetime import datetime
from pathlib import Path

# 配置
CONFIG = {
    "maas_api_key": "REDACTED_MAAS_API_KEY",
    "maas_base_url": "https://maas.devops.xiaohongshu.com/v1",
    "maas_user_email": "zhuxinhao@xiaohongshu.com",
    "maas_app_id": "qs-api",
    "wechat_app_id": "REDACTED_WECHAT_APP_ID",
    "wechat_app_secret": "REDACTED_WECHAT_APP_SECRET",
}

# 获取项目根目录
def get_project_root():
    """获取项目根目录"""
    if getattr(sys, 'frozen', False):
        # 打包后的可执行文件
        return Path(sys.executable).parent
    else:
        # 开发环境
        return Path(__file__).parent.parent

PROJECT_ROOT = get_project_root()
DRAFTS_DIR = PROJECT_ROOT / "公众号写作" / "drafts"
AGENTS_FILE = PROJECT_ROOT / "AGENTS.md"


def print_header(title):
    """打印标题"""
    print("\n" + "=" * 50)
    print(f"  {title}")
    print("=" * 50 + "\n")


def print_success(msg):
    """打印成功信息"""
    print(f"✓ {msg}")


def print_error(msg):
    """打印错误信息"""
    print(f"✗ 错误: {msg}")


def print_warning(msg):
    """打印警告信息"""
    print(f"⚠ {msg}")


def get_today():
    """获取今天日期"""
    return datetime.now().strftime("%Y%m%d")


def create_article(date_dir=None, topic="待定主题"):
    """创建新文章目录和模板"""
    print_header("创建新文章")
    
    if date_dir is None:
        date_dir = get_today()
    
    draft_dir = DRAFTS_DIR / date_dir
    prompt_dir = draft_dir / "prompt"
    raw_dir = draft_dir / "raw"
    final_dir = draft_dir / "final"
    
    # 创建目录
    for d in [prompt_dir, raw_dir, final_dir]:
        d.mkdir(parents=True, exist_ok=True)
    
    # 创建 task.md
    task_content = f'''# 写作任务要求

## 基本信息
- **文章主题**：{topic}
- **目标字数**：1500-2000 字
- **发布平台**：微信公众号

## 结构要求
使用标准结构模板：
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
- 至少 1 个真实数据或案例
- 至少 1 个可直接执行的操作
- 至少 1 个代码片段/截图/命令行
- 至少 1 个个人观点或判断
'''
    
    with open(prompt_dir / "task.md", "w", encoding="utf-8") as f:
        f.write(task_content)
    
    # 创建 materials.md
    materials_content = '''# 素材整理

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

## 个人观点
- [观点 1]
- [观点 2]

## 行动建议
[给读者的明确建议]
'''
    
    with open(prompt_dir / "materials.md", "w", encoding="utf-8") as f:
        f.write(materials_content)
    
    print_success("目录创建成功")
    print(f"\n日期: {date_dir}")
    print(f"主题: {topic}")
    print(f"\n下一步操作：")
    print(f"1. 编辑任务要求：{prompt_dir / 'task.md'}")
    print(f"2. 整理写作素材：{prompt_dir / 'materials.md'}")
    print(f"3. 运行生成文章功能")
    
    return date_dir


def generate_article(date_dir=None):
    """使用 MaaS API 生成文章"""
    print_header("生成文章（MaaS - DeepSeek v4 Pro）")
    
    if date_dir is None:
        date_dir = get_today()
    
    draft_dir = DRAFTS_DIR / date_dir
    prompt_dir = draft_dir / "prompt"
    raw_dir = draft_dir / "raw"
    
    # 检查必要文件
    task_file = prompt_dir / "task.md"
    materials_file = prompt_dir / "materials.md"
    
    if not task_file.exists() or not materials_file.exists():
        print_error(f"缺少必要文件，请先创建文章")
        return False
    
    # 读取文件
    with open(task_file, "r", encoding="utf-8") as f:
        task_content = f.read()
    
    with open(materials_file, "r", encoding="utf-8") as f:
        materials_content = f.read()
    
    agents_content = ""
    if AGENTS_FILE.exists():
        with open(AGENTS_FILE, "r", encoding="utf-8") as f:
            agents_content = f.read()
    
    # 构建提示词
    prompt = f"""你是一个专业的内容创作助手。请严格按照以下要求完成文章写作任务。

# 写作规范（必须严格遵守）
{agents_content}

# 本次任务要求
{task_content}

# 素材参考
{materials_content}

---

现在请根据以上规范和素材，直接输出完整的文章内容（纯 Markdown 格式，不要有任何其他说明）："""

    print("正在调用 MaaS API...")
    
    try:
        response = requests.post(
            f"{CONFIG['maas_base_url']}/chat/completions",
            headers={
                "Content-Type": "application/json",
                "api-key": CONFIG["maas_api_key"],
                "x-maas-user-email": CONFIG["maas_user_email"],
                "x-maas-app-id": CONFIG["maas_app_id"]
            },
            json={
                "model": "deepseek-v4-pro",
                "messages": [
                    {
                        "role": "system",
                        "content": "你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。"
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.9,
                "max_tokens": 4096,
                "stream": False
            },
            timeout=120
        )
        
        if response.status_code != 200:
            print_error(f"API 调用失败: {response.status_code}")
            print(response.text)
            return False
        
        result = response.json()
        article_content = result["choices"][0]["message"]["content"]
        
        # 保存文章
        raw_dir.mkdir(parents=True, exist_ok=True)
        output_file = raw_dir / "article_raw.md"
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(article_content)
        
        print_success("文章生成成功")
        print(f"\n文件路径: {output_file}")
        print(f"字符数: {len(article_content)}")
        
        return True
        
    except Exception as e:
        print_error(f"生成失败: {e}")
        return False


def generate_cover(date_dir=None):
    """生成封面图（简单渐变背景）"""
    print_header("生成封面图")
    
    if date_dir is None:
        date_dir = get_today()
    
    draft_dir = DRAFTS_DIR / date_dir
    final_dir = draft_dir / "final"
    final_dir.mkdir(parents=True, exist_ok=True)
    
    cover_file = final_dir / "cover.png"
    
    # 尝试使用 ImageMagick
    try:
        # 检查是否安装了 ImageMagick
        result = subprocess.run(
            ["magick", "--version"] if sys.platform == "win32" else ["convert", "--version"],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            # 使用 ImageMagick 生成渐变背景
            cmd = ["magick" if sys.platform == "win32" else "convert"]
            cmd.extend([
                "-size", "1536x653",
                "-define", "gradient:direction=diagonal",
                "gradient:#1a73e8-#00bcd4",
                str(cover_file)
            ])
            
            subprocess.run(cmd, check=True)
            print_success(f"封面生成成功: {cover_file}")
            return True
    except FileNotFoundError:
        print_warning("未安装 ImageMagick，跳过封面生成")
        print("如需生成封面，请安装 ImageMagick：")
        print("  Windows: https://imagemagick.org/script/download.php")
        print("  macOS: brew install imagemagick")
        return False
    except Exception as e:
        print_error(f"生成封面失败: {e}")
        return False


def publish_to_wechat(date_dir=None):
    """发布到微信公众号草稿箱"""
    print_header("发布到微信公众号草稿箱")
    
    if date_dir is None:
        date_dir = get_today()
    
    draft_dir = DRAFTS_DIR / date_dir
    raw_file = draft_dir / "raw" / "article_raw.md"
    final_file = draft_dir / "final" / "article_final.md"
    cover_file = draft_dir / "final" / "cover.png"
    
    # 确定使用哪个文件
    if final_file.exists():
        article_file = final_file
    elif raw_file.exists():
        article_file = raw_file
        # 复制到 final
        final_dir = draft_dir / "final"
        final_dir.mkdir(parents=True, exist_ok=True)
        with open(raw_file, "r", encoding="utf-8") as f:
            content = f.read()
        with open(final_file, "w", encoding="utf-8") as f:
            f.write(content)
        article_file = final_file
    else:
        print_error("找不到文章文件")
        return False
    
    # 读取文章
    with open(article_file, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 提取标题
    lines = content.strip().split("\n")
    title = lines[0].lstrip("# ").strip()
    print(f"文章标题: {title}")
    
    # 1. 获取 access_token
    print("正在获取 access_token...")
    try:
        response = requests.get(
            "https://api.weixin.qq.com/cgi-bin/token",
            params={
                "grant_type": "client_credential",
                "appid": CONFIG["wechat_app_id"],
                "secret": CONFIG["wechat_app_secret"]
            },
            timeout=30
        )
        
        result = response.json()
        
        if "access_token" not in result:
            print_error(f"获取 access_token 失败: {result.get('errmsg', 'unknown error')}")
            if result.get("errcode") == 40164:
                print(f"IP 不在白名单，请将以下 IP 添加到公众号白名单")
            return False
        
        access_token = result["access_token"]
        print_success("获取 access_token 成功")
        
    except Exception as e:
        print_error(f"获取 access_token 失败: {e}")
        return False
    
    # 2. 上传封面（如果有）
    thumb_media_id = ""
    if cover_file.exists():
        print("正在上传封面...")
        try:
            with open(cover_file, "rb") as f:
                response = requests.post(
                    f"https://api.weixin.qq.com/cgi-bin/material/add_material",
                    params={"access_token": access_token, "type": "image"},
                    files={"media": f},
                    timeout=60
                )
            
            result = response.json()
            if "media_id" in result:
                thumb_media_id = result["media_id"]
                print_success("封面上传成功")
            else:
                print_warning(f"封面上传失败: {result.get('errmsg', '')}")
        except Exception as e:
            print_warning(f"封面上传失败: {e}")
    
    # 3. 创建草稿
    print("正在创建草稿...")
    
    # 简单的 HTML 转换
    html_content = content.replace("\n", "<br>")
    html_content = f"<p>{html_content}</p>"
    
    article_data = {
        "articles": [{
            "title": title,
            "author": "",
            "digest": "",
            "content": html_content,
            "content_source_url": "",
            "thumb_media_id": thumb_media_id,
            "need_open_comment": 0,
            "only_fans_can_comment": 0
        }]
    }
    
    try:
        response = requests.post(
            f"https://api.weixin.qq.com/cgi-bin/draft/add",
            params={"access_token": access_token},
            json=article_data,
            timeout=60
        )
        
        result = response.json()
        
        if "media_id" in result:
            media_id = result["media_id"]
            print_success("发布到草稿箱成功！")
            print(f"\n草稿 media_id: {media_id}")
            print("\n下一步操作：")
            print("1. 登录微信公众号后台（mp.weixin.qq.com）")
            print("2. 进入「素材管理」→「草稿箱」")
            print("3. 找到文章，预览检查")
            print("4. 确认无误后点击「发布」")
            return True
        else:
            print_error(f"创建草稿失败: {result.get('errmsg', 'unknown error')}")
            return False
            
    except Exception as e:
        print_error(f"创建草稿失败: {e}")
        return False


def main_menu():
    """主菜单"""
    while True:
        print_header("AI 自动写作工具")
        print("请选择操作：\n")
        print("  1. 创建新文章")
        print("  2. 生成文章（DeepSeek）")
        print("  3. 生成封面图")
        print("  4. 发布到草稿箱")
        print("  5. 一键完成（创建+生成+发布）")
        print("  0. 退出")
        print()
        
        choice = input("请输入选项 [0-5]: ").strip()
        
        if choice == "0":
            print("\n再见！")
            break
        elif choice == "1":
            topic = input("请输入文章主题 [默认: 待定主题]: ").strip() or "待定主题"
            date_dir = input(f"请输入日期 [默认: {get_today()}]: ").strip() or get_today()
            create_article(date_dir, topic)
            input("\n按回车继续...")
        elif choice == "2":
            date_dir = input(f"请输入日期 [默认: {get_today()}]: ").strip() or get_today()
            generate_article(date_dir)
            input("\n按回车继续...")
        elif choice == "3":
            date_dir = input(f"请输入日期 [默认: {get_today()}]: ").strip() or get_today()
            generate_cover(date_dir)
            input("\n按回车继续...")
        elif choice == "4":
            date_dir = input(f"请输入日期 [默认: {get_today()}]: ").strip() or get_today()
            publish_to_wechat(date_dir)
            input("\n按回车继续...")
        elif choice == "5":
            topic = input("请输入文章主题: ").strip()
            if not topic:
                print_error("请输入文章主题")
                continue
            
            date_dir = get_today()
            print(f"\n将使用日期: {date_dir}")
            
            # 一键完成
            create_article(date_dir, topic)
            print("\n请编辑 task.md 和 materials.md 后，按回车继续生成文章...")
            input()
            
            if generate_article(date_dir):
                generate_cover(date_dir)
                
                confirm = input("\n是否发布到草稿箱？[y/N]: ").strip().lower()
                if confirm == "y":
                    publish_to_wechat(date_dir)
            
            input("\n按回车继续...")
        else:
            print_error("无效选项，请重新选择")


if __name__ == "__main__":
    # 设置控制台编码
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
    
    main_menu()
