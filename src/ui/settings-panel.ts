import { version } from '../../package.json'
import type { Settings, TapAction, TapZones } from '../store/settings'
import { invertHorizontalZones, TAP_PRESETS } from '../reader/tap-zones'
import type { UIActions } from './overlay'
import { h } from './dom'
import { icon, type IconName } from './icons'

interface SettingsPanelOptions {
  actions: UIActions
  onClose(): void
  toast(message: string): void
}

function button(label: string, action: () => void, className = 'myr-btn'): HTMLButtonElement {
  return h('button', { class: className, type: 'button', onclick: action }, label)
}

function card(title: string, description: string, ...content: HTMLElement[]): HTMLElement {
  return h('section', { class: 'myr-settings-card' },
    h('div', { class: 'myr-card-heading' },
      h('h3', {}, title), h('p', { class: 'myr-setting-hint' }, description),
    ), ...content,
  )
}

function segmented<T extends string>(
  label: string, values: [T, string][], current: T, setter: (value: T) => void,
  className = '',
): HTMLElement {
  const row = h('div', { class: `myr-setting-segments ${className}`, role: 'group', 'aria-label': label })
  for (const [value, text] of values) {
    const item = button(text, () => {
      setter(value)
      for (const option of row.querySelectorAll('button')) {
        option.setAttribute('aria-pressed', String(option === item))
      }
    }, 'myr-btn myr-setting-choice')
    item.dataset.value = value
    item.setAttribute('aria-pressed', String(value === current))
    row.append(item)
  }
  return row
}

function toggle(label: string, description: string, on: boolean, setter: (value: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label })
  input.checked = on
  input.addEventListener('change', () => setter(input.checked))
  return h('label', { class: 'myr-setting-row' },
    h('span', { class: 'myr-setting-copy' },
      h('span', { class: 'myr-setting-title' }, label),
      h('span', { class: 'myr-setting-hint' }, description),
    ),
    h('span', { class: 'myr-switch' }, input, h('span', { class: 'myr-switch-track', 'aria-hidden': 'true' })),
  )
}

function stepper(label: string, title: string, initial: number, min: number, max: number, setter: (value: number) => void): HTMLElement {
  let current = initial
  const value = h('output', { class: 'myr-stepper-value', 'aria-live': 'polite' }, String(current))
  const change = (delta: number) => {
    current = Math.min(max, Math.max(min, current + delta))
    value.textContent = String(current)
    setter(current)
    update()
  }
  const minus = button('−', () => change(-1), 'myr-btn myr-stepper-button')
  minus.setAttribute('aria-label', `减少${label}`)
  const plus = button('+', () => change(1), 'myr-btn myr-stepper-button')
  plus.setAttribute('aria-label', `增加${label}`)
  const update = () => { minus.disabled = current <= min; plus.disabled = current >= max }
  update()
  return h('div', { class: 'myr-stepper-row', role: 'group', 'aria-label': label },
    h('span', { class: 'myr-setting-title' }, title),
    h('div', { class: 'myr-stepper' }, minus, value, plus),
  )
}

