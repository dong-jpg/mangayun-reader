/**
 * 预加载窗口（R-C4）：当前页之前 1 页、之后 3 页（可设置）。
 * 窗口内设置 src；窗口外释放 src、保留占位尺寸。
 * 单页自动重试 2 次（R-C5），仍失败显示“重试 / 重新解析本话”。
 */
export const DEFAULT_RATIO = 0.75 // 3:4（宽/高），§4.4 第 1 页占位

export interface PageWindowConfig {
  before: number
  after: number
}

export interface PageWindowCallbacks {
  /** 图片真实宽高比已知/变化（锚点补偿用）。 */
  onRatioChange?(page: number, ratio: number): void
  /** 单页最终加载失败。 */
  onFatalError?(page: number): void
  /** 点击“重新解析本话”。 */
  onReparseChapter?(): void
}

const AUTO_RETRY_LIMIT = 2
const AUTO_RETRY_DELAY_MS = 1000

export class PageWindow {
  readonly slots: HTMLDivElement[] = []
  readonly imgs: HTMLImageElement[] = []
  #pages: string[]
  #config: PageWindowConfig
  #cb: PageWindowCallbacks
  #ratios: number[]
  #inWindow = new Set<number>()
  #retryCount = new Map<number, number>()
  #failed = new Set<number>()
  #retryTimers = new Map<number, ReturnType<typeof setTimeout>>()
  /** 已加载出真实比例的页；前几张一致时把占位比例统一为真实比例（消除加载完成时的尺寸跳变）。 */
  #realRatios = new Set<number>()
  #loadedRatios: number[] = []
  #commonRatio: number | null = null

  constructor(pages: string[], config: PageWindowConfig, cb: PageWindowCallbacks = {}) {
    this.#pages = pages
    this.#config = config
    this.#cb = cb
    this.#ratios = pages.map(() => DEFAULT_RATIO)
    for (let i = 0; i < pages.length; i++) {
      const slot = document.createElement('div')
      slot.className = 'myr-page'
      slot.style.aspectRatio = `${DEFAULT_RATIO}`
      const img = document.createElement('img')
      img.alt = ''
      img.decoding = 'async'
      img.referrerPolicy = 'no-referrer'
      img.loading = 'eager'
      // 桌面鼠标按住拖动翻页：禁掉图片原生拖拽（否则 pointermove 被拖放协议吞掉）
      img.draggable = false
      slot.appendChild(img)
      this.slots.push(slot)
      this.imgs.push(img)
      this.#wireImage(i)
    }
  }

  #wireImage(page: number): void {
    const img = this.imgs[page]!
    img.addEventListener('load', () => {
      this.slots[page]?.classList.remove('myr-page-error')
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        const ratio = img.naturalWidth / img.naturalHeight
        this.#realRatios.add(page)
        if (this.#commonRatio == null) {
          this.#loadedRatios.push(ratio)
          this.#maybeAdoptCommonRatio()
        }
        if (Math.abs(ratio - this.#ratios[page]!) > 0.001) {
          this.#ratios[page] = ratio
          this.slots[page]?.style.setProperty('aspect-ratio', `${ratio}`)
          this.#cb.onRatioChange?.(page, ratio)
        }
      }
    })
    img.addEventListener('error', () => this.#onError(page))
  }

