export const DEFAULT_WECHAT_TEMPLATE_ID = "best-practice"

export const CSS_BEST_PRACTICE = `/* ====== 默认样式 · 最佳实践 ====== */
#wemd {
  font-size: 16px;
  color: #000000;
  padding: 0 8px;
  line-height: 1.6;
  word-spacing: 0;
  letter-spacing: 0;
  word-break: break-word;
  word-wrap: break-word;
  text-align: left;
  font-family: Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, "PingFang SC", "Microsoft YaHei", "微软雅黑", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

#wemd p {
  font-size: 16px;
  margin: 0 0 16px;
  line-height: 26px;
  color: #000000;
}

#wemd h1,
#wemd h2,
#wemd h3,
#wemd h4,
#wemd h5,
#wemd h6 {
  margin-top: 30px;
  margin-bottom: 15px;
  padding: 0;
  font-weight: bold;
  color: #000000;
}

#wemd h1 { font-size: 24px; }
#wemd h2 { font-size: 22px; }
#wemd h3 { font-size: 20px; }
#wemd h4 { font-size: 18px; }
#wemd h5,
#wemd h6 { font-size: 16px; }

#wemd h1 .prefix,
#wemd h2 .prefix,
#wemd h3 .prefix,
#wemd h4 .prefix,
#wemd h5 .prefix,
#wemd h6 .prefix,
#wemd h1 .suffix,
#wemd h2 .suffix,
#wemd h3 .suffix,
#wemd h4 .suffix,
#wemd h5 .suffix,
#wemd h6 .suffix {
  display: none;
}

#wemd ul,
#wemd ol {
  margin-top: 8px;
  margin-bottom: 16px;
  padding-left: 25px;
  color: #000000;
}

#wemd ul { list-style-type: disc; }
#wemd ul ul { list-style-type: square; }
#wemd ol { list-style-type: decimal; }

#wemd li,
#wemd li section {
  margin-top: 5px;
  margin-bottom: 5px;
  line-height: 26px;
  text-align: left;
  color: #010101;
  font-weight: 500;
}

#wemd blockquote {
  border: none;
}

#wemd blockquote,
#wemd .multiquote-1 {
  display: block;
  font-size: 0.9em;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  border-left: 3px solid rgba(0, 0, 0, 0.4);
  background: rgba(0, 0, 0, 0.05);
  color: #6a737d;
  padding: 10px 10px 10px 20px;
  margin: 20px 0;
}

#wemd blockquote p,
#wemd .multiquote-1 p {
  margin: 0;
  color: #000000;
  line-height: 26px;
}

#wemd .multiquote-2,
#wemd .multiquote-3 {
  box-shadow: 1px 1px 10px rgba(0, 0, 0, 0.2);
  padding: 20px;
  margin: 20px 0;
}

#wemd .multiquote-3 p,
#wemd .multiquote-3 h3 {
  text-align: center;
}

#wemd .table-of-contents a {
  border: none;
  color: #000000;
  font-weight: normal;
}

#wemd a {
  text-decoration: none;
  color: #1e6bb8;
  word-wrap: break-word;
  font-weight: bold;
  border-bottom: 1px solid #1e6bb8;
}

#wemd strong {
  font-weight: bold;
  color: #000000;
}

#wemd em,
#wemd del {
  font-style: italic;
  color: #000000;
}

#wemd em strong {
  font-weight: bold;
  color: #000000;
}

#wemd u {
  text-decoration: underline;
  text-underline-offset: 0.18em;
  text-decoration-thickness: 1px;
}

#wemd hr {
  height: 1px;
  margin: 10px 0;
  border: none;
  border-top: 1px solid #000000;
}

#wemd pre {
  margin: 10px 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

#wemd pre.custom {
  padding: 0;
  border-radius: 6px;
  overflow: hidden;
  overflow-x: auto;
}

#wemd pre code {
  display: block;
  font-family: Operator Mono, Consolas, Monaco, Menlo, monospace;
  border-radius: 0;
  font-size: 12px;
  white-space: pre;
  min-width: max-content;
  -webkit-overflow-scrolling: touch;
}

#wemd pre code span {
  line-height: 26px;
}

#wemd p code,
#wemd li code {
  font-size: 14px;
  word-wrap: break-word;
  padding: 2px 4px;
  border-radius: 4px;
  margin: 0 2px;
  color: #1e6bb8;
  background-color: rgba(27, 31, 35, 0.05);
  font-family: Operator Mono, Consolas, Monaco, Menlo, monospace;
  word-break: break-all;
}

#wemd img {
  display: block;
  margin: 0 auto;
  max-width: 100%;
}

#wemd figure {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin: 10px 0;
}

#wemd figcaption {
  margin-top: 5px;
  text-align: center;
  color: #888888;
  font-size: 14px;
}

#wemd .table-container {
  overflow-x: auto;
  margin: 20px 0;
}

#wemd table {
  display: table;
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

#wemd tbody { border: 0; }

#wemd table tr {
  border: 0;
  border-top: 1px solid #cccccc;
  background-color: #ffffff;
}

#wemd table tr:nth-child(2n) {
  background-color: #f8f8f8;
}

#wemd table tr th,
#wemd table tr td {
  min-width: 85px;
  font-size: 16px;
  border: 1px solid #cccccc;
  padding: 5px 10px;
  text-align: left;
}

#wemd table tr th {
  font-weight: bold;
  background-color: #f0f0f0;
}

#wemd .footnote-word,
#wemd .footnote-ref {
  color: #1e6bb8;
  font-weight: bold;
}

#wemd .footnote-item {
  display: flex;
}

#wemd .footnote-num {
  display: inline;
  width: 10%;
  background: none;
  font-size: 80%;
  opacity: 0.6;
  line-height: 26px;
  font-family: Optima-Regular, Optima, PingFangSC-light, PingFangTC-light, "PingFang SC", Cambria, Cochin, Georgia, Times, "Times New Roman", serif;
}

#wemd .footnote-item p {
  display: inline;
  width: 90%;
  padding: 0;
  margin: 0;
  font-size: 14px;
  line-height: 26px;
  color: #000000;
  word-break: break-all;
}

#wemd sub,
#wemd sup {
  line-height: 0;
}

#wemd .footnotes-sep::before {
  content: "参考资料";
  display: block;
}

#wemd .block-equation {
  display: block;
  text-align: center;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

#wemd .block-equation > svg {
  max-width: 300% !important;
  -webkit-overflow-scrolling: touch;
}

#wemd .imageflow-layer1 {
  margin-top: 1em;
  margin-bottom: 0.5em;
  white-space: normal;
  border: none;
  padding: 0;
  overflow: hidden;
}

#wemd .imageflow-layer2 {
  display: flex;
  white-space: nowrap;
  width: 100%;
  overflow-x: auto;
}

#wemd .imageflow-layer3 {
  display: inline-block;
  word-wrap: break-word;
  white-space: normal;
  vertical-align: top;
  width: 80%;
  margin-right: 10px;
  flex-shrink: 0;
}

#wemd .imageflow-img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 300px;
  object-fit: contain;
  border-radius: 4px;
}

#wemd .imageflow-caption {
  text-align: center;
  margin-top: 0;
  padding-top: 0;
  color: #888888;
}

#wemd .nice-suffix-juejin-container {
  margin-top: 20px !important;
}

#wemd figure a {
  display: flex;
  justify-content: center;
  align-items: center;
  border: none;
}

#wemd figure a img {
  margin: 0;
}

#wemd figure a + figcaption {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  margin-top: -35px;
  background: rgba(0, 0, 0, 0.7);
  color: #ffffff;
  line-height: 35px;
  z-index: 20;
}

#wemd .callout {
  margin: 24px 0;
  padding: 18px 20px;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 12px 25px rgba(15, 23, 42, 0.08);
}

#wemd .callout-title {
  font-weight: 600;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 0;
  letter-spacing: 0.05em;
}

#wemd .callout-icon {
  margin-right: 8px;
  font-size: 18px;
}

#wemd .callout-note { border-left: 4px solid #6366f1; background: #f5f5ff; }
#wemd .callout-tip { border-left: 4px solid #10b981; background: #ecfdf5; }
#wemd .callout-important { border-left: 4px solid #8b5cf6; background: #f5f3ff; }
#wemd .callout-warning { border-left: 4px solid #f59e0b; background: #fffbeb; }
#wemd .callout-caution { border-left: 4px solid #ef4444; background: #fff5f5; }

#wemd .callout p {
  margin: 0;
}

#wemd .task-list-item {
  list-style: none;
  margin-left: -1.2em;
  margin-bottom: 6px;
  display: flex;
  gap: 0;
  align-items: flex-start;
}

#wemd .task-list-item input[type="checkbox"] {
  margin-top: 4px;
  margin-right: 8px;
  pointer-events: none;
}`

