/**
 * harness 入口：用 mock 适配器驱动真实的 app 装配（控制器/UI/下载），
 * 暴露 e2e 句柄（清理表计数、fetch 记录、控制器与任务管理器）。
 */
import { createReaderApp } from '../src/app'
import { cleanupActiveCount } from '../src/utils/cleanup'
import { MockAdapter, MOCK_COMIC } from './mock-adapter'

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
const app = createReaderApp({ adapter })

// e2e 句柄
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = window as any
w.__harness = {
  app,
  adapter,
  controller: app.controller,
  manager: app.manager,
  panel: app.panel,
  ui: app.ui,
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

// 自动进入第 1 话（?ch= 可指定）
const route = adapter.currentReadRoute() ?? { comic: MOCK_COMIC, chapterUrl: 'mock://ch/1' }
void app.controller.enter(route)
