/**
 * 普通单页模式（R-S）：一次一页，四种适应方式；
 * 点击区四区可配置、中央菜单；水平滑动翻页（方向跟随阅读方向）；
 * 双指缩放与拖动由脚本实现（touch-action: none），放大时拖动只平移、
 * 边缘点击区暂停（R-S6、R-G3）。翻过章首/章尾交给宿主显示切话卡片（R-S7）。
 */
import { Cleanup } from '../../utils/cleanup'
import { GestureRecognizer } from '../gesture'
import type { ModeHost, ReaderMode } from '../mode-context'
import { PageWindow } from '../window'
import { outcomeAt } from '../tap-zones'

const MAX_SCALE = 4

export class SingleMode implements ReaderMode {
  #host: ModeHost
  #cleanup = new Cleanup()
  #stage!: HTMLDivElement
  #viewport!: HTMLDivElement
  #win!: PageWindow
  #gesture!: GestureRecognizer
  #page = 0
  #scale = 1
  #tx = 0
  #ty = 0
  #pointers = new Map<number, { x: number; y: number }>()
  #pinchStart: { dist: number; scale: number; mx: number; my: number } | null = null
  #mouseDrag: { x: number; y: number; moved: boolean } | null = null
  #dragStart: { x: number; y: number; t: number } | null = null
  #dragTranslate: number | null = null
  #lastWheelAt = 0
  #wheelAccum = 0

  constructor(host: ModeHost) {
    this.#host = host
  }

