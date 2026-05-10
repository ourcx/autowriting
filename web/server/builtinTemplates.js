/**
 * 内置 CSS 模板数据（服务端版）
 * 与前端 src/utils/templateStore.ts 中 BUILTIN_TEMPLATES 保持同步
 * 首次启动时由 server.js 写入 SQLite style_templates 表
 */

const CSS_DEFAULT = `/* ====== 经典蓝 ====== */
#wemd { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #333333; line-height: 1.75; word-break: break-word; padding: 24px 24px 40px; }
#wemd p { margin: 16px 0; line-height: 1.75; text-align: justify; }
#wemd h1 { margin: 32px 0 20px; text-align: center; font-size: 22px; font-weight: bold; color: #111111; padding-bottom: 14px; border-bottom: 2px solid #e5e7eb; }
#wemd h2 { margin: 28px 0 14px; font-size: 18px; font-weight: bold; color: #1e6bb8; padding-left: 14px; position: relative; }
#wemd h2::before { content: ""; display: block; position: absolute; left: 0; top: 3px; bottom: 3px; width: 4px; background: #1e6bb8; border-radius: 2px; }
#wemd h3 { margin: 22px 0 10px; font-size: 16px; font-weight: bold; color: #1e6bb8; padding-left: 18px; position: relative; }
#wemd h3::before { content: "◆"; display: block; position: absolute; left: 0; top: 0; font-size: 11px; color: #5a9fd4; line-height: 1.6; }
#wemd h4 { margin: 18px 0 8px; font-size: 15px; font-weight: bold; color: #555555; }
#wemd ul, #wemd ol { margin: 12px 0; padding-left: 24px; }
#wemd li { margin: 6px 0; line-height: 1.75; }
#wemd blockquote { margin: 18px 0; padding: 14px 16px 14px 20px; background: #f0f7ff; border-left: 4px solid #1e6bb8; border-radius: 0 6px 6px 0; color: #555555; }
#wemd blockquote p { margin: 0; font-size: 15px; }
#wemd strong { font-weight: bold; color: #111111; }
#wemd em { font-style: italic; color: #1e6bb8; }
#wemd code { color: #d63384; background: #fdf0f5; padding: 2px 6px; border-radius: 3px; font-size: 14px; font-family: "Courier New", monospace; }
#wemd pre { margin: 16px 0; padding: 16px; background: #1e2330; border-radius: 6px; overflow-x: auto; }
#wemd pre code { color: #abb2bf; font-size: 13px; background: transparent; padding: 0; }
#wemd a { color: #1e6bb8; text-decoration: none; border-bottom: 1px solid #b3d0f0; }
#wemd hr { margin: 28px 0; border: none; border-top: 1px solid #e5e7eb; }
#wemd img { display: block; max-width: 100%; margin: 16px auto; border-radius: 4px; }
#wemd table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
#wemd th { background: #dbeafe; color: #1e3a5f; font-weight: bold; border: 1px solid #bfdbfe; padding: 10px 12px; text-align: left; }
#wemd td { border: 1px solid #e5e7eb; padding: 10px 12px; color: #374151; }
#wemd tr:nth-child(even) td { background: #f8faff; }`

const CSS_MORANDI = `/* ====== 莫兰迪 ====== */
#wemd { font-family: "Georgia", "PingFang SC", "Microsoft YaHei", serif; color: #3A4D39; line-height: 2.0; word-break: break-word; padding: 24px 24px 40px; }
#wemd p { margin: 16px 0; line-height: 2.0; text-align: justify; letter-spacing: 0.3px; }
#wemd h1 { margin: 32px 0 20px; text-align: center; font-size: 22px; font-weight: normal; color: #1A261D; letter-spacing: 3px; padding-bottom: 12px; position: relative; }
#wemd h1::after { content: ""; display: block; position: absolute; bottom: 0; left: 50%; width: 40px; height: 2px; background: #4F6F52; margin-left: -20px; }
#wemd h2 { margin: 28px 0 14px; font-size: 18px; font-weight: bold; color: #4F6F52; padding: 8px 12px 8px 16px; background: #f0f5f0; border-left: 4px solid #4F6F52; border-radius: 0 4px 4px 0; }
#wemd h3 { margin: 22px 0 10px; font-size: 16px; font-weight: bold; color: #4F6F52; padding-left: 20px; position: relative; }
#wemd h3::before { content: "▎"; display: block; position: absolute; left: 0; top: 0; color: #739072; font-size: 16px; }
#wemd blockquote { margin: 18px 0; padding: 14px 18px; background: #f4f8f4; border-left: 3px solid #739072; border-radius: 0 6px 6px 0; color: #556B58; }
#wemd strong { font-weight: bold; color: #1A261D; }
#wemd code { color: #4F6F52; background: #eef3ee; padding: 2px 6px; border-radius: 3px; font-size: 14px; font-family: monospace; }
#wemd pre { margin: 16px 0; padding: 16px; background: #2f3e32; border-radius: 6px; overflow-x: auto; }
#wemd pre code { color: #a8c5a0; font-size: 13px; background: transparent; padding: 0; }
#wemd a { color: #4F6F52; text-decoration: none; border-bottom: 1px solid #a0bea2; }
#wemd hr { margin: 28px 0; border: none; border-top: 1px dashed #b0c4b1; }
#wemd img { display: block; max-width: 100%; margin: 16px auto; border-radius: 4px; }
#wemd table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
#wemd th { background: #dde8de; color: #2f3e32; font-weight: bold; border: 1px solid #b8cebc; padding: 10px 12px; text-align: left; }
#wemd td { border: 1px solid #c8d5c9; padding: 10px 12px; color: #3A4D39; }
#wemd tr:nth-child(even) td { background: #f4f8f4; }`

