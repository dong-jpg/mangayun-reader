/**
 * 入口：幂等初始化（§4.4 清理），区分顶层页面与解析用 iframe（§3.3）。
 * 顶层：捕获层 + 路由监听（wrap pushState/replaceState + popstate）+ 悬浮入口 +
 * 增强阅读器（app.ts 公共装配）；iframe 内：只启用捕获层并把事件转发给父页面。
 */
import { createMangayunAdapter } from './site/mangayun/adapter'
import { CaptureBus, RESOLVE_FORWARD_SOURCE } from './site/mangayun/capture'
import { isResolveIframe, resolveIframeToken } from './site/mangayun/batch-resolver'
import { createKV } from './store/kv'
import { migrateStorage } from './store/migrate'
import { createReaderApp } from './app'
import { FloatingEntry } from './ui/entry'
import { RETURN_FLAG } from './reader/controller'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any

// ---------- 解析用 iframe：只装捕获层并转发（§3.3） ----------
if (typeof window !== 'undefined' && isResolveIframe(window.name)) {
  const parentToken = resolveIframeToken(window.name)
  const bus = new CaptureBus()
  bus.start()
  if (parentToken) {
    bus.on((event) => {
      try {
        if (window.parent === window) return
        window.parent.postMessage(
          { source: RESOLVE_FORWARD_SOURCE, token: parentToken, event },
          location.origin,
        )
      } catch {
        /* 父页面不可达 */
      }
    })
  }
} else if (!g.__myrInitialized) {
  g.__myrInitialized = true
  main()

  function main(): void {
    const kv = createKV()
    migrateStorage(kv)
    const bus = new CaptureBus()
    bus.start()
    const adapter = createMangayunAdapter(bus)
    const app = createReaderApp({ adapter, kv })
    const { controller, ui, settingsStore } = app

    // ---------- 悬浮入口与路由（§4.4 事件与路由） ----------
    const entry = new FloatingEntry({
      onTap: () => {
        const route = adapter.currentReadRoute()
        if (route) void controller.enter(route)
      },
      loadPosition: () => settingsStore.get().floatPos,
      savePosition: (pos) => settingsStore.update({ floatPos: pos }),
    })

    function syncRoute(): void {
      const route = adapter.currentReadRoute()
      if (route && !controller.active) {
        entry.show()
        ui.setCurrentChapter(route.chapterUrl)
        const settings = settingsStore.effective(route.comic)
        if (settings.autoEnter) void controller.enter(route)
      } else if (!route) {
        entry.hide()
        if (controller.active) controller.exit()
      }
    }

    // 自己切话后自动返回增强阅读器（§3.2 约束 4 的落地）
    let returning = false
    try {
      returning = sessionStorage.getItem(RETURN_FLAG) === '1'
      if (returning) sessionStorage.removeItem(RETURN_FLAG)
    } catch {
      returning = false
    }

    // 包装 history API：SPA 路由变化时同步入口显隐
    const wrapHistory = (name: 'pushState' | 'replaceState'): void => {
      const orig = history[name].bind(history) as (...args: unknown[]) => unknown
      history[name] = function (this: History, ...args: unknown[]): unknown {
        const result = orig(...args)
        setTimeout(syncRoute, 0)
        return result
      } as typeof history.pushState
    }
    wrapHistory('pushState')
    wrapHistory('replaceState')
    window.addEventListener('popstate', () => setTimeout(syncRoute, 0))

    // 启动
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(onReady, 300))
    } else {
      setTimeout(onReady, 300)
    }

    function onReady(): void {
      syncRoute()
      if (returning) {
        const route = adapter.currentReadRoute()
        if (route) void controller.enter(route)
      }
    }
  }
}
