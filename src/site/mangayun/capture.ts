/**
 * 捕获层（§3.2 约束 2）：包装页面 fetch，只读取 /api/details 与
 * /api/chapter-images 的响应副本，不修改请求与响应，不复刻签名。
 * 页面上下文部分以内联 <script> 注入（CSP 阻止时回退包装 unsafeWindow.fetch），
 * 两侧通过带随机 token 的 postMessage 通信。
 */
import { Cleanup } from '../../utils/cleanup'
import type { RawChapter } from './chapters'

export const CAPTURE_SOURCE = 'myr:v1:capture'
export const RESOLVE_FORWARD_SOURCE = 'myr:v1:resolve'
export const PAGE_FLAG = '__myrCaptureV1'

export interface DetailsPayload {
  title?: string
  coverUrl?: string
  chapters?: RawChapter[]
}

export type CaptureEvent =
  | {
      kind: 'details'
      siteId: string | null
      detailUrl: string | null
      payload: DetailsPayload
      capturedAt: number
    }
  | {
      kind: 'chapter-images'
      siteId: string | null
      chapterUrl: string | null
      images: string[]
      capturedAt: number
    }

/**
 * 注入页面上下文的引导函数。必须自包含：不引用任何模块作用域的变量
 * （常量一律写内联字面量），以 `(fn)(token)` 内联注入（§4.8）。
 * 构建后的自包含性由单测与 e2e 验证。
 */
function pageCaptureBootstrap(token: string): void {
  const w = window
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = w as any
  if (page['__myrCaptureV1']) return
  page['__myrCaptureV1'] = token
  const orig = w.fetch.bind(w)
  const send = (msg: Record<string, unknown>) => {
    try {
      w.postMessage(Object.assign({ source: 'myr:v1:capture', token }, msg), w.location.origin)
    } catch {
      /* 忽略：序列化失败等情况 */
    }
  }
  w.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== w.location.origin) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = e.data as any
    if (!d || d.source !== 'myr:v1:ping' || d.token !== token) return
    send({ kind: 'pong', capturedAt: Date.now() })
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  w.fetch = function myrWrappedFetch(input: any, init?: any) {
    let url = ''
    try {
      url = typeof input === 'string' ? input : String(input && input.url ? input.url : '')
    } catch {
      url = ''
    }
    const p = orig(input, init)
    const path = url.split('?')[0] ?? ''
    if (!/\/api\/(details|chapter-images)$/.test(path)) return p
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let req: any = {}
    try {
      if (init && typeof init.body === 'string') req = JSON.parse(init.body)
    } catch {
      req = {}
    }
    p.then((res: Response) => {
      try {
        if (!res.ok) return
        // 先 clone 再交给调用方消费
        const clone = res.clone()
        clone
          .json()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((json: any) => {
            const data = json && json.data
            if (path.endsWith('/api/details')) {
              if (data && Array.isArray(data.chapters)) {
                send({
                  kind: 'details',
                  siteId: req.siteId ?? null,
                  detailUrl: req.detailUrl ?? null,
                  payload: data,
                  capturedAt: Date.now(),
                })
              }
            } else if (path.endsWith('/api/chapter-images')) {
              if (data && Array.isArray(data.images)) {
                send({
                  kind: 'chapter-images',
                  siteId: req.siteId ?? null,
                  chapterUrl: req.chapterUrl ?? null,
                  images: data.images.filter((x: unknown) => typeof x === 'string'),
                  capturedAt: Date.now(),
                })
              }
            }
          })
          .catch(() => {
            /* 非 JSON 或读取失败：静默跳过 */
          })
      } catch {
        /* 捕获层自身异常不影响页面 */
      }
    }).catch(() => {
      /* 请求失败与捕获无关 */
    })
    return p
  }
}

/** 生成内联注入的脚本源码。 */
export function captureInjectSource(token: string): string {
  return `(${pageCaptureBootstrap.toString()})(${JSON.stringify(token)});`
}

