import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverlayUI } from '../../src/ui/overlay'
import { mergeSettings, type Settings, type TapZones } from '../../src/store/settings'

const views: OverlayUI[] = []

function fixture() {
  const state = mergeSettings(undefined)
  const actions = {
    exit: vi.fn(),
    switchMode: vi.fn((mode: Settings['mode']) => { state.mode = mode }),
    switchDirection: vi.fn(),
    setVerticalWidth: vi.fn((width: number) => { state.verticalWidth = width }),
    setHorizontalFit: vi.fn((fit: Settings['horizontalFit']) => { state.horizontalFit = fit }),
    setHorizontalGap: vi.fn((on: boolean) => { state.horizontalGap = on }),
    setSingleFit: vi.fn(),
    setTapZones: vi.fn((zones: TapZones) => { state.tapZones = zones }),
    setBackground: vi.fn(),
    setPreload: vi.fn((before: number, after: number) => { state.preload = { before, after } }),
    setKeepAwake: vi.fn(),
    setAutoEnter: vi.fn(),
    setTapInContinuous: vi.fn(),
    setDownloadConcurrency: vi.fn(),
    resetEntryPosition: vi.fn(),
    jumpToPage: vi.fn(),
    jumpToChapter: vi.fn(),
    neighborChapter: vi.fn(() => null),
    toggleFullscreen: vi.fn(),
    openDownload: vi.fn(),
    exportSettings: vi.fn(() => '{}'),
    importSettings: vi.fn(() => ({ ok: false, error: 'invalid settings' })),
    settings: () => state,
  }
  const ui = new OverlayUI(actions)
  views.push(ui)
  ui.open()
  const button = (label: string): HTMLButtonElement => {
    const found = ui.queryAll<HTMLButtonElement>('button').find(
      (el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label,
    )
    expect(found, `Missing button: ${label}`).toBeDefined()
    return found!
  }
  button('设置').click()
  const input = (label: string) => {
    const found = ui.queryAll<HTMLInputElement>(`input[aria-label="${label}"]`)[0]
    expect(found, `Missing input: ${label}`).toBeDefined()
    return found!
  }
  return { ui, state, actions, button, input }
}

afterEach(() => {
  for (const ui of views.splice(0)) ui.close()
  vi.restoreAllMocks()
})

describe('mobile settings panel', () => {
  it('groups settings into three accessible tabs inside a labelled dialog', () => {
    const { ui } = fixture()
    const tabs = ui.queryAll('[role="tab"]')
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['阅读', '手势', '通用'])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(ui.queryAll('[role="dialog"][aria-label="阅读设置"]')).toHaveLength(1)
  })

  it('provides a labelled vertical-width slider with 10 percent steps', () => {
    const { input, actions } = fixture()
    const width = input('阅读宽度')
    expect(width.step).toBe('10')
    width.value = '70'
    width.dispatchEvent(new Event('input', { bubbles: true }))
    width.dispatchEvent(new Event('change', { bubbles: true }))
    expect(actions.setVerticalWidth).toHaveBeenLastCalledWith(70)
  })

  it('shows horizontal controls after changing the reading mode', () => {
    const { button, actions, input } = fixture()
    button('横向连续').click()
    expect(actions.switchMode).toHaveBeenCalledWith('horizontal')
    button('适应高度').click()
    expect(actions.setHorizontalFit).toHaveBeenCalledWith('height')
    const gap = input('页间留隙')
    gap.click()
    expect(actions.setHorizontalGap).toHaveBeenCalledWith(false)
  })

  it('increments preloading repeatedly instead of reusing the initial value', () => {
    const { button, actions } = fixture()
    button('通用').click()
    button('增加前方预加载').click()
    button('增加前方预加载').click()
    expect(actions.setPreload).toHaveBeenLastCalledWith(3, 3)
    button('减少后方预加载').click()
    button('减少后方预加载').click()
    expect(actions.setPreload).toHaveBeenLastCalledWith(3, 1)
    expect(button('减少后方预加载').disabled).toBe(true)
  })

  it('updates the preview and every mapping when a preset or reset is applied', () => {
    const { button, ui, actions } = fixture()
    button('手势').click()
    button('仅菜单').click()
    expect(ui.queryAll<HTMLSelectElement>('select[data-zone]').map((el) => el.value))
      .toEqual(['none', 'none', 'none', 'none'])
    button('恢复默认').click()
    const values = Object.fromEntries(ui.queryAll<HTMLSelectElement>('select[data-zone]').map(
      (el) => [el.dataset.zone, el.value],
    ))
    expect(values).toEqual({ top: 'prev', left: 'prev', right: 'next', bottom: 'next' })
    expect(ui.queryAll('.myr-zone-left')[0]?.textContent).toContain('上一页')
    expect(actions.setTapZones).toHaveBeenLastCalledWith(values)
  })

  it('uses labelled switches and exposes download concurrency and entry reset', () => {
    const { button, input, actions } = fixture()
    button('通用').click()
    const awake = input('屏幕常亮')
    expect(awake.getAttribute('role')).toBe('switch')
    awake.click()
    expect(actions.setKeepAwake).toHaveBeenCalledWith(false)
    button('增加下载并发').click()
    expect(actions.setDownloadConcurrency).toHaveBeenCalledWith(3)
    button('重置入口位置').click()
    expect(actions.resetEntryPosition).toHaveBeenCalledTimes(1)
  })

  it('supports arrow-key navigation between tabs', () => {
    const { ui } = fixture()
    const first = ui.queryAll<HTMLButtonElement>('[role="tab"]')[0]
    expect(first).toBeDefined()
    first!.focus()
    first!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    const tabs = ui.queryAll<HTMLButtonElement>('[role="tab"]')
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]?.tabIndex).toBe(-1)
  })

  it('retains import errors in the visible dialog rather than losing settings', async () => {
    const { button, input, ui, actions } = fixture()
    button('通用').click()
    const fileInput = input('导入设置')
    Object.defineProperty(fileInput, 'files', { value: [{ text: async () => '{bad' }] })
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(actions.importSettings).toHaveBeenCalledWith('{bad'))
    expect(ui.queryAll('[role="dialog"][aria-label="阅读设置"]')).toHaveLength(1)
    expect(ui.queryAll('.myr-toast')[0]?.textContent).toContain('invalid settings')
  })

  it('restores the settings trigger focus on close', () => {
    const { button, ui } = fixture()
    button('关闭设置').click()
    expect(ui.queryAll('.myr-settings')).toHaveLength(0)
    const trigger = button('设置')
    expect((trigger.getRootNode() as ShadowRoot).activeElement).toBe(trigger)
  })

  it('keeps event isolation after exiting and reopening the reader', () => {
    const { ui } = fixture()
    ui.close()
    ui.open()
    const listener = vi.fn()
    document.addEventListener('click', listener)
    try {
      ui.queryAll('.myr-root')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
      expect(listener).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('click', listener)
    }
  })
})
