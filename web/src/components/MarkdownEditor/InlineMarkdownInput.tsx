import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import { Markdown } from "@tiptap/markdown"
import { TableKit } from "@tiptap/extension-table"
import { Placeholder } from "@tiptap/extensions"
import { Textarea } from "../FormControls/FormControls"

interface SelectionRange {
  start: number
  end: number
  left: number
  top: number
  bottom: number
}

export type EditorFormat = "h1" | "h2" | "bold" | "italic" | "list" | "link" | "code"
export interface InlineMarkdownInputHandle {
  getValue: () => string
  getSelection: () => SelectionRange
  getSelectedText: (_start: number, _end: number) => string
  replace: (_start: number, _end: number, _text: string) => void
  format: (_format: EditorFormat) => void
  focus: () => void
  contains: (_target: Node) => boolean
}

interface InlineMarkdownInputProps {
  value: string
  placeholder: string
  showImages: boolean
  onChange: (_value: string) => void
  onSelect: (_selection: SelectionRange) => void
  onImageFiles: (_files: File[]) => void
}

/** 图文模式的选区、输入和撤销全部交给 Tiptap；Markdown 模式使用原生文本框。 */
export default forwardRef<InlineMarkdownInputHandle, InlineMarkdownInputProps>(function InlineMarkdownInput(props, ref) {
  const wrapper = useRef<HTMLDivElement>(null)
  const source = useRef<HTMLTextAreaElement>(null)
  const current = useRef(props)
  current.current = props
  const lastMarkdown = useRef(props.value)
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown, Image.configure({ allowBase64: true }), TableKit,
      Placeholder.configure({ placeholder: props.placeholder })],
    content: props.value,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "markdown-body", "aria-label": "文章正文", role: "textbox", "aria-multiline": "true" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith("image/"))
        if (!files.length) return false
        current.current.onImageFiles(files)
        return true
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith("image/"))
        if (!files.length) return false
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (position) editor?.commands.setTextSelection(position.pos)
        current.current.onImageFiles(files)
        return true
      },
    },
    onUpdate: ({ editor: instance }) => {
      lastMarkdown.current = instance.getMarkdown()
      current.current.onChange(lastMarkdown.current)
    },
    onSelectionUpdate: ({ editor: instance }) => {
      if (!current.current.showImages) return
      const { from, to } = instance.state.selection
      const coords = instance.view.coordsAtPos(to)
      current.current.onSelect({ start: from, end: to, ...coords })
    },
  })

  const selectedText = (start: number, end: number) => {
    if (!current.current.showImages) return current.current.value.substring(start, end)
    if (!editor || end > editor.state.doc.content.size) return ""
    return editor.markdown?.serialize({ type: "doc", content: editor.state.doc.slice(start, end).content.toJSON() }) || ""
  }
  const selection = (): SelectionRange => {
    if (!current.current.showImages && source.current) {
      const rect = source.current.getBoundingClientRect()
      return { start: source.current.selectionStart, end: source.current.selectionEnd, left: rect.left, top: rect.top, bottom: rect.top }
    }
    if (!editor) return { start: 0, end: 0, left: 0, top: 0, bottom: 0 }
    const { from, to } = editor.state.selection
    return { start: from, end: to, ...editor.view.coordsAtPos(to) }
  }
  const replace = (start: number, end: number, text: string) => {
    if (current.current.showImages) {
      editor?.chain().focus().insertContentAt({ from: start, to: end }, text, { contentType: "markdown" }).run()
    } else {
      const textarea = source.current
      if (!textarea) return
      textarea.setRangeText(text, start, end, "end")
      current.current.onChange(textarea.value)
      textarea.focus()
    }
  }
  useImperativeHandle(ref, () => ({
    getValue: () => lastMarkdown.current,
    getSelection: selection,
    getSelectedText: selectedText,
    replace,
    format: format => {
      if (!current.current.showImages) {
        const tokens = { h1: ["# ", ""], h2: ["## ", ""], bold: ["**", "**"], italic: ["*", "*"],
          list: ["- ", ""], link: ["[", "](https://)"], code: ["```\n", "\n```"] }
        const { start, end } = selection()
        const [before, after] = tokens[format]
        replace(start, end, before + selectedText(start, end) + after)
        return
      }
      if (!editor) return
      const chain = editor.chain().focus()
      if (format === "h1" || format === "h2") chain.toggleHeading({ level: format === "h1" ? 1 : 2 }).run()
      else if (format === "bold") chain.toggleBold().run()
      else if (format === "italic") chain.toggleItalic().run()
      else if (format === "list") chain.toggleBulletList().run()
      else if (format === "code") chain.toggleCodeBlock().run()
      else {
        const href = window.prompt("链接地址", editor.getAttributes("link").href || "https://")
        if (href !== null) href.trim() ? chain.extendMarkRange("link").setLink({ href: href.trim() }).run() : chain.unsetLink().run()
      }
    },
    focus: () => current.current.showImages ? editor?.commands.focus() : source.current?.focus(),
    contains: target => Boolean(wrapper.current?.contains(target)),
  }))

  useEffect(() => {
    if (props.value === lastMarkdown.current) return
    lastMarkdown.current = props.value
    editor?.commands.setContent(props.value, { contentType: "markdown", emitUpdate: false })
  }, [props.value, editor])

  return <div ref={wrapper} className="inline-markdown-input">
    <div hidden={!props.showImages}><EditorContent editor={editor} /></div>
    {!props.showImages && <Textarea ref={source} className="markdown-source-input" aria-label="Markdown 正文"
      placeholder={props.placeholder} value={props.value}
      onChange={event => props.onChange(event.target.value)}
      onSelect={() => props.onSelect(selection())}
      onPaste={event => {
        const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"))
        if (files.length) { event.preventDefault(); props.onImageFiles(files) }
      }} />}
  </div>
})