const CSS_MINIMAL = `/* ====== 极简黑 ====== */
#wemd { font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #1a1a1a; line-height: 1.8; word-break: break-word; padding: 24px 24px 40px; }
#wemd p { margin: 16px 0; line-height: 1.8; text-align: justify; }
#wemd h1 { margin: 32px 0 20px; text-align: center; font-size: 24px; font-weight: 900; color: #000000; letter-spacing: -0.5px; padding-bottom: 14px; border-bottom: 3px solid #000000; }
#wemd h2 { margin: 28px 0 14px; font-size: 18px; font-weight: 800; color: #000000; padding-bottom: 8px; border-bottom: 1px solid #cccccc; position: relative; }
#wemd h2::before { content: ""; display: block; position: absolute; bottom: -1px; left: 0; width: 36px; height: 2px; background: #000000; }
#wemd h3 { margin: 22px 0 10px; font-size: 16px; font-weight: 700; color: #222222; padding-left: 14px; position: relative; }
#wemd h3::before { content: ""; display: block; position: absolute; left: 0; top: 4px; width: 6px; height: 6px; background: #000000; border-radius: 1px; }
#wemd blockquote { margin: 18px 0; padding: 12px 16px; background: #f5f5f5; border-left: 4px solid #000000; color: #444444; }
#wemd strong { font-weight: bold; color: #000000; }
#wemd code { color: #000000; background: #eeeeee; padding: 2px 6px; border-radius: 2px; font-size: 14px; font-family: monospace; }
#wemd pre { margin: 16px 0; padding: 16px; background: #111111; border-radius: 4px; overflow-x: auto; }
#wemd pre code { color: #eeeeee; font-size: 13px; background: transparent; padding: 0; }
#wemd a { color: #000000; text-decoration: none; border-bottom: 1px solid #888888; font-weight: 600; }
#wemd hr { margin: 28px 0; border: none; border-top: 2px solid #000000; }
#wemd img { display: block; max-width: 100%; margin: 16px auto; }
#wemd table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
#wemd th { background: #111111; color: #ffffff; font-weight: bold; border: 1px solid #111111; padding: 10px 12px; text-align: left; }
#wemd td { border: 1px solid #cccccc; padding: 10px 12px; }
#wemd tr:nth-child(even) td { background: #f5f5f5; }`

const CSS_SUNSET = `/* ====== 夕阳橙 ====== */
#wemd { font-family: "Georgia", "STSong", "SimSun", serif; color: #3d2b1f; line-height: 1.9; word-break: break-word; padding: 24px 24px 40px; }
#wemd p { margin: 16px 0; line-height: 1.9; text-align: justify; letter-spacing: 0.2px; }
#wemd h1 { margin: 32px 0 20px; text-align: center; font-size: 22px; font-weight: bold; color: #6b1d0a; letter-spacing: 2px; padding-bottom: 14px; position: relative; }
#wemd h1::after { content: ""; display: block; position: absolute; bottom: 0; left: 50%; width: 60px; height: 2px; background: #c8602a; margin-left: -30px; }
#wemd h2 { margin: 28px 0 14px; font-size: 18px; font-weight: bold; color: #8b3a0f; padding: 6px 12px 6px 16px; background: #fdf6ee; border-left: 4px solid #c8602a; border-radius: 0 4px 4px 0; }
#wemd h3 { margin: 22px 0 10px; font-size: 16px; font-weight: bold; color: #b25220; padding-left: 20px; position: relative; }
#wemd h3::before { content: "✦"; display: block; position: absolute; left: 0; top: 0; font-size: 12px; color: #c8602a; line-height: 1.7; }
#wemd blockquote { margin: 18px 0; padding: 14px 18px; background: #fdf6ee; border-left: 4px solid #c8602a; border-radius: 0 6px 6px 0; color: #6b4c36; }
#wemd strong { font-weight: bold; color: #6b1d0a; }
#wemd code { color: #c8602a; background: #fdeee4; padding: 2px 6px; border-radius: 3px; font-size: 14px; font-family: monospace; }
#wemd pre { margin: 16px 0; padding: 16px; background: #2a1a0f; border-radius: 6px; overflow-x: auto; }
#wemd pre code { color: #f4c87a; font-size: 13px; background: transparent; padding: 0; }
#wemd a { color: #c8602a; text-decoration: none; border-bottom: 1px solid #e5a882; }
#wemd hr { margin: 28px 0; border: none; border-top: 1px solid #e5c9a0; }
#wemd img { display: block; max-width: 100%; margin: 16px auto; border-radius: 4px; }
#wemd table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
#wemd th { background: #f5ddc8; color: #6b1d0a; font-weight: bold; border: 1px solid #e5c9a0; padding: 10px 12px; text-align: left; }
#wemd td { border: 1px solid #e5c9a0; padding: 10px 12px; color: #3d2b1f; }
#wemd tr:nth-child(even) td { background: #fdf6ee; }`

