import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReaderController } from '../../src/reader/controller'
import { SettingsStore } from '../../src/store/settings'
import { ProgressStore } from '../../src/store/progress'
import type { KV } from '../../src/store/kv'
import type { SiteAdapter, PageList } from '../../src/site/types'
import type { ReaderUI } from '../../src/ui/overlay'

const controllers: ReaderController[] = []
const oldWakeLock = Object.getOwnPropertyDescriptor(navigator, 'wakeLock')

function fixture() {
  const data = new Map<string, unknown>()
  const kv: KV = {
    get: <T>(key: string) => data.get(key) as T | undefined,
    set: (key, value) => { data.set(key, value) },
    delete: (key) => { data.delete(key) },
    list: () => [...data.keys()],
  }
  const route = { comic: { siteId: 'test', detailUrl: 'https://example.test/comic' }, chapterUrl: 'chapter-1' }
  const adapter: SiteAdapter = {
    matchReadUrl: () => route, currentReadRoute: () => route, buildReadUrl: () => '#',
    onComicInfo: () => () => {}, onPageList: () => () => {}, supportOf: () => 'full',
    resolveComic: async () => ({ ref: route.comic, title: 'Test', chapters: [] }),
    resolveChapter: () => new Promise<PageList>(() => {}),
  }
  const settingsStore = new SettingsStore(kv)
  const onActiveChange = vi.fn()
  const deps = { adapter, settingsStore, progress: new ProgressStore(kv), onActiveChange }
  const controller = new ReaderController(deps)
  controllers.push(controller)
  let panelOpen = false
  const ui: ReaderUI = {
    open: vi.fn(), close: vi.fn(), modeRoot: document.createElement('div'), toggleToolbar: vi.fn(),
    setLoading: vi.fn(), showError: vi.fn(), updatePageIndicator: vi.fn(), updateModeButtons: vi.fn(),
    updateCatalog: vi.fn(), showChapterCard: vi.fn(), applyBackground: vi.fn(), toast: vi.fn(),
    dismissTopPanel: () => false, hasOpenPanel: () => panelOpen,
  }
  controller.attachUI(ui)
  return { controller, settingsStore, onActiveChange, start: () => { void controller.enter(route) }, panel: (on: boolean) => { panelOpen = on } }
}

class Sentinel extends EventTarget {
  released = false
  type = 'screen' as const
  release = vi.fn(async () => { this.released = true; this.dispatchEvent(new Event('release')) })
}

function installWakeLock(request: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.exit()
  if (oldWakeLock) Object.defineProperty(navigator, 'wakeLock', oldWakeLock)
  else Reflect.deleteProperty(navigator, 'wakeLock')
  vi.restoreAllMocks()
})

describe('reader UI lifecycle', () => {
  it('notifies entry visibility on entering and exiting', () => {
    const { start, controller, onActiveChange } = fixture()
    start()
    controller.exit()
    expect(onActiveChange.mock.calls).toEqual([[true], [false]])
  })

  it('does not turn pages while settings or another panel has keyboard focus', () => {
    const { start, controller, panel } = fixture()
    start()
    panel(true)
    const step = vi.spyOn(controller, 'step')
    expect(controller.handleKey(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBe(false)
    expect(step).not.toHaveBeenCalled()
  })

  it('leaves modified shortcuts and native input keys alone', () => {
    const { start, controller } = fixture()
    start()
    expect(controller.handleKey(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))).toBe(false)
    const input = document.createElement('input')
    const handled: boolean[] = []
    input.addEventListener('keydown', (event) => handled.push(controller.handleKey(event)))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(handled).toEqual([false])
  })
})

describe('screen wake lock preferences', () => {
  it('does not request a lock when neither reading nor downloading', async () => {
    const request = vi.fn(async () => new Sentinel())
    installWakeLock(request)
    const { controller } = fixture()
    await controller.requestWakeLock()
    expect(request).not.toHaveBeenCalled()
  })

  it('requests a lock when reading begins and releases it when disabled', async () => {
    const sentinel = new Sentinel()
    const request = vi.fn(async () => sentinel)
    installWakeLock(request)
    const { controller, start, settingsStore } = fixture()
    start()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await controller.requestWakeLock()
    settingsStore.update({ keepAwake: false })
    await controller.requestWakeLock()
    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent requests from repeated download progress updates', async () => {
    let resolve!: (value: Sentinel) => void
    const pending = new Promise<Sentinel>((done) => { resolve = done })
    const request = vi.fn(() => pending)
    installWakeLock(request)
    const { controller, start } = fixture()
    start()
    const first = controller.requestWakeLock()
    const second = controller.requestWakeLock()
    resolve(new Sentinel())
    await Promise.all([first, second])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('releases a pending acquisition if the preference changes before it resolves', async () => {
    let resolve!: (value: Sentinel) => void
    const pending = new Promise<Sentinel>((done) => { resolve = done })
    installWakeLock(vi.fn(() => pending))
    const { controller, start, settingsStore } = fixture()
    start()
    const acquisition = controller.requestWakeLock()
    settingsStore.update({ keepAwake: false })
    await controller.requestWakeLock()
    const sentinel = new Sentinel()
    resolve(sentinel)
    await acquisition
    expect(sentinel.release).toHaveBeenCalledTimes(1)
  })

  it('keeps an active download awake without leaving the idle page awake', async () => {
    const sentinel = new Sentinel()
    installWakeLock(vi.fn(async () => sentinel))
    const { controller } = fixture()
    expect(typeof controller.setDownloadActive).toBe('function')
    controller.setDownloadActive(true)
    await controller.requestWakeLock()
    expect(sentinel.released).toBe(false)
    controller.setDownloadActive(false)
    await controller.requestWakeLock()
    expect(sentinel.released).toBe(true)
  })
})
