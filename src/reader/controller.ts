/**
 * 阅读器控制器：进入/退出、模式切换（保持锚点 R-C2）、章节加载与切换、
 * 键盘（R-C6）、全屏（R-C7）、背景（R-C8）、Wake Lock（R-C11）、进度保存。
 * UI 通过 ReaderUI 回调接入；清理统一走 Cleanup。
 */
import type { Chapter, ComicInfo, ComicRef, PageList, SiteAdapter } from '../site/types'
import type { ReaderModeKind, Settings } from '../store/settings'
import type { SettingsStore } from '../store/settings'
import type { ProgressStore } from '../store/progress'
import { Cleanup } from '../utils/cleanup'
import type { ModeHost } from './mode-context'
import { HorizontalMode } from './modes/horizontal'
import { SingleMode } from './modes/single'
import { VerticalMode } from './modes/vertical'
import type { ReaderUI } from '../ui/overlay'

export const RETURN_FLAG = 'myr:v1:return'

export interface ControllerDeps {
  adapter: SiteAdapter
  settingsStore: SettingsStore
  progress: ProgressStore
}

interface PageState {
  pages: string[]
  resolvedAt: number
}

export class ReaderController {
  #deps: ControllerDeps
  #cleanup = new Cleanup()
  #ui: ReaderUI | null = null
  #comic: ComicRef | null = null
  #chapterUrl = ''
  #info: ComicInfo | null = null
  #pageState: PageState | null = null
  #mode: import('./mode-context').ReaderMode | null = null
  #modeKind: ReaderModeKind = 'vertical'
  #active = false
  #wakeLock: WakeLockSentinel | null = null
  #savedStyles: { el: Element; display: string }[] = []
  #savedScrollLock: { htmlOverscroll: string; bodyOverflow: string } | null = null

  constructor(deps: ControllerDeps) {
    this.#deps = deps
  }

  attachUI(ui: ReaderUI): void {
    this.#ui = ui
  }

  get active(): boolean {
    return this.#active
  }

  get comic(): ComicRef | null {
    return this.#comic
  }

  get info(): ComicInfo | null {
    return this.#info
  }

  get currentChapterUrl(): string {
    return this.#chapterUrl
  }

  get pages(): string[] {
    return this.#pageState?.pages ?? []
  }

  get pageStats(): { current: number; total: number } {
    const anchor = this.#mode?.getAnchor()
    return { current: (anchor?.page ?? 0) + 1, total: this.pages.length }
  }

  get settings(): Settings {
    return this.#deps.settingsStore.effective(this.#comic)
  }

  get modeKind(): ReaderModeKind {
    return this.#modeKind
  }

  // ---------- 进入 / 退出 ----------

  async enter(route: { comic: ComicRef; chapterUrl: string }): Promise<void> {
    if (this.#active) return
    this.#active = true
    this.#comic = route.comic
    this.#chapterUrl = route.chapterUrl
    this.#hideSiteReader()
    this.#lockScroll()
    this.#ui?.open()
    this.#applyBackground()

    const offInfo = this.#deps.adapter.onComicInfo((info) => {
      if (info.ref.siteId === this.#comic?.siteId && info.chapters.length) {
        this.#info = info
        this.#ui?.updateCatalog(info)
      }
    })
    this.#cleanup.add(offInfo)

