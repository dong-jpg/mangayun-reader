/**
 * 隐藏 iframe 批量解析（§3.3 / §7 D2）：未打开的章节没有图片清单请求，
 * 让原站自己在隐藏 iframe 里加载 /read/… 并捕获其请求结果。
 * 脚本在 iframe 内同样运行（不加 @noframes），以 window.name 前缀识别解析用途。
 */
import type { ComicInfo, ComicRef, PageList } from '../types'
import { normalizeChapters } from './chapters'
import { finalizeImageUrl } from './images'
import { buildReadPath } from './url'
import type { CaptureBus, CaptureEvent } from './capture'

export const RESOLVE_IFRAME_NAME_PREFIX = 'myr-resolve:v1:'
export const RESOLVE_IFRAME_MIN_GAP_MS = 1000
/** 捕获等待上限：超时后转 DOM 抓取兜底。 */
const CAPTURE_TIMEOUT_MS = 20000
/** DOM 抓取兜底的轮询上限。 */
const SCRAPE_TIMEOUT_MS = 15000

/**
 * 从原站阅读器 DOM 抓取图片清单（捕获层不可用时的兜底）：
 * 阅读器把全部页面的 img（referrerpolicy="no-referrer"）渲染进 DOM，
 * src 即最终地址；按文档序去重，过滤封面缩略图（CoverThumb）。
 */
export function scrapeReaderImages(doc: Document): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const img of doc.querySelectorAll<HTMLImageElement>('img[referrerpolicy="no-referrer"]')) {
    const src = img.getAttribute('src')
    if (!src || seen.has(src)) continue
    if (/thumb/i.test(img.className) || img.closest('[class*="thumb"]')) continue
    if (/\/cover(_pc)?\./i.test(src) || /\/covers?\//i.test(src)) continue
    seen.add(src)
    out.push(src)
  }
  return out
}

/** iframe 是否为解析用途（供 main.ts 在子框架内判断）。 */
export function isResolveIframe(name: string): boolean {
  return name.startsWith(RESOLVE_IFRAME_NAME_PREFIX)
}

export function resolveIframeToken(name: string): string | null {
  return isResolveIframe(name) ? name.slice(RESOLVE_IFRAME_NAME_PREFIX.length) : null
}

export class ChapterResolver {
  #bus: CaptureBus
  #lastLoadAt = 0

  constructor(bus: CaptureBus) {
    this.#bus = bus
  }

  async #loadInIframe(src: string, token: string, match: (ev: CaptureEvent) => boolean, timeoutMs: number): Promise<CaptureEvent> {
    // 逐话间隔至少 1s（§3.3）
    const gap = Date.now() - this.#lastLoadAt - RESOLVE_IFRAME_MIN_GAP_MS
    if (gap < 0) await new Promise((r) => setTimeout(r, -gap))
    this.#lastLoadAt = Date.now()

    const iframe = document.createElement('iframe')
    iframe.name = `${RESOLVE_IFRAME_NAME_PREFIX}${token}`
    iframe.src = src
    // 不用 display:none：保持文档在渲染树中以确保资源加载
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.style.cssText =
      'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;z-index:2147483647'
    const wait = this.#bus.waitFor(match, timeoutMs)
    try {
      document.documentElement.appendChild(iframe)
      return await wait
    } finally {
      iframe.remove()
    }
  }

  async resolveChapter(comic: ComicRef, chapterUrl: string, timeoutMs = 45000): Promise<PageList> {
    // 逐话间隔至少 1s（§3.3）
    const gap = Date.now() - this.#lastLoadAt - RESOLVE_IFRAME_MIN_GAP_MS
    if (gap < 0) await new Promise((r) => setTimeout(r, -gap))
    this.#lastLoadAt = Date.now()

    const src = `${buildReadPath(comic, chapterUrl)}?_myr=${Date.now().toString(36)}`
    const match = (ev: CaptureEvent): boolean =>
      ev.kind === 'chapter-images' && ev.chapterUrl === chapterUrl
    const iframe = document.createElement('iframe')
    iframe.name = `${RESOLVE_IFRAME_NAME_PREFIX}${this.#bus.token}`
    iframe.src = src
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.style.cssText =
      'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;z-index:2147483647'
    try {
      document.documentElement.appendChild(iframe)
      try {
        const ev = await this.#bus.waitFor(match, Math.min(timeoutMs, CAPTURE_TIMEOUT_MS))
        if (ev.kind !== 'chapter-images') throw new Error('unexpected-capture-event')
        const siteId = ev.siteId ?? comic.siteId
        return {
          chapterUrl,
          images: ev.images.map((img) => finalizeImageUrl(siteId, img)),
          resolvedAt: ev.capturedAt,
        }
      } catch (err) {
        // 捕获超时（桌面 TM 沙箱等环境下注入可能失败）：
        // 抓取 iframe 内原站阅读器自己渲染的图片（同源可读，不依赖捕获层）
        const scraped = await this.#pollIframeImages(iframe, SCRAPE_TIMEOUT_MS)
        if (scraped.length > 0) {
          return { chapterUrl, images: scraped, resolvedAt: Date.now() }
        }
        throw err
      }
    } finally {
      iframe.remove()
    }
  }

  /** 轮询 iframe 文档中的阅读器图片（渲染需要时间）。 */
  async #pollIframeImages(iframe: HTMLIFrameElement, timeoutMs: number): Promise<string[]> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const doc = iframe.contentDocument
        if (doc) {
          const imgs = scrapeReaderImages(doc)
          if (imgs.length > 0) return imgs
        }
      } catch {
        /* 文档尚未就绪或不可访问 */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    return []
  }

  async resolveComic(comic: ComicRef, seedChapterUrl: string, timeoutMs = 45000): Promise<ComicInfo> {
    const src = `${buildReadPath(comic, seedChapterUrl)}?_myr=${Date.now().toString(36)}`
    const match = (ev: CaptureEvent): boolean => ev.kind === 'details'
    const ev = await this.#loadInIframe(src, this.#bus.token, match, timeoutMs)
    if (ev.kind !== 'details') throw new Error('unexpected-capture-event')
    const siteId = ev.siteId ?? comic.siteId
    return {
      ref: { siteId, detailUrl: ev.detailUrl ?? comic.detailUrl },
      title: ev.payload.title ?? '',
      coverUrl: ev.payload.coverUrl,
      chapters: normalizeChapters(siteId, ev.payload.chapters ?? []),
    }
  }
}
