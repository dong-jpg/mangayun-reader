/**
 * 阅读进度（R-P4、R-P6）：记录章节、页码与页内比例；
 * 滚动停止 500ms 后保存，页面隐藏/离开时立即保存；
 * 最多 500 部漫画，超出淘汰最久未读。
 */
import type { ComicRef } from '../site/types'
import { KEY_RECENT, comicKey, type ComicRecord } from './settings'
import type { KV } from './kv'

export const MAX_COMICS = 500
export const SAVE_DEBOUNCE_MS = 500

export interface ProgressAnchor {
  chapterUrl: string
  page: number
  offset: number
}

export class ProgressStore {
  #kv: KV
  #pending: { comic: ComicRef; anchor: ProgressAnchor } | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #listeners = new Set<() => void>()

  constructor(private kv: KV) {
    this.#kv = kv
  }

  onChanged(cb: () => void): () => void {
    this.#listeners.add(cb)
    return () => this.#listeners.delete(cb)
  }

  #notify(): void {
    for (const cb of [...this.#listeners]) cb()
  }

  /** 滚动变化时调用；500ms 防抖落盘。 */
  record(comic: ComicRef, anchor: ProgressAnchor): void {
    this.#pending = { comic, anchor }
    if (this.#timer != null) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.flush()
    }, SAVE_DEBOUNCE_MS)
  }

  /** 立即保存（页面隐藏、离开阅读器时）。 */
  flush(): void {
    if (this.#timer != null) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
    if (!this.#pending) return
    const { comic, anchor } = this.#pending
    this.#pending = null
    this.#saveAnchor(comic, anchor)
  }

  #saveAnchor(comic: ComicRef, anchor: ProgressAnchor): void {
    const key = comicKey(comic)
    const record: ComicRecord = this.#kv.get<ComicRecord>(key) ?? { ref: comic }
    if (record.ref.detailUrl !== comic.detailUrl) {
      // 哈希冲突（极小概率）：不覆盖他人数据
      return
    }
    record.ref = comic
    record.progress = { ...anchor, updatedAt: Date.now() }
    this.#kv.set(key, record)
    this.#touchRecent(key)
    this.#evict()
    this.#notify()
  }

  get(comic: ComicRef): (ProgressAnchor & { updatedAt: number }) | null {
    const record = this.#kv.get<ComicRecord>(comicKey(comic))
    if (!record?.progress) return null
    return record.progress
  }

  /** 更新标题等元数据（不触发淘汰重排）。 */
  updateMeta(comic: ComicRef, title: string): void {
    const key = comicKey(comic)
    const record: ComicRecord = this.#kv.get<ComicRecord>(key) ?? { ref: comic }
    if (record.ref.detailUrl !== comic.detailUrl) return
    record.ref = comic
    record.title = title
    this.#kv.set(key, record)
  }

  setOverrides(comic: ComicRef, overrides: ComicRecord['overrides']): void {
    const key = comicKey(comic)
    const record: ComicRecord = this.#kv.get<ComicRecord>(key) ?? { ref: comic }
    if (record.ref.detailUrl !== comic.detailUrl) return
    record.ref = comic
    record.overrides = overrides ?? undefined
    this.#kv.set(key, record)
  }

  #touchRecent(key: string): void {
    const recent = this.#kv.get<string[]>(KEY_RECENT) ?? []
    const next = [key, ...recent.filter((k) => k !== key)]
    this.#kv.set(KEY_RECENT, next)
  }

  /** R-P6：超过 500 部时淘汰最久未读。 */
  #evict(): void {
    const recent = this.#kv.get<string[]>(KEY_RECENT) ?? []
    if (recent.length <= MAX_COMICS) return
    const keep = recent.slice(0, MAX_COMICS)
    const drop = recent.slice(MAX_COMICS)
    for (const key of drop) this.#kv.delete(key)
    this.#kv.set(KEY_RECENT, keep)
  }

  recentCount(): number {
    return (this.#kv.get<string[]>(KEY_RECENT) ?? []).length
  }
}
