/**
 * 下载任务模型与状态机（§4.7）：
 * draft → resolving ⇄ downloading ⇄ paused → packing → packed → handed-off
 *                          └──────────→ incomplete / cancelled
 * 任务元数据持久化到 `myr:v1:task:{id}`（不含图片，R-D13 恢复用）。
 */
import type { Chapter, ComicRef } from '../site/types'
import type { KV } from '../store/kv'

export type TaskState =
  | 'draft'
  | 'resolving'
  | 'downloading'
  | 'paused'
  | 'packing'
  | 'packed'
  | 'handed-off'
  | 'incomplete'
  | 'cancelled'
  | 'failed'

export type PageStatus = 'pending' | 'cached' | 'failed'

export interface PageFailure {
  page: number
  reason: string
  attempts: number
}

export interface TaskChapterState {
  chapter: Chapter
  resolved: boolean
  expectedPages: number
  pages: PageStatus[]
  exts: (string | null)[]
  failures: PageFailure[]
}

export interface DownloadTaskData {
  id: string
  createdAt: number
  updatedAt: number
  ref: ComicRef
  title: string
  state: TaskState
  chapters: TaskChapterState[]
  storage: 'opfs' | 'idb' | 'memory'
  zipName?: string
  note?: string | null
}

export function newTask(
  ref: ComicRef,
  title: string,
  chapters: Chapter[],
  storage: DownloadTaskData['storage'],
): DownloadTaskData {
  const now = Date.now()
  return {
    id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    ref,
    title,
    state: 'draft',
    chapters: chapters.map((chapter) => ({
      chapter,
      resolved: false,
      expectedPages: 0,
      pages: [],
      exts: [],
      failures: [],
    })),
    storage,
  }
}

export function taskKey(id: string): string {
  return `myr:v1:task:${id}`
}

export function saveTask(kv: KV, task: DownloadTaskData): void {
  task.updatedAt = Date.now()
  kv.set(taskKey(task.id), task)
}

export function loadTask(kv: KV, id: string): DownloadTaskData | undefined {
  return kv.get<DownloadTaskData>(taskKey(id))
}

export function listTasks(kv: KV): DownloadTaskData[] {
  return kv
    .list()
    .filter((k) => k.startsWith('myr:v1:task:'))
    .map((k) => kv.get<DownloadTaskData>(k))
    .filter((t): t is DownloadTaskData => !!t)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 可恢复的任务（R-D13）。 */
export function resumableTasks(kv: KV): DownloadTaskData[] {
  return listTasks(kv).filter((t) =>
    t.state === 'resolving' || t.state === 'downloading' || t.state === 'paused' || t.state === 'incomplete' || t.state === 'failed',
  )
}

export function deleteTask(kv: KV, id: string): void {
  kv.delete(taskKey(id))
}

export interface TaskStats {
  totalPages: number
  cachedPages: number
  failedPages: number
  pendingPages: number
  complete: boolean
}

export function taskStats(task: DownloadTaskData): TaskStats {
  let totalPages = 0
  let cachedPages = 0
  let failedPages = 0
  for (const c of task.chapters) {
    totalPages += c.expectedPages
    for (const s of c.pages) {
      if (s === 'cached') cachedPages++
      else if (s === 'failed') failedPages++
    }
  }
  return {
    totalPages,
    cachedPages,
    failedPages,
    pendingPages: Math.max(0, totalPages - cachedPages - failedPages),
    complete: totalPages > 0 && cachedPages === totalPages,
  }
}
