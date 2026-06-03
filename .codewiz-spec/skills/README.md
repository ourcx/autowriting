# 自定义 Skills

这个目录用于存放团队自定义的 Skills，用于增强 SpecAgents 的工作能力。

## Skills 类型

### 1. 知识型 Skills (type: "prompt-injection")
纯知识和规范，SubAgent 会将内容作为上下文知识应用。

### 2. 脚本型 Skills (type: "script")
包含可执行脚本，SubAgent 会自动执行对应的脚本文件。

## Skills 格式

### 知识型 Skill 示例

```markdown
---
name: "code-standards"
description: "代码规范"
type: "prompt-injection"
priority: 50
---

# 代码规范

## 命名规范
- 类名使用 PascalCase
- 方法名使用 camelCase
...
```

### 脚本型 Skill 示例

```markdown
---
name: "create-branch"
description: "创建功能分支的标准流程"
type: "script"
executable: true
script_path: "scripts/create-branch.sh"
priority: 90
---

# 创建功能分支

## 分支命名规范
...

## 使用方式
在模板中强调使用此 Skill，SubAgent 会自动执行脚本。
```

## 配置说明

### frontmatter 字段

- **name**: Skill 名称（必需）
- **description**: Skill 描述（可选）
- **type**: Skill 类型（可选）
		- `"prompt-injection"` - 知识型（默认）
		- `"script"` - 脚本型
- **executable**: 是否可执行（可选，仅 type="script" 时有效）
- **script_path**: 脚本路径（可选，相对于 Skill 目录）
- **priority**: 优先级，数字越大优先级越高（可选，默认 50）

## 使用方式

在模板中用自然语言强调使用某个 Skill：

```markdown
## 分支管理
请严格遵循 **create-branch** 规范创建功能分支。
```

SubAgent 会：
1. 在上下文中找到 create-branch Skill
2. 如果是知识型 - 应用其中的规范
3. 如果是脚本型 - 执行对应的脚本

## 目录结构

```
skills/
├── README.md
├── create-branch/          # 脚本型 Skill 示例
│   ├── skill.md
│   └── scripts/
│       └── create-branch.sh
└── code-standards/         # 知识型 Skill 示例
		  └── skill.md
```
