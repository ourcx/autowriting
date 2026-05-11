/* ============================================================
 * taskTemplateStore.ts — 写作任务模板（task 字段模板）
 * 内置框架 + localStorage 自定义模板 CRUD
 * ============================================================ */

export interface TaskTemplate {
  id: string
  name: string
  desc: string
  content: string    // 模板正文（Markdown 格式的写作要求）
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'wx-task-templates-v1'

// ── 内置写作框架 ──────────────────────────────────────────────

export const BUILTIN_TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'tool-review',
    name: '工具测评',
    desc: '真实使用后的效率工具评测框架',
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    content: `# 写作任务要求

## 基本信息

- **文章主题**：[工具名称] 实测：[一句话核心结论]
- **目标字数**：1500-2000 字
- **发布平台**：微信公众号

## 写作视角

以第一人称「我」写，基于真实使用体验，不吹不黑，给出明确判断。

## 结构要求

1. **开场**：直接给出我用这个工具解决了什么具体问题（避免"在当今时代"式开场）
2. **这是什么**：一段话解释核心功能，用日常语言，不堆术语
3. **怎么用**：分步骤，截图可以后补，重点说操作逻辑
4. **真实效果**：数据说话，比如"节省了 X 小时""成功率 X%"
5. **踩过的坑**：列出 2-3 个真实遇到的问题和解决方案
6. **值不值得用**：明确结论，给出适合/不适合的人群

## 注意事项

- 不写"希望对你有帮助""总结一下"等套话
- 如果某个功能没用过，直接说"我没测"，不要模糊描述
- 结尾用一个具体的行动建议收尾`,
  },
  {
    id: 'tutorial',
    name: '实战教程',
    desc: '从 0 到 1 的完整操作教程框架',
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    content: `# 写作任务要求

## 基本信息

- **文章主题**：手把手教你 [具体操作目标]
- **目标字数**：2000-2500 字
- **发布平台**：微信公众号

## 写作视角

用第一人称，把读者当做从零开始的朋友，假设对方不熟悉这个领域但有基本的电脑操作能力。

## 结构要求

1. **开场**：先说清楚"学完这篇你能做到什么"，给读者预期
2. **前置条件**：需要准备什么，列清单（账号/工具/权限）
3. **核心步骤**：每步一个小标题，步骤之间逻辑清晰，说明"为什么这么做"
4. **常见问题**：列出 3-5 个读者大概率会遇到的坑
5. **完整效果**：说明完成后应该看到什么，用于自检

## 注意事项

- 每个步骤必须可操作，不写"根据实际情况调整"这类废话
- 专业术语第一次出现时给括号解释
- 如果有多种方法，只推荐我用着最顺手的一种，不要"两种方法都介绍"`,
  },
  {
    id: 'pitfalls',
    name: '踩坑经验',
    desc: '真实问题与解决方案，避坑指南框架',
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    content: `# 写作任务要求

## 基本信息

- **文章主题**：[领域/工具] 踩过的 [N] 个坑（附解决方案）
- **目标字数**：1500-2000 字
- **发布平台**：微信公众号

## 写作视角

第一人称，分享真实踩坑过程，不美化，重点在"怎么解决"而不是"坑有多深"。

## 结构要求

1. **开场**：用一个最典型的坑开头，直接带读者入场景
2. **坑的列表**（主体部分，每个坑一小节）：
   - **坑的名称**：一句话描述问题
   - **我遇到时**：具体场景，什么操作触发的
   - **原因**：为什么会出现（一句话，不扯原理）
   - **解决方案**：具体步骤，能复现
3. **结尾**：给出一个"如果重来我会怎么做"的总结建议

## 注意事项

- 只写我真实遇到过的坑，没遇到的不要凑数
- 每个坑的解决方案必须亲测有效
- 不用"这个坑很多人都踩过"这种话，直接说坑是什么`,
  },
  {
    id: 'automation',
    name: '自动化流程',
    desc: '用 AI/脚本提升效率的方法分享框架',
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    content: `# 写作任务要求

## 基本信息

- **文章主题**：我用 [技术/工具] 把 [任务] 从 [原来耗时] 压到了 [现在耗时]
- **目标字数**：1800-2500 字
- **发布平台**：微信公众号

## 写作视角

第一人称，重点展示「之前 vs 之后」的效率对比，让读者感受到差异的真实性。

## 结构要求

1. **开场**：先给出核心数据对比（时间/次数/成本）
2. **之前怎么做**：描述原来的流程，体现繁琐在哪
3. **核心方案**：自动化的关键步骤，附关键代码或操作截图
4. **实际效果**：数据对比，最好附上截图或记录
5. **局限性**：哪些情况这套方案搞不定，诚实说
6. **如何复现**：给读者一个可操作的起点（不需要全套源码）

## 注意事项

- 效率数据要真实，不要夸大
- 代码或配置只放核心部分，不要贴完整 500 行
- 面向有基础的读者，但不假设对方会写代码`,
  },
  {
    id: 'opinion',
    name: '观点输出',
    desc: '基于具体事实的个人判断和分析框架',
    isBuiltin: true,
    createdAt: 0,
    updatedAt: 0,
    content: `# 写作任务要求

## 基本信息

- **文章主题**：[具体问题或现象]，我的看法是 [核心观点]
- **目标字数**：1200-1800 字
- **发布平台**：微信公众号

## 写作视角

第一人称，给出有具体依据的判断，不搞"凡事两面看"，要有明确立场。

## 结构要求

1. **开场**：直接亮明核心观点，一句话说清楚
2. **为什么这么看**：3-4 个具体理由，每个理由有具体事实支撑
3. **反驳常见误解**：说一个人们容易有的相反看法，然后解释为什么我不认同
4. **结尾**：一个具体的行动建议，或者留一个开放性问题

## 注意事项

- 有数据用数据，没数据用具体案例，不用"很多人认为"这种空话
- 不确定的地方直接说"我不确定"，不要硬写
- 结尾不要"欢迎评论""希望对你有帮助"等套话`,
  },
]

// ── CRUD ─────────────────────────────────────────────────────

export function loadCustomTaskTemplates(): TaskTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as TaskTemplate[]) : []
  } catch {
    return []
  }
}

export function loadAllTaskTemplates(): TaskTemplate[] {
  return [...BUILTIN_TASK_TEMPLATES, ...loadCustomTaskTemplates()]
}

export function saveCustomTaskTemplate(t: TaskTemplate): void {
  const customs = loadCustomTaskTemplates()
  const idx = customs.findIndex(c => c.id === t.id)
  const updated = { ...t, updatedAt: Date.now() }
  if (idx >= 0) customs[idx] = updated
  else customs.push(updated)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customs))
  window.dispatchEvent(new CustomEvent('wx-task-templates-updated'))
}

export function deleteCustomTaskTemplate(id: string): void {
  const customs = loadCustomTaskTemplates().filter(c => c.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customs))
  window.dispatchEvent(new CustomEvent('wx-task-templates-updated'))
}

export function createNewTaskTemplate(base?: Partial<TaskTemplate>): TaskTemplate {
  const now = Date.now()
  return {
    id: `custom-${now}`,
    name: base?.name ?? '新模板',
    desc: base?.desc ?? '',
    content: base?.content ?? '# 写作任务要求\n\n## 基本信息\n\n- **文章主题**：\n- **目标字数**：1500-2000 字\n\n## 结构要求\n\n1. \n2. \n3. ',
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  }
}
