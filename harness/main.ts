/**
 * harness 入口：用 mock 适配器驱动真实的 app 装配（控制器/UI/下载），
 * 暴露 e2e 句柄（清理表计数、fetch 记录、控制器与任务管理器）。
 */
import { createReaderApp } from '../src/app'
import { cleanupActiveCount } from '../src/utils/cleanup'
import { CaptureBus } from '../src/site/mangayun/capture'
import { ChapterResolver } from '../src/site/mangayun/batch-resolver'
import { MockAdapter, MOCK_COMIC } from './mock-adapter'
import { FloatingEntry } from '../src/ui/entry'

// fetch 计数（恢复任务测试：断言不重复下载）
const fetchLog: string[] = []
const origFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/mock/')) fetchLog.push(url.split('?')[0]!)
  } catch {
    /* 忽略 */
  }
  return origFetch(input, init)
}

const adapter = new MockAdapter()
// 真实 ChapterResolver（e2e：捕获失败时的 DOM 抓取兜底路径）
const scrapeBus = new CaptureBus()
scrapeBus.start()
const scrapeResolver = new ChapterResolver(scrapeBus)
const entryRef: { current?: FloatingEntry } = {}
const app = createReaderApp({
  adapter,
  onReaderActiveChange: (active) => { if (active) entryRef.current?.hide(); else entryRef.current?.show() },
})
const route = adapter.currentReadRoute() ?? { comic: MOCK_COMIC, chapterUrl: 'mock://ch/1' }
const entry = new FloatingEntry({
  onTap: () => { void app.controller.enter(route) },
  loadPosition: () => app.settingsStore.get().floatPos,
  savePosition: (position) => { app.settingsStore.update({ floatPos: position }) },
})
entryRef.current = entry

// e2e 句柄
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = window as any
w.__harness = {
  app,
  adapter,
  scrapeResolver,
  controller: app.controller,
  manager: app.manager,
  panel: app.panel,
  ui: app.ui,
  entry,
  fetchLog: {
    get: () => [...fetchLog],
    clear: () => {
      fetchLog.length = 0
    },
    counts: () => {
      const m = new Map<string, number>()
      for (const u of fetchLog) m.set(u, (m.get(u) ?? 0) + 1)
      return Object.fromEntries(m)
    },
  },
  cleanupActiveCount,
  resetStorage: () => {
    try {
      localStorage.clear()
    } catch {
      /* 忽略 */
    }
  },
}

// 标题与说明（非 Shadow DOM 部分）
const banner = document.createElement('div')
banner.style.cssText =
  'font:14px system-ui; padding:8px 12px; background:#111; color:#ddd; position:sticky; top:0; z-index:100'
banner.textContent =
  'MangaYun Reader harness：增强阅读器与下载的本地验收页（mock 适配器）'
document.body.prepend(banner)

const original = document.createElement('main')
original.setAttribute('aria-label', '漫画阅读器')
original.style.cssText = 'max-width:640px;margin:32px auto;padding:32px 24px;font:15px/1.8 "Microsoft YaHei",sans-serif;color:#b9c7dc'
const heading = document.createElement('h1')
heading.textContent = '阅读，由你定义。'
heading.style.cssText = 'font-size:28px;font-weight:600;color:#eef3fa;margin:0 0 16px'
const description = document.createElement('p')
description.textContent = '这里是本地模拟的原站阅读页。轻点右下方的书页图标进入增强阅读器；长拖图标可以调整位置，松手后自动贴边。'
const note = document.createElement('p')
note.textContent = '本页只使用测试图片，不访问真实漫画来源，也不能替代安卓真机验收。'
note.style.cssText = 'font-size:12px;color:#8496b0;border-top:1px solid #354154;padding-top:20px;margin-top:32px'
original.append(heading, description, note)
document.body.append(original)

// 自动进入第 1 话（?ch= 可指定）
if (new URLSearchParams(location.search).has('entry')) entry.show()
else void app.controller.enter(route)
