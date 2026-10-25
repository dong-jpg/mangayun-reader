/**
 * 日漫横向连续模式（R-J）。右→左用 direction: rtl 排列；
 * 锚点基于 rect + scrollBy，不直接读写 scrollLeft（§4.4）。
 * scrollBy 的 left 增量在 LTR 与 RTL 下都表示“视口向右移动”（Chromium：
 * RTL 时 scrollLeft 取值区间为 [-(sw-cw), 0]，增大即向右）。
 *
 * 页面适配（参考 Mihon 的 Fit screen/height）：
 * - height：按阅读区高度适配、零间隙（R-J1，适合横屏）
 * - screen：整页可见、页间留隙、垂直居中（适合竖屏手机看日漫）
 * 由设置 horizontalFit 决定，auto 按朝向自动选择。
 */
import { ContinuousMode } from './continuous'
import type { ModeHost } from '../mode-context'

export class HorizontalMode extends ContinuousMode {
  #fit: 'height' | 'screen' = 'height'

  constructor(host: ModeHost) {
    super({ axis: 'x', host })
  }

  /** 页间空隙（适应屏幕适配）：设置“页间留隙”关闭后为 0（零间隙）。 */
  #gap(): number {
    return this.host.settings.horizontalGap === false ? 0 : 12
  }

  /** 生效适配：auto = 竖屏 screen（整页可见），横屏 height（无缝连续）。 */
  #resolveFit(): 'height' | 'screen' {
    const setting = this.host.settings.horizontalFit ?? 'auto'
    if (setting === 'height' || setting === 'screen') return setting
    const rect = this.scroller.getBoundingClientRect()
    return rect.height > rect.width ? 'screen' : 'height'
  }

  /** 按当前适配给页面定尺寸（screen 用包含式显式尺寸）。 */
  #applyLayout(): void {
    if (!this.scroller) return
    this.#fit = this.#resolveFit()
    this.scroller.classList.toggle('myr-h-screen', this.#fit === 'screen')
    const gap = this.#gap()
    this.scroller.style.setProperty('--myr-h-gap', `${gap}px`)
    const rect = this.scroller.getBoundingClientRect()
    for (const [i, slot] of this.win.slots.entries()) {
      if (this.#fit === 'screen') {
        const ratio = this.win.ratioOf(i) // 宽/高
        const viewRatio = rect.width / Math.max(1, rect.height)
        let w: number
        let h: number
        if (ratio >= viewRatio) {
          w = rect.width - gap
          h = w / ratio
        } else {
          h = rect.height - gap
          w = h * ratio
        }
        slot.style.width = `${Math.max(40, w)}px`
        slot.style.height = `${Math.max(40, h)}px`
      } else {
        slot.style.width = ''
        slot.style.height = ''
      }
    }
  }

  /** 基类在尺寸变化（横竖屏）时回调：先重算适配再恢复锚点。 */
  protected override onViewportChange(): void {
    this.#applyLayout()
  }

  /** 页面真实比例已知/变化（占位 → 实测）：screen 适配需重定尺寸。 */
  protected override onPageRatioChange(): void {
    this.#applyLayout()
  }

  protected decorate(): void {
    const start = this.makeEdgeCard('start', '上一话')
    const end = this.makeEdgeCard('end', '下一话')
    this.content.insertBefore(start, this.content.firstChild)
    this.content.appendChild(end)
  }

  private makeEdgeCard(edge: 'start' | 'end', label: string): HTMLElement {
    const card = document.createElement('div')
    card.className = 'myr-edge-card myr-edge-card-h'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = label
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.host.onChapterEdge(edge)
    })
    card.appendChild(btn)
    return card
  }

  /** 参考线 = 视口水平中线所在页与页内比例。 */
  computeAnchor(): { page: number; offset: number } {
    const scrollerRect = this.scroller.getBoundingClientRect()
    const refX = scrollerRect.left + scrollerRect.width / 2
    let page = 0
    for (const [i, slot] of this.win.slots.entries()) {
      const r = slot.getBoundingClientRect()
      if (refX >= r.left && refX < r.right) {
        page = i
        break
      }
      if (r.left <= refX) page = i
    }
    const slot = this.win.slots[page]
    if (!slot) return { page: 0, offset: 0 }
    const r = slot.getBoundingClientRect()
    const offset = clamp01((refX - r.left) / Math.max(1, r.width))
    return { page, offset }
  }

  goTo(page: number, offset = 0): void {
    if (!this.scroller) return
    this.#applyLayout()
    const slot = this.win.slots[clamp(page, 0, this.win.slots.length - 1)]
    if (!slot) return
    const scrollerRect = this.scroller.getBoundingClientRect()
    const r = slot.getBoundingClientRect()
    const rtl = this.host.settings.direction === 'rtl'
    // 页内比例沿阅读方向；宽图 offset 覆盖整页宽度。
    // scrollBy 在 LTR 与 RTL 下 +d 都表示视口向右（实测 scrollLeft∈[-max,0]），
    // 内容 rect.left 需要变化 (desired - current) ⇒ 视口反向滚动 (current - desired)。
    const desiredLeftInViewport = rtl
      ? scrollerRect.right - r.width + (1 - clamp01(offset)) * Math.max(0, r.width - scrollerRect.width)
      : scrollerRect.left - clamp01(offset) * Math.max(0, r.width - scrollerRect.width)
    this.scroller.scrollBy({ left: r.left - desiredLeftInViewport })
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
