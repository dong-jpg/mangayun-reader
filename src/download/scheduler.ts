/**
 * 下载调度器（R-D6、R-D7、R-D10）：
 * - 并发上限（默认 2，可设 1～4）
 * - 每图最多 3 次尝试，间隔约 1s、3s + 随机抖动
 * - 429/503 全局暂停：遵守 Retry-After，否则指数退避（最长 60s），
 *   恢复后并发临时降为 1 持续 60s
 * - 暂停后立即停止发起新请求；取消后迟到的回调被丢弃
 */
import { FetchFailure, type FetchFailureKind } from './fetcher'

export interface SchedulerJob {
  key: string
  /** 执行一次尝试；失败抛 FetchFailure。 */
  run(): Promise<unknown>
}

export type JobStatus = 'done' | 'failed' | 'cancelled' | 'expired'

export interface JobOutcome {
  key: string
  status: JobStatus
  attempts: number
  result?: unknown
  error?: { kind: FetchFailureKind; message: string }
}

const RETRY_DELAYS_MS = [1000, 3000]
const JITTER_MAX_MS = 800
const MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 60000
const RECOVER_CONCURRENCY_MS = 60000

interface QueueEntry {
  job: SchedulerJob
  attempts: number
  resolve: (outcome: JobOutcome) => void
  generation: number
}

export interface SchedulerHooks {
  onRateLimited?(waitMs: number): void
  onRateLimitRecovered?(): void
}

export class Scheduler {
  #concurrency: number
  #hooks: SchedulerHooks
  #queue: QueueEntry[] = []
  #active = 0
  #running = true
  #cancelled = false
  #generation = 0
  #globalPauseUntil = 0
  #pauseTimer: ReturnType<typeof setTimeout> | null = null
  #recoverTimer: ReturnType<typeof setTimeout> | null = null
  #rateLimitHits = 0
  #effectiveConcurrency: number

  constructor(concurrency = 2, hooks: SchedulerHooks = {}) {
    this.#concurrency = Math.min(4, Math.max(1, Math.round(concurrency)))
    this.#effectiveConcurrency = this.#concurrency
    this.#hooks = hooks
  }

  get stats(): { queued: number; active: number; paused: boolean } {
    return { queued: this.#queue.length, active: this.#active, paused: !this.#running || Date.now() < this.#globalPauseUntil }
  }

  submit(job: SchedulerJob): Promise<JobOutcome> {
    if (this.#cancelled) return Promise.resolve({ key: job.key, status: 'cancelled', attempts: 0 })
    return new Promise((resolve) => {
      this.#queue.push({ job, attempts: 0, resolve, generation: this.#generation })
      this.#pull()
    })
  }

  #pull(): void {
    if (!this.#running || this.#cancelled) return
    if (Date.now() < this.#globalPauseUntil) return
    while (this.#active < this.#effectiveConcurrency && this.#queue.length > 0) {
      const entry = this.#queue.shift()!
      this.#active++
      void this.#attempt(entry)
    }
  }

  async #attempt(entry: QueueEntry): Promise<void> {
    const { job } = entry
    try {
      const result = await job.run()
      this.#active--
      if (entry.generation !== this.#generation) {
        entry.resolve({ key: job.key, status: 'cancelled', attempts: entry.attempts + 1 })
      } else {
        entry.resolve({ key: job.key, status: 'done', attempts: entry.attempts + 1, result })
      }
      this.#pull()
      return
    } catch (e) {
      this.#active--
      const failure = e instanceof FetchFailure ? e : null
      const kind: FetchFailureKind = failure?.kind ?? 'invalid'
      const message = e instanceof Error ? e.message : String(e)
      if (entry.generation !== this.#generation || this.#cancelled) {
        entry.resolve({ key: job.key, status: 'cancelled', attempts: entry.attempts + 1 })
        this.#pull()
        return
      }
      if (kind === 'http-429' || kind === 'http-503') {
        this.#rateLimit(failure)
        // 限流不消耗该图的尝试次数，重新排队
        this.#queue.unshift(entry)
        return
      }
      if (kind === 'expired') {
        // 地址疑似过期：交给上层重新解析，不盲目重试
        entry.resolve({
          key: job.key,
          status: 'expired',
          attempts: entry.attempts + 1,
          error: { kind, message },
        })
        this.#pull()
        return
      }
      const canRetry =
        failure != null &&
        (kind === 'network' || kind === 'http-5xx' || kind === 'http-404' || kind === 'invalid') &&
        entry.attempts + 1 < MAX_ATTEMPTS
      if (canRetry) {
        entry.attempts++
        const base = RETRY_DELAYS_MS[Math.min(entry.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? 3000
        const delay = base + Math.random() * JITTER_MAX_MS
        setTimeout(() => {
          if (this.#cancelled || entry.generation !== this.#generation) {
            entry.resolve({ key: job.key, status: 'cancelled', attempts: entry.attempts })
            return
          }
          this.#queue.push(entry)
          this.#pull()
        }, delay)
        return
      }
      entry.resolve({
        key: job.key,
        status: 'failed',
        attempts: entry.attempts + 1,
        error: { kind, message },
      })
      this.#pull()
    }
  }

  /** 429/503：全局暂停（R-D10）。 */
  #rateLimit(failure: FetchFailure | null): void {
    this.#rateLimitHits++
    const retryAfter = failure?.retryAfterMs
    let waitMs: number
    if (retryAfter != null && retryAfter > 0) {
      waitMs = retryAfter
    } else {
      waitMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.#rateLimitHits)
    }
    const until = Date.now() + waitMs
    if (until > this.#globalPauseUntil) {
      this.#globalPauseUntil = until
      this.#hooks.onRateLimited?.(waitMs)
      if (this.#pauseTimer != null) clearTimeout(this.#pauseTimer)
      this.#pauseTimer = setTimeout(() => {
        this.#pauseTimer = null
        this.#globalPauseUntil = 0
        // 恢复后并发临时降为 1，持续 60s
        this.#effectiveConcurrency = 1
        this.#hooks.onRateLimitRecovered?.()
        this.#pull()
        if (this.#recoverTimer != null) clearTimeout(this.#recoverTimer)
        this.#recoverTimer = setTimeout(() => {
          this.#recoverTimer = null
          this.#effectiveConcurrency = this.#concurrency
          this.#pull()
        }, RECOVER_CONCURRENCY_MS)
      }, waitMs)
    }
  }

  /** 用户暂停：立即停止发起新请求（R-D6）。 */
  pause(): void {
    this.#running = false
  }

  resume(): void {
    if (this.#cancelled) return
    this.#running = true
    this.#pull()
  }

  /** 取消：丢弃队列，迟到的回调返回 cancelled。 */
  cancel(): void {
    this.#cancelled = true
    this.#generation++
    if (this.#pauseTimer != null) clearTimeout(this.#pauseTimer)
    if (this.#recoverTimer != null) clearTimeout(this.#recoverTimer)
    this.#pauseTimer = null
    this.#globalPauseUntil = 0
    const queue = this.#queue.splice(0)
    for (const entry of queue) {
      entry.resolve({ key: entry.job.key, status: 'cancelled', attempts: entry.attempts })
    }
    this.#running = false
  }

  isCancelled(): boolean {
    return this.#cancelled
  }
}
