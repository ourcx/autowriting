import { useRef, useState } from "react"
import { FileCheck2, FileUp, ShieldCheck, X } from "lucide-react"
import {
  CANVAS_DESIGN_TEMPLATES,
  type CanvasDesignTemplateId,
} from "../../../shared/canvasDesignTemplates"
import "./CanvasDesignInput.css"

interface CanvasDesignInputProps {
  templateId: CanvasDesignTemplateId
  fileName: string
  onTemplateChange: (templateId: CanvasDesignTemplateId) => void
  onDesignReferenceChange: (content: string, fileName: string) => void
  onError: (message: string) => void
}

const DESIGN_FILE_EXTENSIONS = [".txt", ".md", ".json", ".svg", ".xml", ".drawio"]
const DESIGN_FILE_MAX_BYTES = 200 * 1024

function validDesignFile(file: File): boolean {
  const lowerName = file.name.toLowerCase()
  return DESIGN_FILE_EXTENSIONS.some(extension => lowerName.endsWith(extension))
}

export default function CanvasDesignInput({
  templateId,
  fileName,
  onTemplateChange,
  onDesignReferenceChange,
  onError,
}: CanvasDesignInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const readFile = async (file: File) => {
    if (!validDesignFile(file)) {
      onError("仅支持 TXT、Markdown、JSON、SVG、XML 和 Draw.io 设计文件")
      return
    }
    if (file.size > DESIGN_FILE_MAX_BYTES) {
      onError("设计文件不能超过 200KB")
      return
    }
    try {
      const content = await file.text()
      if (!content.trim()) {
        onError("设计文件内容为空")
        return
      }
      onDesignReferenceChange(content, file.name)
    } catch {
      onError("设计文件读取失败")
    }
  }

  return (
    <div className="cdi-root">
      <label className="cdi-template">
        <ShieldCheck size={15} />
        <span>受控模板</span>
        <select
          value={templateId}
          onChange={event => onTemplateChange(event.target.value as CanvasDesignTemplateId)}
        >
          {CANVAS_DESIGN_TEMPLATES.map(template => (
            <option key={template.id} value={template.id}>
              {template.name} · {template.description}
            </option>
          ))}
        </select>
      </label>

      <div
        className={`cdi-dropzone${dragging ? " is-dragging" : ""}${fileName ? " has-file" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click()
        }}
        onDragEnter={event => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={event => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) void readFile(file)
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.json,.svg,.xml,.drawio,text/plain,text/markdown,application/json,image/svg+xml"
          onChange={event => {
            const file = event.target.files?.[0]
            if (file) void readFile(file)
            event.target.value = ""
          }}
        />
        {fileName ? <FileCheck2 size={15} /> : <FileUp size={15} />}
        <span>{fileName || "拖入 design 文件作为视觉参考"}</span>
        {fileName ? (
          <button
            type="button"
            title="移除设计文件"
            onClick={event => {
              event.stopPropagation()
              onDesignReferenceChange("", "")
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
