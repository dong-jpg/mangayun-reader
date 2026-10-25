import { describe, expect, it } from 'vitest'
import {
  detectDescending,
  normalizeChapters,
  parseChapterNumber,
  type RawChapter,
} from '../../src/site/mangayun/chapters'
import {
  decimalAndVolume,
  emptyCatalog,
  manhuazhijiaReversed,
  orderDescending,
  siteRuleReverse,
  withExtras,
  type CatalogFixture,
} from '../fixtures/chapters'

function check(fixture: CatalogFixture): void {
  const result = normalizeChapters(fixture.siteId, fixture.raw)
  expect(result.map((c) => c.name)).toEqual(fixture.expectedNames)
  // order 从 1 开始连续
  expect(result.map((c) => c.order)).toEqual(result.map((_, i) => i + 1))
  // rawIndex 指向原始下标
  for (const chapter of result) {
    const origin = fixture.raw[chapter.rawIndex]
    expect(origin?.name).toBe(chapter.name)
  }
}

describe('normalizeChapters（原站正序规则）', () => {
  it('接口倒序 + 话数可解析 → 按话数升序', () => check(manhuazhijiaReversed))
  it('正篇在前、番外在后', () => check(withExtras))
  it('小数话与卷：episode 在前 volume 在后，小数正确排序', () => check(decimalAndVolume))
  it('话数不可解析：order 递减 → 反转', () => check(orderDescending))
  it('已知来源首章非第 1 话 → 整体反转', () => check(siteRuleReverse))
  it('空目录', () => check(emptyCatalog))

  it('只选第 10 话时保留完整目录正序序号（R-D3）', () => {
    const raw: RawChapter[] = Array.from({ length: 12 }, (_, i) => ({
      name: `第${i + 1}话`,
      url: `https://x.com/c/${i + 1}`,
      order: 11 - i,
    }))
    const normalized = normalizeChapters('manhuazhijia', raw)
    const tenth = normalized.find((c) => c.name === '第10话')
    expect(tenth?.order).toBe(10)
  })
})

describe('parseChapterNumber', () => {
  it.each([
    ['第12话', 12],
    ['第 012 話', 12],
    ['第3.5回', 3.5],
    ['EP.7', 7],
    ['Chapter 9', 9],
    ['Vol.2', 2],
    ['24', 24],
    ['第24.5话', 24.5],
    ['序章', 0],
    ['预告篇', 0],
    ['最终话', 1e6],
    ['完结篇', 1e6],
  ])('%s → %s', (name, expected) => {
    expect(parseChapterNumber(name)).toBe(expected)
  })

  it('URL 中的 chapter_slot 兜底', () => {
    expect(parseChapterNumber('单行本特典', 'https://x.com/c?chapter_slot=17')).toBe(17)
  })

  it('解析不出返回 null', () => {
    expect(parseChapterNumber('雨夜')).toBeNull()
    expect(parseChapterNumber('')).toBeNull()
  })
})

describe('detectDescending', () => {
  it('长递减序列返回 true（前后各 8 项均值可区分）', () => {
    expect(detectDescending(Array.from({ length: 20 }, (_, i) => 20 - i))).toBe(true)
  })
  it('长递增序列返回 false', () => {
    expect(detectDescending(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(false)
  })
  it('少于 3 项返回 null', () => {
    expect(detectDescending([5, 4])).toBeNull()
  })
  it('短序列（≤16 项）前后窗口重叠返回 null', () => {
    expect(detectDescending([9, 8, 7, 6, 5, 4, 3, 2, 1])).toBeNull()
  })
})