interface UnsafeWindowGlobal {
  fetch?: typeof fetch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

function getUnsafeWindow(): UnsafeWindowGlobal | null {
  try {
    // Tampermonkey：@grant unsafeWindow 时可用
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uw = (globalThis as any).unsafeWindow as UnsafeWindowGlobal | undefined
    if (uw && uw.fetch) return uw
  } catch {
    /* 无权访问 */
  }
  return null
}

/** 消息事件（捕获层与 iframe 转发共用同一信封）。 */
export type BusMessage = CaptureEvent & { source: string; token: string }

interface RecentEntry {
  event: CaptureEvent
  at: number
}

const RECENT_LIMIT = 40
const RECENT_TTL_MS = 30 * 60 * 1000

/**
 * 用户脚本侧总线：接收捕获层 postMessage，向适配层分发；
 * 保留最近事件，支持后到的订阅者（如进入增强阅读器时页面早已加载完成）。
 */
export class CaptureBus {
  #cleanup = new Cleanup()
  #token = `t${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  #subscribers = new Set<(ev: CaptureEvent) => void>()
  #recent: RecentEntry[] = []
  #started = false

  get token(): string {
    return this.#token
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    this.#installPageCapture()
    const onMessage = (e: MessageEvent) => this.#handleMessage(e)
    window.addEventListener('message', onMessage)
    this.#cleanup.add(() => window.removeEventListener('message', onMessage))
  }

  #handleMessage(e: MessageEvent): void {
    if (e.origin !== location.origin) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = e.data as any
    if (!data || typeof data !== 'object') return
    if (data.token !== this.#token) return
    const source = data.source
    if (source === CAPTURE_SOURCE || source === RESOLVE_FORWARD_SOURCE) {
      const event = source === RESOLVE_FORWARD_SOURCE ? (data.event as CaptureEvent) : toEvent(data)
      if (event) this.#dispatch(event)
    }
  }

