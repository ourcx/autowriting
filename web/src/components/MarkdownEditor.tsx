import { useState, useRef } from 'react'
import { toast } from './Toast'
import { Eye, Edit2, Copy, Download } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './MarkdownEditor.css'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  height?: string
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder = '输入 Markdown 内容...',
  height = '500px'
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('edit')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    toast.info('已复制到剪贴板')
  }

  const handleDownload = () => {
    const element = document.createElement('a')
    const file = new Blob([value], { type: 'text/markdown' })
    element.href = URL.createObjectURL(file)
    element.download = `article_${new Date().getTime()}.md`
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  const insertMarkdown = (before: string, after: string = '') => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = value.substring(start, end)
    const newValue =
      value.substring(0, start) +
      before +
      selectedText +
      after +
      value.substring(end)

    onChange(newValue)

    // 恢复光标位置
    setTimeout(() => {
      textarea.focus()
      const newCursorPos = start + before.length + selectedText.length
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab 键插入 4 个空格
    if (e.key === 'Tab') {
      e.preventDefault()
      insertMarkdown('    ')
    }
    // Ctrl/Cmd + B 加粗
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      insertMarkdown('**', '**')
    }
    // Ctrl/Cmd + I 斜体
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault()
      insertMarkdown('*', '*')
    }
  }

  return (
    <div className="markdown-editor">
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <button
            className={`toolbar-btn ${mode === 'edit' ? 'active' : ''}`}
            onClick={() => setMode('edit')}
            title="编辑模式"
          >
            <Edit2 size={18} />
            编辑
          </button>
          <button
            className={`toolbar-btn ${mode === 'preview' ? 'active' : ''}`}
            onClick={() => setMode('preview')}
            title="预览模式"
          >
            <Eye size={18} />
            预览
          </button>
          <button
            className={`toolbar-btn ${mode === 'split' ? 'active' : ''}`}
            onClick={() => setMode('split')}
            title="分屏模式"
          >
            <div className="split-icon">⊞</div>
            分屏
          </button>
        </div>

        <div className="toolbar-right">
          <button
            className="toolbar-btn"
            onClick={() => insertMarkdown('# ')}
            title="标题 1"
          >
            H1
          </button>
          <button
            className="toolbar-btn"
            onClick={() => insertMarkdown('## ')}
            title="标题 2"
          >
            H2
          </button>
          <button
            className="toolbar-btn"
            onClick={() => insertMarkdown('**', '**')}
            title="加粗 (Ctrl+B)"
          >
            <strong>B</strong>
          </button>
          <button
            className="toolbar-btn"
            onClick={() => insertMarkdown('*', '*')}
            title="斜体 (Ctrl+I)"
          >
            <em>I</em>
          </button>
          <button
            className="toolbar-btn"
            onClick={() => insertMarkdown('- ')}
            title="列表"
          >
            ≡
          </button>
          <button
            className="toolbar-btn"
            onClick={() => insertMarkdown('[', '](url)')}
            title="链接"
          >
            🔗
          </button>
          <button
            className="toolbar-btn"
            onClick={() => insertMarkdown('```\n', '\n```')}
            title="代码块"
          >
            {'<>'}
          </button>
          <div className="toolbar-divider"></div>
          <button
            className="toolbar-btn"
            onClick={handleCopy}
            title="复制"
          >
            <Copy size={18} />
          </button>
          <button
            className="toolbar-btn"
            onClick={handleDownload}
            title="下载"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      <div className="editor-container" style={{ height }}>
        {(mode === 'edit' || mode === 'split') && (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="editor-textarea"
            spellCheck="false"
          />
        )}

        {(mode === 'preview' || mode === 'split') && (
          <div className="editor-preview markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {value || '*预览内容将显示在这里*'}
            </ReactMarkdown>
          </div>
        )}
      </div>

      <div className="editor-footer">
        <span className="char-count">
          {value.length} 字符 · {value.split('\n').length} 行
        </span>
      </div>
    </div>
  )
}
