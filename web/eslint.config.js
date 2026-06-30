import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// ───────────────────────────────────────────────────────────────────────
// Harness Engineering: 把"规范"转成"工具强制"。
// 错误消息必须三段式：❌ 问题 → ✅ FIX → 📖 see docs。
// 存量豁免见 docs/agents/harness.md，新代码默认走严格区。
// ───────────────────────────────────────────────────────────────────────

const FIX = {
  noConsole:
    '❌ 后端禁止 console.* | ✅ 用 logger.info/warn/error/debug | 📖 docs/agents/conventions.md',
  noFetch:
    '❌ 禁止裸 fetch() | ✅ 走 src/utils/apiHelpers.ts | 📖 docs/agents/structure.md#强约束',
  noTsIgnore:
    '❌ 禁止 @ts-ignore / @ts-expect-error | ✅ 用类型守卫；必须逃生时改用 // @ts-expect-error 并紧跟一行注释说明 | 📖 docs/agents/conventions.md',
  noAny:
    '❌ 禁止 any | ✅ 用 unknown + 类型守卫 / 精确类型 | 📖 docs/agents/conventions.md',
  noLocalStorageAI:
    '❌ 禁止页面直接读 localStorage 取 AI 配置 | ✅ 走 utils/aiConfig.ts 的 loadAIConfig() | 📖 docs/agents/conventions.md',
  noStoreInComponent:
    '❌ components 内禁止 import store | ✅ 状态由 page 通过 props 注入 | 📖 docs/agents/structure.md#强约束',
  noFsInRoutes:
    '❌ routes/ 内禁止直接 import fs 写绝对路径 | ✅ 路径走 web/server/config.js | 📖 docs/agents/structure.md#强约束',
  noDirectDb:
    '❌ 禁止 new Database( | ✅ 所有 SQLite 操作走 web/server/db.js | 📖 docs/agents/structure.md#强约束',
}

export default tseslint.config(
  // 忽略产物与基础设施脚本（scripts/ 是 lint 运行环境，避免自反）
  { ignores: ['dist', 'dist-electron', 'node_modules', 'scripts/**', 'electron/**'] },

  // 通用 JS 推荐
  js.configs.recommended,

  // ─────────── 前端 TS / TSX ───────────
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      // react-hooks v6 引入的存量违规规则（先降为 warn，加入 P2 清理）
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/unsupported-syntax': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/component-hook-factories': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // 存量 TS6133 还没清，保留 warn
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],

      // 严格禁 any / ts-ignore（增量约束：新代码 PR 必修，存量逐步清；pre-commit 钩子按变更行阻断）
      '@typescript-eslint/no-explicit-any': ['warn', { fixToUnknown: false, ignoreRestArgs: false }],
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // 调试器禁止
      'no-debugger': 'error',
      // console 只能 warn/error（与生产保持一致）
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // 强约束：前端禁裸 fetch（必须走 apiHelpers）
      // 存量违规：lint-staged 兜底拦截新代码；存量整体在 P2 阶段清理
      'no-restricted-globals': [
        'warn',
        { name: 'fetch', message: FIX.noFetch },
      ],

      // 允许 `cond && fn()` 短路调用（项目里常用，否则需要重构成 if）
      '@typescript-eslint/no-unused-expressions': [
        'warn',
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true },
      ],
    },
  },

  // ─────────── 组件层额外约束：禁引 store ───────────
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            { group: ['*/store/*', '**/store/**', '../store/*', '../../store/*'], message: FIX.noStoreInComponent },
          ],
        },
      ],
    },
  },

  // ─────────── 页面/组件：禁绕过 loadAIConfig 直读 localStorage ───────────
  {
    files: ['src/pages/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          // localStorage.getItem('ai...') / localStorage.getItem('apiKey') 之类
          selector:
            "CallExpression[callee.object.name='localStorage'][callee.property.name='getItem'][arguments.0.value=/ai|apiKey|provider|model/i]",
          message: FIX.noLocalStorageAI,
        },
      ],
    },
  },

  // ─────────── 后端 ESM JavaScript（server.js + server/**/*.js） ───────────
  {
    files: ['server.js', 'server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Node 内置
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        crypto: 'readonly',
        // 浏览器 / Electron-renderer 注入（少量后端工具会模拟）
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        MessageEvent: 'readonly',
        DataTransfer: 'readonly',
        ClipboardEvent: 'readonly',
      },
    },
    rules: {
      // 后端强制：禁 console.*（migration 等启动期日志可在文件顶部 /* eslint-disable no-console */）
      'no-console': 'error',
      'no-debugger': 'error',
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' },
      ],

      // 错误消息带 FIX 指引（针对后端常见违规）
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name=/^(log|info|debug|warn|error)$/]",
          message: FIX.noConsole,
        },
        {
          // 禁止 routes/ 之外的 new Database(（routes/ 由 no-restricted-imports 兜底）
          selector: "NewExpression[callee.name='Database']",
          message: FIX.noDirectDb,
        },
      ],
    },
  },

  // ─────────── 路由层额外约束（必须排在存量豁免之前，让豁免可降级它）───────────
  {
    files: ['server/routes/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: FIX.noFsInRoutes },
            { name: 'fs/promises', message: FIX.noFsInRoutes },
            { name: 'node:fs', message: FIX.noFsInRoutes },
            { name: 'node:fs/promises', message: FIX.noFsInRoutes },
            { name: 'better-sqlite3', message: FIX.noDirectDb },
          ],
        },
      ],
    },
  },

  // ─────────── 后端存量豁免（含 console.* / 直读 fs 等旧文件）───────────
  // 策略：旧文件降级为 warn（不阻断），新文件保持 error。
  // 清理路径：
  //   1. 把 console.* 替换为 logger.* → 从下方清单删除文件名
  //   2. 把 routes 内的 fs 直读改走 web/server/config.js 暴露的目录函数
  //   3. 文件全清干净后从清单移除，下次提交即受严格规则保护
  {
    files: [
      'server/logger.js',
      'server/db.js',
      'server/config.js',
      'server/cronEngine.js',
      'server/seedPrompts.js',
      'server/utils.js',
      'server/rag.js',
      'server/performanceMonitor.js',
      'server/routes/admin.js',
      'server/routes/articles.js',
      'server/routes/covers.js',
      'server/routes/cron.js',
      'server/routes/images.js',
      'server/routes/materials.js',
      'server/routes/monitoring.js',
      'server/routes/prompts.js',
      'server/routes/publish.js',
      'server/routes/rag.js',
      'server/routes/scores.js',
      'server/routes/settings.js',
      'server/routes/style.js',
      'server/routes/templates.js',
      'server/routes/toutiao.js',
      'server/routes/wechat.js',
      'server.js',
    ],
    rules: {
      'no-console': 'warn',
      'no-restricted-syntax': 'warn',
      'no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'no-empty': 'warn',
      'preserve-caught-error': 'off',
      'no-restricted-imports': 'warn',
    },
  },

)
