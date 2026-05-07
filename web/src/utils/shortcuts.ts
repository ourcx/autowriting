/**
 * 快捷键处理工具
 */

export type ShortcutCallback = () => void | Promise<void>

interface ShortcutConfig {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  callback: ShortcutCallback
}

class ShortcutManager {
  private shortcuts: Map<string, ShortcutCallback> = new Map()

  /**
   * 注册快捷键
   */
  register(config: ShortcutConfig) {
    const key = this.generateKey(config)
    this.shortcuts.set(key, config.callback)
  }

  /**
   * 注销快捷键
   */
  unregister(config: Omit<ShortcutConfig, 'callback'>) {
    const key = this.generateKey(config)
    this.shortcuts.delete(key)
  }

  /**
   * 生成快捷键标识
   */
  private generateKey(config: Omit<ShortcutConfig, 'callback'>): string {
    const parts = []
    if (config.ctrl) parts.push('ctrl')
    if (config.shift) parts.push('shift')
    if (config.alt) parts.push('alt')
    parts.push(config.key.toLowerCase())
    return parts.join('+')
  }

  /**
   * 处理键盘事件
   */
  handleKeyDown(event: KeyboardEvent) {
    const key = this.generateKey({
      key: event.key,
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey
    })

    const callback = this.shortcuts.get(key)
    if (callback) {
      event.preventDefault()
      callback()
    }
  }

  /**
   * 获取所有快捷键
   */
  getAll(): Array<{ key: string; description: string }> {
    return Array.from(this.shortcuts.keys()).map(key => ({
      key,
      description: this.formatKey(key)
    }))
  }

  /**
   * 格式化快捷键显示
   */
  private formatKey(key: string): string {
    return key
      .split('+')
      .map(part => {
        const map: Record<string, string> = {
          ctrl: 'Ctrl',
          shift: 'Shift',
          alt: 'Alt',
          enter: 'Enter',
          space: 'Space',
          tab: 'Tab',
          escape: 'Esc'
        }
        return map[part] || part.toUpperCase()
      })
      .join(' + ')
  }
}

export const shortcutManager = new ShortcutManager()

/**
 * 在组件中使用快捷键的 Hook
 */
export function useShortcuts(shortcuts: ShortcutConfig[]) {
  return {
    register: (config: ShortcutConfig) => {
      shortcutManager.register(config)
    },
    unregister: (config: Omit<ShortcutConfig, 'callback'>) => {
      shortcutManager.unregister(config)
    }
  }
}

/**
 * 预定义的快捷键配置
 */
export const COMMON_SHORTCUTS = {
  SAVE: { key: 's', ctrl: true },
  GENERATE: { key: 'g', ctrl: true },
  PUBLISH: { key: 'p', ctrl: true },
  PREVIEW: { key: 'e', ctrl: true },
  UNDO: { key: 'z', ctrl: true },
  REDO: { key: 'z', ctrl: true, shift: true }
}
