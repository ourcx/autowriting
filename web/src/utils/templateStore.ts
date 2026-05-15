/**
 * WeChat CSS Template Store
 * 内置模板 + localStorage 自定义模板 CRUD
 */

export interface TemplateItem {
  id: string
  name: string
  desc: string
  accentColor: string
  css: string
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'wx-style-templates-v1'

// ── 内置模板 CSS ─────────────────────────────────────────────────────────────

export const CSS_DEFAULT = `/* ====== 经典蓝 ====== */
#wemd {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: #333333;
  line-height: 1.75;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 1.75;
  text-align: justify;
}
#wemd h1 {
  margin: 32px 0 20px;
  text-align: center;
  font-size: 22px;
  font-weight: bold;
  color: #111111;
  padding-bottom: 14px;
  border-bottom: 2px solid #e5e7eb;
  position: relative;
}
#wemd h2 {
  margin: 28px 0 14px;
  font-size: 18px;
  font-weight: bold;
  color: #1e6bb8;
  padding-left: 14px;
  position: relative;
}
#wemd h2::before {
  content: "";
  display: block;
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 4px;
  background: #1e6bb8;
  border-radius: 2px;
}
#wemd h3 {
  margin: 22px 0 10px;
  font-size: 16px;
  font-weight: bold;
  color: #1e6bb8;
  padding-left: 18px;
  position: relative;
}
#wemd h3::before {
  content: "◆";
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  font-size: 11px;
  color: #5a9fd4;
  line-height: 1.6;
}
#wemd h4 {
  margin: 18px 0 8px;
  font-size: 15px;
  font-weight: bold;
  color: #555555;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 1.75;
}
#wemd blockquote {
  margin: 18px 0;
  padding: 14px 16px 14px 20px;
  background: #f0f7ff;
  border-left: 4px solid #1e6bb8;
  border-radius: 0 6px 6px 0;
  color: #555555;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
}
#wemd strong {
  font-weight: bold;
  color: #111111;
}
#wemd em {
  font-style: italic;
  color: #1e6bb8;
}
#wemd code {
  color: #d63384;
  background: #fdf0f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #1e2330;
  border-radius: 6px;
  overflow-x: auto;
}
#wemd pre code {
  color: #abb2bf;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #1e6bb8;
  text-decoration: none;
  border-bottom: 1px solid #b3d0f0;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 1px solid #e5e7eb;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 20px auto;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(30,107,184,0.12), 0 1px 3px rgba(0,0,0,0.08);
  border: 1px solid #dbeafe;
}
#wemd img + em, #wemd img + p > em:only-child {
  display: block;
  text-align: center;
  font-size: 13px;
  color: #6b7280;
  margin-top: -10px;
  margin-bottom: 16px;
  font-style: normal;
}
#wemd figure { margin: 20px 0; text-align: center; }
#wemd figure img { margin: 0 auto 8px; }
#wemd figcaption { font-size: 13px; color: #6b7280; }
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #dbeafe;
  color: #1e3a5f;
  font-weight: bold;
  border: 1px solid #bfdbfe;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #e5e7eb;
  padding: 10px 12px;
  color: #374151;
}
#wemd tr:nth-child(even) td {
  background: #f8faff;
}`

export const CSS_MORANDI = `/* ====== 莫兰迪 ====== */
#wemd {
  font-family: "Georgia", "PingFang SC", "Microsoft YaHei", serif;
  color: #3A4D39;
  line-height: 2.0;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 2.0;
  text-align: justify;
  letter-spacing: 0.3px;
}
#wemd h1 {
  margin: 32px 0 20px;
  text-align: center;
  font-size: 22px;
  font-weight: normal;
  color: #1A261D;
  letter-spacing: 3px;
  padding-bottom: 12px;
  position: relative;
}
#wemd h1::after {
  content: "";
  display: block;
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 40px;
  height: 2px;
  background: #4F6F52;
  margin-left: -20px;
}
#wemd h2 {
  margin: 28px 0 14px;
  font-size: 18px;
  font-weight: bold;
  color: #4F6F52;
  padding: 8px 12px 8px 16px;
  background: #f0f5f0;
  border-left: 4px solid #4F6F52;
  border-radius: 0 4px 4px 0;
}
#wemd h3 {
  margin: 22px 0 10px;
  font-size: 16px;
  font-weight: bold;
  color: #4F6F52;
  padding-left: 20px;
  position: relative;
}
#wemd h3::before {
  content: "▎";
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  color: #739072;
  font-size: 16px;
}
#wemd h4 {
  margin: 18px 0 8px;
  font-size: 15px;
  color: #556B58;
  font-weight: bold;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 2.0;
  color: #3A4D39;
}
#wemd blockquote {
  margin: 18px 0;
  padding: 14px 18px;
  background: #f4f8f4;
  border-left: 3px solid #739072;
  border-radius: 0 6px 6px 0;
  color: #556B58;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.85;
}
#wemd strong {
  font-weight: bold;
  color: #1A261D;
}
#wemd em {
  font-style: italic;
  color: #4F6F52;
}
#wemd code {
  color: #4F6F52;
  background: #eef3ee;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #2f3e32;
  border-radius: 6px;
  overflow-x: auto;
}
#wemd pre code {
  color: #a8c5a0;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #4F6F52;
  text-decoration: none;
  border-bottom: 1px solid #a0bea2;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 1px dashed #b0c4b1;
  position: relative;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 20px auto;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(79,111,82,0.15), 0 1px 4px rgba(0,0,0,0.06);
  border: 1px solid #c8d5c9;
}
#wemd img + em, #wemd img + p > em:only-child {
  display: block;
  text-align: center;
  font-size: 13px;
  color: #739072;
  margin-top: -10px;
  margin-bottom: 16px;
  font-style: normal;
  letter-spacing: 0.3px;
}
#wemd figure { margin: 20px 0; text-align: center; }
#wemd figure img { margin: 0 auto 8px; }
#wemd figcaption { font-size: 13px; color: #739072; }
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #dde8de;
  color: #2f3e32;
  font-weight: bold;
  border: 1px solid #b8cebc;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #c8d5c9;
  padding: 10px 12px;
  color: #3A4D39;
}
#wemd tr:nth-child(even) td {
  background: #f4f8f4;
}`

export const CSS_MINIMAL = `/* ====== 极简黑 ====== */
#wemd {
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: #1a1a1a;
  line-height: 1.8;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 1.8;
  text-align: justify;
}
#wemd h1 {
  margin: 32px 0 20px;
  text-align: center;
  font-size: 24px;
  font-weight: 900;
  color: #000000;
  letter-spacing: -0.5px;
  padding-bottom: 14px;
  border-bottom: 3px solid #000000;
}
#wemd h2 {
  margin: 28px 0 14px;
  font-size: 18px;
  font-weight: 800;
  color: #000000;
  padding-bottom: 8px;
  border-bottom: 1px solid #cccccc;
  position: relative;
}
#wemd h2::before {
  content: "";
  display: block;
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 36px;
  height: 2px;
  background: #000000;
}
#wemd h3 {
  margin: 22px 0 10px;
  font-size: 16px;
  font-weight: 700;
  color: #222222;
  padding-left: 14px;
  position: relative;
}
#wemd h3::before {
  content: "";
  display: block;
  position: absolute;
  left: 0;
  top: 4px;
  width: 6px;
  height: 6px;
  background: #000000;
  border-radius: 1px;
}
#wemd h4 {
  margin: 18px 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: #444444;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 1.8;
}
#wemd blockquote {
  margin: 18px 0;
  padding: 12px 16px;
  background: #f5f5f5;
  border-left: 4px solid #000000;
  color: #444444;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.75;
}
#wemd strong {
  font-weight: bold;
  color: #000000;
}
#wemd em {
  font-style: italic;
  color: #555555;
}
#wemd code {
  color: #000000;
  background: #eeeeee;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #111111;
  border-radius: 4px;
  overflow-x: auto;
}
#wemd pre code {
  color: #eeeeee;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #000000;
  text-decoration: none;
  border-bottom: 1px solid #888888;
  font-weight: 600;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 2px solid #000000;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 24px auto;
  border-radius: 2px;
  box-shadow: 4px 4px 0 #111111;
  border: 2px solid #111111;
}
#wemd img + em, #wemd img + p > em:only-child {
  display: block;
  text-align: center;
  font-size: 12px;
  color: #888888;
  margin-top: -14px;
  margin-bottom: 16px;
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
#wemd figure { margin: 24px 0; text-align: center; }
#wemd figure img { margin: 0 auto 8px; }
#wemd figcaption { font-size: 12px; color: #888888; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #111111;
  color: #ffffff;
  font-weight: bold;
  border: 1px solid #111111;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #cccccc;
  padding: 10px 12px;
}
#wemd tr:nth-child(even) td {
  background: #f5f5f5;
}`

export const CSS_SUNSET = `/* ====== 夕阳橙 ====== */
#wemd {
  font-family: "Georgia", "STSong", "SimSun", serif;
  color: #3d2b1f;
  line-height: 1.9;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 1.9;
  text-align: justify;
  letter-spacing: 0.2px;
}
#wemd h1 {
  margin: 32px 0 20px;
  text-align: center;
  font-size: 22px;
  font-weight: bold;
  color: #6b1d0a;
  letter-spacing: 2px;
  padding-bottom: 14px;
  position: relative;
}
#wemd h1::after {
  content: "";
  display: block;
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 60px;
  height: 2px;
  background: #c8602a;
  margin-left: -30px;
}
#wemd h2 {
  margin: 28px 0 14px;
  font-size: 18px;
  font-weight: bold;
  color: #8b3a0f;
  padding: 6px 12px 6px 16px;
  background: #fdf6ee;
  border-left: 4px solid #c8602a;
  border-radius: 0 4px 4px 0;
}
#wemd h3 {
  margin: 22px 0 10px;
  font-size: 16px;
  font-weight: bold;
  color: #b25220;
  padding-left: 20px;
  position: relative;
}
#wemd h3::before {
  content: "✦";
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  font-size: 12px;
  color: #c8602a;
  line-height: 1.7;
}
#wemd h4 {
  margin: 18px 0 8px;
  font-size: 15px;
  color: #b25220;
  font-weight: bold;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 1.9;
  color: #3d2b1f;
}
#wemd blockquote {
  margin: 18px 0;
  padding: 14px 18px;
  background: #fdf6ee;
  border-left: 4px solid #c8602a;
  border-radius: 0 6px 6px 0;
  color: #6b4c36;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.85;
}
#wemd strong {
  font-weight: bold;
  color: #6b1d0a;
}
#wemd em {
  font-style: italic;
  color: #b25220;
}
#wemd code {
  color: #c8602a;
  background: #fdeee4;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #2a1a0f;
  border-radius: 6px;
  overflow-x: auto;
}
#wemd pre code {
  color: #f4c87a;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #c8602a;
  text-decoration: none;
  border-bottom: 1px solid #e5a882;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 1px solid #e5c9a0;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 20px auto;
  border-radius: 4px;
  box-shadow: 0 3px 14px rgba(200,96,42,0.18), 0 1px 4px rgba(0,0,0,0.08);
  border: 1px solid #e5c9a0;
}
#wemd img + em, #wemd img + p > em:only-child {
  display: block;
  text-align: center;
  font-size: 13px;
  color: #b25220;
  margin-top: -10px;
  margin-bottom: 16px;
  font-style: italic;
  letter-spacing: 0.2px;
}
#wemd figure { margin: 20px 0; text-align: center; }
#wemd figure img { margin: 0 auto 8px; }
#wemd figcaption { font-size: 13px; color: #b25220; font-style: italic; }
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #f5ddc8;
  color: #6b1d0a;
  font-weight: bold;
  border: 1px solid #e5c9a0;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #e5c9a0;
  padding: 10px 12px;
  color: #3d2b1f;
}
#wemd tr:nth-child(even) td {
  background: #fdf6ee;
}`

export const CSS_AURORA = `/* ====== 极光紫 ====== */
#wemd {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #2d2a3e;
  line-height: 1.8;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 1.8;
  text-align: justify;
}
#wemd h1 {
  margin: 32px 0 20px;
  text-align: center;
  font-size: 22px;
  font-weight: bold;
  color: #1a0d3b;
  padding-bottom: 14px;
  position: relative;
}
#wemd h1::after {
  content: "";
  display: block;
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 48px;
  height: 3px;
  background: #7c3aed;
  margin-left: -24px;
  border-radius: 2px;
}
#wemd h2 {
  margin: 28px 0 14px;
  font-size: 18px;
  font-weight: bold;
  color: #4c1d95;
  padding: 7px 12px 7px 16px;
  background: #f3eeff;
  border-left: 4px solid #7c3aed;
  border-radius: 0 6px 6px 0;
}
#wemd h3 {
  margin: 22px 0 10px;
  font-size: 16px;
  font-weight: bold;
  color: #5b21b6;
  padding-left: 20px;
  position: relative;
}
#wemd h3::before {
  content: "◈";
  display: block;
  position: absolute;
  left: 0;
  top: 0;
  font-size: 13px;
  color: #7c3aed;
  line-height: 1.6;
}
#wemd h4 {
  margin: 18px 0 8px;
  font-size: 15px;
  color: #6d28d9;
  font-weight: bold;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 1.8;
  color: #2d2a3e;
}
#wemd blockquote {
  margin: 18px 0;
  padding: 14px 18px;
  background: #f3eeff;
  border-left: 4px solid #7c3aed;
  border-radius: 0 8px 8px 0;
  color: #4c1d95;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
}
#wemd strong {
  font-weight: bold;
  color: #4c1d95;
}
#wemd em {
  font-style: italic;
  color: #5b21b6;
}
#wemd code {
  color: #6d28d9;
  background: #ede9fe;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #1a0d3b;
  border-radius: 8px;
  overflow-x: auto;
}
#wemd pre code {
  color: #c4b5fd;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #7c3aed;
  text-decoration: none;
  border-bottom: 1px solid #c4b5fd;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 1px solid #d8c8f8;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 20px auto;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(124,58,237,0.18), 0 1px 4px rgba(0,0,0,0.08);
  border: 1px solid #ddd6fe;
}
#wemd img + em, #wemd img + p > em:only-child {
  display: block;
  text-align: center;
  font-size: 13px;
  color: #7c3aed;
  margin-top: -10px;
  margin-bottom: 16px;
  font-style: normal;
}
#wemd figure { margin: 20px 0; text-align: center; }
#wemd figure img { margin: 0 auto 8px; }
#wemd figcaption { font-size: 13px; color: #7c3aed; }
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #ede9fe;
  color: #4c1d95;
  font-weight: bold;
  border: 1px solid #c4b5fd;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #ddd6fe;
  padding: 10px 12px;
  color: #2d2a3e;
}
#wemd tr:nth-child(even) td {
  background: #f8f5ff;
}`

// ── 内置模板列表（前端本地副本，用于离线 fallback） ──────────────────────────

export const BUILTIN_TEMPLATES: TemplateItem[] = [
  { id: 'default', name: '经典蓝', desc: '清爽专业，适合大多数文章', accentColor: '#1e6bb8', css: CSS_DEFAULT, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'morandi', name: '莫兰迪', desc: '低饱和自然色调，文艺感强', accentColor: '#4F6F52', css: CSS_MORANDI, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'minimal', name: '极简黑', desc: '干净有力，排版纯粹', accentColor: '#111111', css: CSS_MINIMAL, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'sunset', name: '夕阳橙', desc: '暖色复古胶片，有温度感', accentColor: '#c8602a', css: CSS_SUNSET, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'aurora', name: '极光紫', desc: '渐变紫调，年轻现代', accentColor: '#7c3aed', css: CSS_AURORA, isBuiltin: true, createdAt: 0, updatedAt: 0 },
]

// ── API-based CRUD（主路径） + localStorage fallback ─────────────────────────

/** 从服务端拉取所有模板（内置 + 自定义） */
export async function fetchAllTemplates(): Promise<TemplateItem[]> {
  try {
    const resp = await fetch('/api/templates')
    if (!resp.ok) throw new Error('fetch failed')
    const data = await resp.json() as Array<Record<string, unknown>>
    return data.map(t => ({
      id:          String(t.id),
      name:        String(t.name),
      desc:        String(t.desc ?? ''),
      accentColor: String(t.accent_color ?? t.accentColor ?? '#6366f1'),
      css:         String(t.css ?? ''),
      isBuiltin:   Boolean(t.is_builtin ?? t.isBuiltin),
      createdAt:   Number(t.created_at  ?? t.createdAt  ?? 0),
      updatedAt:   Number(t.updated_at  ?? t.updatedAt  ?? 0),
    }))
  } catch {
    // fallback：内置模板 + localStorage 自定义
    return [...BUILTIN_TEMPLATES, ...loadCustomTemplatesLocal()]
  }
}

/** 保存自定义模板到服务端（POST 新建 / PUT 更新） */
export async function saveCustomTemplate(t: TemplateItem): Promise<void> {
  const payload = {
    id:          t.id,
    name:        t.name,
    desc:        t.desc,
    accentColor: t.accentColor,
    css:         t.css,
    isBuiltin:   false,
  }
  try {
    await fetch('/api/templates', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
  } catch {
    // fallback：写 localStorage
    const customs = loadCustomTemplatesLocal()
    const idx = customs.findIndex(c => c.id === t.id)
    const updated = { ...t, updatedAt: Date.now() }
    if (idx >= 0) customs[idx] = updated
    else customs.push(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customs))
  }
  window.dispatchEvent(new CustomEvent('wxtemplates-updated'))
}

/** 删除自定义模板 */
export async function deleteCustomTemplate(id: string): Promise<void> {
  try {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
  } catch {
    const customs = loadCustomTemplatesLocal().filter(c => c.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customs))
  }
  window.dispatchEvent(new CustomEvent('wxtemplates-updated'))
}

