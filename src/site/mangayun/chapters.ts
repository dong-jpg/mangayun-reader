/**
 * 章节正序化（§3.5）。规则逐行移植自原站前端（docs/specs/site-probe-2026-10-24.md），
 * 下载编号必须与原站目录“正序”一致。
 */
import type { Chapter } from '../types'

/** 接口返回的原始章节对象（字段以实际响应为准，宽松解析）。 */
export interface RawChapter {
  id?: string
  name?: string
  url?: string
  order?: number
  category?: string
}

/** 原站代码中参与“整体反转”判定的已知来源集合。 */
const KNOWN_SITES = new Set([
  'dm5', 'mangabz', 'manben', 'manhuagui', 'manhuazhijia',
  'tuku', 'rumanhua', 'comicbox', 'manhuazhan',
])

const RE_NUM_UNIT = /(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:话|話|回|集|卷|期|章|篇)/i
const RE_NUM_LATIN = /(?:EP|Ch(?:apter)?|Vol(?:ume)?)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i
const RE_NUM_PURE = /^(?:第\s*)?(\d+(?:\.\d+)?)$/
const RE_SLOT = /(?:chapter_slot)=(\d+)/i
const RE_EXTRA =
  /外传|外傳|番外|特别篇|特別篇|特典|附录|附錄|加笔|加筆|短篇|单行本特典|\bSP\b|\bExtra\b|\bOmake\b|\bGaiden\b/i
const RE_PROLOGUE = /^(?:0\.)?(?:序章|预告|預告|开篇|開篇|前言|第零)/i
const RE_FINALE = /最终话|最終話|终章|終章|完结篇|完結篇|大结局|最後一/
const RE_ANY_NUM = /(?:第|\b)\d+/
const RE_FIRST_CHAPTER = /第\s*0*1\s*(?:话|話|回|集|章)/
const RE_VOLUME = /卷|Vol(?:ume)?/i

type Kind = 'main' | 'extra'
type Unit = 'episode' | 'volume'

function mean(list: number[]): number {
  return list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0
}

function kindOf(name: string, category: string | undefined): Kind {
  return RE_EXTRA.test(`${category ?? ''} ${name}`) ? 'extra' : 'main'
}

function unitOf(name: string): Unit {
  return RE_VOLUME.test(name) ? 'volume' : 'episode'
}

/** 从标题或 URL 解析话数；解析不出返回 null。 */
export function parseChapterNumber(name: string, url = ''): number | null {
  const r = name.replace(/\s+/g, ' ').trim()
  if (!r) return null
  if (RE_PROLOGUE.test(r)) return 0
  if (RE_FINALE.test(r) && !RE_ANY_NUM.test(r)) return 1e6
  const unit = RE_NUM_UNIT.exec(r)
  if (unit?.[1]) return Number(unit[1])
  const latin = RE_NUM_LATIN.exec(r)
  if (latin?.[1]) return Number(latin[1])
  const leading = r.match(/^(\d+)(?:\.(\d+))?(?:[.\-_、\s]+|$)/)
  if (leading) {
    const int = leading[1]!
    const frac = leading[2]
    return frac && frac !== int && frac.length <= 2 ? Number(`${int}.${frac}`) : Number(int)
  }
  const pure = RE_NUM_PURE.exec(r)
  if (pure?.[1]) return Number(pure[1])
  if (url) {
    const slot = RE_SLOT.exec(url)
    if (slot?.[1]) return Number(slot[1])
  }
  return null
}

/** order 序列首尾均值判断是否倒序（原站取前后各 8 项）。 */
export function detectDescending(orders: number[]): boolean | null {
  if (orders.length < 3) return null
  const head = orders.slice(0, Math.min(8, orders.length))
  const tail = orders.slice(-Math.min(8, orders.length))
  const headMean = mean(head)
  const tailMean = mean(tail)
  if (headMean > tailMean + 1) return true
  if (tailMean > headMean + 1) return false
  return null
}

function shouldReverseBySite(siteId: string | undefined, chapters: RawChapter[]): boolean {
  if (!siteId || !KNOWN_SITES.has(siteId) || chapters.length < 2) return false
  const first = chapters[0]?.name ?? ''
  const last = chapters[chapters.length - 1]?.name ?? ''
  return !(RE_FIRST_CHAPTER.test(first) && !RE_FIRST_CHAPTER.test(last))
}

interface Item {
  raw: RawChapter
  index: number
  num: number | null
  kind: Kind
  unit: Unit
}

/**
 * 输出正序章节列表：order 从 1 开始，rawIndex 为接口原始下标（写入下载报告）。
 */
export function normalizeChapters(siteId: string | undefined, raw: RawChapter[]): Chapter[] {
  if (!raw.length) return []
  const items: Item[] = raw.map((raw, index) => ({
    raw,
    index,
    num: parseChapterNumber(raw.name ?? '', raw.url ?? ''),
    kind: kindOf(raw.name ?? '', raw.category),
    unit: unitOf(raw.name ?? ''),
  }))
  const parsedCount = items.filter((it) => it.num != null).length
  const coverage = parsedCount / items.length

  let sorted: Item[]
  if (coverage >= 0.35 && parsedCount >= 3) {
    sorted = [...items].sort((a, b) => {
      const kindDiff = (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1)
      if (kindDiff !== 0) return kindDiff
      const unitDiff = (a.unit === 'episode' ? 0 : a.unit === 'volume' ? 1 : 2) -
        (b.unit === 'episode' ? 0 : b.unit === 'volume' ? 1 : 2)
      if (unitDiff !== 0) return unitDiff
      if (a.num != null && b.num != null && a.num !== b.num) return a.num - b.num
      if (a.num != null && b.num == null) return -1
      if (a.num == null && b.num != null) return 1
      return a.index - b.index
    })
  } else if (shouldReverseBySite(siteId, raw)) {
    sorted = [...items].reverse()
  } else {
    const byOrder = [...items].sort((a, b) => {
      const diff = (a.raw.order ?? 0) - (b.raw.order ?? 0)
      return diff !== 0 ? diff : a.index - b.index
    })
    const orders = byOrder.map((it, i) => it.raw.order || i)
    sorted = detectDescending(orders) ? byOrder.reverse() : byOrder
  }

  return sorted.map((it, i) => ({
    url: it.raw.url ?? '',
    name: it.raw.name ?? '',
    order: i + 1,
    rawIndex: it.index,
    category: it.raw.category,
  }))
}
