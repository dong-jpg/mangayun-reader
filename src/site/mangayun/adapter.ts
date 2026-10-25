/** mangayun.com 站点适配器（SiteAdapter 实现）。 */
import type {
  Chapter,
  ComicInfo,
  ComicRef,
  PageList,
  SiteAdapter,
} from '../types'
import { normalizeChapters } from './chapters'
import { finalizeImageUrl, supportOf } from './images'
import type { CaptureBus } from './capture'
import { ChapterResolver } from './batch-resolver'
import { buildReadPath, parseReadPath, parseReadSearch } from './url'

export function createMangayunAdapter(bus: CaptureBus): SiteAdapter {
  const resolver = new ChapterResolver(bus)

  function readRouteOf(url: URL): { comic: ComicRef; chapterUrl: string } | null {
    return parseReadPath(url.pathname) ?? parseReadSearch(url.search)
  }

  return {
    matchReadUrl: readRouteOf,
    buildReadUrl(comic, chapterUrl) {
      return buildReadPath(comic, chapterUrl)
    },
    currentReadRoute() {
      return readRouteOf(new URL(location.href))
    },
    onComicInfo(cb: (info: ComicInfo) => void): () => void {
      return bus.on((ev) => {
        if (ev.kind !== 'details') return
        const route = readRouteOf(new URL(location.href))
        const siteId = ev.siteId ?? route?.comic.siteId
        if (!siteId) return
        const chapters: Chapter[] = normalizeChapters(siteId, ev.payload.chapters ?? [])
        cb({
          ref: { siteId, detailUrl: ev.detailUrl ?? route?.comic.detailUrl ?? '' },
          title: ev.payload.title ?? '',
          coverUrl: ev.payload.coverUrl,
          chapters,
        })
      })
    },
    onPageList(cb: (list: PageList, siteId: string) => void): () => void {
      return bus.on((ev) => {
        if (ev.kind !== 'chapter-images') return
        const siteId = ev.siteId ?? ''
        cb(
          {
            chapterUrl: ev.chapterUrl ?? '',
            images: ev.images.map((img) => finalizeImageUrl(siteId, img)),
            resolvedAt: ev.capturedAt,
          },
          siteId,
        )
      })
    },
    async resolveComic(comic, seedChapterUrl) {
      return resolver.resolveComic(comic, seedChapterUrl)
    },
    async resolveChapter(comic, chapterUrl) {
      return resolver.resolveChapter(comic, chapterUrl)
    },
    supportOf,
  }
}
