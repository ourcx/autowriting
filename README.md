# AI 公众号写作系统

公众号「老东谈道理」正在用的编辑器。起因是写一篇文章要花 2-3 小时，太慢了。

从一堆命令行脚本开始，随着号做起来后流程变复杂，逐渐演变成现在这套 Web 系统。用它写了一个月的大学咨询和政策解读类推文，涨粉 500，广告收入 700+。

## 核心能力

**RAG 索引往期文章** —— 生成时会调取历史内容，文章风格和叙述身份不会飘。

**提示词编排** —— 内置一套针对公众号场景的提示词工程，支持自定义调整，公众号素材、写作指南、往期内容统一注入。

**实时样式预览** —— 生成后可以在 Web 端直接预览公众号排版效果，支持自定义样式，所见即所得。

**图片支持** —— 支持图片上传，支持配置生图模型自动生成配图。

## 使用流程

1. 配置 AI Key（支持主流模型 API）
2. 输入标题 + 填写公众号素材
3. AI 生成草稿，实时预览公众号样式
4. 手动复制上传到公众号（自动发布需要企业资质，目前不支持）

## 页面截图

<img width="1501" height="803" alt="image" src="https://github.com/user-attachments/assets/61accced-c751-461a-8d42-7f7f2a3bf528" />
AI 配置

<img width="1511" height="884" alt="2b5fce749cc9e327775d7796f74ddb78" src="https://github.com/user-attachments/assets/f5899928-8713-4158-9f34-fa91c382968c" />
公众号预览

<img width="1512" height="800" alt="264b18843271a8f9faef4e0daf5fa05f" src="https://github.com/user-attachments/assets/4041dc26-fd9c-4868-b496-353945e80076" />
样式管理

<img width="1488" height="786" alt="150278045f7e43d6ac330ccabf7cb095" src="https://github.com/user-attachments/assets/3bb9586e-f3d6-4b33-8192-5b883d841b42" />

## 快速启动

```bash
cd web
npm install
npm start
```

前端跑在 http://localhost:5173，后端 API 在 http://localhost:3000。

## Docker 一键部署

项目根目录已提供 `Dockerfile` 和 `docker-compose.yml`，运行：

```bash
cp web/.env.example web/.env
# 编辑 web/.env，填写文章生成所需的 API Key
docker compose up -d --build
```

服务启动后访问 http://localhost:3000。SQLite、RAG 索引、上传图片、草稿和日志会分别保存在 Docker 命名卷中；详细持久化、备份和调试文件清理说明见 `docs/DEPLOYMENT.md`。

## 后续方向

工作流式的提示词编排能力——把现在的单次生成升级成多步骤的任务链，支持更复杂的写作场景。
如果你确实有公众号写作风格规范想喂给 LLM：

在项目根目录新建 写作参考/写作规范.md，写真正的"公众号写作风格指南"（朋友式口吻、避免 AI 套话、段落控制等）
