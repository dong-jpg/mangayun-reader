/** 站点适配接口（方案 §4.3）。阅读核心只依赖这些类型，不触碰具体站点细节。 */

/** 漫画身份：siteId + 来源详情页 URL（R-P2）。 */
export interface ComicRef {
  siteId: string
  detailUrl: string
}

/** 章节。order 为完整目录正序序号（从 1 开始），用于下载文件夹编号（R-D3）。 */
export interface Chapter {
  url: string
  name: string
  order: number
  rawIndex: number
  category?: string
}

export interface ComicInfo {
  ref: ComicRef
  title: string
  coverUrl?: string
  chapters: Chapter[]
}

export interface PageList {
  chapterUrl: string
  images: string[]
  resolvedAt: number
}

export type SourceSupport = 'full' | 'read-only' | 'unsupported'

export interface ReadingAnchor {
  chapterUrl: string
  /** 逻辑页码，0 起。 */
  page: number
  /** 页内比例 0～1。 */
  offset: number
}

export interface SiteAdapter {
  /** 解析 /read/ 风格 URL；非阅读页返回 null。 */
  matchReadUrl(url: URL): { comic: ComicRef; chapterUrl: string } | null
  buildReadUrl(comic: ComicRef, chapterUrl: string): string
  /** 捕获层事件：原站自己发出的 /api/details 结果。 */
  onComicInfo(cb: (info: ComicInfo) => void): () => void
  /** 捕获层事件：原站自己发出的 /api/chapter-images 结果。 */
  onPageList(cb: (list: PageList, siteId: string) => void): () => void
  /** 批量解析：隐藏 iframe 逐话取详情（§3.3）。 */
  resolveComic(comic: ComicRef, seedChapterUrl: string): Promise<ComicInfo>
  resolveChapter(comic: ComicRef, chapterUrl: string): Promise<PageList>
  supportOf(siteId: string): SourceSupport
  /** 当前地址栏对应的阅读路由（含查询串形式）。 */
  currentReadRoute(): { comic: ComicRef; chapterUrl: string } | null
}