  mount(root: HTMLElement, anchor: { page: number; offset: number }): void {
    const s = this.#host.settings
    this.#stage = document.createElement('div')
    this.#stage.className = `myr-single myr-fit-${s.singleFit}`
    this.#stage.style.touchAction = 'none'
    this.#viewport = document.createElement('div')
    this.#viewport.className = 'myr-single-viewport'
    this.#stage.appendChild(this.#viewport)
    root.appendChild(this.#stage)

    this.#win = new PageWindow(
      this.#host.pages,
      { before: s.preload.before, after: s.preload.after },
      {
        onRatioChange: () => this.#applyTransform(),
        onReparseChapter: () => this.#host.onReparseChapter(),
      },
    )
    this.#win.appendTo(this.#viewport)

    this.#gesture = new GestureRecognizer(
      {
        onTap: (x, y) => this.#handleTap(x, y),
        onSwipe: (dir) => this.#handleSwipe(dir),
        onPan: (dx, dy) => this.#pan(dx, dy),
      },
      { viewportWidth: this.#stage.getBoundingClientRect().width || 400 },
    )

    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
      this.#cleanup.addListener(this.#stage, type, (e: Event) => {
        this.#trackPointer(type, e as PointerEvent)
      })
    }
    // 桌面鼠标按住拖动（非放大态拖出阈值→翻页判定，放大态→平移，与触摸一致）
    this.#cleanup.addListener(this.#stage, 'pointerdown', (e: Event) => {
      const pe = e as PointerEvent
      if (pe.pointerType !== 'mouse' || pe.button !== 0) return
      this.#mouseDrag = { x: pe.clientX, y: pe.clientY, moved: false }
      this.#dragStart = { x: pe.clientX, y: pe.clientY, t: pe.timeStamp }
    })
    this.#cleanup.addListener(this.#stage, 'pointermove', (e: Event) => {
      const pe = e as PointerEvent
      if (pe.pointerType !== 'mouse' || !this.#mouseDrag) return
      const dx = pe.clientX - this.#mouseDrag.x
      const dy = pe.clientY - this.#mouseDrag.y
      this.#mouseDrag = { x: pe.clientX, y: pe.clientY, moved: true }
      if (this.isZoomed()) {
        this.#pan(dx, dy)
      } else if (Math.hypot(pe.clientX - (this.#dragStart?.x ?? pe.clientX), pe.clientY - (this.#dragStart?.y ?? pe.clientY)) >= 10) {
        // 非放大态：视觉跟手（临时 translate），释放时按滑动规则判定翻页
        this.#dragTranslate = (this.#dragTranslate ?? 0) + dx
        this.#applyDragTranslate()
      }
    })
    const endMouseDrag = (e: Event) => {
      const pe = e as PointerEvent
      if (pe.pointerType !== 'mouse' || !this.#mouseDrag) return
      this.#mouseDrag = null
      this.#dragTranslate = null
      if (this.#dragStart) {
        const totalDx = pe.clientX - this.#dragStart.x
        const totalDy = pe.clientY - this.#dragStart.y
        const dur = Math.max(1, pe.timeStamp - this.#dragStart.t)
        const velocity = Math.hypot(totalDx, totalDy) / dur
        this.#dragStart = null
        if (!this.isZoomed()) {
          const ax = Math.abs(totalDx)
          const ay = Math.abs(totalDy)
          if (ax > ay * 1.5 && (ax >= this.#stage.getBoundingClientRect().width * 0.15 || velocity >= 0.5)) {
            this.#applyDragTranslate(0)
            this.#handleSwipe(totalDx < 0 ? 'left' : 'right')
            return
          }
        }
      }
      this.#applyDragTranslate(0)
    }
    this.#cleanup.addListener(this.#stage, 'pointerup', endMouseDrag)
    this.#cleanup.addListener(this.#stage, 'pointercancel', endMouseDrag)
    // 桌面滚轮：整页步进。滚轮一格（离散事件）翻一页；触控板高频流按像素累积折算
    this.#cleanup.addListener(this.#stage, 'wheel', (e: Event) => {
      const we = e as WheelEvent
      if (we.ctrlKey) return
      if (we.deltaX !== 0 && we.deltaY === 0) {
        // 触控板横滑：直接翻页（跟滑动同规则）
        e.preventDefault()
        this.step(we.deltaX < 0 ? (this.#host.settings.direction === 'rtl' ? -1 : 1) : (this.#host.settings.direction === 'rtl' ? 1 : -1))
        return
      }
      e.preventDefault()
      const dir = we.deltaY > 0 ? 1 : -1
      const now = we.timeStamp
      if (now - this.#lastWheelAt > 80) this.#wheelAccum = 0 // 新的一格
      this.#lastWheelAt = now
      this.#wheelAccum += Math.abs(we.deltaY)
      if (this.#wheelAccum >= 40) {
        const n = Math.min(3, Math.floor(this.#wheelAccum / 40))
        this.#wheelAccum -= n * 40
        for (let i = 0; i < n; i++) this.step(dir)
      }
    }, { passive: false })
    this.#cleanup.addListener(this.#stage, 'click', (e) => e.stopPropagation())
    this.#cleanup.addListener(this.#stage, 'contextmenu', (e) => e.stopPropagation())

    const onResize = () => {
      this.#gesture.updateThresholds({ viewportWidth: this.#stage.getBoundingClientRect().width || 400 })
      this.#clampTransform()
      this.#applyTransform()
    }
    this.#cleanup.addListener(window, 'resize', onResize)

    this.#showPage(anchor.page, false)
  }

  #trackPointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', e: PointerEvent): void {
    if (type === 'pointerdown') {
      this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      this.#gesture.pointerDown(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    } else if (type === 'pointermove') {
      if (this.#pointers.has(e.pointerId)) {
        this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        this.#pinch()
      }
      this.#gesture.pointerMove(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    } else if (type === 'pointerup') {
      this.#pointers.delete(e.pointerId)
      this.#pinchStart = null
      this.#gesture.pointerUp(e.pointerId, e.clientX, e.clientY, e.timeStamp)
    } else {
      this.#pointers.delete(e.pointerId)
      this.#pinchStart = null
      this.#gesture.pointerCancel(e.pointerId)
    }
  }

  /** 双指捏合缩放（transform-origin 0 0，围绕中点）。 */
  #pinch(): void {
    if (this.#pointers.size !== 2) return
    const [a, b] = [...this.#pointers.values()]
    if (!a || !b) return
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    if (!this.#pinchStart) {
      this.#pinchStart = { dist, scale: this.#scale, mx, my }
      return
    }
    const start = this.#pinchStart
    const nextScale = Math.min(MAX_SCALE, Math.max(1, start.scale * (dist / Math.max(1, start.dist))))
    const ratio = nextScale / this.#scale
    const rect = this.#stage.getBoundingClientRect()
    const cx = mx - rect.left
    const cy = my - rect.top
    this.#tx = cx - (cx - this.#tx) * ratio
    this.#ty = cy - (cy - this.#ty) * ratio
    this.#scale = nextScale
    this.#clampTransform()
    this.#applyTransform()
  }

  #pan(dx: number, dy: number): void {
    if (this.#scale <= 1.01) return
    this.#tx += dx
    this.#ty += dy
    this.#clampTransform()
    this.#applyTransform()
  }

  #clampTransform(): void {
    const rect = this.#stage.getBoundingClientRect()
    const img = this.#win.imgs[this.#page]
    if (!img || !rect.width) return
    const w = img.clientWidth * this.#scale || rect.width * this.#scale
    const h = img.clientHeight * this.#scale || rect.height * this.#scale
    if (w <= rect.width) this.#tx = (rect.width - w) / 2
    else this.#tx = Math.min(0, Math.max(rect.width - w, this.#tx))
    if (h <= rect.height) this.#ty = (rect.height - h) / 2
    else this.#ty = Math.min(0, Math.max(rect.height - h, this.#ty))
  }

  #applyTransform(): void {
    this.#viewport.style.transform = `translate(${this.#tx}px, ${this.#ty}px) scale(${this.#scale})`
    if (this.#scale <= 1.01) this.#viewport.classList.remove('myr-zoomed')
    else this.#viewport.classList.add('myr-zoomed')
  }

  /** 鼠标拖动跟手位移（非放大态的临时视觉反馈，释放后归零）。 */
  #applyDragTranslate(px = this.#dragTranslate ?? 0): void {
    this.#viewport.style.translate = px !== 0 ? `${px}px` : ''
  }

  #handleTap(x: number, y: number): void {
    const rect = this.#stage.getBoundingClientRect()
    const zoomed = this.isZoomed()
    const outcome = outcomeAt(x - rect.left, y - rect.top, rect.width, rect.height, this.#host.settings.tapZones)
    if (zoomed && outcome !== 'menu') return // R-G3
    if (outcome === 'menu') this.#host.onMenu()
    else if (outcome === 'next') this.step(1)
    else if (outcome === 'prev') this.step(-1)
  }

  /** 滑动方向跟随阅读方向（R-S6）。 */
  #handleSwipe(dir: 'left' | 'right'): void {
    if (this.isZoomed()) return
    const forwardSwipe = this.#host.settings.direction === 'rtl' ? 'right' : 'left'
    this.step(dir === forwardSwipe ? 1 : -1)
  }

  #showPage(page: number, notify = true): void {
    const max = this.#host.pages.length - 1
    const clamped = Math.min(max, Math.max(0, page))
    this.#page = clamped
    for (const [i, slot] of this.#win.slots.entries()) {
      slot.classList.toggle('myr-active', i === clamped)
    }
    this.#resetZoom()
    this.#win.update(clamped)
    if (notify) {
      this.#host.onPageChange(clamped)
      this.#host.onAnchorChange({ page: clamped, offset: 0 })
    }
  }

  #resetZoom(): void {
    this.#scale = 1
    this.#tx = 0
    this.#ty = 0
    this.#applyTransform()
  }

  isZoomed(): boolean {
    return this.#scale > 1.01
  }

  computeAnchor(): { page: number; offset: number } {
    return { page: this.#page, offset: 0 }
  }

  getAnchor(): { page: number; offset: number } {
    return { page: this.#page, offset: 0 }
  }

  goTo(page: number, _offset?: number): void {
    this.#showPage(page)
  }

  step(dir: 1 | -1): void {
    const next = this.#page + dir
    if (next < 0) {
      this.#host.onChapterEdge('start')
      return
    }
    if (next > this.#host.pages.length - 1) {
      this.#host.onChapterEdge('end')
      return
    }
    this.#showPage(next)
  }

  unmount(): void {
    this.#win?.unmount()
    this.#gesture?.dispose()
    this.#cleanup.run()
    this.#stage?.remove()
  }
}