const CSS_AURORA = `/* ====== 极光紫 ====== */
#wemd { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; color: #2d2a3e; line-height: 1.8; word-break: break-word; padding: 24px 24px 40px; }
#wemd p { margin: 16px 0; line-height: 1.8; text-align: justify; }
#wemd h1 { margin: 32px 0 20px; text-align: center; font-size: 22px; font-weight: bold; color: #1a0d3b; padding-bottom: 14px; position: relative; }
#wemd h1::after { content: ""; display: block; position: absolute; bottom: 0; left: 50%; width: 48px; height: 3px; background: #7c3aed; margin-left: -24px; border-radius: 2px; }
#wemd h2 { margin: 28px 0 14px; font-size: 18px; font-weight: bold; color: #4c1d95; padding: 7px 12px 7px 16px; background: #f3eeff; border-left: 4px solid #7c3aed; border-radius: 0 6px 6px 0; }
#wemd h3 { margin: 22px 0 10px; font-size: 16px; font-weight: bold; color: #5b21b6; padding-left: 20px; position: relative; }
#wemd h3::before { content: "◈"; display: block; position: absolute; left: 0; top: 0; font-size: 13px; color: #7c3aed; line-height: 1.6; }
#wemd blockquote { margin: 18px 0; padding: 14px 18px; background: #f3eeff; border-left: 4px solid #7c3aed; border-radius: 0 8px 8px 0; color: #4c1d95; }
#wemd strong { font-weight: bold; color: #4c1d95; }
#wemd code { color: #6d28d9; background: #ede9fe; padding: 2px 6px; border-radius: 4px; font-size: 14px; font-family: monospace; }
#wemd pre { margin: 16px 0; padding: 16px; background: #1a0d3b; border-radius: 8px; overflow-x: auto; }
#wemd pre code { color: #c4b5fd; font-size: 13px; background: transparent; padding: 0; }
#wemd a { color: #7c3aed; text-decoration: none; border-bottom: 1px solid #c4b5fd; }
#wemd hr { margin: 28px 0; border: none; border-top: 1px solid #d8c8f8; }
#wemd img { display: block; max-width: 100%; margin: 16px auto; border-radius: 8px; }
#wemd table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
#wemd th { background: #ede9fe; color: #4c1d95; font-weight: bold; border: 1px solid #c4b5fd; padding: 10px 12px; text-align: left; }
#wemd td { border: 1px solid #ddd6fe; padding: 10px 12px; color: #2d2a3e; }
#wemd tr:nth-child(even) td { background: #f8f5ff; }`

export const BUILTIN_TEMPLATES_DATA = [
  { id: 'default', name: '经典蓝', desc: '清爽专业，适合大多数文章', accentColor: '#1e6bb8', css: CSS_DEFAULT, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'morandi', name: '莫兰迪', desc: '低饱和自然色调，文艺感强', accentColor: '#4F6F52', css: CSS_MORANDI, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'minimal', name: '极简黑', desc: '干净有力，排版纯粹',       accentColor: '#111111', css: CSS_MINIMAL, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'sunset',  name: '夕阳橙', desc: '暖色复古胶片，有温度感',   accentColor: '#c8602a', css: CSS_SUNSET,  isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'aurora',  name: '极光紫', desc: '渐变紫调，年轻现代',       accentColor: '#7c3aed', css: CSS_AURORA,  isBuiltin: true, createdAt: 0, updatedAt: 0 },
]
