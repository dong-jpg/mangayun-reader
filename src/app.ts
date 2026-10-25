/**
 * 阅读器应用装配：userscript（main.ts）与 harness 验收页共用的同一套
 * 控制器 + UI + 下载管理器接线，保证验收页测到的就是真实行为。
 */
import type { SiteAdapter } from './site/types'
import { createKV, type KV } from './store/kv'
import { SettingsStore } from './store/settings'
import { ProgressStore } from './store/progress'
import { exportData, importData } from './store/migrate'
import { ReaderController } from './reader/controller'
import { OverlayUI, type UIActions } from './ui/overlay'
import { DownloadManager } from './download/manager'
import { DownloadPanel } from './download/panel'
import { invertHorizontalZones } from './reader/tap-zones'

export interface AppHandle {
  controller: ReaderController
  ui: OverlayUI
  manager: DownloadManager
  panel: DownloadPanel
  settingsStore: SettingsStore
  progress: ProgressStore
  kv: KV
}

export function createReaderApp(deps: { adapter: SiteAdapter; kv?: KV }): AppHandle {
  const kv = deps.kv ?? createKV()
  const settingsStore = new SettingsStore(kv)
  const progress = new ProgressStore(kv)

  const controller = new ReaderController({ adapter: deps.adapter, settingsStore, progress })

  const actions: UIActions = {
    exit: () => controller.exit(),
    switchMode: (kind) => controller.switchMode(kind),
    switchDirection: (direction, invert) => {
      if (invert) {
        const s = settingsStore.get()
        settingsStore.update({ tapZones: invertHorizontalZones(s.tapZones) })
      }
      controller.switchDirection(direction)
    },
    setVerticalWidth: (width) => {
      if (controller.comic) progress.setOverrides(controller.comic, { verticalWidth: width })
      controller.applySettingChanges()
    },
    setSingleFit: (fit) => {
      if (controller.comic) progress.setOverrides(controller.comic, { singleFit: fit })
      controller.applySettingChanges()
    },
    setTapZones: (zones) => {
      settingsStore.update({ tapZones: zones })
    },
    setBackground: (bg) => {
      settingsStore.update({ background: bg })
      controller.applySettingChanges()
    },
    setPreload: (before, after) => {
      settingsStore.update({ preload: { before, after } })
      controller.applySettingChanges()
    },
    setKeepAwake: (on) => {
      settingsStore.update({ keepAwake: on })
      if (on) void controller.requestWakeLock()
    },
    setAutoEnter: (on) => {
      settingsStore.update({ autoEnter: on })
    },
    setTapInContinuous: (on) => {
      settingsStore.update({ tapInContinuous: on })
      controller.applySettingChanges()
    },
    jumpToPage: (page) => controller.jumpToPage(page),
    jumpToChapter: (chapter) => controller.navigateToChapter(chapter),
    neighborChapter: (delta) => {
      const chapters = controller.info?.chapters ?? []
      const idx = chapters.findIndex((c) => c.url === controller.currentChapterUrl)
      return chapters[idx + delta] ?? null
    },
    toggleFullscreen: () => void controller.toggleFullscreen(),
    openDownload: () => panel.open(),
    exportSettings: () => exportData(kv),
    importSettings: (json) => importData(kv, json),
    settings: () => settingsStore.effective(controller.comic),
  }

  const ui: OverlayUI = new OverlayUI(actions)
  controller.attachUI(ui)

  const manager = new DownloadManager({
    adapter: deps.adapter,
    settings: settingsStore,
    kv,
    onProgress: (p) => panel.onProgress(p),
    onPacked: (handle) => panel.onPacked(handle),
  })
  const panel = new DownloadPanel({
    manager,
    adapter: deps.adapter,
    kv,
    getComic: () => {
      const comic = controller.comic
      if (!comic) return null
      return { ref: comic, info: controller.info, currentChapterUrl: controller.currentChapterUrl }
    },
    toast: (text) => ui.toast(text),
    openSheet: (el) => ui.openSheet(el),
    closeSheet: (el) => ui.closeSheet(el),
  })

  // 键盘（R-C6）：捕获阶段处理并阻止原站同时翻页
  window.addEventListener(
    'keydown',
    (e) => {
      if (!controller.active) return
      if (controller.handleKey(e)) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    },
    { capture: true },
  )

  // 离开/隐藏时立即保存进度（R-P4）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') progress.flush()
    else void controller.requestWakeLock()
  })
  window.addEventListener('pagehide', () => progress.flush())

  return { controller, ui, manager, panel, settingsStore, progress, kv }
}