function readingPanel(actions: UIActions): HTMLElement {
  const s = actions.settings()
  const modes: [Settings['mode'], string, string, IconName][] = [
    ['vertical', '纵向连续', '长条 / 韩漫', 'vertical'],
    ['horizontal', '横向连续', '跨页 / 日漫', 'horizontal'],
    ['single', '单页阅读', '逐页细读', 'single'],
  ]
  const modeRow = h('div', { class: 'myr-mode-cards', role: 'group', 'aria-label': '阅读模式' })
  const modeControls = h('div', { class: 'myr-mode-settings' })
  const renderMode = () => {
    const settings = actions.settings()
    modeControls.replaceChildren()
    if (settings.mode === 'vertical') {
      const input = h('input', { class: 'myr-width-slider', type: 'range', min: '50', max: '100', step: '10', 'aria-label': '阅读宽度' })
      input.value = String(settings.verticalWidth)
      const value = h('output', { class: 'myr-width-value' }, `${settings.verticalWidth}%`)
      input.addEventListener('input', () => { value.textContent = `${input.value}%` })
      input.addEventListener('change', () => actions.setVerticalWidth(Number(input.value)))
      modeControls.append(card('阅读宽度', '只对当前漫画生效，图片始终居中、不裁切。',
        h('div', { class: 'myr-width-control' }, input, value),
        h('div', { class: 'myr-range-legend', 'aria-hidden': 'true' }, h('span', {}, '留白更多'), h('span', {}, '铺满屏幕')),
      ))
    } else if (settings.mode === 'horizontal') {
      modeControls.append(card('横向适配', '自动：竖屏整页可见，横屏按高度连续排列。',
        segmented<Settings['horizontalFit']>('横向适配', [['auto', '自动'], ['screen', '适应屏幕'], ['height', '适应高度']], settings.horizontalFit, actions.setHorizontalFit),
        toggle('页间留隙', '适应屏幕时保留 12px 留白；跨页拼接请关闭。', settings.horizontalGap !== false, actions.setHorizontalGap),
      ))
    } else {
      modeControls.append(card('单页适应', '为当前漫画选择页面大小，默认完整显示一页。',
        segmented<Settings['singleFit']>('单页适应', [['screen', '适应屏幕'], ['width', '适应宽度'], ['height', '适应高度'], ['original', '原始大小']], settings.singleFit, actions.setSingleFit, 'myr-two-columns'),
      ))
    }
  }
  for (const [kind, label, note, glyph] of modes) {
    const item = h('button', {
      class: 'myr-mode-card', type: 'button', 'aria-label': label,
      'aria-pressed': String(kind === s.mode),
    }, icon(glyph), h('span', { class: 'myr-mode-name' }, label), h('span', { class: 'myr-mode-note' }, note))
    item.addEventListener('click', () => {
      actions.switchMode(kind)
      for (const option of modeRow.querySelectorAll('button')) option.setAttribute('aria-pressed', String(option === item))
      renderMode()
    })
    modeRow.append(item)
  }
  renderMode()
  const backgrounds = segmented<Settings['background']>(
    '阅读背景', [['black', '纯黑'], ['gray', '深灰'], ['white', '纸白'], ['system', '跟随系统']],
    s.background, actions.setBackground, 'myr-backgrounds',
  )
  for (const item of backgrounds.querySelectorAll('button')) {
    item.prepend(h('span', { class: `myr-color-swatch myr-swatch-${item.dataset.value}`, 'aria-hidden': 'true' }))
  }
  return h('div', { class: 'myr-settings-content' },
    h('div', { class: 'myr-section-caption' }, h('span', {}, '选择阅读方式'), h('span', { class: 'myr-scope-tag' }, '本书记忆')),
    modeRow, modeControls,
    card('阅读背景', '全局通用。留白区域跟随选择，不改变漫画图片。', backgrounds),
    h('p', { class: 'myr-settings-note' }, '左右阅读方向可在阅读工具栏切换。'),
  )
}

