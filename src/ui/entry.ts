/**
 * 悬浮入口（R-C1）：阅读页显示可拖动按钮，点击进入增强阅读器。
 * 独立 Shadow DOM 宿主；位置持久化在设置中。
 */
import { STYLES } from './styles'
import type { EntryPosition } from '../store/settings'
import { clampEntryPosition, restoreEntryPosition, snapEntryPosition, type EntryViewport } from './entry-position'
import { icon } from './icons'

export interface FloatingEntryOptions {
  onTap(): void
  loadPosition(): EntryPosition | undefined
  savePosition(pos: EntryPosition): void
}

const DRAG_THRESHOLD_PX = 12

export class FloatingEntry {
  #host: HTMLElement
  #btn: HTMLButtonElement
  #opts: FloatingEntryOptions
  #position: EntryPosition = { x: 0, y: 0 }
  #visualViewport: VisualViewport | null = null
  #drag: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null
  #suppressClick = false

  constructor(opts: FloatingEntryOptions) {
    this.#opts = opts
    this.#host = document.createElement('div')
    this.#host.id = 'myr-entry-host'
    this.#host.style.cssText = 'position:fixed;width:52px;height:52px;z-index:2147483646;' +
      '--myr-safe-top:env(safe-area-inset-top,0px);--myr-safe-bottom:env(safe-area-inset-bottom,0px);' +
      '--myr-safe-left:env(safe-area-inset-left,0px);--myr-safe-right:env(safe-area-inset-right,0px);'
    const shadow = this.#host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLES
    shadow.append(style)
    this.#btn = document.createElement('button')
    this.#btn.className = 'myr-entry'
    this.#btn.type = 'button'
    this.#btn.setAttribute('aria-label', '打开增强阅读器')
    this.#btn.title = '增强阅读 · 拖动可调整位置'
    this.#btn.append(icon('book'))
    shadow.append(this.#btn)

    this.#btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.isPrimary === false || this.#drag) return
      this.#suppressClick = false
      this.#drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.#position.x, top: this.#position.y, moved: false }
      this.#btn.setPointerCapture(e.pointerId)
      e.stopPropagation()
    })
    this.#btn.addEventListener('pointermove', (e) => {
      const start = this.#drag
      if (!start || start.id !== e.pointerId) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) start.moved = true
      if (start.moved) {
        this.#btn.classList.add('myr-entry-dragging')
        this.#place(clampEntryPosition(start.left + dx, start.top + dy, this.#viewport()))
      }
      e.stopPropagation()
    })
    this.#btn.addEventListener('pointerup', (e) => this.#finishDrag(e, false))
    this.#btn.addEventListener('pointercancel', (e) => this.#finishDrag(e, true))
    this.#btn.addEventListener('click', (e) => {
      e.stopPropagation()
      // Native keyboard clicks have detail=0 and remain usable after a drag.
      const suppress = this.#suppressClick && e.detail !== 0
      this.#suppressClick = false
      if (!suppress) this.#opts.onTap()
    })
  }

  #viewport(): EntryViewport {
    const visual = window.visualViewport
    const style = getComputedStyle(this.#host)
    const inset = (edge: string) => Number.parseFloat(style.getPropertyValue(`--myr-safe-${edge}`)) || 0
    return {
      left: visual?.offsetLeft ?? 0,
      top: visual?.offsetTop ?? 0,
      width: visual?.width || window.innerWidth,
      height: visual?.height || window.innerHeight,
      safeTop: inset('top'), safeBottom: inset('bottom'), safeLeft: inset('left'), safeRight: inset('right'),
    }
  }

  #place(position: EntryPosition): void {
    this.#position = position
    this.#host.style.left = `${Math.round(position.x)}px`
    this.#host.style.top = `${Math.round(position.y)}px`
    if (position.side) this.#btn.dataset.side = position.side
  }

  #finishDrag(event: PointerEvent, cancelled: boolean): void {
    const drag = this.#drag
    if (!drag || drag.id !== event.pointerId) return
    this.#drag = null
    this.#suppressClick = cancelled || drag.moved
    this.#btn.classList.remove('myr-entry-dragging')
    if (drag.moved) {
      this.#place(snapEntryPosition(this.#position, this.#viewport()))
      this.#opts.savePosition({ ...this.#position })
    }
    if (this.#btn.hasPointerCapture(event.pointerId)) this.#btn.releasePointerCapture(event.pointerId)
    event.stopPropagation()
  }

  #onResize = (): void => {
    if (!this.#drag) this.#place(restoreEntryPosition(this.#position, this.#viewport()))
  }

  show(): void {
    if (this.#host.isConnected) return
    document.documentElement.appendChild(this.#host)
    this.#place(restoreEntryPosition(this.#opts.loadPosition(), this.#viewport()))
    window.addEventListener('resize', this.#onResize)
    this.#visualViewport = window.visualViewport
    this.#visualViewport?.addEventListener('resize', this.#onResize)
    this.#visualViewport?.addEventListener('scroll', this.#onResize)
  }

  hide(): void {
    if (!this.#host.isConnected) return
    window.removeEventListener('resize', this.#onResize)
    this.#visualViewport?.removeEventListener('resize', this.#onResize)
    this.#visualViewport?.removeEventListener('scroll', this.#onResize)
    this.#visualViewport = null
    this.#drag = null
    this.#btn.classList.remove('myr-entry-dragging')
    this.#host.remove()
  }
}
