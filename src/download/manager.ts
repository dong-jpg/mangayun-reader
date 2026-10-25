/**
 * 下载编排：章节解析串行、图片并发受限、缓存先行、限流退避、
 * 部分导出、任务恢复（R-D13）、Web Locks 单标签页（R-D14）。
 */
import type { Chapter, ComicRef, SiteAdapter } from '../site/types'
import type { SettingsStore } from '../store/settings'
import type { KV } from '../store/kv'
import { MemoryCapError, openBestCache, type ImageCache } from './cache'
import { fetchImage, type FetchedImage } from './fetcher'
import { Scheduler, type JobOutcome } from './scheduler'
import {
  type DownloadTaskData,
  deleteTask,
  loadTask,
  newTask,
  saveTask,
  taskStats,
} from './task'
import { MemorySink, opfsSink, packToSink, zipFileName, type DownloadReport } from './packer'
import { withTabLock } from '../utils/lock'
import { isProxiedUrl, VERIFIED_SOURCES } from '../site/mangayun/images'

export interface DownloadProgress {
  state: DownloadTaskData['state']
  title: string
  chapterCount: number
  currentChapter: string | null
  totalPages: number
  cachedPages: number
  failedPages: number
  bytesPerSec: number
  storage: ImageCache['kind']
  usedBytes: number
  capBytes: number | null
  note: string | null
}

export interface PackHandle {
  taskId: string
  fileName: string
  byteLength: number
  /** OPFS 输出文件；内存模式为 null，ZIP 保存在 blob。 */
  file: File | null
  blob: Blob | null
  report: DownloadReport
}

export interface ManagerDeps {
  adapter: SiteAdapter
  settings: SettingsStore
  kv: KV
  onProgress(progress: DownloadProgress): void
  onPacked(handle: PackHandle): void
}

const MAX_CHAPTER_RESOLVES = 3

export class DownloadManager {
  #deps: ManagerDeps
  #cache: ImageCache | null = null
  #scheduler: Scheduler | null = null
  #task: DownloadTaskData | null = null
  #abort = false
  #userPaused = false
  #speedWindow: { at: number; bytes: number }[] = []
  #pack: PackHandle | null = null
  #running = false

  constructor(deps: ManagerDeps) {
    this.#deps = deps
  }

  get task(): DownloadTaskData | null {
    return this.#task
  }

  get packHandle(): PackHandle | null {
    return this.#pack
  }

