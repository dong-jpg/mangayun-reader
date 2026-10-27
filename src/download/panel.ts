/**
 * 下载面板：范围选择（当前话/多话/整部，R-D1）→ 确认页（R-D2）→
 * 进度（R-D6）→ 未完成/失败清单（R-D8、R-D9）→ 保存（R-D12）。
 * comicbox 等不支持下载的来源在勾选阶段拦截（R-D15）。
 */
import type { Chapter, ComicInfo, ComicRef, SiteAdapter } from '../site/types'
import type { DownloadManager, DownloadProgress } from './manager'
import type { PackHandle } from './manager'
import { saveZip, type SaveResult } from './saver'
import { resumableTasks } from './task'
import type { KV } from '../store/kv'

export interface PanelDeps {
  manager: DownloadManager
  adapter: SiteAdapter
  kv: KV
  getComic(): { ref: ComicRef; info: ComicInfo | null; currentChapterUrl: string } | null
  toast(text: string): void
  openSheet(el: HTMLElement): void
  closeSheet(el: HTMLElement): void
}

type Scope = 'current' | 'select' | 'all'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  for (const child of children) {
    if (child == null) continue
    node.append(child instanceof Node ? child : document.createTextNode(child))
  }
  return node
}

function btn(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = el('button', `myr-btn${primary ? ' myr-btn-primary' : ''}`, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

const STATE_LABEL: Record<string, string> = {
  draft: '准备中',
  resolving: '解析章节',
  downloading: '下载中',
  paused: '已暂停',
  packing: '打包中',
  packed: '已打包',
  'handed-off': '已交给系统下载',
  incomplete: '未完成',
  cancelled: '已取消',
  failed: '失败',
}

export class DownloadPanel {
  #deps: PanelDeps
  #sheet: HTMLElement | null = null

  constructor(deps: PanelDeps) {
    this.#deps = deps
  }

  open(): void {
    this.#sheet?.remove()
    const comic = this.#deps.getComic()
    if (!comic) {
      this.#deps.toast('请先进入漫画阅读页')
      return
    }
    // R-D15：不支持下载的来源在勾选阶段拦截
    const support = this.#deps.adapter.supportOf(comic.ref.siteId)
    if (support !== 'full') {
      this.#showBlocked(comic.ref.siteId)
      return
    }
    const resumable = resumableTasks(this.#deps.kv)
    if (resumable.length > 0 && !this.#deps.manager.task) {
      this.#showResumePrompt(resumable[0]!)
      return
    }
    if (this.#deps.manager.task) {
      this.#showProgress()
      return
    }
    this.#showScopeSelection(comic.ref, comic.info, comic.currentChapterUrl)
  }

  close(): void {
    if (this.#sheet) this.#deps.closeSheet(this.#sheet)
    this.#sheet = null
  }

  #begin(): HTMLElement {
    const sheet = el('div', 'myr-sheet-wrap myr-sheet-bottom')
    const box = el('div', 'myr-sheet myr-sheet-tall')
    sheet.append(box)
    this.#sheet = sheet
    this.#deps.openSheet(sheet)
    return box
  }

  #showBlocked(siteId: string): void {
    const box = this.#begin()!
    box.append(
      el('div', 'myr-sheet-title', '此来源暂不支持下载'),
      el('div', 'myr-sheet-body', `来源 ${siteId} 的图片经过前端打乱还原，原始字节无法直接打包（首版限制）。阅读不受影响。`),
      el('div', 'myr-sheet-actions', btn('关闭', false, () => this.close())),
    )
  }

  #showResumePrompt(task: { id: string; title: string; state: string }): void {
    const box = this.#begin()!
    box.append(
      el('div', 'myr-sheet-title', '发现未完成的任务'),
      el('div', 'myr-sheet-body', `《${task.title}》（${STATE_LABEL[task.state] ?? task.state}）可以恢复：已下载的图片不会重复下载。`),
      el('div', 'myr-sheet-actions',
        btn('恢复任务', true, () => {
          this.close()
          void this.#deps.manager.resume(task.id).then((ok) => {
            if (ok) this.#showProgress()
            else this.#deps.toast('任务数据已失效')
          })
        }),
        btn('新建任务', false, () => {
          void this.#deps.manager.cleanup(true).then(() => {
            const comic = this.#deps.getComic()
            if (comic && this.#deps.adapter.supportOf(comic.ref.siteId) === 'full') {
              this.#showScopeSelection(comic.ref, comic.info, comic.currentChapterUrl)
            }
          })
        }),
      ),
    )
  }

  #showScopeSelection(ref: ComicRef, info: ComicInfo | null, currentChapterUrl: string): void {
    const box = this.#begin()!
    const chapters = info?.chapters ?? []
    const current = chapters.find((c) => c.url === currentChapterUrl) ?? null
    let scope: Scope = 'current'
    const selected = new Set<string>(current ? [current.url] : [])

    box.append(el('div', 'myr-sheet-title', '下载'))

    if (chapters.length === 0) {
      box.append(el('div', 'myr-sheet-body', '目录尚未加载完成，请稍后再试或先打开目录。'))
      box.append(el('div', 'myr-sheet-actions', btn('关闭', false, () => this.close())))
      return
    }

    const scopeRow = el('div', 'myr-dl-scope-row')
    const scopeBtns: Record<Scope, HTMLButtonElement> = {
      current: btn('当前话', false, () => pick('current')),
      select: btn('多话勾选', false, () => pick('select')),
      all: btn('整部', false, () => pick('all')),
    }
    const list = el('div', 'myr-dl-list')
    list.style.display = 'none'
    for (const chapter of [...chapters].reverse()) {
      const row = el('label', 'myr-dl-chapter')
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = selected.has(chapter.url)
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(chapter.url)
        else selected.delete(chapter.url)
        updateConfirm()
      })
      row.append(checkbox, el('span', undefined, chapter.name))
      list.append(row)
    }
    const pick = (next: Scope): void => {
      scope = next
      for (const [key, b] of Object.entries(scopeBtns)) b.classList.toggle('myr-seg-active', key === scope)
      list.style.display = scope === 'select' ? 'block' : 'none'
      updateConfirm()
    }
    for (const b of Object.values(scopeBtns)) scopeRow.append(b)
    // R-D2：来源、存储方式与容量提示
    const storageLine = el('div', 'myr-dl-status', '正在检测存储能力…')
    void this.#deps.manager
      .ensureCache()
      .then(async (cache) => {
        let quota = ''
        try {
          const est = await navigator.storage?.estimate?.()
          if (est?.quota) quota += `，站点配额约 ${formatBytes(est.quota)}`
        } catch {
          /* estimate 不可用 */
        }
        const cap = cache.capBytes ? `（上限 ${Math.round(cache.capBytes / 1024 / 1024)} MiB）` : ''
        const verified = this.#deps.adapter.supportOf(ref.siteId) === 'full'
        storageLine.textContent =
          `来源：${ref.siteId} · 存储：${cache.kind.toUpperCase()}${cap}，已用 ${formatBytes(cache.usedBytes())}${quota}` +
          (verified ? '' : '（未验证来源，报告中会标注）')
      })
      .catch(() => {
        storageLine.textContent = '存储能力检测失败，任务可能无法建立'
      })
    box.append(scopeRow, storageLine, list)

    const confirmBox = el('div', 'myr-dl-status')
    const actions = el('div', 'myr-sheet-actions')
    const startBtn = btn('确认下载', true, () => this.#start(ref, info, scope, selected, chapters))
    const closeBtn = btn('关闭', false, () => this.close())
    actions.append(startBtn, closeBtn)
    box.append(confirmBox, actions)

    const updateConfirm = (): void => {
      const count = scope === 'all' ? chapters.length : scope === 'current' ? (current ? 1 : 0) : selected.size
      confirmBox.textContent =
        scope === 'all'
          ? `将下载整部 ${chapters.length} 话（来源 ${ref.siteId}）`
          : scope === 'current'
            ? `将下载当前话${current ? `：${current.name}` : ''}（来源 ${ref.siteId}）`
            : `已选 ${count} 话（来源 ${ref.siteId}）`
      startBtn.disabled = count === 0
    }
    pick('current')
  }

  async #start(ref: ComicRef, info: ComicInfo | null, scope: Scope, selected: Set<string>, chapters: Chapter[]): Promise<void> {
    let targets: Chapter[]
    if (scope === 'all') targets = chapters
    else if (scope === 'select') targets = chapters.filter((c) => selected.has(c.url))
    else targets = chapters.filter((c) => selected.size <= 1 ? selected.has(c.url) : false)
    if (targets.length === 0) {
      const current = chapters.find((c) => selected.has(c.url))
      targets = current ? [current] : []
    }
    if (targets.length === 0) {
      this.#deps.toast('没有可下载的章节')
      return
    }
    // 按正序执行
    targets = [...targets].sort((a, b) => a.order - b.order)
    this.close()
    await this.#deps.manager.ensureCache()
    await this.#deps.manager.start(ref, info?.title ?? 'comic', targets)
    this.#showProgress()
  }

  #showProgress(): void {
    this.#sheet?.remove()
    const box = this.#begin()!
    const title = el('div', 'myr-sheet-title', '下载')
    const status = el('div', 'myr-dl-status')
    const barOuter = el('div', 'myr-dl-bar')
    const barInner = el('div')
    barOuter.append(barInner)
    const meta = el('div', 'myr-dl-meta')
    const failList = el('div', 'myr-dl-fail-list')
    failList.style.display = 'none'
    const actions = el('div', 'myr-sheet-actions')
    const closeBtn = btn('关闭', false, () => this.close())
    actions.append(closeBtn)
    box.append(title, status, barOuter, meta, failList, actions)

    const render = (p: DownloadProgress): void => {
      title.textContent = `下载《${p.title}》`
      const total = Math.max(1, p.totalPages)
      barInner.style.width = `${Math.round((p.cachedPages / total) * 100)}%`
      status.textContent = `${STATE_LABEL[p.state] ?? p.state}${p.note ? `：${p.note}` : ''}`
      meta.textContent = `${p.cachedPages + p.failedPages}/${p.totalPages} 页 · 失败 ${p.failedPages} · ${formatBytes(p.bytesPerSec)}/s · ${p.currentChapter ?? ''}`
      meta.title = `存储：${p.storage.toUpperCase()}${p.capBytes ? `（上限 ${Math.round(p.capBytes / 1024 / 1024)} MiB）` : ''}，已用 ${formatBytes(p.usedBytes)}`
      for (const b of [...actions.querySelectorAll('button')]) {
        if (b !== closeBtn) b.remove()
      }
      const insert = (...bs: HTMLButtonElement[]): void => {
        for (const b of bs) actions.insertBefore(b, closeBtn)
      }
      if (p.state === 'downloading' || p.state === 'resolving') {
        insert(btn('暂停', false, () => this.#deps.manager.pause()))
      } else if (p.state === 'paused') {
        if (p.note?.includes('另一个标签页')) {
          insert(btn('重新检查', true, () => this.#deps.manager.resumePaused()))
        } else {
          insert(
            btn('继续', true, () => this.#deps.manager.resumePaused()),
            btn('取消', false, () => void this.onCancelChoice()),
          )
          if (p.storage === 'memory' && p.cachedPages > 0 && p.note?.includes('上限')) {
            insert(btn('导出部分结果', false, () => void this.#packAndShow(true)))
          }
        }
      } else if (p.state === 'incomplete') {
        const failed = p.failedPages > 0
        failList.style.display = failed ? 'block' : 'none'
        if (failed) failList.textContent = `失败 ${p.failedPages} 页；可选择“只重试失败项”，或导出已有部分（文件名加 _partial）`
        insert(
          btn('只重试失败项', true, () => void this.#deps.manager.retryFailed()),
          btn('导出部分结果', false, () => void this.#packAndShow(true)),
          btn('取消任务', false, () => void this.onCancelChoice()),
        )
      } else if (p.state === 'packed') {
        insert(btn('保存 ZIP', true, () => this.#showSave()))
      } else if (p.state === 'failed') {
        insert(btn('重新解析并恢复', true, () => void this.#deps.manager.retryFailed()))
      }
    }

    const current = this.#deps.manager.task
    if (current) {
      // 立即渲染一次，再由回调驱动
      render(this.#lastProgress ?? {
        state: current.state,
        title: current.title,
        chapterCount: current.chapters.length,
        currentChapter: null,
        totalPages: 0,
        cachedPages: 0,
        failedPages: 0,
        bytesPerSec: 0,
        storage: current.storage,
        usedBytes: 0,
        capBytes: null,
        note: current.note ?? null,
      })
    }
    this.#progressListener = render
  }

  #lastProgress: DownloadProgress | null = null
  #progressListener: ((p: DownloadProgress) => void) | null = null

  /** 由 main 转发 manager 的进度回调。 */
  onProgress(p: DownloadProgress): void {
    this.#lastProgress = p
    this.#progressListener?.(p)
  }

  onPacked(handle: PackHandle): void {
    if (this.#sheet && this.#lastProgress?.state !== 'incomplete') this.#showSave(handle)
  }

  onCancelChoice(): void {
    const box = this.#begin()!
    box.append(
      el('div', 'myr-sheet-title', '取消下载？'),
      el('div', 'myr-sheet-body', '取消后已下载的缓存可以保留（下次可恢复），或立即清理。'),
      el('div', 'myr-sheet-actions',
        btn('取消并保留缓存', true, () => {
          this.#deps.manager.cancel()
          this.close()
        }),
        btn('取消并清理缓存', false, () => {
          this.#deps.manager.cancel()
          void this.#deps.manager.cleanup()
          this.close()
        }),
        btn('返回', false, () => this.close()),
      ),
    )
  }

  #showSave(handle?: PackHandle): void {
    const pack = handle ?? this.#deps.manager.packHandle
    if (!pack) return
    this.#sheet?.remove()
    const box = this.#begin()!
    const status = el('div', 'myr-dl-status', `ZIP 已生成（${formatBytes(pack.byteLength)}，${pack.report.result === 'partial' ? '部分结果' : '完整'}）`)
    const resultLine = el('div', 'myr-dl-status', '等待保存…')
    box.append(
      el('div', 'myr-sheet-title', '保存'),
      status,
      el('div', 'myr-dl-meta', `文件名：${pack.fileName}`),
      resultLine,
      el('div', 'myr-sheet-actions',
        btn('保存 ZIP', true, async () => {
          const source = pack.file ?? pack.blob!
          const result: SaveResult = await saveZip(source, pack.fileName)
          resultLine.textContent =
            result.status === 'saved' ? '已保存' : result.status === 'handed-off' ? '已交给系统下载，请在系统下载记录确认' : `保存失败：${result.detail ?? ''}`
          if (result.status !== 'failed') this.#deps.manager.markHandedOff()
        }),
        btn('重新打包', false, () => void this.#packAndShow(pack.report.result === 'partial')),
        btn('清理任务', false, () => {
          void this.#deps.manager.cleanup()
          this.close()
        }),
      ),
    )
  }

  async #packAndShow(partial: boolean): Promise<void> {
    try {
      await this.#deps.manager.pack(partial)
      this.#showSave()
    } catch (error) {
      this.#deps.toast(`打包失败：${error instanceof Error ? error.message : String(error)}`)
      this.#showProgress()
    }
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
