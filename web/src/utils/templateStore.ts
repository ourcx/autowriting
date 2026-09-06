import { readStyleTemplates, writeStyleTemplate, removeStyleTemplate } from "./apiHelpers"
/**
 * WeChat CSS Template Store
 * 内置模板 + localStorage 自定义模板 CRUD
 */

import {
  CSS_MOSS_JOURNAL, CSS_CREAM_LETTER, CSS_BLUE_COLUMN, CSS_ROSE_EDITION,
  CSS_BEST_PRACTICE,
  CSS_EASTERN_LETTER,
  CSS_GALLERY_STORY,
  CSS_RECEIPT_NOTE,
  CSS_SUNSET_FILM,
  DEFAULT_WECHAT_TEMPLATE_ID,
} from "../../shared/defaultStyleTemplates"

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
  { id: 'moss-journal', name: '青苔手记', desc: '自然绿与细侧线，适合日常、旅行和成长记录', accentColor: '#466650', css: CSS_MOSS_JOURNAL, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'cream-letter', name: '奶油来信', desc: '暖纸色与信笺边框，适合书信和人文故事', accentColor: '#976140', css: CSS_CREAM_LETTER, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'blue-column', name: '蓝调专栏', desc: '深蓝栏目标题与清晰层级，适合观点和知识分享', accentColor: '#284e70', css: CSS_BLUE_COLUMN, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'rose-edition', name: '玫瑰刊物', desc: '柔粉刊头与圆角章节，适合生活美学和节日特辑', accentColor: '#965569', css: CSS_ROSE_EDITION, isBuiltin: true, createdAt: 0, updatedAt: 0 },

  { id: DEFAULT_WECHAT_TEMPLATE_ID, name: '默认样式', desc: '公众号最佳实践，正文、列表、代码与表格完整适配', accentColor: '#1e6bb8', css: CSS_BEST_PRACTICE, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'eastern-letter', name: '东方笺谱', desc: '现代人文长文，宋体留白与朱砂点睛', accentColor: '#a33a2b', css: CSS_EASTERN_LETTER, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'receipt-note', name: '黑白小票', desc: '清单感与打印纸质感，适合教程和复盘', accentColor: '#171717', css: CSS_RECEIPT_NOTE, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'sunset-film', name: '落日胶片', desc: '暖红与琥珀色调，适合故事和观点长文', accentColor: '#b33d25', css: CSS_SUNSET_FILM, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'gallery-story', name: '留白画册', desc: '大留白与图片叙事，适合人物和品牌故事', accentColor: '#80503f', css: CSS_GALLERY_STORY, isBuiltin: true, createdAt: 0, updatedAt: 0 },
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
    const data = await readStyleTemplates()
    const serverTemplates = data.map(t => ({
      id:          String(t.id),
      name:        String(t.name),
      desc:        String(t.desc ?? ''),
      accentColor: String(t.accent_color ?? t.accentColor ?? '#6366f1'),
      css:         String(t.css ?? ''),
      isBuiltin:   Boolean(t.is_builtin ?? t.isBuiltin),
      createdAt:   Number(t.created_at  ?? t.createdAt  ?? 0),
      updatedAt:   Number(t.updated_at  ?? t.updatedAt  ?? 0),
    }))
    const builtinIds = new Set(BUILTIN_TEMPLATES.map(template => template.id))
    return [
      ...BUILTIN_TEMPLATES,
      ...serverTemplates.filter(template => !builtinIds.has(template.id)),
    ]
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
  // 服务端拒绝保存时向上抛错，避免把失败展示为已保存。
  await writeStyleTemplate(payload)
  window.dispatchEvent(new CustomEvent('wxtemplates-updated'))
}

/** 删除自定义模板 */
export async function deleteCustomTemplate(id: string): Promise<void> {
  await removeStyleTemplate(id)
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
    css: base?.css ?? CSS_BEST_PRACTICE.replace('/* ====== 默认样式 · 最佳实践 ====== */', '/* ====== 自定义模板 ====== */'),
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  }
}

/** 用于预览的示例 Markdown，覆盖常见文章元素 */
/** 用完整短文观察阅读节奏，元素清单放在组件预览中。 */
export const PREVIEW_MARKDOWN = `# 把日子过成一封慢慢写的信

周末的清晨，推开窗，街边的树叶已经换了一种绿。楼下的早餐铺刚刚开门，热气从蒸笼的缝隙里冒出来。这些寻常的小事，让忙了一周的人终于愿意慢下来。

我们总想给生活留下一点特别的记录。后来发现，**值得记下的，往往就是眼前这一刻**：一顿认真做的饭，一次没有目的地的散步，和朋友聊到天黑的下午。

## 01 留一点时间给自己

不必把每个空闲都填满。找一本读到一半的书，泡一杯喜欢的茶，把手机放远一点。没有完成什么，也可以是一个很好的下午。

> 生活的丰盛，有时来自我们愿意停下来，看见已经拥有的东西。

## 02 收藏平凡里的微光

给窗边的植物浇水，记下今天听到的一句话，认真回复一位老朋友。日常里的温柔并不声张，却能在回头看的时候，连成一条清晰的线。

### 从一件小事开始

- 给自己做一份热乎的早餐。
- 沿着熟悉的街道，多走十分钟。
- 在睡前写下今天值得记住的一件事。

## 03 与喜欢的人好好相处

约一次见面，不必等到大家都有大段的空闲。一起吃顿饭，聊聊近况，就足以让普通的一天变得不同。

---

愿我们都能在匆忙的日子里，留住一点从容。下一封写给生活的信，就从今天开始。
`

/** 组件模式用于集中检查模板对扩展语义块的覆盖程度。 */
export const PREVIEW_COMPONENTS_MARKDOWN = `# 样式组件总览

## 标题与强调

### 三级标题

普通正文、**重点文字**、*斜体说明*、~~删除内容~~、[链接文本](#)与\`inline code\`。

> 普通引用块用于展示摘录和观点。

> [!TIP] 行动建议提示块，用于展示可执行的下一步。

> [!IMPORTANT] 重点提示块，用于展示核心结论。

> [!WARNING] 注意提示块，用于展示风险和限制。

- [x] 已完成事项
- [ ] 待处理事项

![图片与图注预览](https://picsum.photos/seed/components/600/320)

*图片说明文字*

| 内容类型 | 展示重点 |
|---|---|
| 表格 | 边框、底色、对齐 |
| 代码 | 字体、背景、高亮 |

\`\`\`typescript
interface ArticleStyle {
  name: string
  accentColor: string
}
\`\`\`
`