    const offPages = this.#deps.adapter.onPageList((list) => {
      if (list.chapterUrl === this.#chapterUrl) this.#setPages(list.images, list.resolvedAt)
    })
    this.#cleanup.add(offPages)

    this.#ui?.setLoading(true, '正在获取本章图片…')
    try {
      const list: PageList = await this.#resolveCurrentChapter()
      if (!this.#active) return
      this.#setPages(list.images, list.resolvedAt)
    } catch (e) {
      if (!this.#active) return
      this.#ui?.setLoading(false)
      this.#ui?.showError('图片清单获取失败', e instanceof Error ? e.message : String(e), [
        { label: '重试', action: () => void this.#reloadChapter() },
        { label: '退出', action: () => this.exit() },
      ])
      return
    }
    // 漫画信息（标题/目录）：现场等待最近捕获或 iframe 解析
    void this.#ensureComicInfo().then(() => {
      if (this.#info) this.#ui?.updateCatalog(this.#info)
    })
  }

  async #resolveCurrentChapter(): Promise<PageList> {
    const comic = this.#comic!
    return this.#deps.adapter.resolveChapter(comic, this.#chapterUrl)
  }

  async #ensureComicInfo(): Promise<void> {
    if (this.#info || !this.#comic) return
    try {
      const info = await this.#deps.adapter.resolveComic(this.#comic, this.#chapterUrl)
      if (this.#comic && info.ref.siteId === this.#comic.siteId) {
        this.#info = info
        this.#deps.progress.updateMeta(this.#comic, info.title)
      }
    } catch {
      /* 目录不可用时阅读不受影响 */
    }
  }

  #setPages(pages: string[], resolvedAt: number): void {
    this.#pageState = { pages, resolvedAt }
    this.#ui?.setLoading(false)
    this.#mountMode()
  }

  async #reloadChapter(): Promise<void> {
    this.#ui?.setLoading(true, '正在重新解析本话…')
    try {
      const list = await this.#resolveCurrentChapter()
      this.#setPages(list.images, list.resolvedAt)
    } catch (e) {
      this.#ui?.setLoading(false)
      this.#ui?.showError('重新解析失败', e instanceof Error ? e.message : String(e), [
        { label: '重试', action: () => void this.#reloadChapter() },
      ])
    }
  }

  exit(): void {
    if (!this.#active) return
    this.#flushProgress()
    this.#active = false
    this.#unmountMode()
    this.#ui?.close()
    this.#releaseWakeLock()
    this.#cleanup.run()
    this.#cleanup = new Cleanup()
    this.#restoreSiteReader()
    this.#restoreScroll()
    this.#pageState = null
    this.#info = null
  }

  #hideSiteReader(): void {
    this.#savedStyles = []
    // 原站阅读弹层隐藏，阻止其继续懒加载（§4.4）
    const candidates = document.querySelectorAll(
      '[aria-label="漫画阅读器"], .reader-overlay, [role="dialog"][aria-modal="true"]',
    )
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue
      this.#savedStyles.push({ el, display: el.style.display })
      el.style.display = 'none'
    }
  }

  #restoreSiteReader(): void {
    for (const { el, display } of this.#savedStyles) {
      if (el instanceof HTMLElement) el.style.display = display
    }
    this.#savedStyles = []
  }

  #lockScroll(): void {
    const html = document.documentElement
    this.#savedScrollLock = {
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: document.body.style.overflow,
    }
    html.style.overscrollBehavior = 'none'
    document.body.style.overflow = 'hidden'
  }

  #restoreScroll(): void {
    if (!this.#savedScrollLock) return
    document.documentElement.style.overscrollBehavior = this.#savedScrollLock.htmlOverscroll
    document.body.style.overflow = this.#savedScrollLock.bodyOverflow
    this.#savedScrollLock = null
  }

  // ---------- 模式 ----------

  #modeHost(): ModeHost {
    const self = () => this
    return {
      get settings() {
        return self().settings
      },
      get pages() {
        return self().pages
      },
      onAnchorChange: (a) => {
        this.#recordAnchor(a)
      },
      onPageChange: (page) => {
        this.#ui?.updatePageIndicator(page + 1, this.pages.length)
      },
      onMenu: () => {
        this.#ui?.toggleToolbar()
      },
      onChapterEdge: (edge) => {
        const chapter = this.#neighborChapter(edge === 'start' ? -1 : 1)
        this.#ui?.showChapterCard(edge, chapter)
      },
      onReparseChapter: () => {
        void this.#reloadChapter()
      },
      isZoomed: () => this.#mode?.isZoomed?.() ?? (window.visualViewport?.scale ?? 1) > 1.01,
    }
  }

  #mountMode(anchor?: { page: number; offset: number }): void {
    if (!this.#active || !this.#ui || !this.#pageState) return
    this.#unmountMode()
    const kind = this.settings.mode
    this.#modeKind = kind
    const host = this.#modeHost()
    const mode =
      kind === 'horizontal' ? new HorizontalMode(host) : kind === 'single' ? new SingleMode(host) : new VerticalMode(host)
    const target = anchor ?? this.#restoredAnchor()
    this.#mode = mode
    mode.mount(this.#ui.modeRoot, target)
    const a = mode.getAnchor()
    this.#ui.updatePageIndicator(a.page + 1, this.pages.length)
    this.#ui.updateModeButtons(kind, this.settings.direction)
  }

  #unmountMode(): void {
    this.#mode?.unmount()
    this.#mode = null
  }

  /** 恢复锚点：进度记录 →（无则第 1 页）。 */
  #restoredAnchor(): { page: number; offset: number } {
    const saved = this.#comic ? this.#deps.progress.get(this.#comic) : null
    if (saved && saved.chapterUrl === this.#chapterUrl) {
      return { page: Math.min(this.pages.length - 1, Math.max(0, saved.page)), offset: saved.offset }
    }
    return { page: 0, offset: 0 }
  }

  #recordAnchor(a: { page: number; offset: number }): void {
    if (!this.#comic) return
    this.#deps.progress.record(this.#comic, { chapterUrl: this.#chapterUrl, page: a.page, offset: a.offset })
  }

  #flushProgress(): void {
    this.#deps.progress.flush()
  }

  // ---------- 设置变更 ----------

  switchMode(kind: ReaderModeKind): void {
    if (!this.#active) return
    const anchor = this.#mode?.getAnchor() ?? { page: 0, offset: 0 }
    this.#applySettings({ mode: kind }, anchor)
  }

  switchDirection(direction: 'ltr' | 'rtl'): void {
    if (!this.#active) return
    const anchor = this.#mode?.getAnchor() ?? { page: 0, offset: 0 }
    this.#applySettings({ direction }, anchor)
  }

  /** 应用设置变更并保持锚点（R-C2）。 */
  applySettingChanges(anchor?: { page: number; offset: number }): void {
    if (!this.#active) return
    this.#applyBackground()
    this.#mountMode(anchor ?? this.#mode?.getAnchor() ?? undefined)
  }

  #applySettings(patch: Partial<Settings>, anchor: { page: number; offset: number }): void {
    if (this.#comic) {
      const overrides = {
        ...(this.#deps.settingsStore.effective(this.#comic) as Partial<Settings>),
        ...patch,
      }
      // 漫画级覆盖项只保留白名单字段
      const { mode, direction, verticalWidth, singleFit } = overrides as Settings
      this.#deps.progress.setOverrides(this.#comic, { mode, direction, verticalWidth, singleFit })
    }
    this.#applyBackground()
    this.#mountMode(anchor)
  }

  #applyBackground(): void {
    this.#ui?.applyBackground(this.settings.background)
  }

  // ---------- 章节 ----------

  #neighborChapter(delta: 1 | -1): Chapter | null {
    const chapters = this.#info?.chapters
    if (!chapters?.length) return null
    const idx = chapters.findIndex((c) => c.url === this.#chapterUrl)
    if (idx < 0) return null
    return chapters[idx + delta] ?? null
  }

  /** 切话：交给原站路由整页跳转（§7 D6），打标记返回后自动进入。 */
  navigateToChapter(chapter: Chapter): void {
    if (!this.#comic) return
    try {
      sessionStorage.setItem(RETURN_FLAG, '1')
    } catch {
      /* 无 sessionStorage 时退化为手动进入 */
    }
    this.#flushProgress()
    const url = this.#deps.adapter.buildReadUrl(this.#comic, chapter.url)
    this.exit()
    location.assign(url)
  }

  jumpToPage(page: number): void {
    this.#mode?.goTo(page)
  }

  step(dir: 1 | -1): void {
    this.#mode?.step(dir)
  }

  // ---------- 键盘（R-C6） ----------

  handleKey(e: KeyboardEvent): boolean {
    if (!this.#active) return false
    const rtl = this.settings.direction === 'rtl'
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft'
    switch (e.key) {
      case forward:
      case 'PageDown':
      case ' ':
        this.step(1)
        return true
      case backward:
      case 'PageUp':
        this.step(-1)
        return true
      case 'ArrowDown':
        this.step(1)
        return true
      case 'ArrowUp':
        this.step(-1)
        return true
      case 'Escape':
        if (this.#ui?.dismissTopPanel()) return true
        this.exit()
        return true
      case 'f':
      case 'F':
        void this.toggleFullscreen()
        return true
      default:
        return false
    }
  }

  // ---------- 全屏 / 常亮 ----------

  async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      this.#ui?.toast('当前环境不支持全屏')
    }
  }

  #releaseWakeLock(): void {
    void this.#wakeLock?.release().catch(() => {})
    this.#wakeLock = null
  }

  async requestWakeLock(): Promise<void> {
    if (!this.settings.keepAwake) return
    if (this.#wakeLock && !this.#wakeLock.released) return
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen')
      this.#wakeLock.addEventListener('release', () => {
        this.#wakeLock = null
      })
    } catch {
      /* 不支持时静默跳过（R-C11） */
    }
  }
}
