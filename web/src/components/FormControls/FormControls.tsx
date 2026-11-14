import { forwardRef, useEffect, useId, useRef, useState } from "react"
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react"
import * as Collapsible from "@radix-ui/react-collapsible"
import * as RadixCheckbox from "@radix-ui/react-checkbox"
import * as RadixSelect from "@radix-ui/react-select"
import { Check, ChevronDown, Paperclip } from "lucide-react"
import Button from "../Button/Button"
import "./FormControls.css"

type CheckboxProps = {
  checked: boolean
  disabled?: boolean
  onCheckedChange: (_checked: boolean) => void
  children: ReactNode
  className?: string
}

export function Checkbox({ checked, disabled, onCheckedChange, children, className = "" }: CheckboxProps) {
  const labelId = useId()
  return <label className={`ui-checkbox ${className}`.trim()}>
    <RadixCheckbox.Root checked={checked} disabled={disabled} onCheckedChange={value => onCheckedChange(value === true)}
      className="ui-checkbox-control" aria-labelledby={labelId}>
      <RadixCheckbox.Indicator><Check size={12} aria-hidden="true" /></RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
    <span id={labelId}>{children}</span>
  </label>
}

type SelectProps = {
  label: string
  value: string
  disabled?: boolean
  onValueChange: (_value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
}

export function Select({ label, value, disabled, onValueChange, options }: SelectProps) {
  return <RadixSelect.Root value={value} disabled={disabled} onValueChange={onValueChange}>
    <RadixSelect.Trigger className="ui-select-trigger" aria-label={label}>
      <RadixSelect.Value /><RadixSelect.Icon asChild><ChevronDown size={14} /></RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal>
      <RadixSelect.Content className="ui-select-content" position="popper" sideOffset={4}>
        <RadixSelect.Viewport>
          {options.map(option => <RadixSelect.Item className="ui-select-option" key={option.value} value={option.value}>
            <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
            <RadixSelect.ItemIndicator><Check size={13} /></RadixSelect.ItemIndicator>
          </RadixSelect.Item>)}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea {...props} ref={ref} className={className || "ui-textarea"} />
  },
)

type FilePickerProps = Pick<InputHTMLAttributes<HTMLInputElement>, "accept" | "disabled"> & {
  children: ReactNode
  onPick: (_file: File) => void
}

export function FilePicker({ children, accept, disabled, onPick }: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <Button onClick={() => input.current?.click()} disabled={disabled}>
      <Paperclip size={14} aria-hidden="true" />
      {children}
    </Button>
    <input ref={input} type="file" hidden accept={accept} disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ""
      if (file) onPick(file)
    }} />
  </>
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input {...props} ref={ref} className={`ui-field ${className || "ui-input"}`} />
  },
)

export function SelectField({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={className ? `ui-native-select ${className}` : "ui-native-select ui-select-default"} />
}

type CollapseProps = { label: ReactNode; children: ReactNode; className?: string; defaultOpen?: boolean; onOpenChange?: (_open: boolean) => void; closeOnAction?: boolean }

export function Collapse({ label, children, className, defaultOpen, onOpenChange, closeOnAction }: CollapseProps) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  useEffect(() => { setOpen(defaultOpen ?? false) }, [defaultOpen])
  const change = (next: boolean) => { setOpen(next); onOpenChange?.(next) }
  return <Collapsible.Root className={className} open={open} onOpenChange={change}>
    <Collapsible.Trigger className="ui-collapse-trigger">
      <span>{label}</span><ChevronDown className="ui-collapse-chevron" size={14} aria-hidden="true" />
    </Collapsible.Trigger>
    <Collapsible.Content forceMount hidden={!open} className="ui-collapse-content" onClick={event => {
      if (closeOnAction && (event.target as HTMLElement).closest("button[data-ui-close]")) change(false)
    }}>{children}</Collapsible.Content>
  </Collapsible.Root>
}