function gesturesPanel(options: SettingsPanelOptions): HTMLElement {
  const { actions } = options
  const settings = actions.settings()
  let zones = { ...settings.tapZones }
  const labels: Record<TapAction, string> = { prev: '上一页', next: '下一页', none: '无操作' }
  const names: [keyof TapZones, string][] = [['top', '上'], ['left', '左'], ['right', '右'], ['bottom', '下']]
  const preview = h('div', { class: 'myr-zone-preview', role: 'img', 'aria-label': '点击区布局：中央固定为菜单' })
  const mappings = h('div', { class: 'myr-zone-mappings' })
  const selects = new Map<keyof TapZones, HTMLSelectElement>()
  const renderPreview = () => {
    const zone = (name: string, text: string) => h('div', { class: `myr-zone myr-zone-${name}` }, text)
    preview.replaceChildren(
      zone('top', labels[zones.top]),
      h('div', { class: 'myr-zone-mid' }, zone('left', labels[zones.left]), zone('center', '菜单'), zone('right', labels[zones.right])),
      zone('bottom', labels[zones.bottom]),
    )
    preview.setAttribute('aria-label', `点击区布局：上${labels[zones.top]}，左${labels[zones.left]}，右${labels[zones.right]}，下${labels[zones.bottom]}，中央菜单`)
  }
  const apply = (next: TapZones) => {
    zones = { ...next }
    for (const [name, select] of selects) select.value = zones[name]
    renderPreview()
    actions.setTapZones({ ...zones })
  }
  for (const [name, label] of names) {
    const select = h('select', { class: 'myr-select', 'data-zone': name, 'aria-label': `${label}方点击区` })
    for (const [value, text] of Object.entries(labels)) select.append(h('option', { value }, text))
    select.value = zones[name]
    select.addEventListener('change', () => apply({ ...zones, [name]: select.value as TapAction }))
    selects.set(name, select)
    mappings.append(h('label', { class: 'myr-zone-mapping' }, h('span', {}, label), select))
  }
  renderPreview()
  const presets = h('div', { class: 'myr-preset-grid', role: 'group', 'aria-label': '点击区预设' })
  for (const preset of Object.values(TAP_PRESETS)) presets.append(button(preset.label, () => apply(preset.zones)))
  return h('div', { class: 'myr-settings-content' },
    card('让翻页顺手一点', '四周由你定义，中央始终呼出菜单。设置对所有漫画生效。',
      h('div', { class: 'myr-zone-editor' }, preview, mappings),
      h('div', { class: 'myr-section-caption' }, '快速预设'), presets,
      h('div', { class: 'myr-setting-tools' },
        button('反转左右', () => apply(invertHorizontalZones(zones))),
        button('恢复默认', () => apply(TAP_PRESETS.default!.zones)),
        button('立即试用', () => { options.onClose(); options.toast('已应用，点击试用') }, 'myr-btn myr-btn-primary'),
      ),
    ),
    card('连续阅读', '关闭点击翻页后，轻点只会呼出菜单。',
      toggle('连续模式点击区', '在纵向和横向连续模式中使用同一套点击区。', settings.tapInContinuous, actions.setTapInContinuous),
    ),
    h('div', { class: 'myr-gesture-note' }, icon('gesture'), h('p', {}, '双指放大后，拖动只移动画面；缩放结束后会短暂屏蔽误触。')),
  )
}

