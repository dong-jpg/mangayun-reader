/** 阅读模式宿主接口：模式只依赖此接口，不触碰站点与 UI 细节（§4.3）。 */
import type { ReadingAnchor } from '../site/types'
import type { Settings } from '../store/settings'

export interface ModeHost {
  settings: Settings
  pages: string[]
  /** 锚点变化（页码 + 页内比例）；由宿主负责节流保存。 */
  onAnchorChange(anchor: Omit<ReadingAnchor, 'chapterUrl'>): void
  /** 当前页变化（页码显示、预加载）。 */
  onPageChange(page: number): void
  /** 点击区动作被消费后仍需要宿主处理的部分（菜单、切话）。 */
  onMenu(): void
  /** 章首/章尾切换卡片被点击（不直接跳转，由宿主确认）。 */
  onChapterEdge(edge: 'start' | 'end'): void
  /** “重新解析本话”。 */
  onReparseChapter(): void
  /** 供模式读取当前缩放状态（连续模式 visualViewport，单页自管）。 */
  isZoomed(): boolean
}

/** 方案 §4.3 的 ReaderMode 接口。 */
export interface ReaderMode {
  mount(root: HTMLElement, anchor: Omit<ReadingAnchor, 'chapterUrl'>): void
  getAnchor(): Omit<ReadingAnchor, 'chapterUrl'>
  goTo(page: number, offset?: number): void
  /** 单页翻一页；连续模式滚动约 90% 视口。dir=1 为前进。 */
  step(dir: 1 | -1): void
  /** 是否处于放大状态（缩放防误触判定）。 */
  isZoomed?(): boolean
  unmount(): void
}
