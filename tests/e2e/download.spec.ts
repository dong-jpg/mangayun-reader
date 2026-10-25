import { expect, test, type Page } from '@playwright/test'

async function waitForReader(page: Page): Promise<void> {
  await expect(page.locator('.myr-root.myr-open')).toBeVisible({ timeout: 15000 })
  await page.locator('.myr-page img[src]').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
}

async function openToolbar(page: Page): Promise<void> {
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
}

async function openDownloadPanel(page: Page): Promise<void> {
  await openToolbar(page)
  await page.locator('.myr-bar .myr-btn', { hasText: '下载' }).click()
  await expect(page.locator('.myr-sheet')).toBeVisible({ timeout: 5000 })
}

async function selectChapters(page: Page, names: string[]): Promise<void> {
  await page.locator('.myr-dl-scope-row .myr-btn', { hasText: '多话勾选' }).click()
  for (const name of names) {
    await page.locator('.myr-dl-chapter', { hasText: name }).locator('input').check()
  }
  await page.locator('.myr-sheet-actions .myr-btn', { hasText: '确认下载' }).click()
}

async function waitForTaskState(page: Page, states: string[], timeout = 120000): Promise<string> {
  const state = await page.waitForFunction(
    (expected) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const task = (window as any).__harness.manager.task
      return task && expected.includes(task.state) ? task.state : undefined
    },
    states,
    { timeout, polling: 250 },
  )
  return state.jsonValue() as Promise<string>
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForReader(page)
})

test('故障章节：404/限流/HTML/过期 → 未完成 → 导出部分结果（R-D7~R-D9）', async ({ page }) => {
  await openDownloadPanel(page)
  await selectChapters(page, ['第2话', '故障注入话'])
  // 第2话有一页永久 404 → 最终 incomplete
  await waitForTaskState(page, ['incomplete'])
  const info = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = (window as any).__harness.manager.task
    return {
      state: task.state,
      chapters: task.chapters.map((c: { chapter: { name: string }; expectedPages: number; pages: string[] }) => ({
        name: c.chapter.name,
        expected: c.expectedPages,
        cached: c.pages.filter((s) => s === 'cached').length,
        failed: c.pages.filter((s) => s === 'failed').length,
      })),
    }
  })
  // 故障注入话：HTML/403 触发重解析（v2 有效）→ 全部成功
  const fault = info.chapters.find((c: { name: string }) => c.name.includes('故障'))
  expect(fault.cached).toBe(fault.expected)
  // 第2话：404 页失败、限流页重试后成功
  const ch2 = info.chapters.find((c: { name: string }) => c.name === '第2话')
  expect(ch2.failed).toBe(1)
  expect(ch2.cached).toBe(ch2.expected - 1)
  // 故障注入话应被解析了两次（v1 → v2）
  const resolves = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__harness.adapter.resolveLog.filter((l: string) => l.startsWith('mock://ch/fault')).length,
  )
  expect(resolves).toBeGreaterThanOrEqual(2)

  // 导出部分结果
  await page.locator('.myr-sheet-actions .myr-btn', { hasText: '导出部分结果' }).click()
  await expect(page.locator('.myr-sheet', { hasText: '保存' })).toBeVisible({ timeout: 30000 })
  const pack = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (window as any).__harness.manager.packHandle
    return {
      fileName: p.fileName,
      byteLength: p.byteLength,
      result: p.report.result,
      chapters: p.report.chapters.map((c: { folder: string; savedPages: number; expectedPages: number; missing: unknown[] }) => ({
        folder: c.folder,
        saved: c.savedPages,
        expected: c.expectedPages,
        missing: c.missing.length,
      })),
    }
  })
  expect(pack.fileName).toContain('_partial')
  expect(pack.result).toBe('partial')
  expect(pack.byteLength).toBeGreaterThan(1000)
  const folderNames = pack.chapters.map((c: { folder: string }) => c.folder)
  expect(folderNames).toEqual(expect.arrayContaining(['0002_第2话', '0004_故障注入话']))
  const ch2Pack = pack.chapters.find((c: { folder: string }) => c.folder === '0002_第2话')!
  expect(ch2Pack.missing).toBe(1)

  // ZIP 魔数与条目数（内存 sink 场景验证 blob 头）
  const zipHead = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (window as any).__harness.manager.packHandle
    const source = p.file ?? p.blob
    const buf = new Uint8Array(await source.slice(0, 4).arrayBuffer())
    return Array.from(buf)
  })
  expect(zipHead).toEqual([0x50, 0x4b, 0x03, 0x04])
})

test('恢复任务：刷新后不重复下载已完成图片（R-D13/T13）', async ({ page }) => {
  await openDownloadPanel(page)
  await selectChapters(page, ['第1话'])
  // 等到至少 4 页缓存后暂停（第1话含 2 张慢图，避免立即完成）
  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const task = (window as any).__harness.manager.task
      return task && task.chapters[0].pages.filter((s: string) => s === 'cached').length >= 4
    },
    undefined,
    { timeout: 60000, polling: 200 },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__harness.manager.pause())
  // 刷新页面（任务元数据在 localStorage 的 myr: 命名空间）
  await page.reload()
  await waitForReader(page)
  await openDownloadPanel(page)
  // 出现恢复提示
  await expect(page.locator('.myr-sheet', { hasText: '恢复任务' })).toBeVisible()
  await page.locator('.myr-sheet-actions .myr-btn', { hasText: '恢复任务' }).click()
  await waitForTaskState(page, ['packed'], 180000)
  // 恢复会话内：每个图片地址至多请求一次（无重复下载）
  const counts = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__harness.fetchLog.counts(),
  )
  for (const [url, count] of Object.entries(counts)) {
    if (url.includes('/mock/img/') || url.includes('/mock/slow/')) {
      expect(count, `重复下载：${url}`).toBeLessThanOrEqual(1)
    }
  }
  const stats = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const task = (window as any).__harness.manager.task
    return {
      state: task.state,
      cached: task.chapters[0].pages.filter((s: string) => s === 'cached').length,
      expected: task.chapters[0].expectedPages,
    }
  })
  expect(stats.state).toBe('packed')
  expect(stats.cached).toBe(stats.expected)
})

test('暂停后 2 秒内不再发出新请求（R-D6）', async ({ page }) => {
  await openDownloadPanel(page)
  await selectChapters(page, ['第3话'])
  await page.waitForFunction(
    () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const task = (window as any).__harness.manager.task
      return task && task.chapters[0].pages.filter((s: string) => s === 'cached').length >= 2
    },
    undefined,
    { timeout: 60000, polling: 200 },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__harness.manager.pause())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__harness.fetchLog.clear())
  await page.waitForTimeout(2500)
  const counts = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__harness.fetchLog.get(),
  )
  // 暂停后不得有新的图片请求（in-flight 的完成不计：清空后不应再有新条目）
  expect(counts.filter((u: string) => u.includes('/mock/'))).toHaveLength(0)
})
