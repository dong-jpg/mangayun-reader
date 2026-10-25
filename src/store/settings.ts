/** 全局默认设置与单部漫画覆盖项（§4.6、R-P3）。 */
import type { ComicRef } from '../site/types'
import { fnv1aHex } from '../utils/fnv'
import type { KV } from './kv'

export type ReaderModeKind = 'horizontal' | 'vertical' | 'single'
export type Direction = 'ltr' | 'rtl'
export type SingleFit = 'screen' | 'width' | 'height' | 'original'
/** 横向连续模式的页面适配（参考 Mihon Fit screen/height）。 */
export type HorizontalFit = 'auto' | 'height' | 'screen'
export type TapAction = 'prev' | 'next' | 'none'
export type Background = 'black' | 'gray' | 'white' | 'system'

export interface TapZones {
  top: TapAction
  bottom: TapAction
  left: TapAction
  right: TapAction
}

export interface Settings {
  schema: number
  autoEnter: boolean
  mode: ReaderModeKind
  direction: Direction
  verticalWidth: number // 50～100
  horizontalFit: HorizontalFit
  /** 横向“适应屏幕”适配下页与页之间是否留 12px 空隙。 */
  horizontalGap: boolean
  singleFit: SingleFit
  tapZones: TapZones
  tapInContinuous: boolean
  preload: { before: number; after: number }
  background: Background
  keepAwake: boolean
  download: { concurrency: number } // 1～4
  /** 悬浮入口位置（屏幕坐标 px）。 */
  floatPos?: { x: number; y: number }
}

export const DEFAULT_SETTINGS: Settings = {
  schema: 1,
  autoEnter: false,
  mode: 'vertical',
  direction: 'rtl',
  verticalWidth: 100,
  horizontalFit: 'auto',
  horizontalGap: true,
  singleFit: 'screen',
  tapZones: { top: 'prev', left: 'prev', bottom: 'next', right: 'next' },
  tapInContinuous: true,
  preload: { before: 1, after: 3 },
  background: 'black',
  keepAwake: true,
  download: { concurrency: 2 },
}

export const KEY_SETTINGS = 'myr:v1:settings'
export const KEY_RECENT = 'myr:v1:recent'

export function comicKey(comic: ComicRef): string {
  return `myr:v1:comic:${fnv1aHex(`${comic.siteId}\n${comic.detailUrl}`)}`
}

/** 漫画记录：覆盖项 + 进度 + 完整 ComicRef（防哈希冲突，R-P2）。 */
export interface ComicRecord {
  ref: ComicRef
  title?: string
  overrides?: Partial<Pick<Settings, 'mode' | 'direction' | 'verticalWidth' | 'singleFit'>>
  progress?: {
    chapterUrl: string
    page: number
    offset: number
    updatedAt: number
  }
}

const HORIZONTAL_FITS: HorizontalFit[] = ['auto', 'height', 'screen']

export function clampSettings(s: Settings): Settings {
  return {
    ...s,
    verticalWidth: Math.min(100, Math.max(50, Math.round(s.verticalWidth))),
    horizontalFit: HORIZONTAL_FITS.includes(s.horizontalFit) ? s.horizontalFit : 'auto',
    preload: {
      before: Math.min(5, Math.max(0, Math.round(s.preload.before))),
      after: Math.min(10, Math.max(1, Math.round(s.preload.after))),
    },
    download: { concurrency: Math.min(4, Math.max(1, Math.round(s.download.concurrency))) },
  }
}

export function mergeSettings(raw: unknown): Settings {
  const base = { ...DEFAULT_SETTINGS, ...(raw as Partial<Settings> | undefined) }
  return clampSettings({
    ...base,
    tapZones: { ...DEFAULT_SETTINGS.tapZones, ...(base.tapZones ?? {}) },
    preload: { ...DEFAULT_SETTINGS.preload, ...(base.preload ?? {}) },
    download: { ...DEFAULT_SETTINGS.download, ...(base.download ?? {}) },
  })
}

export class SettingsStore {
  #kv: KV
  #cache: Settings

  constructor(kv: KV) {
    this.#kv = kv
    this.#cache = mergeSettings(kv.get<unknown>(KEY_SETTINGS))
  }

  get(): Settings {
    return this.#cache
  }

  update(patch: Partial<Settings>): Settings {
    this.#cache = mergeSettings({ ...this.#cache, ...patch, schema: DEFAULT_SETTINGS.schema })
    this.#kv.set(KEY_SETTINGS, this.#cache)
    return this.#cache
  }

  reset(): Settings {
    this.#cache = mergeSettings(undefined)
    this.#kv.set(KEY_SETTINGS, this.#cache)
    return this.#cache
  }

  /** 生效设置：全局默认 + 单部漫画覆盖项。 */
  effective(comic: ComicRef | null): Settings {
    if (!comic) return this.#cache
    const record = this.#kv.get<ComicRecord>(comicKey(comic))
    if (!record?.overrides) return this.#cache
    return mergeSettings({ ...this.#cache, ...record.overrides })
  }
}
