# AI 自动写作工具 - 打包版

将 AI 自动写作工具打包成独立可执行文件，无需安装 Python 环境。

## 功能

- 🆕 **创建新文章**：生成日期目录和模板文件
- 📝 **生成文章**：调用 MaaS API（DeepSeek v4 Pro）自动生成文章
- 🖼️ **生成封面**：创建渐变背景封面图
- 📤 **发布草稿**：一键发布到微信公众号草稿箱

## 使用方法

### 1. 运行程序

**Windows**：双击 `autowriting.exe` 或在命令行运行

**macOS**：
```bash
./autowriting
```

### 2. 按菜单操作

```
==================================================
  AI 自动写作工具
==================================================
请选择操作：

  1. 创建新文章
  2. 生成文章（MaaS - DeepSeek v4 Pro）
  3. 生成封面图
  4. 发布到草稿箱
  5. 一键完成（创建+生成+发布）
  0. 退出
```

## 打包说明

### 在 macOS 上打包（生成 macOS 可执行文件）

```bash
cd app
pip3 install -r requirements.txt
python3 build.py
```

生成文件：`app/dist/autowriting`

### 在 Windows 上打包（生成 .exe 文件）

1. 安装 Python 3.8+：https://www.python.org/downloads/

2. 安装依赖：
```cmd
cd app
pip install -r requirements.txt
```

3. 执行打包：
```cmd
python build.py
```

生成文件：`app\dist\autowriting.exe`

### 使用 GitHub Actions 自动打包（推荐）

如果你需要同时生成 Windows 和 macOS 版本，可以使用 GitHub Actions：

1. 将代码推送到 GitHub 仓库
2. 创建 `.github/workflows/build.yml`（见下方配置）
3. 推送后自动构建，在 Actions 页面下载

`.github/workflows/build.yml` 示例：

```yaml
name: Build Executable

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest]
    
    runs-on: ${{ matrix.os }}
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      
      - name: Install dependencies
        run: |
          pip install -r app/requirements.txt
      
      - name: Build executable
        run: |
          cd app
          python build.py
      
      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: autowriting-${{ matrix.os }}
          path: app/dist/*
```

## 目录结构

程序会在运行目录下创建以下结构：

```
公众号写作/
└── drafts/
    └── 20250131/          # 日期目录
        ├── prompt/
        │   ├── task.md      # 写作任务要求
        │   └── materials.md # 素材整理
        ├── raw/
        │   └── article_raw.md
        └── final/
            ├── article_final.md
            └── cover.png
```

## 配置说明

### API 配置

MaaS API 配置已内置在代码中，包括：
- API 端点：`https://maas.devops.xiaohongshu.com/v1`
- API Key：`REDACTED_MAAS_API_KEY`
- 用户邮箱：`zhuxinhao@xiaohongshu.com`
- App ID：`qs-api`
- 模型：`deepseek-v4-pro`

如需修改，请编辑 `autowriting.py` 中的 `CONFIG` 字典：

```python
CONFIG = {
    "maas_api_key": "你的API密钥",
    "maas_base_url": "https://maas.devops.xiaohongshu.com/v1",
    "maas_user_email": "你的邮箱",
    "maas_app_id": "你的AppID",
    "wechat_app_id": "你的微信AppID",
    "wechat_app_secret": "你的微信AppSecret",
}
```

### 微信公众号配置

**注意**：发布功能需要将运行机器的 IP 添加到微信公众号后台的 IP 白名单。

## 常见问题

### Q: Windows 上提示"无法找到入口点"

A: 请确保安装了最新版 Visual C++ Redistributable：
https://aka.ms/vs/17/release/vc_redist.x64.exe

### Q: macOS 上提示"无法打开，因为无法验证开发者"

A: 在终端执行：
```bash
xattr -d com.apple.quarantine ./autowriting
```

### Q: 提示 "IP 不在白名单"

A: 需要将当前机器的公网 IP 添加到微信公众号后台的 IP 白名单中。

### Q: 生成封面失败

A: 封面生成依赖 ImageMagick：
- Windows: https://imagemagick.org/script/download.php
- macOS: `brew install imagemagick`
- 也可以手动准备封面图放到 `final/cover.png`

## 技术支持

如有问题，请检查：
1. API 密钥是否有效且有余额
2. 网络是否能访问 maas.devops.xiaohongshu.com 和 api.weixin.qq.com
3. 邮箱和 App ID 是否正确配置