  async ensureCache(): Promise<ImageCache> {
    if (!this.#cache) this.#cache = await openBestCache()
    return this.#cache
  }

  #emit(extra: Partial<DownloadProgress> = {}): void {
    const task = this.#task
    if (!task) return
    const stats = taskStats(task)
    const cache = this.#cache
    const now = Date.now()
    this.#speedWindow = this.#speedWindow.filter((p) => now - p.at < 3000)
    const bytes = this.#speedWindow.reduce((s, p) => s + p.bytes, 0)
    const current = task.chapters.find((c) => c.resolved && c.pages.includes('pending')) ?? task.chapters.find((c) => !c.resolved)
    this.#deps.onProgress({
      state: task.state,
      title: task.title,
      chapterCount: task.chapters.length,
      currentChapter: current?.chapter.name ?? null,
      totalPages: stats.totalPages,
      cachedPages: stats.cachedPages,
      failedPages: stats.failedPages,
      bytesPerSec: bytes / 3,
      storage: cache?.kind ?? task.storage,
      usedBytes: cache?.usedBytes() ?? 0,
      capBytes: cache?.capBytes ?? null,
      note: task.note ?? null,
      ...extra,
    })
  }

  cacheKeyOf(taskId: string, chapterIndex: number, page: number): string {
    return `${taskId}/${chapterIndex}/${page}`
  }

  /** 建立并运行任务。返回任务 id。 */
  async start(comic: ComicRef, title: string, chapters: Chapter[]): Promise<string> {
    const cache = await this.ensureCache()
    const task = newTask(comic, title, chapters, cache.kind)
    this.#task = task
    this.#pack = null
    this.#abort = false
    this.#userPaused = false
    saveTask(this.#deps.kv, task)
    void this.#run(task)
    return task.id
  }

  /** 恢复任务（R-D13）：已缓存页跳过，其余重新解析后下载。 */
  async resume(taskId: string): Promise<boolean> {
    const cached = loadTask(this.#deps.kv, taskId)
    if (!cached) return false
    const cache = await this.ensureCache()
    cached.storage = cache.kind
    cached.state = 'resolving'
    cached.note = null
    // 校验已缓存页：缓存损坏的回退为 pending
    for (const [ci, c] of cached.chapters.entries()) {
      for (let p = 0; p < c.pages.length; p++) {
        if (c.pages[p] === 'cached') {
          const hit = await cache.get(this.cacheKeyOf(taskId, ci, p))
          if (!hit) c.pages[p] = 'pending'
        }
      }
      c.failures = []
    }
    this.#task = cached
    this.#abort = false
    this.#userPaused = false
    saveTask(this.#deps.kv, cached)
    void this.#run(cached)
    return true
  }

  async #run(task: DownloadTaskData): Promise<void> {
    if (this.#running) return
    this.#running = true
    try {
      // R-D14：同一任务同时只有一个标签页在执行
      const outcome = await withTabLock(`myr:v1:lock:${task.id}`, async () => this.#runInner(task))
      if (!outcome.acquired) {
        task.state = 'paused'
        task.note = '另一个标签页正在执行本任务'
        saveTask(this.#deps.kv, task)
        this.#emit()
      }
    } finally {
      this.#running = false
    }
  }

  async #runInner(task: DownloadTaskData): Promise<void> {
    const cache = await this.ensureCache()
    const concurrency = this.#deps.settings.get().download.concurrency
    const scheduler = new Scheduler(concurrency, {
      onRateLimited: (waitMs) => {
        task.note = `限流，等待 ${Math.ceil(waitMs / 1000)}s`
        this.#emit()
      },
      onRateLimitRecovered: () => {
        task.note = null
        this.#emit()
      },
    })
    this.#scheduler = scheduler

    try {
      const resolvesCount = new Map<number, number>()
      for (const [ci, chapterState] of task.chapters.entries()) {
        if (this.#abort) break
        while (!this.#userPaused && !this.#abort) {
          task.state = chapterState.resolved ? 'downloading' : 'resolving'
          this.#emit()
          saveTask(this.#deps.kv, task)

          // 1. 解析本章（串行；地址过期时重新解析，不复用旧地址）
          let images: string[]
          try {
            const list = await this.#deps.adapter.resolveChapter(task.ref, chapterState.chapter.url)
            images = list.images
          } catch (e) {
            chapterState.failures.push({
              page: 0,
              reason: `章节解析失败：${e instanceof Error ? e.message : String(e)}`,
              attempts: 1,
            })
            task.state = 'incomplete'
            task.note = chapterState.failures[0]?.reason ?? null
            saveTask(this.#deps.kv, task)
            this.#emit()
            return
          }
          chapterState.expectedPages = images.length
          if (chapterState.pages.length !== images.length) {
            chapterState.pages = images.map((_, i) => chapterState.pages[i] ?? 'pending')
            chapterState.exts = images.map((_, i) => chapterState.exts[i] ?? null)
          }
          chapterState.resolved = true

          // 2. 已缓存页跳过；未缓存的进入调度器
          const jobs: Promise<JobOutcome>[] = []
          let expired = false
          let capHit = false
          for (let page = 0; page < images.length; page++) {
            if (chapterState.pages[page] === 'cached') continue
            const url = images[page]!
            const key = this.cacheKeyOf(task.id, ci, page)
            jobs.push(
              scheduler.submit({
                key,
                run: async () => {
                  if (scheduler.isCancelled()) return
                  const fetched: FetchedImage = await fetchImage(
                    url,
                    (u) => isProxiedUrl(u, location.origin) || new URL(u, location.origin).origin === location.origin,
                  )
                  try {
                    await cache.put(key, fetched.bytes)
                  } catch (e) {
                    if (e instanceof MemoryCapError) {
                      capHit = true
                      throw e
                    }
                    throw e
                  }
                  this.#speedWindow.push({ at: Date.now(), bytes: fetched.bytes.length })
                  return fetched
                },
              }).then((outcome) => {
                const p = Number(outcome.key.split('/')[2])
                if (outcome.status === 'done') {
                  chapterState.pages[p] = 'cached'
                  const fetched = outcome.result as FetchedImage | undefined
                  chapterState.exts[p] = fetched?.ext ?? null
                } else if (outcome.status === 'expired') {
                  expired = true
                  chapterState.pages[p] = 'pending'
                } else if (outcome.status === 'failed') {
                  chapterState.pages[p] = 'failed'
                  chapterState.failures.push({
                    page: p,
                    reason: outcome.error?.message ?? '下载失败',
                    attempts: outcome.attempts,
                  })
                }
                // cancelled：不动状态
                this.#emit()
                return outcome
              }),
            )
          }
          await Promise.all(jobs)
          if (capHit) throw new MemoryCapError(cache.capBytes ?? 100 * 1024 * 1024)
          if (this.#abort) break
          if (this.#userPaused) break
          saveTask(this.#deps.kv, task)

          // 3. 地址过期：重新解析本章再试（有限次数）
          if (expired) {
            const count = (resolvesCount.get(ci) ?? 1) + 1
            resolvesCount.set(ci, count)
            if (count < MAX_CHAPTER_RESOLVES) {
              chapterState.resolved = false
              continue
            }
            for (let p = 0; p < chapterState.pages.length; p++) {
              if (chapterState.pages[p] === 'pending') {
                chapterState.pages[p] = 'failed'
                chapterState.failures.push({ page: p, reason: '地址过期且重解析无效', attempts: MAX_CHAPTER_RESOLVES })
              }
            }
          }
          break
        }
        if (this.#userPaused) {
          task.state = 'paused'
          saveTask(this.#deps.kv, task)
          this.#emit()
          return
        }
      }

      if (this.#abort) {
        task.state = 'cancelled'
        saveTask(this.#deps.kv, task)
        this.#emit()
        return
      }

      const stats = taskStats(task)
      if (stats.failedPages > 0) {
        // R-D8：有失败项时不显示“下载成功”
        task.state = 'incomplete'
        task.note = null
        saveTask(this.#deps.kv, task)
        this.#emit()
        return
      }
      // 全部完成 → 打包
      await this.pack(false)
    } catch (e) {
      if (e instanceof MemoryCapError) {
        // R-D11：内存模式达到上限时暂停并说明
        task.state = 'paused'
        task.note = `已达到内存模式 ${Math.round(e.capBytes / 1024 / 1024)} MiB 上限，可导出部分结果或取消`
        saveTask(this.#deps.kv, task)
        this.#emit()
        return
      }
      task.state = 'failed'
      task.note = e instanceof Error ? e.message : String(e)
      saveTask(this.#deps.kv, task)
      this.#emit()
    } finally {
      this.#scheduler = null
    }
  }

  pause(): void {
    this.#userPaused = true
    this.#scheduler?.pause()
    if (this.#task) {
      this.#task.state = 'paused'
      saveTask(this.#deps.kv, this.#task)
      this.#emit()
    }
  }

  resumePaused(): void {
    this.#userPaused = false
    this.#scheduler?.resume()
    if (this.#task) {
      const task = this.#task
      task.note = null
      saveTask(this.#deps.kv, task)
      // 若运行循环已退出（暂停在章节边界），重新驱动
      if (!this.#running) void this.#run(task)
      this.#emit()
    }
  }

  cancel(): void {
    this.#abort = true
    this.#userPaused = false
    this.#scheduler?.cancel()
    if (this.#task) {
      this.#task.state = 'cancelled'
      saveTask(this.#deps.kv, this.#task)
      this.#emit()
    }
  }

  /** 只重试失败项（R-D7）。 */
  async retryFailed(): Promise<void> {
    const task = this.#task
    if (!task) return
    for (const c of task.chapters) {
      c.failures = []
      for (let p = 0; p < c.pages.length; p++) {
        if (c.pages[p] === 'failed') c.pages[p] = 'pending'
      }
      c.resolved = false
    }
    task.state = 'resolving'
    task.note = null
    saveTask(this.#deps.kv, task)
    this.#abort = false
    this.#userPaused = false
    if (!this.#running) void this.#run(task)
    this.#emit()
  }

  /** 打包（R-D5）。partial=true 时文件名加 _partial（R-D9）。 */
  async pack(partial: boolean): Promise<PackHandle> {
    const task = this.#task
    if (!task) throw new Error('没有进行中的任务')
    const cache = await this.ensureCache()
    task.state = 'packing'
    saveTask(this.#deps.kv, task)
    this.#emit()
    const input = {
      ref: task.ref,
      title: task.title,
      partial,
      siteVerified: VERIFIED_SOURCES.has(task.ref.siteId),
      chapters: task.chapters.map((c) => ({
        chapter: c.chapter,
        expectedPages: c.expectedPages,
        pages: c.pages.map((status, page) => ({
          page,
          ext: status === 'cached' ? c.exts[page] ?? 'jpg' : null,
        })),
      })),
    }
    const keyOf = (ci: number, page: number) => this.cacheKeyOf(task.id, ci, page)

    let handle: PackHandle
    if (cache.kind === 'opfs') {
      const root = await navigator.storage.getDirectory()
      const ns = await root.getDirectoryHandle('myr-v1', { create: true })
      const zips = await ns.getDirectoryHandle('zips', { create: true })
      const fileHandle = await zips.getFileHandle(`${task.id}.zip`, { create: true })
      const writable = await fileHandle.createWritable()
      const result = await packToSink(opfsSink(writable), input, (key) =>
        cache.get(key).then((c) => c?.bytes ?? null),
        keyOf,
      )
      handle = {
        taskId: task.id,
        fileName: zipFileName(task.title, partial),
        byteLength: result.byteLength,
        file: await fileHandle.getFile(),
        blob: null,
        report: result.report,
      }
    } else {
      const sink = new MemorySink()
      const result = await packToSink(sink, input, (key) =>
        cache.get(key).then((c) => c?.bytes ?? null),
        keyOf,
      )
      handle = {
        taskId: task.id,
        fileName: zipFileName(task.title, partial),
        byteLength: result.byteLength,
        file: null,
        blob: sink.toBlob(),
        report: result.report,
      }
    }
    task.state = 'packed'
    task.zipName = handle.fileName
    saveTask(this.#deps.kv, task)
    this.#pack = handle
    this.#emit()
    this.#deps.onPacked(handle)
    return handle
  }

  markHandedOff(): void {
    const task = this.#task
    if (!task) return
    task.state = 'handed-off'
    saveTask(this.#deps.kv, task)
    this.#emit()
  }

  /** 清理任务缓存与元数据（取消后由用户选择，基线 §8.1）。 */
  async cleanup(keepZip = false): Promise<void> {
    const task = this.#task
    const cache = this.#cache
    if (task && cache) {
      await cache.clearTask(`${task.id}/`)
      if (cache.kind === 'opfs') {
        try {
          const root = await navigator.storage.getDirectory()
          const ns = await root.getDirectoryHandle('myr-v1')
          const zips = await ns.getDirectoryHandle('zips')
          await zips.removeEntry(`${task.id}.zip`)
        } catch {
          /* 文件不存在 */
        }
      }
    }
    if (task && !keepZip) deleteTask(this.#deps.kv, task.id)
    this.#task = null
    this.#pack = null
  }
}
