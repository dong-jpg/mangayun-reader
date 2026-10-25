import { expect, test, type Page } from '@playwright/test'

/** 等待增强阅读器打开、首图加载并稳定（locator 穿透 open Shadow DOM）。 */
async function waitForReader(page: Page): Promise<void> {
  await expect(page.locator('.myr-root.myr-open')).toBeVisible({ timeout: 15000 })
  await page.locator('.myr-page img[src]').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
}

async function currentPageNumber(page: Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (window as any).__harness
    return h.controller.pageStats.current
  })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await waitForReader(page)
})

test('纵向模式挂载、页码指示与图片加载', async ({ page }) => {
  const stats = page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (window as any).__harness
    return { total: h.controller.pages.length, kind: h.controller.modeKind }
  })
  expect((await stats).kind).toBe('vertical')
  expect((await stats).total).toBeGreaterThanOrEqual(12)
  const imgs = page.locator('.myr-strip-v .myr-page img[src]')
  expect(await imgs.count()).toBeGreaterThan(0)
})

test('三种模式切换与退出后无残留（监听器计数归零）', async ({ page }) => {
  // 先退出一次取基线（空闲态清理表应为空）
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__harness.controller.exit()
  })
  await expect(page.locator('#myr-overlay-host')).toHaveCount(0)
  const before = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__harness.cleanupActiveCount(),
  )
  // 重新进入，横向 → 单页 → 纵向
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (window as any).__harness
    await h.controller.enter({
      comic: { siteId: 'harness', detailUrl: 'https://harness.local/comic/1' },
      chapterUrl: 'mock://ch/1',
    })
  })
  await page.locator('.myr-page img[src]').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
  for (const label of ['横向', '单页', '纵向']) {
    await page.locator('.myr-bar .myr-seg', { hasText: label }).first().click()
    await page.waitForTimeout(400)
    expect(
      await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => (window as any).__harness.controller.modeKind,
      ),
    ).toBe(label === '横向' ? 'horizontal' : label === '单页' ? 'single' : 'vertical')
  }
  // 退出：节点与监听全部清理
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__harness.controller.exit()
  })
  await expect(page.locator('.myr-root.myr-open')).toHaveCount(0)
  await expect(page.locator('#myr-overlay-host')).toHaveCount(0)
  const after = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__harness.cleanupActiveCount(),
  )
  expect(after).toBe(before)
  // 再 20 次进出（R-C1 验收）：计数不增长
  const stable = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (window as any).__harness
    const route = { comic: { siteId: 'harness', detailUrl: 'https://harness.local/comic/1' }, chapterUrl: 'mock://ch/1' }
    const base = h.cleanupActiveCount()
    for (let i = 0; i < 20; i++) {
      await h.controller.enter(route)
      h.controller.exit()
    }
    return { base, after: h.cleanupActiveCount() }
  })
  expect(stable.after).toBe(stable.base)
})

test('竖屏 → 横屏 → 竖屏后锚点页码不变（R-C2/T7）', async ({ page }) => {
  // 通过滑块跳到第 5 页
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
  await page.locator('.myr-page-slider').evaluate((el: HTMLInputElement) => {
    el.value = '5'
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(300)
  const pageNum = await currentPageNumber(page)
  expect(pageNum).toBe(5)
  // 横屏
  await page.setViewportSize({ width: 915, height: 412 })
  await page.waitForTimeout(400)
  expect(await currentPageNumber(page)).toBe(5)
  // 竖屏
  await page.setViewportSize({ width: 412, height: 915 })
  await page.waitForTimeout(400)
  expect(await currentPageNumber(page)).toBe(5)
})

test('右→左模式下第 1 页在最右侧（R-J2/T4）', async ({ page }) => {
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
  await page.locator('.myr-bar .myr-seg', { hasText: '横向' }).click()
  await page.waitForTimeout(500)
  const order = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slots = (window as any).__harness.ui.queryAll('.myr-strip-h .myr-page')
    return slots.slice(0, 3).map((s: HTMLElement) => s.getBoundingClientRect().left)
  })
  // direction:rtl 排列：第 1 页在最右（left 最大）
  expect(order[0]).toBeGreaterThan(order[1]!)
  expect(order[1]).toBeGreaterThan(order[2]!)
  // 跳到第 1 页后：第 1 页右缘对齐视口右缘（RTL 初始含“上一话”卡片，
  // 卡片在最右侧属于设计行为，用显式跳页验证对齐）
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__harness.controller.jumpToPage(0)
  })
  await page.waitForTimeout(300)
  const align = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ui = (window as any).__harness.ui
    const slot = ui.queryAll('.myr-strip-h .myr-page')[0] as HTMLElement
    const scroller = ui.queryAll('.myr-scroll-h')[0] as HTMLElement
    return { pageRight: slot.getBoundingClientRect().right, scrollerRight: scroller.getBoundingClientRect().right }
  })
  expect(align.pageRight).toBeGreaterThan(align.scrollerRight - 8)
})

