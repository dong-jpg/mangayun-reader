/**
 * 增强阅读器界面（N-3 隔离）：全部内容放在宿主元素的 Shadow DOM 中。
 * 工具栏默认收起（R-C9），底部面板操作，按钮 ≥48px，适配安全区。
 */
import type { Chapter, ComicInfo } from '../site/types'
import type { Background, Direction, HorizontalFit, ReaderModeKind, Settings, SingleFit, TapZones } from '../store/settings'
import { Cleanup } from '../utils/cleanup'
import { STYLES } from './styles'
import { h } from './dom'
import { createSettingsPanel } from './settings-panel'

export interface UIActions {
  exit(): void
  switchMode(kind: ReaderModeKind): void
  switchDirection(direction: Direction, invertTapZones: boolean): void
  setVerticalWidth(width: number): void
  setHorizontalFit(fit: HorizontalFit): void
  setHorizontalGap(on: boolean): void
  setSingleFit(fit: SingleFit): void
  setTapZones(zones: TapZones): void
  setBackground(bg: Background): void
  setPreload(before: number, after: number): void
  setKeepAwake(on: boolean): void
  setAutoEnter(on: boolean): void
  setTapInContinuous(on: boolean): void
  setDownloadConcurrency(value: number): void
  resetEntryPosition(): void
  jumpToPage(page: number): void
  jumpToChapter(chapter: Chapter): void
  neighborChapter(delta: 1 | -1): Chapter | null
  toggleFullscreen(): void
  openDownload(): void
  exportSettings(): string
  importSettings(json: string): { ok: boolean; error?: string }
  settings(): Settings
}

export interface ReaderUI {
  open(): void
  close(): void
  readonly modeRoot: HTMLElement
  toggleToolbar(): void
  setLoading(on: boolean, text?: string): void
  showError(title: string, detail: string, actions: { label: string; action: () => void }[]): void
  updatePageIndicator(current: number, total: number): void
  updateModeButtons(mode: ReaderModeKind, direction: Direction): void
  updateCatalog(info: ComicInfo): void
  showChapterCard(edge: 'start' | 'end', chapter: Chapter | null): void
  applyBackground(bg: Background): void
  toast(text: string): void
  /** 顶层面板（目录/设置）打开时返回 true（Esc 先关面板）。 */
  dismissTopPanel(): boolean
  hasOpenPanel?(): boolean
}

const BG_COLOR: Record<Background, string> = {
  black: '#000',
  gray: '#3f3f46',
  white: '#fff',
  system: 'auto',
}

export class OverlayUI implements ReaderUI {
  #host: HTMLElement
  #shadow: ShadowRoot
  #root: HTMLElement
  #modeRootEl: HTMLElement
  #toolbar: HTMLElement
  #toolbarVisible = false
  #loading: HTMLElement | null = null
  #errorSheet: HTMLElement | null = null
  #catalogSheet: HTMLElement | null = null
  #settingsSheet: HTMLElement | null = null
  #chapterCard: HTMLElement | null = null
  #toastEl: HTMLElement | null = null
  #pageLabel: HTMLElement
  #pageSlider: HTMLInputElement
  #modeButtons: Record<string, HTMLButtonElement> = {}
  #cleanup = new Cleanup()
  #actions: UIActions
  #catalogAsc = true
  #info: ComicInfo | null = null
  #currentChapterUrl = ''
  #externalSheets = new Set<HTMLElement>()

  constructor(actions: UIActions) {
    this.#actions = actions
    this.#host = document.createElement('div')
    this.#host.id = 'myr-overlay-host'
    this.#host.style.cssText = 'position:fixed;inset:0;z-index:2147483647'
    this.#shadow = this.#host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLES
    this.#shadow.append(style)

    this.#root = h('div', { class: 'myr-root myr-bg-black' })
    this.#modeRootEl = h('div', { class: 'myr-mode-root' })

    this.#toolbar = this.#buildToolbar()
    this.#pageLabel = this.#toolbar.querySelector('.myr-page-label')!
    this.#pageSlider = this.#toolbar.querySelector('.myr-page-slider')!

    this.#root.append(this.#modeRootEl, this.#toolbar)
    this.#shadow.append(this.#root)
  }

