import { describe, expect, it } from 'vitest'
import { finalizeImageUrl, isProxiedUrl, isScrambledImage, supportOf, VERIFIED_SOURCES } from '../../src/site/mangayun/images'
import { validateImageBytes, parseRetryAfter, FetchFailure } from '../../src/download/fetcher'
import { buildReport, zipFileName } from '../../src/download/packer'
import { newTask, taskStats } from '../../src/download/task'
import { MemoryCache, MEMORY_MODE_CAP_MIB } from '../../src/download/cache'
import type { Chapter } from '../../src/site/types'

const BASE = 'https://mangayun.com'

describe('images（代理与来源规则，§3.4）', () => {
  it('白名单域名走代理', () => {
    expect(finalizeImageUrl('manhuazhijia', 'https://i.hamreus.com/a/1.webp', BASE)).toBe(
      'https://mangayun.com/api/image?url=' + encodeURIComponent('https://i.hamreus.com/a/1.webp') + '&siteId=manhuazhijia',
    )
  })
  it('白名单来源（siteId）走代理，即使域名不命中', () => {
    const out = finalizeImageUrl('manhuagui', 'https://cdn.example.com/x.jpg', BASE)
    expect(out.startsWith('https://mangayun.com/api/image?url=')).toBe(true)
  })
  it('普通来源直连绝对化', () => {
    expect(finalizeImageUrl('manhuazhijia', 'https://cdn.example.com/x.jpg', BASE)).toBe('https://cdn.example.com/x.jpg')
  })
  it('已是代理地址沿用（不再包一层）', () => {
    const proxied = 'https://mangayun.com/api/image?url=https%3A%2F%2Fi.hamreus.com%2Fa.webp&siteId=dm5'
    expect(finalizeImageUrl('dm5', proxied, BASE)).toBe(proxied)
  })
  it('isProxiedUrl', () => {
    expect(isProxiedUrl('https://mangayun.com/api/image?url=x', BASE)).toBe(true)
    expect(isProxiedUrl('https://cdn.example.com/x.jpg', BASE)).toBe(false)
  })
  it('comicbox 与打乱地址：不支持（§7 D3）', () => {
    expect(supportOf('comicbox')).toBe('unsupported')
    expect(supportOf('dm5')).toBe('full')
    expect(isScrambledImage('comicbox', 'https://x.com/a.jpg')).toBe(true)
    expect(isScrambledImage('dm5', 'https://ccavbox.com/a.jpg')).toBe(true)
    expect(isScrambledImage('dm5', 'https://normal.com/a.jpg')).toBe(false)
  })
  it('未验证来源集合', () => {
    expect(VERIFIED_SOURCES.has('manhuazhijia')).toBe(true)
    expect(VERIFIED_SOURCES.has('unknown-src')).toBe(false)
  })
})

describe('fetcher 校验（§4.7）', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  it('合法 JPEG', () => {
    expect(validateImageBytes(jpg, 'image/jpeg', jpg.length)).toEqual({ ext: 'jpg', mime: 'image/jpeg' })
  })
  it('Content-Length 不一致 → network', () => {
    expect(() => validateImageBytes(jpg, 'image/jpeg', jpg.length + 1)).toThrow(FetchFailure)
  })
  it('HTML 内容类型 → expired', () => {
    const htmlBytes = new TextEncoder().encode('<html>403</html>')
    expect(() => validateImageBytes(htmlBytes, 'text/html', htmlBytes.length)).toThrow(FetchFailure)
  })
  it('无效文件头 → expired（无法识别的格式记为失败）', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    try {
      validateImageBytes(junk, 'application/octet-stream', junk.length)
      expect.unreachable()
    } catch (e) {
      expect((e as FetchFailure).kind).toBe('expired')
    }
  })
  it('空响应 → expired', () => {
    try {
      validateImageBytes(new Uint8Array(0), 'image/jpeg', 0)
      expect.unreachable()
    } catch (e) {
      expect((e as FetchFailure).kind).toBe('expired')
    }
  })
  it('Retry-After 解析', () => {
    expect(parseRetryAfter('3')).toBe(3000)
    expect(parseRetryAfter('0')).toBe(0)
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('garbage')).toBeUndefined()
  })
})

