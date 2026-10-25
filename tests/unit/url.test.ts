import { describe, expect, it } from 'vitest'
import {
  buildReadPath,
  decodeChapterParam,
  decodeComicParam,
  encodeComicParam,
  parseReadPath,
  parseReadSearch,
} from '../../src/site/mangayun/url'

describe('mangayun url 编解码', () => {
  it('往返一致（含中文与特殊字符）', () => {
    const comic = { siteId: 'manhuazhijia', detailUrl: 'https://www.manhuazhijia.cc/comic/斗破苍穹?a=1&b=中' }
    const chapterUrl = 'https://www.manhuazhijia.cc/chapter/8690778?x=/dd'
    const path = buildReadPath(comic, chapterUrl)
    const parsed = parseReadPath(path)
    expect(parsed).not.toBeNull()
    expect(parsed!.comic).toEqual(comic)
    expect(parsed!.chapterUrl).toBe(chapterUrl)
  })

  it('与原站实现一致（手工向量）', () => {
    // 原站：JSON.stringify(["a","b"]) → base64url
    const param = encodeComicParam('a', 'b')
    expect(param).toBe('WyJhIiwiYiJd')
    expect(decodeComicParam('WyJhIiwiYiJd')).toEqual({ siteId: 'a', detailUrl: 'b' })
  })

  it('非法输入返回 null', () => {
    expect(decodeComicParam('!!!!')).toBeNull() // 非 base64 字符被忽略后解析失败
    expect(decodeComicParam(encodeBase64('not json'))).toBeNull()
    expect(decodeComicParam(encodeBase64('[1,2]'))).toBeNull() // 非字符串元素
    expect(decodeComicParam(encodeBase64('["only-one"]'))).toBeNull() // 缺字段
    expect(decodeChapterParam('')).toBeNull()
  })

  it('parseReadPath 只匹配 /read 路径', () => {
    expect(parseReadPath('/')).toBeNull()
    expect(parseReadPath('/m/abc')).toBeNull()
    expect(parseReadPath('/read/abc')).toBeNull()
    const path = buildReadPath({ siteId: 's', detailUrl: 'https://x.com/c/1' }, 'https://x.com/ch/1')
    expect(parseReadPath(path)).not.toBeNull()
  })

  it('parseReadSearch 支持查询串形式', () => {
    const q = '?site=dm5&manga=https%3A%2F%2Fx%2Fc%2F1&chapter=https%3A%2F%2Fx%2Fch%2F1'
    const parsed = parseReadSearch(q)
    expect(parsed).toEqual({
      comic: { siteId: 'dm5', detailUrl: 'https://x/c/1' },
      chapterUrl: 'https://x/ch/1',
    })
    expect(parseReadSearch('?site=dm5')).toBeNull()
  })
})

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
