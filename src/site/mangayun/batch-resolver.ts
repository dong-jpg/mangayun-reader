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
    const src = `${buildReadPath(comic, chapterUrl)}?_myr=${Date.now().toString(36)}`
    const match = (ev: CaptureEvent): boolean =>
      ev.kind === 'chapter-images' && ev.chapterUrl === chapterUrl
    const ev = await this.#loadInIframe(src, this.#bus.token, match, timeoutMs)
    if (ev.kind !== 'chapter-images') throw new Error('unexpected-capture-event')
    const siteId = ev.siteId ?? comic.siteId
    return {
      chapterUrl,
      images: ev.images.map((img) => finalizeImageUrl(siteId, img)),
      resolvedAt: ev.capturedAt,
    }
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