  #bindEvents(): void {
    this.#cleanup = new Cleanup()
    // 点击模式区以外不透传
    this.#cleanup.addListener(this.#root, 'pointerdown', (e) => e.stopPropagation())
    this.#cleanup.addListener(this.#root, 'touchstart', (e) => e.stopPropagation(), { passive: true })
    this.#cleanup.addListener(this.#root, 'touchmove', (e) => e.stopPropagation(), { passive: true })
    this.#cleanup.addListener(this.#root, 'touchend', (e) => e.stopPropagation(), { passive: true })
    this.#cleanup.addListener(this.#root, 'click', (e) => e.stopPropagation())
    this.#cleanup.addListener(this.#root, 'wheel', (e) => e.stopPropagation())
    this.#cleanup.addListener(this.#root, 'keydown', (e) => e.stopPropagation())
  }

  get modeRoot(): HTMLElement {
    return this.#modeRootEl
  }

  /** 在 Shadow DOM 内查询（e2e/测试辅助）。 */
  queryAll<T extends HTMLElement = HTMLElement>(selector: string): T[] {
    return [...this.#shadow.querySelectorAll<T>(selector)]
  }

  open(): void {
    if (!this.#host.isConnected) {
      document.documentElement.appendChild(this.#host)
      this.#bindEvents()
    }
    this.#root.classList.add('myr-open')
    this.setToolbarVisible(false)
    this.updatePageIndicator(1, 0)
  }

  close(): void {
    this.dismissTopPanel()
    this.#chapterCard?.remove()
    this.#chapterCard = null
    this.#errorSheet?.remove()
    this.#errorSheet = null
    this.#loading?.remove()
    this.#loading = null
    this.#root.classList.remove('myr-open')
    this.#cleanup.run()
    this.#host.remove()
  }

  // ---------- 工具栏 ----------

  #buildToolbar(): HTMLElement {
    // R-C7：全屏 API 可用时提供全屏；不可用时提供沉浸模式，文案不混用
    const fullscreenSupported =
      typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled
    const screenBtn = h(
      'button',
      { class: 'myr-btn', type: 'button' },
      fullscreenSupported ? '全屏' : '沉浸',
    )
    screenBtn.addEventListener('click', () => {
      if (fullscreenSupported) this.#actions.toggleFullscreen()
      else {
        this.setToolbarVisible(false)
        this.toast('沉浸模式：点击中央区域呼出菜单')
      }
    })
    const top = h('div', { class: 'myr-bar myr-bar-top' },
      h('button', { class: 'myr-btn', type: 'button', onclick: () => this.#actions.exit() }, '退出'),
      h('div', { class: 'myr-title' }, '增强阅读'),
      screenBtn,
      h('button', { class: 'myr-btn', type: 'button', 'data-settings-trigger': '', onclick: () => this.#openSettings() }, '设置'),
    )
    const modeBtn = (kind: ReaderModeKind, label: string): HTMLButtonElement => {
      const btn = h('button', { class: 'myr-btn myr-seg', type: 'button', onclick: () => this.#actions.switchMode(kind) }, label)
      this.#modeButtons[kind] = btn
      return btn
    }
    const dirBtn = h('button', { class: 'myr-btn', type: 'button' }, '右→左')
    dirBtn.addEventListener('click', () => {
      const s = this.#actions.settings()
      const next: Direction = s.direction === 'rtl' ? 'ltr' : 'rtl'
      this.#confirmInvertZones(next)
    })
    this.#modeButtons['dir'] = dirBtn
    const bottom = h('div', { class: 'myr-bar myr-bar-bottom' },
      h('div', { class: 'myr-cluster', role: 'group', 'aria-label': '阅读模式' },
        modeBtn('vertical', '纵向'),
        modeBtn('horizontal', '横向'),
        modeBtn('single', '单页'),
        dirBtn,
      ),
      h('div', { class: 'myr-cluster' },
        h('button', { class: 'myr-btn', type: 'button', onclick: () => this.#openCatalog() }, '目录'),
        h('button', { class: 'myr-btn', type: 'button', onclick: () => this.#actions.openDownload() }, '下载'),
      ),
      h('div', { class: 'myr-slider-row' },
        h('span', { class: 'myr-page-label' }, '0 / 0'),
        this.#makeSlider(),
      ),
    )
    return h('div', { class: 'myr-toolbar' }, top, bottom)
  }

  #makeSlider(): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'range'
    input.className = 'myr-page-slider'
    input.min = '1'
    input.max = '1'
    input.value = '1'
    input.addEventListener('input', () => {
      const page = Number(input.value)
      this.#pageLabel.textContent = `${page} / ${input.max}`
    })
    input.addEventListener('change', () => {
      this.#actions.jumpToPage(Number(input.value) - 1)
    })
    return input
  }

  /** R-S3/D4：切换方向时询问是否同时反转左右点击区，不静默修改。 */
  #confirmInvertZones(next: Direction): void {
    const sheet = h('div', { class: 'myr-sheet-wrap' },
      h('div', { class: 'myr-sheet' },
        h('div', { class: 'myr-sheet-title' }, `切换为${next === 'rtl' ? '右→左' : '左→右'}`),
        h('div', { class: 'myr-sheet-body' }, '是否同时反转左右点击区的动作？'),
        h('div', { class: 'myr-sheet-actions' },
          h('button', {
            class: 'myr-btn myr-btn-primary', type: 'button',
            onclick: () => { sheet.remove(); this.#actions.switchDirection(next, true) },
          }, '是，反转'),
          h('button', {
            class: 'myr-btn', type: 'button',
            onclick: () => { sheet.remove(); this.#actions.switchDirection(next, false) },
          }, '否，保持'),
        ),
      ),
    )
    this.#root.append(sheet)
  }

  toggleToolbar(): void {
    this.setToolbarVisible(!this.#toolbarVisible)
  }

  setToolbarVisible(visible: boolean): void {
    this.#toolbarVisible = visible
    this.#toolbar.classList.toggle('myr-visible', visible)
  }

  // ---------- 状态展示 ----------

  setLoading(on: boolean, text = '加载中…'): void {
    if (!on) {
      this.#loading?.remove()
      this.#loading = null
      return
    }
    if (!this.#loading) {
      this.#loading = h('div', { class: 'myr-loading' }, h('div', { class: 'myr-spinner' }), h('div', { class: 'myr-loading-text' }, text))
      this.#root.append(this.#loading)
    }
    const label = this.#loading.querySelector('.myr-loading-text')
    if (label) label.textContent = text
  }

  showError(title: string, detail: string, actions: { label: string; action: () => void }[]): void {
    this.#errorSheet?.remove()
    const buttons = actions.map((a) =>
      h('button', { class: 'myr-btn myr-btn-primary', type: 'button', onclick: () => { this.#errorSheet?.remove(); this.#errorSheet = null; a.action() } }, a.label),
    )
    this.#errorSheet = h('div', { class: 'myr-sheet-wrap' },
      h('div', { class: 'myr-sheet' },
        h('div', { class: 'myr-sheet-title' }, title),
        h('div', { class: 'myr-sheet-body' }, detail),
        h('div', { class: 'myr-sheet-actions' }, ...buttons),
      ),
    )
    this.#root.append(this.#errorSheet)
  }

  updatePageIndicator(current: number, total: number): void {
    this.#pageLabel.textContent = `${current} / ${total}`
    this.#pageSlider.max = String(Math.max(1, total))
    this.#pageSlider.value = String(Math.max(1, Math.min(total, current)))
  }

  updateModeButtons(mode: ReaderModeKind, direction: Direction): void {
    for (const kind of ['vertical', 'horizontal', 'single']) {
      this.#modeButtons[kind]?.classList.toggle('myr-seg-active', kind === mode)
    }
    const dirBtn = this.#modeButtons['dir']
    if (dirBtn) dirBtn.textContent = direction === 'rtl' ? '右→左' : '左→右'
  }

  updateCatalog(info: ComicInfo): void {
    this.#info = info
    const title = this.#root.querySelector('.myr-title')
    if (title && info.title) title.textContent = info.title
    if (this.#catalogSheet) this.#renderCatalogList()
  }

  setCurrentChapter(chapterUrl: string): void {
    this.#currentChapterUrl = chapterUrl
  }

  applyBackground(bg: Background): void {
    const color = BG_COLOR[bg]
    this.#root.classList.remove('myr-bg-black', 'myr-bg-gray', 'myr-bg-white', 'myr-bg-system')
    this.#root.classList.add(`myr-bg-${bg}`)
    this.#root.style.removeProperty('background')
    if (color !== 'auto') this.#root.style.background = color
  }

  toast(text: string): void {
    this.#toastEl?.remove()
    this.#toastEl = h('div', { class: 'myr-toast' }, text)
    this.#root.append(this.#toastEl)
    setTimeout(() => {
      this.#toastEl?.remove()
      this.#toastEl = null
    }, 2200)
  }

  // ---------- 面板 ----------

  dismissTopPanel(): boolean {
    let dismissed = false
    if (this.#externalSheets.size > 0) {
      for (const el of [...this.#externalSheets]) this.closeSheet(el)
      dismissed = true
    }
    if (this.#errorSheet) {
      this.#errorSheet.remove()
      this.#errorSheet = null
      dismissed = true
    }
    if (this.#settingsSheet) {
      this.#closeSettings()
      dismissed = true
    }
    if (this.#catalogSheet) {
      this.#catalogSheet.remove()
      this.#catalogSheet = null
      dismissed = true
    }
    if (this.#chapterCard) {
      this.#chapterCard.remove()
      this.#chapterCard = null
      dismissed = true
    }
    return dismissed
  }

  hasOpenPanel(): boolean {
    return this.#root.querySelector('.myr-sheet-wrap') !== null
  }

  /** 外部面板（如下载面板）挂载进 Shadow DOM（N-3 隔离）。 */
  openSheet(el: HTMLElement): void {
    this.#externalSheets.add(el)
    this.#root.append(el)
  }

  closeSheet(el: HTMLElement): void {
    this.#externalSheets.delete(el)
    el.remove()
  }

  showChapterCard(edge: 'start' | 'end', chapter: Chapter | null): void {
    this.#chapterCard?.remove()
    if (!chapter) {
      this.toast(edge === 'start' ? '已经是第一话' : '已经是最后一话')
      return
    }
    const label = edge === 'start' ? '上一话' : '下一话'
    this.#chapterCard = h('div', { class: 'myr-sheet-wrap myr-center' },
      h('div', { class: 'myr-sheet' },
        h('div', { class: 'myr-sheet-title' }, label),
        h('div', { class: 'myr-sheet-body' }, chapter.name),
        h('div', { class: 'myr-sheet-actions' },
          h('button', {
            class: 'myr-btn myr-btn-primary', type: 'button',
            onclick: () => { this.#chapterCard?.remove(); this.#chapterCard = null; this.#actions.jumpToChapter(chapter) },
          }, `进入${label}`),
          h('button', {
            class: 'myr-btn', type: 'button',
            onclick: () => { this.#chapterCard?.remove(); this.#chapterCard = null },
          }, '留在本章'),
        ),
      ),
    )
    this.#root.append(this.#chapterCard)
  }

  #openCatalog(): void {
    this.#catalogSheet?.remove()
    this.#catalogSheet = h('div', { class: 'myr-sheet-wrap myr-sheet-bottom' },
      h('div', { class: 'myr-sheet myr-sheet-tall' },
        h('div', { class: 'myr-sheet-head' },
          h('div', { class: 'myr-sheet-title' }, this.#info?.title || '目录'),
          h('button', {
            class: 'myr-btn myr-btn-small', type: 'button',
            onclick: () => {
              this.#catalogAsc = !this.#catalogAsc
              this.#renderCatalogList()
            },
          }, this.#catalogAsc ? '正序 ↓' : '倒序 ↑'),
          h('button', {
            class: 'myr-btn myr-btn-small', type: 'button',
            onclick: () => { this.#catalogSheet?.remove(); this.#catalogSheet = null },
          }, '关闭'),
        ),
        h('div', { class: 'myr-catalog-list' }),
      ),
    )
    this.#root.append(this.#catalogSheet)
    this.#renderCatalogList()
  }

  #renderCatalogList(): void {
    const list = this.#catalogSheet?.querySelector('.myr-catalog-list')
    if (!list || !this.#info) return
    list.textContent = ''
    const chapters = this.#catalogAsc ? this.#info.chapters : [...this.#info.chapters].reverse()
    for (const chapter of chapters) {
      const current = chapter.url === this.#currentChapterUrl
      const item = h('button', {
        class: `myr-catalog-item${current ? ' myr-catalog-now' : ''}`, type: 'button',
        onclick: () => {
          if (current) {
            this.#catalogSheet?.remove()
            this.#catalogSheet = null
            return
          }
          this.#actions.jumpToChapter(chapter)
        },
      }, chapter.name)
      list.append(item)
    }
    const now = list.querySelector('.myr-catalog-now')
    now?.scrollIntoView({ block: 'center' })
  }

  // ---------- 设置 ----------

  #closeSettings(): void {
    this.#settingsSheet?.remove()
    this.#settingsSheet = null
    this.#toolbar.querySelector<HTMLButtonElement>('[data-settings-trigger]')?.focus({ preventScroll: true })
  }

  #openSettings(): void {
    this.#settingsSheet?.remove()
    this.#settingsSheet = createSettingsPanel({
      actions: this.#actions,
      onClose: () => this.#closeSettings(),
      toast: (message) => this.toast(message),
    })
    this.#root.append(this.#settingsSheet)
    this.#settingsSheet.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
  }
}
