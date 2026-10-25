/**
 * 日漫横向连续模式（R-J）。右→左用 direction: rtl 排列；
 * 锚点基于 rect + scrollBy，不直接读写 scrollLeft（§4.4）。
 * scrollBy 的 left 增量在 LTR 与 RTL 下都表示“视口向右移动”（Chromium：
 * RTL 时 scrollLeft 取值区间为 [-(sw-cw), 0]，增大即向右）。
 */
import { ContinuousMode } from './continuous'
import type { ModeHost } from '../mode-context'

export class HorizontalMode extends ContinuousMode {
  constructor(host: ModeHost) {
    super({ axis: 'x', host })
  }

  protected decorate(): void {
    // 图片按阅读区高度适配、保持比例、零间隙（R-J1、R-J6）
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
