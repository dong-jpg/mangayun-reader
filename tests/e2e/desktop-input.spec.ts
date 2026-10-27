import { expect, test, type Page } from '@playwright/test'

/**
 * 桌面输入（§1.1 桌面可用）：滚轮翻页与鼠标按住拖动（模拟手指按住滑动）。
 * 桌面视口（非 Pixel 7 移动仿真）跑这些用例，覆盖三种模式。
 */

async function currentPageNumber(page: Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = (window as any).__harness
    return h.controller.pageStats.current
  })
}

async function scrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sr = (document.getElementById('myr-overlay-host') as any).shadowRoot
    const el = sr.querySelector('.myr-scroll')
    return Math.round(el.scrollTop)
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
  // desktop-chromium project 已配置桌面视口；清掉上一用例留下的阅读进度
  await page.goto('/')
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__harness.resetStorage()
  })
  await page.goto('/')
  await expect(page.locator('.myr-root.myr-open')).toBeVisible({ timeout: 15000 })
  await page.locator('.myr-page img[src]').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
})

test('纵向模式：鼠标按住拖动滚动 + 滚轮滚动', async ({ page }) => {
  const box = await page.locator('.myr-scroll').boundingBox()
  // 按住向上拖（把内容往上推 = 往下读）
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 400)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 400 - i * 50)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
  expect(await scrollTop(page)).toBeGreaterThan(200)

  // 滚轮：继续向下
  const before = await scrollTop(page)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(600)
  expect(await scrollTop(page)).toBeGreaterThan(before + 300)
})

test('横向模式：滚轮垂直滚动转翻行 + 鼠标按住拖动翻页', async ({ page }) => {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__harness.app.controller.switchMode('horizontal')
  })
  await page.waitForTimeout(800)
  const box = await page.locator('.myr-scroll').boundingBox()
  const before = await currentPageNumber(page)
  // 滚轮一格（deltaY=200 ≈ 2 行）
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(900)
  expect(await currentPageNumber(page)).toBeGreaterThan(before)

  // 鼠标按住向右拖（RTL 前进方向）
  const before2 = await currentPageNumber(page)
  await page.mouse.move(box!.x + 200, box!.y + box!.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box!.x + 200 + i * 60, box!.y + box!.height / 2)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  await page.waitForTimeout(900)
  expect(await currentPageNumber(page)).toBeGreaterThan(before2)
})

test('单页模式：滚轮翻页 + 鼠标按住拖动翻页（方向跟随阅读方向）', async ({ page }) => {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__harness.app.controller.switchMode('single')
  })
  await page.waitForTimeout(800)
  // 跳到第 3 页（避开章首卡片）
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__harness.controller.jumpToPage(2)
  })
  await page.waitForTimeout(300)
  const box = await page.locator('.myr-single').boundingBox()

  // 滚轮向下 = 前进
  const before = await currentPageNumber(page)
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(600)
  expect(await currentPageNumber(page)).toBeGreaterThan(before)

  // 向右拖 = RTL 前进
  const before2 = await currentPageNumber(page)
  await page.mouse.move(box!.x + 300, box!.y + box!.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box!.x + 300 + i * 60, box!.y + box!.height / 2)
    await page.waitForTimeout(25)
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
  expect(await currentPageNumber(page)).toBeGreaterThan(before2)

  // 回归：中央单击仍然呼出菜单（拖动不吞点击）
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForTimeout(300)
  const toolbar = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sr = (document.getElementById('myr-overlay-host') as any).shadowRoot
    return !!sr.querySelector('.myr-toolbar.myr-visible')
  })
  expect(toolbar).toBe(true)
})

test('鼠标拖动不误触发点击区（拖动后无翻页副作用之外的点击动作）', async ({ page }) => {
  // 纵向模式小幅度拖动（超过点击判定阈值 10px）：松手后页码变化只来自滚动，
  // 不应有 tap 触发的 step（点底 next 区会整屏跳 90%）
  const box = await page.locator('.myr-scroll').boundingBox()
  const before = await currentPageNumber(page)
  await page.mouse.move(box!.x + box!.width * 0.9, box!.y + 600) // next 点击区
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(box!.x + box!.width * 0.9, box!.y + 600 - i * 30)
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
  const after = await currentPageNumber(page)
  // 拖动 180px 只滚 180px（不足一页），tap 的 90% 视口跳页不应发生
  expect(after - before).toBeLessThanOrEqual(1)
})