  #dispatch(event: CaptureEvent): void {
    const now = Date.now()
    this.#recent.push({ event, at: now })
    while (this.#recent.length > RECENT_LIMIT) this.#recent.shift()
    this.#recent = this.#recent.filter((r) => now - r.at < RECENT_TTL_MS)
    for (const cb of [...this.#subscribers]) {
      try {
        cb(event)
      } catch {
        /* 订阅者异常不影响其他订阅者 */
      }
    }
  }

  /** 测试与 iframe 转发路径：直接投递事件。 */
  injectEvent(event: CaptureEvent): void {
    this.#dispatch(event)
  }

  on(cb: (ev: CaptureEvent) => void): () => void {
    this.#subscribers.add(cb)
    return () => this.#subscribers.delete(cb)
  }

  /** 等待匹配事件；先查最近缓冲。 */
  waitFor(match: (ev: CaptureEvent) => boolean, timeoutMs: number): Promise<CaptureEvent> {
    const cached = [...this.#recent].reverse().find((r) => match(r.event))
    if (cached) return Promise.resolve(cached.event)
    return new Promise((resolve, reject) => {
      const off = this.on((ev) => {
        if (!match(ev)) return
        cleanupFns.forEach((fn) => fn())
        resolve(ev)
      })
      const timer = setTimeout(() => {
        cleanupFns.forEach((fn) => fn())
        reject(new Error('capture-wait-timeout'))
      }, timeoutMs)
      const cleanupFns = [off, () => clearTimeout(timer)]
    })
  }

  #installPageCapture(): void {
    // 首选：内联 <script> 注入页面上下文（同步执行）
    if (this.#tryInjectInline()) return
    // 极早期注入（TM Instant 等场景）时 <html> 可能尚不存在：等 DOM 就绪后重试
    if (!document.documentElement) {
      const retry = (): void => {
        if (!document.documentElement) return
        if (!this.#tryInjectInline()) this.#wrapUnsafeWindow()
      }
      if (document.readyState === 'loading') {
        document.addEventListener('readystatechange', retry, { once: true })
        document.addEventListener('DOMContentLoaded', retry, { once: true })
      } else {
        retry()
      }
      return
    }
    // 回退：直接包装 unsafeWindow.fetch（§4.8），逻辑与注入版本一致
    this.#wrapUnsafeWindow()
  }

  #tryInjectInline(): boolean {
    try {
      const root = document.documentElement
      if (!root) return false
      const el = document.createElement('script')
      el.textContent = captureInjectSource(this.#token)
      root.appendChild(el)
      el.remove()
      const page = getUnsafeWindow()
      // unsafeWindow 可用时核对页面标记；不可用时按注入成功处理
      return !page || page[PAGE_FLAG] === this.#token
    } catch {
      return false
    }
  }

  #wrapUnsafeWindow(): void {
    const page = getUnsafeWindow()
    if (!page || page[PAGE_FLAG] || !page.fetch) return
    page[PAGE_FLAG] = this.#token
    const token = this.#token
    const orig = page.fetch.bind(page)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.fetch = function (input: any, init?: any) {
      return wrapFetchForCapture(orig, token, input, init)
    }
  }

  stop(): void {
    this.#cleanup.run()
    this.#subscribers.clear()
    this.#recent = []
    this.#started = false
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEvent(data: any): CaptureEvent | null {
  if (data.kind === 'details' && data.payload && typeof data.payload === 'object') {
    return {
      kind: 'details',
      siteId: data.siteId ?? null,
      detailUrl: data.detailUrl ?? null,
      payload: data.payload as DetailsPayload,
      capturedAt: data.capturedAt ?? Date.now(),
    }
  }
  if (data.kind === 'chapter-images' && Array.isArray(data.images)) {
    return {
      kind: 'chapter-images',
      siteId: data.siteId ?? null,
      chapterUrl: data.chapterUrl ?? null,
      images: data.images as string[],
      capturedAt: data.capturedAt ?? Date.now(),
    }
  }
  return null
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** 测试用：在给定 window 上安装捕获包装（沙箱回退路径同款逻辑）。 */
export function installCaptureOnWindow(
  target: Window & typeof globalThis,
  fetchImpl: FetchLike,
  _token: string,
): () => CaptureEvent[] {
  const events: CaptureEvent[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orig = fetchImpl as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(target as any).fetch = function (input: any, init?: any) {
    let url = ''
    try {
      url = typeof input === 'string' ? input : String(input && input.url ? input.url : '')
    } catch {
      url = ''
    }
    const p = orig(input, init)
    const path = url.split('?')[0] ?? ''
    if (!/\/api\/(details|chapter-images)$/.test(path)) return p
    let req: { siteId?: string; detailUrl?: string; chapterUrl?: string } = {}
    try {
      if (init && typeof init.body === 'string') req = JSON.parse(init.body)
    } catch {
      req = {}
    }
    void p.then((res: Response) => {
      if (!res.ok) return
      res
        .clone()
        .json()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((json: any) => {
          const data = json && json.data
          if (path.endsWith('/api/details') && data && Array.isArray(data.chapters)) {
            events.push({
              kind: 'details',
              siteId: req.siteId ?? null,
              detailUrl: req.detailUrl ?? null,
              payload: data,
              capturedAt: Date.now(),
            })
          } else if (path.endsWith('/api/chapter-images') && data && Array.isArray(data.images)) {
            events.push({
              kind: 'chapter-images',
              siteId: req.siteId ?? null,
              chapterUrl: req.chapterUrl ?? null,
              images: data.images.filter((x: unknown) => typeof x === 'string'),
              capturedAt: Date.now(),
            })
          }
        })
        .catch(() => {})
    }).catch(() => {})
    return p
  }
  return () => events
}

/** 沙箱回退路径的包装实现（与 pageCaptureBootstrap 内联逻辑保持一致）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapFetchForCapture(orig: FetchLike, token: string, input: any, init?: any): Promise<Response> {
  const send = (msg: Record<string, unknown>) => {
    try {
      window.postMessage(Object.assign({ source: CAPTURE_SOURCE, token }, msg), location.origin)
    } catch {
      /* 忽略 */
    }
  }
  let url = ''
  try {
    url = typeof input === 'string' ? input : String(input && input.url ? input.url : '')
  } catch {
    url = ''
  }
  const p = orig(input, init)
  const path = url.split('?')[0] ?? ''
  if (!/\/api\/(details|chapter-images)$/.test(path)) return p
  let req: { siteId?: string; detailUrl?: string; chapterUrl?: string } = {}
  try {
    if (init && typeof init.body === 'string') req = JSON.parse(init.body)
  } catch {
    req = {}
  }
  void p.then((res: Response) => {
    if (!res.ok) return
    res
      .clone()
      .json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((json: any) => {
        const data = json && json.data
        if (path.endsWith('/api/details') && data && Array.isArray(data.chapters)) {
          send({
            kind: 'details',
            siteId: req.siteId ?? null,
            detailUrl: req.detailUrl ?? null,
            payload: data,
            capturedAt: Date.now(),
          })
        } else if (path.endsWith('/api/chapter-images') && data && Array.isArray(data.images)) {
          send({
            kind: 'chapter-images',
            siteId: req.siteId ?? null,
            chapterUrl: req.chapterUrl ?? null,
            images: data.images.filter((x: unknown) => typeof x === 'string'),
            capturedAt: Date.now(),
          })
        }
      })
      .catch(() => {})
  }).catch(() => {})
  return p
}
