import {
  CANVAS_SECTION_PRESETS,
  type CanvasSectionPresetId,
} from "../../../shared/canvasSectionPresets"

interface CanvasSectionPresetShelfProps {
  disabled: boolean
  onApply: (id: CanvasSectionPresetId) => void
}

export default function CanvasSectionPresetShelf({ disabled, onApply }: CanvasSectionPresetShelfProps) {
  return <div className="cs-section-presets" role="group" aria-label="章节组件">
    <div className="cs-shelf-heading">
      <strong>一键替换章节样式</strong>
      <span>{disabled ? "先在正文或左侧结构中选中一个章节" : "内容和顺序保持不变"}</span>
    </div>
    <div className="cs-section-preset-grid">
      {CANVAS_SECTION_PRESETS.map(preset => (
        <button
          key={preset.id}
          disabled={disabled}
          onClick={event => {
            onApply(preset.id)
            event.currentTarget.closest("details")?.removeAttribute("open")
          }}
        >
          <span className={`cs-section-preset-preview cs-section-preset-preview--${preset.id}`} aria-hidden="true">
            <i /><i /><i />
          </span>
          <strong>{preset.name}</strong>
          <small>{preset.description}</small>
        </button>
      ))}
    </div>
  </div>
}
