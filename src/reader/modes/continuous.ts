/**
 * 连续模式基类：纵向（R-K）与横向（R-J）共用。
 * 原生滚动 + 惯性，overscroll-behavior: contain；
 * 横向右→左用 CSS direction: rtl 排列，锚点一律基于 getBoundingClientRect
 * 计算相对位置再用 scrollBy 修正，不直接读写 scrollLeft（§4.4）。
 */
import { Cleanup } from '../../utils/cleanup'
import { GestureRecognizer } from '../gesture'
import type { ModeHost, ReaderMode } from '../mode-context'
import { PageWindow } from '../window'
import { outcomeAt } from '../tap-zones'

export interface ContinuousOptions {
  axis: 'y' | 'x'
  host: ModeHost
}

export abstract class ContinuousMode implements ReaderMode {
  protected host: ModeHost
  protected axis: 'y' | 'x'
  protected cleanup = new Cleanup()
  protected scroller!: HTMLDivElement
  protected content!: HTMLDivElement
  protected win!: PageWindow
  protected gesture!: GestureRecognizer
  #lastAnchor: { page: number; offset: number } | null = null

  constructor(options: ContinuousOptions) {
    this.host = options.host
    this.axis = options.axis
  }

  /** 子类附加内容（宽度设置、方向、边缘卡片等）。 */
  protected abstract decorate(): void

  /** 子类可在尺寸变化（横竖屏）时重算布局（如横向适配切换）。 */
  protected onViewportChange(): void {}

  /** 子类可在页面真实比例变化时重算布局。 */
  protected onPageRatioChange(): void {}

  /** 页内容盒（含占位尺寸）的定位坐标。 */
  protected rectOf(el: HTMLElement): DOMRect {
    return el.getBoundingClientRect()
  }

