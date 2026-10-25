/**
 * harness mock 适配器：不访问真实站点，覆盖正常章节与故障注入章节
 * （404、限流、HTML、过期后重解析成功），供阅读与下载全流程验收（§4.3）。
 */
import type {
  Chapter,
  ComicInfo,
  ComicRef,
  PageList,
  SiteAdapter,
} from '../src/site/types'

export const MOCK_COMIC: ComicRef = { siteId: 'harness', detailUrl: 'https://harness.local/comic/1' }

function mockImg(seed: string, w = 600, h = 900): string {
  return `/mock/img/${encodeURIComponent(seed)}.png?w=${w}&h=${h}`
}

function mockSlow(seed: string, delay = 400): string {
  return `/mock/slow/${encodeURIComponent(seed)}.png?delay=${delay}`
}

export const MOCK_CHAPTERS: Chapter[] = [
  { url: 'mock://ch/1', name: '第1话', order: 1, rawIndex: 0 },
  { url: 'mock://ch/2', name: '第2话', order: 2, rawIndex: 1 },
  { url: 'mock://ch/3', name: '第3话', order: 3, rawIndex: 2 },
  { url: 'mock://ch/fault', name: '故障注入话', order: 4, rawIndex: 3 },
  { url: 'mock://ch/long', name: '长章节60页', order: 5, rawIndex: 4 },
]

/** 故障注入章节的页清单按解析版本变化：v1 含坏地址，v2+ 全部有效（模拟重新解析）。 */
export class MockAdapter implements SiteAdapter {
  #infoSubs = new Set<(info: ComicInfo) => void>()
  #pageSubs = new Set<(list: PageList, siteId: string) => void>()
  #resolveCounts = new Map<string, number>()
  /** e2e 可观察：解析次数 */
  readonly resolveLog: string[] = []

  resolveCountOf(chapterUrl: string): number {
    return this.#resolveCounts.get(chapterUrl) ?? 0
  }

  matchReadUrl(url: URL): { comic: ComicRef; chapterUrl: string } | null {
    if (url.pathname === '/harness' || url.pathname === '/' || url.pathname === '/index.html') {
      const ch = url.searchParams.get('ch') ?? 'mock://ch/1'
      return { comic: MOCK_COMIC, chapterUrl: ch }
    }
    return null
  }

  buildReadUrl(comic: ComicRef, chapterUrl: string): string {
    void comic
    return `/harness?ch=${encodeURIComponent(chapterUrl)}`
  }

  currentReadRoute(): { comic: ComicRef; chapterUrl: string } | null {
    return this.matchReadUrl(new URL(location.href))
  }

  onComicInfo(cb: (info: ComicInfo) => void): () => void {
    this.#infoSubs.add(cb)
    // harness：立即提供目录
    queueMicrotask(() => {
      cb({
        ref: MOCK_COMIC,
        title: 'harness 测试漫画',
        chapters: MOCK_CHAPTERS,
      })
    })
    return () => this.#infoSubs.delete(cb)
  }

  onPageList(cb: (list: PageList, siteId: string) => void): () => void {
    this.#pageSubs.add(cb)
    return () => this.#pageSubs.delete(cb)
  }

  emitPageList(list: PageList): void {
    for (const cb of [...this.#pageSubs]) cb(list, 'harness')
  }

  async resolveComic(comic: ComicRef): Promise<ComicInfo> {
    void comic
    await sleep(30)
    return { ref: MOCK_COMIC, title: 'harness 测试漫画', chapters: MOCK_CHAPTERS }
  }

  async resolveChapter(comic: ComicRef, chapterUrl: string): Promise<PageList> {
    void comic
    this.resolveLog.push(`${chapterUrl}#${this.resolveCountOf(chapterUrl) + 1}`)
    const count = this.resolveCountOf(chapterUrl) + 1
    this.#resolveCounts.set(chapterUrl, count)
    await sleep(120)
    if (chapterUrl === 'mock://ch/1') return this.#chapter1()
    if (chapterUrl === 'mock://ch/2') return this.#chapter2()
    if (chapterUrl === 'mock://ch/3') return this.#chapter3()
    if (chapterUrl === 'mock://ch/long') return this.#chapterLong()
    if (chapterUrl === 'mock://ch/fault') return this.#chapterFault(count)
    throw new Error('未知章节')
  }

  /** 12 页普通漫画 + 2 页慢图（恢复任务测试用）。 */
  #chapter1(): PageList {
    const images: string[] = []
    for (let i = 0; i < 12; i++) images.push(mockImg(`ch1-p${i}`, 600, 900))
    images.push(mockSlow('ch1-slow-1', 600))
    images.push(mockSlow('ch1-slow-2', 700))
    return { chapterUrl: 'mock://ch/1', images, resolvedAt: Date.now() }
  }

  /** 8 页：含 1 页永久 404（失败清单）、1 页限流 2 次后成功。 */
  #chapter2(): PageList {
    const images: string[] = []
    for (let i = 0; i < 8; i++) images.push(mockImg(`ch2-p${i}`, 700, 480))
    images[3] = '/mock/f/404.png'
    images[5] = '/mock/f/429.png'
    return { chapterUrl: 'mock://ch/2', images, resolvedAt: Date.now() }
  }

  /** 条漫：6 页长条图（纵向阅读/页内位置测试用）。 */
  #chapter3(): PageList {
    const images: string[] = []
    for (let i = 0; i < 6; i++) images.push(mockImg(`ch3-p${i}`, 600, 2400))
    return { chapterUrl: 'mock://ch/3', images, resolvedAt: Date.now() }
  }

  /** 长章节（60 页）：预加载窗口验收（R-C4）用。 */
  #chapterLong(): PageList {
    const images: string[] = []
    for (let i = 0; i < 60; i++) images.push(mockImg(`long-p${i}`, 600, 900))
    return { chapterUrl: 'mock://ch/long', images, resolvedAt: Date.now() }
  }

  /** 故障注入：v1 有 HTML 页与过期页（403），重解析（v2+）后全部有效（R-D13 路径）。 */
  #chapterFault(version: number): PageList {
    const images: string[] = []
    for (let i = 0; i < 6; i++) images.push(mockImg(`fault-p${i}-v${version}`, 640, 960))
    if (version === 1) {
      images[1] = '/mock/f/html.png'
      images[2] = '/mock/f/expired.png'
    }
    return { chapterUrl: 'mock://ch/fault', images, resolvedAt: Date.now() }
  }

  supportOf(siteId: string): 'full' | 'read-only' | 'unsupported' {
    return siteId === 'harness' ? 'full' : 'unsupported'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