// ── localStorage 兼容层（仅用于 fallback） ───────────────────────────────────

function loadCustomTemplatesLocal(): TemplateItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as TemplateItem[]) : []
  } catch {
    return []
  }
}

/** @deprecated 请使用 fetchAllTemplates()，此函数仅返回本地内置+localStorage */
export function loadCustomTemplates(): TemplateItem[] {
  return loadCustomTemplatesLocal()
}

/** @deprecated 请使用 fetchAllTemplates() */
export function loadAllTemplates(): TemplateItem[] {
  return [...BUILTIN_TEMPLATES, ...loadCustomTemplatesLocal()]
}

export function createNewTemplate(base?: Partial<TemplateItem>): TemplateItem {
  const now = Date.now()
  return {
    id: `custom-${now}`,
    name: base?.name ?? '新模板',
    desc: base?.desc ?? '',
    accentColor: base?.accentColor ?? '#6366f1',
    css: base?.css ?? CSS_DEFAULT.replace('/* ====== 经典蓝 ====== */', '/* ====== 自定义模板 ====== */'),
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  }
}

/** 用于预览的示例 Markdown，覆盖所有元素（含图片） */
export const PREVIEW_MARKDOWN = `# 一级标题样式

这是**正文段落**，包含*斜体*文字和\`行内代码\`示例。点击[这是链接](#)查看效果。段落文字随模板自动调整行高和间距。

## 二级标题

> 这是引用块，适合强调重要内容或引用他人观点。可以包含**加粗**文字。

### 三级标题

- 无序列表项 A
- 无序列表项 B
- 支持 **加粗** 和 *斜体* 混排

1. 有序列表一
2. 有序列表二
3. 有序列表三

#### 四级标题

---

### 图片样式预览

![示例图片](https://picsum.photos/seed/style/600/300)

*图片注释文字——斜体紧跟在图片下方会被识别为图注*

\`\`\`javascript
// 代码块样式预览
function greet(name) {
  return \`Hello, \${name}!\`
}
\`\`\`

| 表头 A | 表头 B | 表头 C |
|--------|--------|--------|
| 数据 1 | 数据 2 | 数据 3 |
| 数据 4 | 数据 5 | 数据 6 |
`
