import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import EasyMDE from "easymde"
import { Textarea } from "../FormControls/FormControls"
import "easymde/dist/easymde.min.css"

interface SelectionRange {
  start: number
  end: number
  left: number
  top: number
  bottom: number
}

export interface InlineMarkdownInputHandle {
  getValue: () => string
  getSelection: () => SelectionRange
  replace: (_start: number, _end: number, _text: string) => void
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

/** 保留原始 Markdown 与撤销历史，只把图片语法显示为可点击的实际图片。 */
export default forwardRef<InlineMarkdownInputHandle, InlineMarkdownInputProps>(function InlineMarkdownInput(props, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const instance = useRef<EasyMDE | null>(null)
  const current = useRef(props)
  const refreshImages = useRef<() => void>(() => {})
  useEffect(() => { current.current = props })

  useImperativeHandle(ref, () => ({
    getValue: () => instance.current?.value() || "",
    getSelection: () => {
      const editor = instance.current?.codemirror
      if (!editor) return { start: 0, end: 0, left: 0, top: 0, bottom: 0 }
      const from = editor.getCursor("from")
      const to = editor.getCursor("to")
      const coords = editor.cursorCoords(to, "window")
      return { start: editor.indexFromPos(from), end: editor.indexFromPos(to), ...coords }
    },
    replace: (start, end, text) => {
      const editor = instance.current?.codemirror
      if (!editor) return
      editor.replaceRange(text, editor.posFromIndex(start), editor.posFromIndex(end), "+input")
      editor.setCursor(editor.posFromIndex(start + text.length))
      editor.focus()
    },
    focus: () => instance.current?.codemirror.focus(),
    contains: target => Boolean(wrapper.current?.contains(target)),
  }), [])

  useEffect(() => {
    if (!textarea.current) return
    const easy = new EasyMDE({
      element: textarea.current,
      initialValue: current.current.value,
      placeholder: current.current.placeholder,
      toolbar: false, status: false, spellChecker: false,
      autoDownloadFontAwesome: false, autofocus: false,
      indentWithTabs: false, tabSize: 4, minHeight: "100px",
      shortcuts: { togglePreview: null, toggleSideBySide: null, toggleFullScreen: null, drawImage: null },
    })
    instance.current = easy
    const editor = easy.codemirror
    editor.getInputField().setAttribute("aria-label", "文章正文")
    let frame = 0
    let marks: ReturnType<typeof editor.markText>[] = []

    const decorate = () => {
      const scroll = editor.getScrollInfo()
      editor.operation(() => {
        marks.forEach(mark => mark.clear())
        marks = []
        if (!current.current.showImages) return
        const text = editor.getValue()
        const from = editor.indexFromPos(editor.getCursor("from"))
        const to = editor.indexFromPos(editor.getCursor("to"))
        const imagePattern = /!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
        for (const match of text.matchAll(imagePattern)) {
          if (marks.length >= 40) break
          const start = match.index
          const end = start + match[0].length
          // 光标或选区进入图片语法时显示原文，方便直接修改或删除。
          if (from <= end && to >= start && editor.hasFocus()) continue
          let url: URL
          try { url = new URL(match[2], window.location.href) } catch { continue }
          if (!["http:", "https:"].includes(url.protocol) && !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(match[2])) continue
          const widget = document.createElement("span")
          widget.className = "inline-article-image"
          widget.setAttribute("role", "button")
          widget.tabIndex = 0
          widget.title = "点击修改图片链接或删除图片"
          widget.setAttribute("aria-label", `编辑图片：${match[1] || "正文配图"}`)
          const image = document.createElement("img")
          image.src = url.href
          image.alt = match[1] || "正文配图"
          image.loading = "lazy"
          image.referrerPolicy = "no-referrer"
          const caption = document.createElement("span")
          caption.className = "inline-article-image-caption"
          caption.textContent = match[1]
          widget.append(image, caption)
          image.addEventListener("load", () => editor.refresh())
          image.addEventListener("error", () => {
            widget.classList.add("inline-article-image--error")
            image.hidden = true
            caption.textContent = `图片暂时无法显示 · ${match[1] || "点击修改链接"}`
            editor.refresh()
          })
          const mark = editor.markText(editor.posFromIndex(start), editor.posFromIndex(end), {
            replacedWith: widget, atomic: true, handleMouseEvents: false,
          })
          const editImage = () => {
            mark.clear()
            editor.setSelection(editor.posFromIndex(start), editor.posFromIndex(end))
            editor.focus()
          }
          widget.addEventListener("click", editImage)
          widget.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); editImage() }
          })
          marks.push(mark)
        }
      })
      editor.scrollTo(scroll.left, scroll.top)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(decorate)
    }
    refreshImages.current = schedule
    const changed = () => { current.current.onChange(editor.getValue()); schedule() }
    const selected = () => {
      schedule()
      const coords = editor.cursorCoords(editor.getCursor("to"), "window")
      current.current.onSelect({
        start: editor.indexFromPos(editor.getCursor("from")),
        end: editor.indexFromPos(editor.getCursor("to")), ...coords,
      })
    }
    const paste = (_editor: EasyMDE["codemirror"], event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith("image/"))
      if (files.length) { event.preventDefault(); current.current.onImageFiles(files) }
    }
    const drop = (_editor: EasyMDE["codemirror"], event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith("image/"))
      if (!files.length) return
      event.preventDefault()
      const position = editor.coordsChar({ left: event.clientX, top: event.clientY }, "window")
      editor.setCursor(position)
      current.current.onImageFiles(files)
    }
    editor.on("change", changed)
    editor.on("cursorActivity", selected)
    editor.on("paste", paste)
    editor.on("drop", drop)
    editor.on("blur", schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      editor.off("change", changed)
      editor.off("cursorActivity", selected)
      editor.off("paste", paste)
      editor.off("drop", drop)
      editor.off("blur", schedule)
      marks.forEach(mark => mark.clear())
      instance.current = null
      easy.toTextArea()
    }
  }, [])

  useEffect(() => {
    const editor = instance.current?.codemirror
    if (!editor || editor.getValue() === props.value) return
    const scroll = editor.getScrollInfo()
    const cursor = editor.indexFromPos(editor.getCursor())
    editor.replaceRange(props.value, { line: 0, ch: 0 }, editor.posFromIndex(editor.getValue().length), "external")
    editor.setCursor(editor.posFromIndex(Math.min(cursor, props.value.length)))
    editor.scrollTo(scroll.left, scroll.top)
  }, [props.value])
  useEffect(() => { refreshImages.current() }, [props.showImages])
  useEffect(() => { instance.current?.codemirror.setOption("placeholder", props.placeholder) }, [props.placeholder])

  return <div ref={wrapper} className={`inline-markdown-input${props.showImages ? " inline-markdown-input--visual" : " inline-markdown-input--source"}`}>
    <Textarea ref={textarea} aria-label="文章正文" defaultValue={props.value} />
  </div>
})
