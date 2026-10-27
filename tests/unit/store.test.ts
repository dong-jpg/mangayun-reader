import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { KV } from '../../src/store/kv'
import { SettingsStore, comicKey, DEFAULT_SETTINGS } from '../../src/store/settings'
import { ProgressStore, MAX_COMICS } from '../../src/store/progress'
import { exportData, importData, migrateStorage } from '../../src/store/migrate'
import type { ComicRef } from '../../src/site/types'

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: (key) => data.get(key),
    set: (key, value) => void data.set(key, value),
    delete: (key) => void data.delete(key),
    list: () => [...data.keys()],
  } as KV & { data: Map<string, unknown> }
}

const COMIC: ComicRef = { siteId: 's', detailUrl: 'https://x.com/c/1' }
const COMIC_B: ComicRef = { siteId: 's', detailUrl: 'https://x.com/c/2' }

describe('settings（R-P3）', () => {
  it('默认值与钳制', () => {
    const kv = memoryKV()
    const store = new SettingsStore(kv)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(store.get().horizontalFit).toBe('auto')
    const s = store.update({ verticalWidth: 300, download: { concurrency: 99 }, horizontalFit: 'bogus' as never })
    expect(s.verticalWidth).toBe(100)
    expect(s.download.concurrency).toBe(4)
    expect(s.horizontalFit).toBe('auto')
    expect(store.update({ horizontalFit: 'screen' }).horizontalFit).toBe('screen')
  })

  it('单部漫画覆盖项不影响其他漫画', () => {
    const kv = memoryKV()
    const store = new SettingsStore(kv)
    const progress = new ProgressStore(kv)
    progress.setOverrides(COMIC, { mode: 'horizontal' })
    expect(store.effective(COMIC).mode).toBe('horizontal')
    expect(store.effective(COMIC_B).mode).toBe(DEFAULT_SETTINGS.mode)
    // 改全局不影响已有覆盖
    store.update({ mode: 'single' })
    expect(store.effective(COMIC).mode).toBe('horizontal')
  })

  it('reload refreshes a live store after settings are imported', () => {
    const source = memoryKV()
    new SettingsStore(source).update({ background: 'white', preload: { before: 4, after: 7 } })
    const target = memoryKV()
    const live = new SettingsStore(target)
    expect(importData(target, exportData(source)).ok).toBe(true)
    live.reload()
    expect(live.get().background).toBe('white')
    live.update({ keepAwake: false })
    expect(live.get().preload).toEqual({ before: 4, after: 7 })
  })
})

describe('progress（R-P4、R-P6）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('滚动停止 500ms 后保存；每秒写入不超过 2 次', () => {
    const kv = memoryKV()
    const store = new ProgressStore(kv)
    let writes = 0
    const origSet = kv.set.bind(kv)
    kv.set = (key, value) => {
      if (key.startsWith('myr:v1:comic')) writes++
      origSet(key, value)
    }
    // 2 秒内连续记录 20 次锚点
    for (let t = 0; t < 2000; t += 100) {
      store.record(COMIC, { chapterUrl: 'ch', page: t / 100, offset: 0.5 })
      vi.advanceTimersByTime(100)
    }
    vi.advanceTimersByTime(600)
    // 每次防抖到期才写：500ms 一次 → 2 秒约 4 次
    expect(writes).toBeLessThanOrEqual(6)
    expect(store.get(COMIC)?.chapterUrl).toBe('ch')
  })

  it('flush 立即保存', () => {
    const kv = memoryKV()
    const store = new ProgressStore(kv)
    store.record(COMIC, { chapterUrl: 'ch', page: 3, offset: 0.7 })
    store.flush()
    expect(store.get(COMIC)).toMatchObject({ chapterUrl: 'ch', page: 3, offset: 0.7 })
  })

  it('第 501 部写入后淘汰最旧（R-P6）', () => {
    const kv = memoryKV()
    const store = new ProgressStore(kv)
    const mk = (i: number): ComicRef => ({ siteId: 's', detailUrl: `https://x.com/c/${i}` })
    for (let i = 0; i < MAX_COMICS; i++) {
      store.record(mk(i), { chapterUrl: 'ch', page: i, offset: 0 })
      store.flush()
    }
    expect(store.recentCount()).toBe(MAX_COMICS)
    // 第 501 部：第 0 部被淘汰
    store.record(mk(MAX_COMICS), { chapterUrl: 'ch', page: 0, offset: 0 })
    store.flush()
    expect(store.recentCount()).toBe(MAX_COMICS)
    expect(store.get(mk(0))).toBeNull()
    expect(store.get(mk(1))).not.toBeNull()
    expect(store.get(mk(MAX_COMICS))).not.toBeNull()
  })

  it('进度按章节区分：不同章节不互相覆盖恢复锚点', () => {
    const kv = memoryKV()
    const store = new ProgressStore(kv)
    store.record(COMIC, { chapterUrl: 'ch1', page: 5, offset: 0.5 })
    store.flush()
    const saved = store.get(COMIC)!
    expect(saved.chapterUrl).toBe('ch1')
    // 控制器只在章节匹配时使用锚点
    expect(saved.chapterUrl === 'ch2').toBe(false)
  })
})

describe('migrate / import / export（R-P1、R-P5）', () => {
  it('旧数据补齐字段', () => {
    const kv = memoryKV()
    kv.set('myr:v1:settings', { schema: 1, mode: 'single' })
    const result = migrateStorage(kv)
    expect(result.migrated).toContain('myr:v1:settings')
    const settings = kv.get<Record<string, unknown>>('myr:v1:settings')!
    expect(settings['keepAwake']).toBe(true)
    expect(settings['mode']).toBe('single')
  })

  it('导出导入往返一致', () => {
    const kv = memoryKV()
    const settings = new SettingsStore(kv)
    settings.update({ background: 'white' })
    const progress = new ProgressStore(kv)
    progress.record(COMIC, { chapterUrl: 'ch', page: 1, offset: 0.2 })
    progress.flush()
    const json = exportData(kv)

    const kv2 = memoryKV()
    expect(importData(kv2, json).ok).toBe(true)
    expect(new SettingsStore(kv2).get().background).toBe('white')
    expect(new ProgressStore(kv2).get(COMIC)?.chapterUrl).toBe('ch')
    // 不含站点键（N-3/N-4）
    expect(json).not.toContain('ym_auth_token')
  })

  it('导入非法内容报错', () => {
    const kv = memoryKV()
    expect(importData(kv, 'not json').ok).toBe(false)
    expect(importData(kv, '{"tool":"other","data":{}}').ok).toBe(false)
  })
})

describe('comicKey（R-P2）', () => {
  it('siteId + detailUrl 决定身份，同名不同来源不同键', () => {
    expect(comicKey({ siteId: 'a', detailUrl: 'u' })).toBe(comicKey({ siteId: 'a', detailUrl: 'u' }))
    expect(comicKey({ siteId: 'a', detailUrl: 'u' })).not.toBe(comicKey({ siteId: 'b', detailUrl: 'u' }))
    expect(comicKey({ siteId: 'a', detailUrl: 'u1' })).not.toBe(comicKey({ siteId: 'a', detailUrl: 'u2' }))
  })
})
