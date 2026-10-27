import { expect, test, type Page } from '@playwright/test'

async function openSettings(page: Page) {
  await expect(page.locator('.myr-root.myr-open')).toBeVisible()
  await page.locator('.myr-page img[src]').first().waitFor()
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__harness.ui.setToolbarVisible(true)
  })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '阅读设置' })).toBeVisible()
}

test('入口贴边、拖动不打开、位置记忆与旋转保持可见', async ({ page }) => {
  await page.goto('/?entry=1')
  const entry = page.getByRole('button', { name: '打开增强阅读器' })
  await expect(entry).toBeVisible()
  const box = (await entry.boundingBox())!
  expect(box.width).toBe(52)
  expect(box.x).toBeGreaterThan(300)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 90)
  await page.mouse.move(box.x + 26, box.y + 26)
  await page.mouse.down()
  await page.mouse.move(35, 270, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.myr-root.myr-open')).toHaveCount(0)
  expect((await entry.boundingBox())!.x).toBe(12)
  await page.reload()
  await expect(entry).toBeVisible()
  expect((await entry.boundingBox())!.x).toBe(12)
  await page.setViewportSize({ width: 915, height: 412 })
  await expect.poll(async () => (await entry.boundingBox())!.y + 52).toBeLessThanOrEqual(400)
  await entry.click()
  await expect(page.locator('.myr-root.myr-open')).toBeVisible()
  await expect(entry).toHaveCount(0)
})

test('入口支持键盘打开，退出阅读后重新出现', async ({ page }) => {
  await page.goto('/?entry=1')
  const entry = page.getByRole('button', { name: '打开增强阅读器' })
  await entry.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.myr-root.myr-open')).toBeVisible()
  await page.locator('.myr-page img[src]').first().waitFor()
  await page.keyboard.press('Escape')
  await expect(entry).toBeVisible()
  await expect(page.locator('.myr-root.myr-open')).toHaveCount(0)
})

test('设置页签键盘操作不会误翻页，关闭后恢复焦点', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  const before = await page.locator('.myr-page-label').textContent()
  await expect(page.getByRole('tab', { name: '阅读', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '手势', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(await page.locator('.myr-page-label').textContent()).toBe(before)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '阅读设置' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused()
  await expect(page.locator('.myr-root.myr-open')).toBeVisible()
})

test('真实设置控件即时生效，刷新后保留偏好', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByRole('button', { name: '横向连续', exact: true }).click()
  await page.getByRole('button', { name: '适应屏幕', exact: true }).click()
  await page.getByRole('switch', { name: '页间留隙', exact: true }).uncheck()
  await page.getByRole('tab', { name: '通用', exact: true }).click()
  await page.getByRole('button', { name: '增加前方预加载' }).click()
  await page.getByRole('button', { name: '增加前方预加载' }).click()
  await page.getByRole('button', { name: '增加下载并发' }).click()
  const settings = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (window as any).__harness.app
    return app.settingsStore.effective(app.controller.comic)
  })
  expect(settings).toMatchObject({ mode: 'horizontal', horizontalFit: 'screen', horizontalGap: false, preload: { before: 3, after: 3 }, download: { concurrency: 3 } })
  await page.reload()
  await openSettings(page)
  await expect(page.getByRole('button', { name: '横向连续', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('switch', { name: '页间留隙', exact: true })).not.toBeChecked()
  await page.getByRole('tab', { name: '通用', exact: true }).click()
  await expect(page.getByRole('group', { name: '前方预加载' }).locator('output')).toHaveText('3')
})

test('点击区预设、重置和试用保持预览与真实映射一致', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByRole('tab', { name: '手势', exact: true }).click()
  await page.getByRole('button', { name: '仅菜单', exact: true }).click()
  for (const zone of ['上', '左', '右', '下']) await expect(page.getByLabel(`${zone}方点击区`)).toHaveValue('none')
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  await expect(page.getByLabel('左方点击区')).toHaveValue('prev')
  await expect(page.getByLabel('右方点击区')).toHaveValue('next')
  await expect(page.locator('.myr-zone-left')).toHaveText('上一页')
  await page.getByRole('button', { name: '立即试用', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '阅读设置' })).toHaveCount(0)
})

test('窄屏、横屏和桌面设置无横向溢出，触控目标至少 48px', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const viewport of [{ width: 360, height: 740 }, { width: 915, height: 412 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: '阅读设置' })
    for (const tab of ['阅读', '手势', '通用']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      const layout = await dialog.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const small = [...el.querySelectorAll<HTMLElement>('button, input, select')]
          .filter((control) => !control.closest('[hidden]'))
          .filter((control) => {
            const rect = control.getBoundingClientRect()
            return rect.width < 48 || rect.height < 48
          }).map((control) => control.getAttribute('aria-label') ?? control.textContent)
        return { overflow: el.scrollWidth > el.clientWidth + 1, left: box.left, right: box.right, top: box.top, bottom: box.bottom, small }
      })
      expect(layout.overflow, `${viewport.width}/${tab}`).toBe(false)
      expect(layout.left).toBeGreaterThanOrEqual(0)
      expect(layout.right).toBeLessThanOrEqual(viewport.width + 1)
      expect(layout.top).toBeGreaterThanOrEqual(0)
      expect(layout.bottom).toBeLessThanOrEqual(viewport.height + 1)
      expect(layout.small, `${viewport.width}/${tab}`).toEqual([])
    }
  }
})
