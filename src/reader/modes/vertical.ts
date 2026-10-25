/** 韩漫纵向连续模式（R-K）。 */
import { ContinuousMode } from './continuous'
import type { ModeHost } from '../mode-context'

export class VerticalMode extends ContinuousMode {
  constructor(host: ModeHost) {
    super({ axis: 'y', host })
  }

  protected decorate(): void {
    const width = this.host.settings.verticalWidth
    this.content.style.width = `${width}%`
    this.content.style.maxWidth = `${width}%`
    this.content.style.margin = '0 auto'
    this.appendEdgeCards()
  }

  private appendEdgeCards(): void {
    // 章首“上一话”、章尾“下一话”卡片（R-C12/R-K6），不自动拼接
    const start = this.makeEdgeCard('start', '上一话')
    const end = this.makeEdgeCard('end', '下一话')
    this.content.insertBefore(start, this.content.firstChild)
    this.content.appendChild(end)
  }

  private makeEdgeCard(edge: 'start' | 'end', label: string): HTMLElement {
    const card = document.createElement('div')
    card.className = 'myr-edge-card'
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

  /** 参考线 = 视口垂直中线所在页与页内比例（R-K3）。 */
  computeAnchor(): { page: number; offset: number } {
    const scrollerRect = this.scroller.getBoundingClientRect()
    const refY = scrollerRect.top + scrollerRect.height / 2
    let page = 0
    for (const [i, slot] of this.win.slots.entries()) {
      const r = slot.getBoundingClientRect()
      if (refY >= r.top && refY < r.bottom) {
        page = i
        break
      }
      if (r.top <= refY) page = i
    }
    const slot = this.win.slots[page]
    if (!slot) return { page: 0, offset: 0 }
    const r = slot.getBoundingClientRect()
    const offset = clamp01((refY - r.top) / Math.max(1, r.height))
    return { page, offset }
  }

  goTo(page: number, offset = 0): void {
    const slot = this.win.slots[clamp(page, 0, this.win.slots.length - 1)]
    if (!slot) return
    const scrollerRect = this.scroller.getBoundingClientRect()
    const r = slot.getBoundingClientRect()
    // 恢复到长图中部而不是页顶（R-K3）
    const targetRefY = r.top + r.height * clamp01(offset)
    const delta = targetRefY - (scrollerRect.top + scrollerRect.height / 2)
    this.scroller.scrollTop += delta
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