  mount(root: HTMLElement, anchor: { page: number; offset: number }): void {
    const s = this.host.settings
    this.scroller = document.createElement('div')
    this.scroller.className =
      this.axis === 'y' ? 'myr-scroll myr-scroll-v' : 'myr-scroll myr-scroll-h'
    if (this.axis === 'x' && s.direction === 'rtl') this.scroller.classList.add('myr-rtl')
    this.scroller.style.touchAction =
      this.axis === 'y' ? 'pan-y pinch-zoom' : 'pan-x pinch-zoom'
    this.content = document.createElement('div')
    this.content.className = this.axis === 'y' ? 'myr-strip-v' : 'myr-strip-h'
    this.scroller.appendChild(this.content)
    root.appendChild(this.scroller)

    this.win = new PageWindow(
      this.host.pages,
      { before: s.preload.before, after: s.preload.after },
      {
        onRatioChange: (page) => {
          this.onPageRatioChange()
          this.#compensateRatioChange(page)
        },
        onFatalError: () => {
          /* 失败 UI 由 PageWindow 生成 */
        },
        onReparseChapter: () => this.host.onReparseChapter(),
      },
    )
    this.win.appendTo(this.content)
    this.decorate()

    // 滚动 → 锚点 + 预加载（按真实可见范围，可见页永不卸载）
    let rafPending = false
    this.cleanup.addListener(this.scroller, 'scroll', () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        const a = this.computeAnchor()
        this.#lastAnchor = a
        this.win.update(a.page, this.#visibleRange())
        this.host.onPageChange(a.page)
        this.host.onAnchorChange(a)
      })
    })

    // 尺寸变化 → 先让子类重算布局（如横向适配切换），再按最近上报锚点恢复。
    // 守卫：安卓 Chrome 滑动时地址栏收展/双指缩放会触发 visualViewport 事件，
    // 高度抖动 <150px 或纯缩放（innerWidth 不变）不重排，避免与手势打架造成闪跳。
    let lastW = window.innerWidth
    let lastH = window.innerHeight
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 150) return
      lastW = w
      lastH = h
      this.onViewportChange()
      const a = this.#lastAnchor ?? this.getAnchor()
      this.goTo(a.page, a.offset)
      this.#lastAnchor = a
    }
    this.cleanup.addListener(window, 'resize', onResize)
    if (window.visualViewport) {
      this.cleanup.addListener(window.visualViewport, 'resize', onResize)
    }

    // 手势：点击区（可关闭）
    this.gesture = new GestureRecognizer({
      onTap: (x, y) => this.#handleTap(x, y),
    })
    const onPointer = (handler: (pe: PointerEvent) => void) => (e: Event) => handler(e as PointerEvent)
    this.cleanup.addListener(this.scroller, 'pointerdown', onPointer((e) => {
      this.gesture.pointerDown(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    }))
    this.cleanup.addListener(this.scroller, 'pointermove', onPointer((e) => {
      this.gesture.pointerMove(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    }))
    this.cleanup.addListener(this.scroller, 'pointerup', onPointer((e) => {
      this.gesture.pointerUp(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    }))
    this.cleanup.addListener(this.scroller, 'pointercancel', onPointer((e) => {
      this.gesture.pointerCancel(e.pointerId)
    }))
    // 阻断冒泡，避免原站挂在 document/window 的监听收到（§4.4 事件与路由）
    this.cleanup.addListener(this.scroller, 'touchstart', stopper, { passive: true })
    this.cleanup.addListener(this.scroller, 'touchmove', stopper, { passive: true })
    this.cleanup.addListener(this.scroller, 'touchend', stopper, { passive: true })
    this.cleanup.addListener(this.scroller, 'click', stopper)
    this.cleanup.addListener(this.scroller, 'contextmenu', stopper)

    // 首帧挂载后恢复锚点
    requestAnimationFrame(() => {
      this.goTo(anchor.page, anchor.offset)
      this.win.update(anchor.page, this.#visibleRange())
      this.host.onPageChange(anchor.page)
    })
  }

  /** 视口内实际可见的首页/末页（横屏一屏 3~4 页时的卸载判定依据）。 */
  #visibleRange(): { first: number; last: number } | undefined {
    if (!this.scroller || this.win.slots.length === 0) return undefined
    const s = this.scroller.getBoundingClientRect()
    let first = -1
    let last = -1
    for (const [i, slot] of this.win.slots.entries()) {
      const r = slot.getBoundingClientRect()
      // 两轴都相交才算可见（纵向模式所有页水平相交，必须同时判垂直）
      if (r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom) {
        if (first < 0) first = i
        last = i
      }
    }
    return first >= 0 ? { first, last } : undefined
  }

  #handleTap(x: number, y: number): void {
    if (this.host.settings.tapInContinuous !== true) {
      this.host.onMenu()
      return
    }
    if (this.host.isZoomed()) {
      // 放大状态：只保留中央菜单（R-G3）
      const rect = this.scroller.getBoundingClientRect()
      const zone = outcomeAt(x - rect.left, y - rect.top, rect.width, rect.height, {
        top: 'none', bottom: 'none', left: 'none', right: 'none',
      })
      if (zone === 'menu') this.host.onMenu()
      return
    }
    const rect = this.scroller.getBoundingClientRect()
    const outcome = outcomeAt(x - rect.left, y - rect.top, rect.width, rect.height, this.host.settings.tapZones)
    if (outcome === 'menu') this.host.onMenu()
    else if (outcome === 'next') this.step(1)
    else if (outcome === 'prev') this.step(-1)
  }

  /** 计算当前锚点（子类按轴实现）。 */
  abstract computeAnchor(): { page: number; offset: number }
  /** 滚动到指定锚点（子类按轴实现）。 */
  abstract goTo(page: number, offset?: number): void

  getAnchor(): { page: number; offset: number } {
    if (!this.scroller) return { page: 0, offset: 0 }
    return this.computeAnchor()
  }

  /** 前进/后退 90% 视口（R-J4、R-K4）。 */
  step(dir: 1 | -1): void {
    const rect = this.scroller.getBoundingClientRect()
    if (this.axis === 'y') {
      this.scroller.scrollBy({ top: dir * rect.height * 0.9, behavior: 'smooth' })
    } else {
      const forwardPositive = this.host.settings.direction !== 'rtl'
      const sign = forwardPositive ? dir : -dir
      this.scroller.scrollBy({ left: sign * rect.width * 0.9, behavior: 'smooth' })
    }
  }

  /**
   * 图片真实比例与占位不符时的滚动补偿（§4.4）：保持当前页参考线不动。
   */
  #compensateRatioChange(page: number): void {
    const a = this.computeAnchor()
    if (a.page !== page) {
      // 变化页在锚点之前才会影响布局：重新对齐当前锚点
      if (this.#isBefore(page, a.page)) {
        const before = this.#referenceOffsetFromViewport(a)
        requestAnimationFrame(() => {
          const after = this.#referenceOffsetFromViewport(this.computeAnchor())
          const delta = after - before
          if (Math.abs(delta) > 0.5) {
            // 内容整体位移 delta（视觉坐标）⇒ 视口同向滚动 delta 保持画面稳定
            if (this.axis === 'y') this.scroller.scrollTop += delta
            else this.scroller.scrollBy({ left: delta })
          }
        })
      }
    }
  }

  #isBefore(page: number, current: number): boolean {
    return page < current
  }

  /** 锚点参考线相对视口的偏移（px）。 */
  #referenceOffsetFromViewport(a: { page: number; offset: number }): number {
    const slot = this.win.slots[a.page]
    if (!slot) return 0
    const r = slot.getBoundingClientRect()
    if (this.axis === 'y') return r.top + r.height * a.offset
    return r.left + r.width * a.offset
  }

  unmount(): void {
    this.win?.unmount()
    this.gesture?.dispose()
    this.cleanup.run()
    this.scroller?.remove()
  }

  isZoomed(): boolean {
    return (window.visualViewport?.scale ?? 1) > 1.01
  }
}

function stopper(e: Event): void {
  e.stopPropagation()
}
