import { expect, test, type Page } from '@playwright/test'
import type { AppHandle } from '../../src/app'
import type { SiteAdapter } from '../../src/site/types'

interface Harness {
  app: AppHandle
  manager: AppHandle['manager']
  controller: AppHandle['controller']
  adapter: SiteAdapter
  fetchLog: { clear(): void; get(): string[] }
}

async function ready(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.myr-root.myr-open')).toBeVisible()
  await page.locator('.myr-page img[src]').first().waitFor()
}

async function startChapter(page: Page, order = 3): Promise<string> {
  return page.evaluate(async (target) => {
    const h = (window as unknown as { __harness: Harness }).__harness
    const info = await h.adapter.resolveComic(h.controller.comic!, h.controller.currentChapterUrl)
    return h.manager.start(info.ref, info.title, [info.chapters.find((chapter) => chapter.order === target)!])
  }, order)
}

async function state(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as unknown as { __harness: Harness }).__harness.manager.task?.state)
}

test('禁用 OPFS 后由 IndexedDB 完成真实下载和打包', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: async () => { throw new DOMException('disabled for test', 'NotAllowedError') } })
  })
  await ready(page)
  await startChapter(page)
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe('packed')
  const result = await page.evaluate(async () => {
    const h = (window as unknown as { __harness: Harness }).__harness
    const pack = h.manager.packHandle!
    return { storage: h.manager.task!.storage, blob: !!pack.blob, file: !!pack.file, bytes: pack.byteLength, actualBytes: pack.blob!.size, report: pack.report.result }
  })
  expect(result).toMatchObject({ storage: 'idb', blob: true, file: false, report: 'complete' })
  expect(result.bytes).toBe(result.actualBytes)
})

test('内存模式达到容量上限立即停止新请求并显示暂停原因', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'getDirectory', { configurable: true, value: async () => { throw new Error('OPFS disabled') } })
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined })
  })
  await ready(page)
  const originalCap = await page.evaluate(async () => {
    const h = (window as unknown as { __harness: Harness }).__harness
    const cache = await h.manager.ensureCache()
    const original = cache.capBytes
    // Exercise the real capacity branch without allocating 100 MiB in every run.
    Object.defineProperty(cache, 'capBytes', { value: 1 })
    h.fetchLog.clear()
    return original
  })
  expect(originalCap).toBe(100 * 1024 * 1024)
  await startChapter(page)
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe('paused')
  const result = await page.evaluate(() => {
    const h = (window as unknown as { __harness: Harness }).__harness
    return { note: h.manager.task!.note, storage: h.manager.task!.storage, requests: h.fetchLog.get().length }
  })
  expect(result.storage).toBe('memory')
  expect(result.note).toContain('内存模式')
  expect(result.requests).toBeLessThanOrEqual(2)
})

test('第二个标签页不能执行同一任务，也不能覆盖持锁者的任务记录', async ({ page, context }) => {
  await ready(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/mock/slow/**', async (route) => {
    await gate
    await route.continue().catch(() => {})
  })
  const second = await context.newPage()
  try {
    const id = await startChapter(page, 1)
    await page.waitForFunction(() => {
      const h = (window as unknown as { __harness: Harness }).__harness
      return (h.manager.task?.chapters[0]?.pages.filter((value) => value === 'cached').length ?? 0) >= 4
    })
    const snapshot = await page.evaluate((taskId) => {
      const h = (window as unknown as { __harness: Harness }).__harness
      return h.app.kv.get(`myr:v1:task:${taskId}`)
    }, id)
    await ready(second)
    await second.evaluate(async (taskId) => {
      const h = (window as unknown as { __harness: Harness }).__harness
      h.fetchLog.clear()
      await h.manager.resume(taskId)
    }, id)
    await expect.poll(() => state(second)).toBe('paused')
    const other = await second.evaluate(async (taskId) => {
      const h = (window as unknown as { __harness: Harness }).__harness
      let packingDenied = false
      try { await h.manager.pack(true) } catch { packingDenied = true }
      return { note: h.manager.task?.note, packingDenied, requests: h.fetchLog.get(), persisted: h.app.kv.get(`myr:v1:task:${taskId}`) }
    }, id)
    expect(other.note).toContain('另一个标签页')
    expect(other.requests).toEqual([])
    expect(other.packingDenied).toBe(true)
    expect(other.persisted).toEqual(snapshot)
    release()
    await expect.poll(() => state(page), { timeout: 30_000 }).toBe('packed')
  } finally {
    release()
    await second.close()
  }
})

test('打包时缓存丢失应进入失败状态，不能保留旧的成功产物', async ({ page }) => {
  await ready(page)
  await startChapter(page)
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe('packed')
  const result = await page.evaluate(async () => {
    const h = (window as unknown as { __harness: Harness }).__harness
    const cache = await h.manager.ensureCache()
    await cache.remove(h.manager.cacheKeyOf(h.manager.task!.id, 0, 0))
    let rejected = false
    try { await h.manager.pack(false) } catch { rejected = true }
    return { rejected, state: h.manager.task!.state, artifact: h.manager.packHandle, note: h.manager.task!.note }
  })
  expect(result.rejected).toBe(true)
  expect(result.state).toBe('failed')
  expect(result.artifact).toBeNull()
  expect(result.note).toContain('missing cached page')
  await ready(page)
  await page.evaluate(() => (window as unknown as { __harness: Harness }).__harness.app.panel.open())
  await page.getByRole('button', { name: '恢复任务', exact: true }).click({ timeout: 5000 })
  await expect.poll(() => state(page), { timeout: 30_000 }).toBe('packed')
  const requests = await page.evaluate(() => (window as unknown as { __harness: Harness }).__harness.fetchLog.get())
  expect(requests).toHaveLength(1)
})