export const CSS_EASTERN_LETTER = `/* ====== 东方笺谱 · 现代人文长文 ====== */
#wemd {
  max-width: 677px;
  margin: 0 auto;
  padding: 24px 28px;
  color: #36322f;
  background-color: transparent;
  font-family: "Songti SC", "STSong", "Noto Serif CJK SC", SimSun, serif;
  font-size: 17px;
  line-height: 2.06;
  letter-spacing: 0.045em;
  word-break: break-word;
}

#wemd p {
  margin: 0 0 29px;
  color: #36322f;
  font-size: 17px;
  line-height: 2.06;
  text-align: justify;
  text-wrap: pretty;
}

#wemd h1,
#wemd h2,
#wemd h3,
#wemd h4,
#wemd h5,
#wemd h6 {
  text-align: left;
}

#wemd h1 {
  max-width: 7em;
  margin: 38px 0 72px auto;
  padding: 0 8px 0 0;
  border: none;
  text-align: right;
}

#wemd h1::after {
  content: "";
  display: block;
  width: 18px;
  height: 18px;
  margin: 24px 0 0 auto;
  background: #a33a2b;
}

#wemd h1 .content,
#wemd h1 {
  color: #282522;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.18em;
  text-wrap: balance;
}

#wemd h2 {
  margin: 58px 0 30px;
  padding: 0 8px 0 0;
  border: none;
  text-align: right;
}

#wemd h2::before {
  content: "◆";
  display: block;
  margin-bottom: 8px;
  color: #a33a2b;
  font-size: 9px;
  text-align: right;
}

#wemd h2 .content,
#wemd h2 {
  color: #a33a2b;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-wrap: balance;
}

#wemd h3 {
  margin: 40px 0 21px 2em;
}

#wemd h3 .content,
#wemd h3 {
  color: #a33a2b;
  background: transparent;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0.1em;
  text-wrap: balance;
}

#wemd h4,
#wemd h5,
#wemd h6 {
  margin: 29px 0 14px;
  padding: 0;
  border: none;
  color: #514841;
  font-size: 16px;
  font-weight: 700;
}

#wemd h1 .prefix,
#wemd h1 .suffix,
#wemd h2 .prefix,
#wemd h2 .suffix,
#wemd h3 .prefix,
#wemd h3 .suffix,
#wemd h4 .prefix,
#wemd h4 .suffix,
#wemd h5 .prefix,
#wemd h5 .suffix,
#wemd h6 .prefix,
#wemd h6 .suffix {
  display: none;
}

#wemd blockquote,
#wemd .multiquote-1,
#wemd .multiquote-2,
#wemd .multiquote-3 {
  margin: 46px 8px;
  padding: 8px 24px;
  border: none;
  background: transparent;
}

#wemd blockquote::before,
#wemd .multiquote-1::before {
  content: "“";
  display: block;
  color: #a33a2b;
  font-size: 42px;
  line-height: 0.8;
  text-align: center;
}

#wemd blockquote p,
#wemd .multiquote-1 p,
#wemd .multiquote-2 p,
#wemd .multiquote-3 p {
  margin: 0;
  color: #564c45;
  font-size: 18px;
  line-height: 2;
  text-align: center;
}

#wemd .multiquote-2,
#wemd .multiquote-3,
#wemd .multiquote-1 .multiquote-1 {
  margin: 12px 0 0;
  padding: 8px 0 0;
}

#wemd .multiquote-1 .multiquote-1::before {
  display: none;
}

#wemd ul,
#wemd ol {
  margin: 22px 0 28px;
  padding-left: 25px;
  color: #a33a2b;
}

#wemd li,
#wemd li section {
  margin: 7px 0;
  color: #36322f;
  line-height: 1.88;
}

#wemd ol > li {
  padding: 3px 0 9px;
  border-bottom: 1px dotted #bfb4aa;
}

#wemd a {
  color: #8c3025;
  font-weight: 600;
  text-decoration: underline;
  text-decoration-color: #c99087;
  text-underline-offset: 0.22em;
}

#wemd strong {
  color: #272320;
  font-weight: 700;
  text-decoration: underline;
  text-decoration-color: #d9aaa2;
  text-decoration-thickness: 2px;
  text-underline-offset: 0.18em;
}

#wemd mark {
  padding: 1px 4px;
  color: #4f2822;
  background: #efd9d4;
}

#wemd hr {
  width: 8px;
  height: 8px;
  margin: 64px auto;
  border: none;
  background: #a33a2b;
}

#wemd figure {
  margin: 48px 0 54px;
  padding: 0;
  border: none;
  break-inside: avoid;
}

#wemd figure a {
  border: none;
}

#wemd img,
#wemd figure a img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}

#wemd figcaption {
  margin-top: 12px;
  color: #746860;
  font-size: 12px;
  line-height: 1.8;
  letter-spacing: 0.08em;
  text-align: right;
}

#wemd p code,
#wemd li code {
  padding: 2px 6px;
  border: 1px solid #d4cbc3;
  color: #8c3025;
  background: #f1eeea;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 13px;
}

#wemd pre {
  margin: 32px 0;
  border: 1px solid #403a35;
  border-top: 6px solid #a33a2b;
  background: #2e2a27;
  overflow-x: auto;
}

#wemd pre code,
#wemd pre code.hljs {
  display: block;
  min-width: max-content;
  padding: 20px;
  color: #f0ece7;
  background: #2e2a27;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 13px;
  line-height: 1.72;
  white-space: pre;
}

#wemd pre.custom > .mac-sign {
  display: block;
  border-bottom: 1px solid #5d554e;
  background: #2e2a27;
}

#wemd .table-container {
  margin: 34px 0;
  overflow-x: auto;
}

#wemd table {
  width: 100%;
  border-collapse: collapse;
  color: #3d3732;
  background: #faf9f7;
  text-align: left;
}

#wemd table tr th,
#wemd table tr td {
  min-width: 88px;
  padding: 11px 10px;
  border: none;
  border-bottom: 1px solid #cfc6be;
  font-size: 14px;
  line-height: 1.65;
}

#wemd table tr th {
  border-top: 1px solid #5a4e46;
  border-bottom: 2px solid #5a4e46;
  color: #a33a2b;
  background: transparent;
  font-weight: 700;
}

#wemd table tr:nth-child(2n) {
  background: #f0ede9;
}

#wemd .callout {
  margin: 31px 0;
  padding: 18px 4px;
  border: none;
  border-top: 1px dotted #8f8177;
  border-bottom: 1px dotted #8f8177;
  border-radius: 0;
  color: #4a423c;
  background: transparent;
  break-inside: avoid;
}

#wemd .callout-warning,
#wemd .callout-caution {
  border-color: #a33a2b;
}

#wemd .callout-title {
  margin-bottom: 8px;
  color: #5a2d26;
  font-weight: 700;
}

#wemd .callout p {
  margin: 0;
  color: #564c45;
  font-size: 15px;
}

#wemd .footnote-word,
#wemd .footnote-ref {
  color: #a33a2b;
  font-weight: 700;
}

#wemd .footnotes-sep {
  margin-top: 52px;
  padding-top: 18px;
  border-top: 4px double #4c4640;
}

#wemd .footnote-item {
  display: flex;
  margin-top: 9px;
}

#wemd .footnote-num {
  width: 30px;
  flex-shrink: 0;
  color: #a33a2b;
}

#wemd .footnote-item p {
  margin: 0;
  color: #746860;
  font-size: 13px;
  text-align: left;
}

#wemd .block-equation {
  display: block;
  margin: 32px 0;
  padding: 19px 10px;
  border-top: 1px solid #cfc6be;
  border-bottom: 1px solid #cfc6be;
  text-align: center;
  overflow-x: auto;
}

#wemd .inline-equation {
  color: #8c3025;
}

#wemd pre.mermaid {
  padding: 20px 10px;
  border: 1px solid #c2b7ae;
  border-top: 5px solid #a33a2b;
  background: #faf9f7;
}

#wemd .task-list-item {
  display: flex;
  align-items: flex-start;
  margin-left: -1.2em;
  list-style: none;
}

#wemd .task-list-item input[type="checkbox"] {
  margin-top: 8px;
  margin-right: 8px;
  accent-color: #a33a2b;
  pointer-events: none;
}

#wemd .hljs {
  display: block;
  overflow-x: auto;
  padding: 16px;
  color: #c9d1d9;
  background: #0d1117;
}

#wemd .hljs-doctag,
#wemd .hljs-keyword,
#wemd .hljs-meta .hljs-keyword,
#wemd .hljs-template-tag,
#wemd .hljs-template-variable,
#wemd .hljs-type,
#wemd .hljs-variable.language_ {
  color: #ff7b72;
}

#wemd .hljs-title,
#wemd .hljs-title.class_,
#wemd .hljs-title.function_ {
  color: #d2a8ff;
}

#wemd .hljs-attr,
#wemd .hljs-attribute,
#wemd .hljs-literal,
#wemd .hljs-meta,
#wemd .hljs-number,
#wemd .hljs-operator,
#wemd .hljs-variable,
#wemd .hljs-selector-attr,
#wemd .hljs-selector-class,
#wemd .hljs-selector-id {
  color: #79c0ff;
}

#wemd .hljs-regexp,
#wemd .hljs-string,
#wemd .hljs-meta .hljs-string {
  color: #a5d6ff;
}

#wemd .hljs-built_in,
#wemd .hljs-symbol {
  color: #ffa657;
}

#wemd .hljs-comment,
#wemd .hljs-code,
#wemd .hljs-formula {
  color: #9198a1;
}

#wemd .hljs-name,
#wemd .hljs-quote,
#wemd .hljs-selector-tag,
#wemd .hljs-selector-pseudo {
  color: #7ee787;
}

#wemd .hljs-section {
  color: #58a6ff;
  font-weight: bold;
}

#wemd .hljs-bullet {
  color: #f2cc60;
}

#wemd .hljs-emphasis {
  color: #c9d1d9;
  font-style: italic;
}

#wemd .hljs-strong {
  color: #c9d1d9;
  font-weight: bold;
}

#wemd .hljs-addition {
  color: #aff5b4;
  background-color: #033a16;
}

#wemd .hljs-deletion {
  color: #ffdcd7;
  background-color: #67060c;
}`