describe('packer（R-D5、R-D9 报告）', () => {
  const chapter = (order: number, name: string, rawIndex: number): Chapter => ({
    url: `https://x/c/${order}`,
    name,
    order,
    rawIndex,
  })

  it('报告结构与缺页标注（R-D9）', () => {
    const report = buildReport({
      ref: { siteId: 'manhuazhijia', detailUrl: 'https://x/c' },
      title: '测试漫画',
      partial: true,
      siteVerified: false,
      chapters: [
        {
          chapter: chapter(2, '第2话', 1),
          expectedPages: 24,
          pages: [
            { page: 0, ext: 'jpg' },
            { page: 1, ext: null }, // 缺页
            { page: 2, ext: 'webp' },
          ],
        },
      ],
    })
    expect(report.result).toBe('partial')
    expect(report.chapters[0]!.folder).toBe('0002_第2话')
    expect(report.chapters[0]!.rawIndex).toBe(1)
    expect(report.chapters[0]!.expectedPages).toBe(24)
    expect(report.chapters[0]!.savedPages).toBe(2)
    expect(report.chapters[0]!.missing).toEqual([{ page: 2, reason: 'fetch-failed', attempts: 3 }])
    expect(report.site.verified).toBe(false)
  })

  it('完整任务 result=complete', () => {
    const report = buildReport({
      ref: { siteId: 'manhuazhijia', detailUrl: 'https://x/c' },
      title: 't',
      partial: false,
      siteVerified: true,
      chapters: [
        { chapter: chapter(1, '第1话', 0), expectedPages: 1, pages: [{ page: 0, ext: 'jpg' }] },
      ],
    })
    expect(report.result).toBe('complete')
  })

  it('zip 文件名与 _partial（R-D9）', () => {
    expect(zipFileName('测试', false)).toBe('测试.zip')
    expect(zipFileName('测试', true)).toBe('测试.zip_partial')
  })
})

describe('task（§4.7 状态与统计）', () => {
  it('新任务初始化', () => {
    const task = newTask({ siteId: 's', detailUrl: 'u' }, '标题', [
      { url: 'c1', name: '第1话', order: 1, rawIndex: 0 },
    ], 'memory')
    expect(task.state).toBe('draft')
    expect(task.chapters[0]!.pages).toEqual([])
    expect(task.id).toMatch(/^t/)
  })

  it('统计：完成/失败/待定', () => {
    const task = newTask({ siteId: 's', detailUrl: 'u' }, '标题', [], 'memory')
    task.chapters = [
      {
        chapter: { url: 'c1', name: '第1话', order: 1, rawIndex: 0 },
        resolved: true,
        expectedPages: 4,
        pages: ['cached', 'cached', 'failed', 'pending'],
        exts: ['jpg', 'jpg', null, null],
        failures: [{ page: 2, reason: 'http-404', attempts: 3 }],
      },
    ]
    const stats = taskStats(task)
    expect(stats).toMatchObject({ totalPages: 4, cachedPages: 2, failedPages: 1, pendingPages: 1 })
    expect(stats.complete).toBe(false)
  })
})

describe('MemoryCache（R-D11 上限）', () => {
  it('达到上限（100 MiB 固定值）时抛 MemoryCapError', async () => {
    // 用小容量子类等价验证（避免测试分配 100 MiB），
    // 固定值本身单独断言
    expect(MEMORY_MODE_CAP_MIB).toBe(100)
    class SmallCache extends MemoryCache {
      override readonly capBytes = 1000
    }
    const cache = new SmallCache()
    await cache.init()
    const chunk = new Uint8Array(400)
    await cache.put('a/0/0', chunk)
    await cache.put('a/0/1', chunk)
    // 第三块 1200 > 1000：抛错
    await expect(cache.put('a/0/2', chunk)).rejects.toMatchObject({ name: 'MemoryCapError' })
    expect(cache.usedBytes()).toBe(800)
  })

  it('put/get 往返与覆盖更新占用', async () => {
    const cache = new MemoryCache()
    await cache.init()
    const data = new TextEncoder().encode('hello')
    await cache.put('k', data)
    const hit = await cache.get('k')
    expect(hit?.bytes).toEqual(data)
    expect(hit?.length).toBe(5)
    await cache.put('k', new Uint8Array(2))
    expect(cache.usedBytes()).toBe(2)
    await cache.remove('k')
    expect(await cache.get('k')).toBeNull()
    expect(cache.usedBytes()).toBe(0)
  })
})
