/**
 * 悬浮入口（R-C1）：阅读页显示可拖动按钮，点击进入增强阅读器。
 * 独立 Shadow DOM 宿主；位置持久化在设置中。
 */
import { STYLES } from './styles'

export interface FloatingEntryOptions {
  onTap(): void
  loadPosition(): { x: number; y: number } | undefined
  savePosition(pos: { x: number; y: number }): void
}

const DRAG_THRESHOLD_PX = 12
const EDGE = 8

export class FloatingEntry {
  #host: HTMLElement
  #btn: HTMLButtonElement
  #opts: FloatingEntryOptions

  constructor(opts: FloatingEntryOptions) {
    this.#opts = opts
    this.#host = document.createElement('div')
    this.#host.style.cssText = 'position:fixed;z-index:2147483646;'
    const shadow = this.#host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLES
    shadow.append(style)
    this.#btn = document.createElement('button')
    this.#btn.className = 'myr-entry'
    this.#btn.type = 'button'
    this.#btn.textContent = '增强\n阅读'
    this.#btn.style.whiteSpace = 'pre'
    shadow.append(this.#btn)

    let start: { x: number; y: number; left: number; top: number } | null = null
    let dragged = false
    this.#btn.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, left: this.#host.offsetLeft, top: this.#host.offsetTop }
      dragged = false
      this.#btn.setPointerCapture(e.pointerId)
      e.stopPropagation()
    })
    this.#btn.addEventListener('pointermove', (e) => {
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) dragged = true
      if (dragged) this.#place(start.left + dx, start.top + dy)
      e.stopPropagation()
    })
    this.#btn.addEventListener('pointerup', (e) => {
      if (start && dragged) {
        this.#opts.savePosition(this.#normalize())
      } else if (start) {
        this.#opts.onTap()
      }
      start = null
      e.stopPropagation()
    })
    this.#btn.addEventListener('pointercancel', () => {
      start = null
    })
    this.#btn.addEventListener('click', (e) => e.stopPropagation())

    const saved = this.#opts.loadPosition()
    this.#place(saved?.x ?? window.innerWidth - 110, saved?.y ?? window.innerHeight * 0.55)
  }

  #place(x: number, y: number): void {
    const w = this.#btn.offsetWidth || 88
    const h = this.#btn.offsetHeight || 52
    const left = Math.min(window.innerWidth - w - EDGE, Math.max(EDGE, x))
    const top = Math.min(window.innerHeight - h - EDGE, Math.max(EDGE, y))
    this.#host.style.left = `${Math.round(left)}px`
    this.#host.style.top = `${Math.round(top)}px`
  }

  #normalize(): { x: number; y: number } {
    return { x: this.#host.offsetLeft, y: this.#host.offsetTop }
  }

  show(): void {
    if (!this.#host.isConnected) document.documentElement.appendChild(this.#host)
  }

  hide(): void {
    this.#host.remove()
  }
}