function generalPanel(options: SettingsPanelOptions): HTMLElement {
  const { actions } = options
  const settings = actions.settings()
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': '导入设置' })
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]
    if (!file) return
    try {
      const result = actions.importSettings(await file.text())
      options.toast(result.ok ? '导入成功，设置已应用' : `导入失败：${result.error ?? '未知错误'}`)
      if (result.ok) options.onClose()
    } catch {
      options.toast('导入失败：无法读取文件')
    } finally {
      importInput.value = ''
    }
  })
  const exportButton = button('导出设置', () => {
    const blob = new Blob([actions.exportSettings()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = h('a', { href: url, download: 'mangayun-reader-settings.json' })
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  return h('div', { class: 'myr-settings-content' },
    card('流畅与性能', '提前加载相邻图片。窗口越大，占用的内存越多。',
      stepper('前方预加载', '当前页之前', settings.preload.before, 0, 5, (value) => actions.setPreload(value, actions.settings().preload.after)),
      stepper('后方预加载', '当前页之后', settings.preload.after, 1, 10, (value) => actions.setPreload(actions.settings().preload.before, value)),
      stepper('下载并发', '同时下载图片', settings.download.concurrency, 1, 4, actions.setDownloadConcurrency),
    ),
    card('阅读习惯', '这些偏好全局生效，下一次打开时仍会保留。',
      toggle('屏幕常亮', '阅读和下载时尝试保持亮屏；由浏览器能力决定。', settings.keepAwake, actions.setKeepAwake),
      toggle('自动进入增强阅读', '进入原站阅读页后，直接打开增强阅读器。', settings.autoEnter, actions.setAutoEnter),
      h('div', { class: 'myr-setting-row' },
        h('div', { class: 'myr-setting-copy' }, h('span', { class: 'myr-setting-title' }, '悬浮入口'), h('span', { class: 'myr-setting-hint' }, '退出阅读后显示，拖动后自动贴边。')),
        button('重置入口位置', () => { actions.resetEntryPosition(); options.toast('入口位置已重置，退出阅读后生效') }, 'myr-btn myr-text-button'),
      ),
    ),
    card('备份与迁移', '导出设置和本地阅读进度，不包含漫画图片。',
      h('div', { class: 'myr-backup-actions' }, exportButton, h('label', { class: 'myr-btn myr-file-label' }, '导入设置', importInput)),
    ),
    h('p', { class: 'myr-settings-note' }, `MangaYun Reader ${version} · 数据仅保存在本地`),
  )
}

export function createSettingsPanel(options: SettingsPanelOptions): HTMLElement {
  const tabs: [string, string, () => HTMLElement][] = [
    ['reading', '阅读', () => readingPanel(options.actions)],
    ['gestures', '手势', () => gesturesPanel(options)],
    ['general', '通用', () => generalPanel(options)],
  ]
  const close = h('button', { class: 'myr-btn myr-icon-button', type: 'button', 'aria-label': '关闭设置', onclick: options.onClose }, icon('close'))
  const tabRow = h('div', { class: 'myr-settings-tabs', role: 'tablist', 'aria-label': '设置分类' })
  const body = h('div', { class: 'myr-sheet-body myr-settings-body' })
  const buttons: HTMLButtonElement[] = []
  const panels: HTMLElement[] = []
  const activate = (index: number, focus = false) => {
    for (const [i, tab] of buttons.entries()) {
      tab.setAttribute('aria-selected', String(i === index))
      tab.tabIndex = i === index ? 0 : -1
      panels[i]!.hidden = i !== index
    }
    body.scrollTop = 0
    if (focus) buttons[index]!.focus()
  }
  for (const [index, [id, label, render]] of tabs.entries()) {
    const tab = button(label, () => activate(index), 'myr-settings-tab')
    tab.id = `myr-settings-tab-${id}`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', `myr-settings-panel-${id}`)
    tab.addEventListener('keydown', (event) => {
      let next: number | undefined
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = tabs.length - 1
      if (next !== undefined) { event.preventDefault(); activate(next, true) }
    })
    const panel = h('div', { id: `myr-settings-panel-${id}`, role: 'tabpanel', 'aria-labelledby': tab.id }, render())
    buttons.push(tab)
    panels.push(panel)
    tabRow.append(tab)
    body.append(panel)
  }
  activate(0)
  const dialog = h('div', { class: 'myr-sheet myr-settings', role: 'dialog', 'aria-modal': 'true', 'aria-label': '阅读设置' },
    h('div', { class: 'myr-sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'myr-settings-header' },
      h('div', { class: 'myr-settings-mark' }, icon('book')),
      h('div', { class: 'myr-settings-heading' }, h('span', { class: 'myr-eyebrow' }, 'MANGAYUN READER'), h('h2', {}, '阅读设置')),
      close,
    ),
    tabRow, body,
    h('div', { class: 'myr-settings-footer' },
      h('span', { class: 'myr-saved-indicator' }, icon('check'), '更改自动保存'),
      button('完成', options.onClose, 'myr-btn myr-btn-primary'),
    ),
  )
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); options.onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
      .filter((el) => !el.closest('[hidden]') && el.tabIndex >= 0)
    const active = (dialog.getRootNode() as ShadowRoot).activeElement
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && active === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus() }
  })
  const wrap = h('div', { class: 'myr-sheet-wrap myr-settings-wrap' }, dialog)
  wrap.addEventListener('click', (event) => { if (event.target === wrap) options.onClose() })
  return wrap
}
