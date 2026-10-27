import { expect, test } from '@playwright/test'

/**
 * 章节解析兜底：捕获层不可用（iframe 内无脚本/注入失败）时，
 * 抓取 iframe 中原站阅读器自己渲染的图片（桌面 TM 沙箱场景的保底路径）。
 */
test('捕获超时后转 DOM 抓取：从 iframe 原站阅读器取得页面清单', async ({ page }) => {
  await page.goto('/')
  await page.locator('.myr-root.myr-open').first().waitFor({ timeout: 15000 })

  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (window as any).__harness
    // timeoutMs=3000：捕获 3 秒超时（iframe 是无脚本的假阅读器页，不会有事件）
    return h.scrapeResolver.resolveChapter(
      { siteId: 'harness', detailUrl: 'https://harness.local/comic/1' },
      'mock://ch/scrape',
      3000,
    )
  })

  // 假阅读器渲染 5 张（含 1 张重复已被去重），封面（thumb/cover）被过滤
  expect(result.images).toHaveLength(5)
  expect(result.images[0]).toContain('/mock/img/scrape-p0.png')
  expect(result.images.some((u: string) => u.includes('cover'))).toBe(false)
  expect(result.chapterUrl).toBe('mock://ch/scrape')
})