  /** 前 2 张已加载且比例一致（±5%）→ 未加载页的占位比例改为该值，减少加载后的布局跳变。 */
  #maybeAdoptCommonRatio(): void {
    const loaded = this.#loadedRatios
    if (loaded.length < 2 || this.#commonRatio != null) return
    const [a, b] = loaded
    if (a == null || b == null) return
    if (Math.abs(a - b) / Math.max(a, b) > 0.05) return
    const common = (a + b) / 2
    this.#commonRatio = common
    for (const [i, slot] of this.slots.entries()) {
      if (this.#realRatios.has(i)) continue
      this.#ratios[i] = common
      slot.style.setProperty('aspect-ratio', `${common}`)
      this.#cb.onRatioChange?.(i, common)
    }
  }

  #onError(page: number): void {
    const attempts = this.#retryCount.get(page) ?? 0
    if (attempts < AUTO_RETRY_LIMIT) {
      this.#retryCount.set(page, attempts + 1)
      const timer = setTimeout(() => {
        this.#retryTimers.delete(page)
        this.#load(page)
      }, AUTO_RETRY_DELAY_MS * (attempts + 1))
      this.#retryTimers.set(page, timer)
      return
    }
    this.#failed.add(page)
    const slot = this.slots[page]
    if (slot && !slot.querySelector('.myr-page-retry')) {
      const overlay = document.createElement('div')
      overlay.className = 'myr-page-retry'
      const retryBtn = document.createElement('button')
      retryBtn.type = 'button'
      retryBtn.textContent = '重试'
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        overlay.remove()
        this.retry(page)
      })
      const reparseBtn = document.createElement('button')
      reparseBtn.type = 'button'
      reparseBtn.textContent = '重新解析本话'
      reparseBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.#cb.onReparseChapter?.()
      })
      overlay.append(retryBtn, reparseBtn)
      slot.appendChild(overlay)
    }
    slot?.classList.add('myr-page-error')
    this.#cb.onFatalError?.(page)
  }

  appendTo(container: HTMLElement): void {
    const frag = document.createDocumentFragment()
    for (const slot of this.slots) frag.appendChild(slot)
    container.appendChild(frag)
  }

  get pages(): string[] {
    return this.#pages
  }

  ratioOf(page: number): number {
    return this.#ratios[page] ?? DEFAULT_RATIO
  }

  setConfig(config: PageWindowConfig): void {
    this.#config = config
  }

  /**
   * 按锚点页与可见范围更新预加载窗口；窗口外的释放 src、保留占位尺寸。
   * visible 为当前视口内实际可见的首页/末页（横屏一屏可见 3~4 页）：
   * 窗口 = [min(可见首, 当前)-before, max(可见末, 当前)+after]，
   * 可见页永不因参考线翻页被卸载（否则露出一角的页会闪白）。
   */
  update(current: number, visible?: { first: number; last: number }): void {
    const before = this.#config.before
    const after = this.#config.after
    const lo = Math.min(visible ? visible.first : current, current) - before
    const hi = Math.max(visible ? visible.last : current, current) + after
    const next = new Set<number>()
    for (let i = Math.max(0, lo); i <= Math.min(this.#pages.length - 1, hi); i++) next.add(i)
    for (const i of this.#inWindow) {
      if (!next.has(i) && !this.#failed.has(i)) this.#unload(i)
    }
    for (const i of next) {
      if (!this.#inWindow.has(i)) this.#load(i)
    }
    this.#inWindow = next
    // 当前页高优先级
    for (const [i, img] of this.imgs.entries()) {
      if (i === current) img.setAttribute('fetchpriority', 'high')
      else img.removeAttribute('fetchpriority')
    }
  }

  /** 当前持有图片的元素数量（验收：不超过窗口大小 + 2）。 */
  loadedCount(): number {
    let n = 0
    for (const img of this.imgs) if (img.getAttribute('src')) n++
    return n
  }

  #load(page: number): void {
    const url = this.#pages[page]
    const img = this.imgs[page]
    if (!url || !img) return
    this.slots[page]?.classList.remove('myr-page-error')
    this.#failed.delete(page)
    if (img.getAttribute('src') !== url) img.src = url
  }

  #unload(page: number): void {
    const img = this.imgs[page]
    if (!img) return
    img.removeAttribute('src')
    img.removeAttribute('fetchpriority')
  }

  /** 手动重试失败页。 */
  retry(page: number): void {
    const timer = this.#retryTimers.get(page)
    if (timer) {
      clearTimeout(timer)
      this.#retryTimers.delete(page)
    }
    this.#retryCount.delete(page)
    this.#load(page)
    this.#inWindow.add(page)
  }

  unmount(): void {
    for (const timer of this.#retryTimers.values()) clearTimeout(timer)
    this.#retryTimers.clear()
    for (const img of this.imgs) img.removeAttribute('src')
  }
}