test('单页模式点击区按坐标生效（R-S2/T5）', async ({ page }) => {
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
  await page.locator('.myr-bar .myr-seg', { hasText: '单页' }).click()
  await page.waitForTimeout(400)
  // 跳到第 3 页（避开章首切话卡片）
  await page.locator('.myr-page-slider').evaluate((el: HTMLInputElement) => {
    el.value = '3'
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(200)
  // 收起工具栏
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await page.waitForTimeout(200)
  expect(await currentPageNumber(page)).toBe(3)
  // 右侧点击区（30% 宽）→ 下一页
  await page.mouse.click(center!.x + center!.width * 0.9, center!.y + center!.height * 0.5)
  await page.waitForTimeout(200)
  expect(await currentPageNumber(page)).toBe(4)
  // 左侧点击区 → 上一页
  await page.mouse.click(center!.x + center!.width * 0.05, center!.y + center!.height * 0.5)
  await page.waitForTimeout(200)
  expect(await currentPageNumber(page)).toBe(3)
  // 顶部 → 上一页（默认配置 top=prev）
  await page.mouse.click(center!.x + center!.width * 0.5, center!.y + center!.height * 0.05)
  await page.waitForTimeout(200)
  expect(await currentPageNumber(page)).toBe(2)
  // 中央 → 菜单（工具栏呼出）
  await page.mouse.click(center!.x + center!.width * 0.5, center!.y + center!.height * 0.5)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
})

test('长章节预加载窗口：窗口外释放 src，返回已读页不重挂载（R-C4）', async ({ page }) => {
  await page.goto(`/?ch=${encodeURIComponent('mock://ch/long')}`)
  await waitForReader(page)
  // 滑块跳到第 30 页
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
  await page.locator('.myr-page-slider').evaluate((el: HTMLInputElement) => {
    el.value = '30'
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(800)
  const stats = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ui = (window as any).__harness.ui
    return {
      slots: ui.queryAll('.myr-page').length,
      withSrc: ui.queryAll('.myr-page img[src]').length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page: (window as any).__harness.controller.pageStats.current,
    }
  })
  expect(stats.slots).toBe(60)
  // 窗口 = 当前页 -1 / +3（默认设置），验收允许 +2：不超过 6 个元素持有图片
  expect(stats.withSrc).toBeLessThanOrEqual(6)
  // 返回已读页面（第 5 页）：锚点恢复，不整章重挂载
  await page.locator('.myr-page-slider').evaluate((el: HTMLInputElement) => {
    el.value = '5'
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(600)
  const back = await page.evaluate(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page: (window as any).__harness.controller.pageStats.current,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withSrc: (window as any).__harness.ui.queryAll('.myr-page img[src]').length,
  }))
  expect(back.page).toBe(5)
  expect(back.withSrc).toBeLessThanOrEqual(6)
})

test('横向适配：竖屏整页可见（自动=screen），切“适应高度”生效（Mihon 式适配）', async ({ page }) => {
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
  await page.locator('.myr-bar .myr-seg', { hasText: '横向' }).click()
  await page.waitForTimeout(600)
  // 竖屏（默认 412×915）+ auto → screen：页面完整可见且页间有间隙
  const screenFit = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ui = (window as any).__harness.ui
    const scroller = ui.queryAll('.myr-scroll-h')[0] as HTMLElement
    const s = scroller.getBoundingClientRect()
    const slot = ui.queryAll('.myr-strip-h .myr-page')[0] as HTMLElement
    const r = slot.getBoundingClientRect()
    return { screen: scroller.classList.contains('myr-h-screen'), vw: s.width, vh: s.height, pw: r.width, ph: r.height }
  })
  expect(screenFit.screen).toBe(true)
  expect(screenFit.pw).toBeLessThanOrEqual(screenFit.vw + 1)
  expect(screenFit.ph).toBeLessThanOrEqual(screenFit.vh + 1)
  expect(screenFit.pw).toBeGreaterThan(100)

  // 切换到“适应高度”：页面铺满高度（无缝连续）
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (window as any).__harness
    h.app.settingsStore.update({ horizontalFit: 'height' })
    h.controller.applySettingChanges()
  })
  await page.waitForTimeout(500)
  const heightFit = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ui = (window as any).__harness.ui
    const scroller = ui.queryAll('.myr-scroll-h')[0] as HTMLElement
    const slot = ui.queryAll('.myr-strip-h .myr-page')[0] as HTMLElement
    return {
      screen: scroller.classList.contains('myr-h-screen'),
      vh: scroller.getBoundingClientRect().height,
      ph: slot.getBoundingClientRect().height,
    }
  })
  expect(heightFit.screen).toBe(false)
  expect(heightFit.ph).toBeGreaterThanOrEqual(heightFit.vh - 2)
})

