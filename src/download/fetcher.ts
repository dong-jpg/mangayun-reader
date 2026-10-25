/**
 * 图片请求与校验（§4.7）：
 * - 同源（/api/image 代理）直接 fetch；跨域先页面 fetch（无 Referer），
 *   失败回退 GM_xmlhttpRequest（anonymous、blob，§3.4）
 * - 校验：2xx、Content-Type 非 HTML、文件头为 JPEG/PNG/WebP/GIF/AVIF、
 *   长度 > 0 且与 Content-Length 一致
 */
import { sniffImageType } from '../utils/mime-sniff'

export type FetchFailureKind =
  | 'network' // 网络错误：可重试
  | 'http-429' // 限流：全局暂停
  | 'http-503' // 限流/过载：全局暂停
  | 'http-5xx' // 服务错误：可重试
  | 'http-404' // 重试后失败
  | 'expired' // 403 / HTML / 无效文件头：疑似地址过期，需重新解析
  | 'invalid'

export class FetchFailure extends Error {
  kind: FetchFailureKind
  status?: number
  /** 429/503 时从 Retry-After 解析的等待毫秒数（R-D10）。 */
  retryAfterMs?: number

  constructor(kind: FetchFailureKind, message: string, status?: number, retryAfterMs?: number) {
    super(message)
    this.name = 'FetchFailure'
    this.kind = kind
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/** 解析 Retry-After（秒数或 HTTP 日期）。 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

export interface FetchedImage {
  bytes: Uint8Array
  ext: string
  mime: string
}

function classifyStatus(status: number): FetchFailureKind {
  if (status === 429) return 'http-429'
  if (status === 503) return 'http-503'
  if (status === 403) return 'expired'
  if (status === 404) return 'http-404'
  if (status >= 500) return 'http-5xx'
  return 'invalid'
}

export function validateImageBytes(bytes: Uint8Array, contentType: string | null, contentLength: number | null): { ext: string; mime: string } {
  if (bytes.length === 0) throw new FetchFailure('expired', '空响应')
  if (contentLength != null && contentLength !== bytes.length) {
    throw new FetchFailure('network', `长度不一致：${bytes.length}/${contentLength}`)
  }
  const sniffed = sniffImageType(bytes)
  if (!sniffed) throw new FetchFailure('expired', '文件头不是受支持的图片格式')
  if (contentType && /text\/html/i.test(contentType)) {
    throw new FetchFailure('expired', '响应是 HTML')
  }
  return sniffed
}

async function fromResponse(res: Response): Promise<FetchedImage> {
  if (!res.ok) {
    const retryAfter = res.status === 429 || res.status === 503 ? parseRetryAfter(res.headers.get('retry-after')) : undefined
    throw new FetchFailure(classifyStatus(res.status), `HTTP ${res.status}`, res.status, retryAfter)
  }
  const contentType = res.headers.get('content-type')
  const contentLengthHeader = res.headers.get('content-length')
  const contentLength = contentLengthHeader != null ? Number(contentLengthHeader) : null
  if (contentType && /text\/html/i.test(contentType)) {
    throw new FetchFailure('expired', '响应是 HTML')
  }
  const buffer = await res.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const { ext, mime } = validateImageBytes(bytes, contentType, Number.isFinite(contentLength) ? contentLength : null)
  return { bytes, ext, mime }
}

/** 同源/代理地址用页面 fetch。 */
export async function fetchViaPage(url: string): Promise<FetchedImage> {
  try {
    const res = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'same-origin' })
    return await fromResponse(res)
  } catch (e) {
    if (e instanceof FetchFailure) throw e
    throw new FetchFailure('network', e instanceof Error ? e.message : String(e))
  }
}

/** GM_xmlhttpRequest 回退（跨域被 CORS 拦截时）。 */
export function fetchViaGM(url: string): Promise<FetchedImage> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gm = (globalThis as any).GM_xmlhttpRequest as
      | ((details: {
          method?: string
          url: string
          anonymous?: boolean
          responseType?: string
          headers?: Record<string, string>
          onload: (res: { status: number; response: unknown; responseHeaders: string }) => void
          onerror: (err: { error?: string }) => void
          ontimeout: () => void
          timeout?: number
        }) => void)
      | undefined
    if (!gm) {
      reject(new FetchFailure('network', 'GM_xmlhttpRequest 不可用'))
      return
    }
    gm({
      method: 'GET',
      url,
      anonymous: true, // 不带 Cookie
      responseType: 'blob',
      timeout: 60000,
      onload: async (res) => {
        if (res.status < 200 || res.status >= 300) {
          const headers = parseHeaders(res.responseHeaders)
          const retryAfter = res.status === 429 || res.status === 503 ? parseRetryAfter(headers.get('retry-after')) : undefined
          reject(new FetchFailure(classifyStatus(res.status), `HTTP ${res.status}`, res.status, retryAfter))
          return
        }
        try {
          const blob = res.response as Blob
          const headers = parseHeaders(res.responseHeaders)
          const contentLengthHeader = headers.get('content-length')
          const contentLength = contentLengthHeader != null ? Number(contentLengthHeader) : null
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const { ext, mime } = validateImageBytes(bytes, headers.get('content-type'), Number.isFinite(contentLength) ? contentLength : null)
          resolve({ bytes, ext, mime })
        } catch (e) {
          reject(e instanceof FetchFailure ? e : new FetchFailure('network', String(e)))
        }
      },
      onerror: (err) => reject(new FetchFailure('network', err?.error ?? 'GM 请求失败')),
      ontimeout: () => reject(new FetchFailure('network', '请求超时')),
    })
  })
}

function parseHeaders(raw: string): Headers {
  const headers = new Headers()
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
  }
  return headers
}

/** 按地址决定请求路径（§3.4 支持矩阵）。 */
export async function fetchImage(url: string, isSameOrigin: (url: string) => boolean): Promise<FetchedImage> {
  if (isSameOrigin(url)) {
    return fetchViaPage(url)
  }
  try {
    return await fetchViaPage(url)
  } catch (e) {
    if (e instanceof FetchFailure && (e.kind === 'network' || e.kind === 'http-5xx')) {
      return fetchViaGM(url)
    }
    throw e
  }
}