test('页间留隙开关：关闭后横向“适应屏幕”页面零间隙相接', async ({ page }) => {
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
  await page.locator('.myr-bar .myr-seg', { hasText: '横向' }).click()
  await page.waitForTimeout(600)
  const gapOf = () =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ui = (window as any).__harness.ui
      const slots = ui.queryAll('.myr-strip-h .myr-page') as HTMLElement[]
      // LTR/RTL 通用：取相邻两页的间隙
      const rects = slots.slice(0, 3).map((s) => s.getBoundingClientRect())
      const gaps: number[] = []
      const sorted = [...rects].sort((a, b) => a.left - b.left)
      for (let i = 1; i < sorted.length; i++) gaps.push(Math.abs(sorted[i]!.left - sorted[i - 1]!.right))
      return Math.min(...gaps)
    })
  // 默认留隙 ~12px
  expect(await gapOf()).toBeGreaterThan(4)
  // 关闭留隙
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (window as any).__harness
    h.app.settingsStore.update({ horizontalGap: false })
    h.controller.applySettingChanges()
  })
  await page.waitForTimeout(500)
  expect(await gapOf()).toBeLessThanOrEqual(1)
})

test('横屏翻页闪白修复：参考线贴边界翻页时可见页不卸载 src', async ({ page }) => {
  // 长章节 + 横屏 + 横向模式（适应高度，一屏约 3 页）
  await page.goto(`/?ch=${encodeURIComponent('mock://ch/long')}`)
  await page.locator('.myr-page img[src]').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
  await page.setViewportSize({ width: 915, height: 412 })
  const center = await page.locator('.myr-mode-root').boundingBox()
  await page.mouse.click(center!.x + center!.width / 2, center!.y + center!.height / 2)
  await expect(page.locator('.myr-toolbar.myr-visible')).toBeVisible()
  await page.locator('.myr-bar .myr-seg', { hasText: '横向' }).click()
  await page.waitForTimeout(600)
  // 跳到长章节中部
  await page.locator('.myr-page-slider').evaluate((el: HTMLInputElement) => {
    el.value = '20'
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(700)

  // 把参考线（视口中线）精确挪到第 21 页左缘内侧 5px——旧逻辑此时会卸载
  // 仍部分可见的第 19 页（横屏一屏 3+ 页），露出白边
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ui = (window as any).__harness.ui
    const scroller = ui.queryAll('.myr-scroll-h')[0] as HTMLElement
    const slots = ui.queryAll('.myr-strip-h .myr-page') as HTMLElement[]
    const s = scroller.getBoundingClientRect()
    const target = slots[21]!.getBoundingClientRect()
    // LTR：参考线需在 target.left + 5
    const delta = target.left - (s.left + s.width / 2) + 5
    scroller.scrollBy({ left: delta })
  })
  await page.waitForTimeout(400)

  const check = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ui = (window as any).__harness.ui
    const scroller = ui.queryAll('.myr-scroll-h')[0] as HTMLElement
    const slots = ui.queryAll('.myr-strip-h .myr-page') as HTMLElement[]
    const s = scroller.getBoundingClientRect()
    const visible: number[] = []
    const missingSrc: number[] = []
    for (const [i, slot] of slots.entries()) {
      const r = slot.getBoundingClientRect()
      if (r.right > s.left + 1 && r.left < s.right - 1) {
        visible.push(i)
        if (!slot.querySelector('img')?.getAttribute('src')) missingSrc.push(i)
      }
    }
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      current: (window as any).__harness.controller.pageStats.current,
      visibleCount: visible.length,
      visibleFirst: visible[0],
      missingSrc,
    }
  })
  expect(check.visibleCount).toBeGreaterThanOrEqual(2) // 横屏确实多页可见
  expect(check.missingSrc).toEqual([]) // 所有可见页都有 src（不闪白）
})
