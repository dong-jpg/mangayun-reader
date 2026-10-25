import { describe, expect, it } from 'vitest'
import {
  TAP_PRESETS,
  invertHorizontalZones,
  outcomeAt,
  resolveZone,
  zoneOutcome,
} from '../../src/reader/tap-zones'
import type { TapZones } from '../../src/store/settings'

const DEFAULT: TapZones = { top: 'prev', left: 'prev', bottom: 'next', right: 'next' }
const W = 400
const H = 800

describe('点击区几何（基线 §4.3）', () => {
  it('五区基本归属', () => {
    expect(resolveZone(200, 10, W, H)).toBe('top')
    expect(resolveZone(200, 790, W, H)).toBe('bottom')
    expect(resolveZone(50, 400, W, H)).toBe('left')
    expect(resolveZone(350, 400, W, H)).toBe('right')
    expect(resolveZone(200, 400, W, H)).toBe('center')
  })

  it('四角归顶/底区域', () => {
    expect(resolveZone(0, 0, W, H)).toBe('top')
    expect(resolveZone(W - 1, 0, W, H)).toBe('top')
    expect(resolveZone(0, H - 1, W, H)).toBe('bottom')
    expect(resolveZone(W - 1, H - 1, W, H)).toBe('bottom')
  })

  it('分界线两侧（20% 高、30% 宽）', () => {
    // 高度边界 y=160（不含于顶区）、y=159（含）
    expect(resolveZone(200, 159, W, H)).toBe('top')
    expect(resolveZone(50, 160, W, H)).toBe('left') // 160 恰好进入中间行
    expect(resolveZone(200, 639, W, H)).toBe('center') // 639 < 640（80%）
    expect(resolveZone(200, 641, W, H)).toBe('bottom')
    // 宽度边界 30%（x=120）
    expect(resolveZone(119, 400, W, H)).toBe('left')
    expect(resolveZone(121, 400, W, H)).toBe('center')
    expect(resolveZone(279, 400, W, H)).toBe('center')
    expect(resolveZone(281, 400, W, H)).toBe('right')
  })

  it('中央固定菜单、无操作生效', () => {
    expect(zoneOutcome('center', DEFAULT)).toBe('menu')
    const none: TapZones = { top: 'none', left: 'none', bottom: 'none', right: 'none' }
    expect(outcomeAt(10, 10, W, H, none)).toBe('none')
    expect(outcomeAt(200, 400, W, H, none)).toBe('menu')
  })

  it('每个区域的每种取值都生效（R-S2）', () => {
    for (const zone of ['top', 'bottom', 'left', 'right'] as const) {
      for (const action of ['prev', 'next', 'none'] as const) {
        const zones = { ...DEFAULT, [zone]: action } as TapZones
        const pos: Record<string, [number, number]> = {
          top: [200, 10],
          bottom: [200, 790],
          left: [50, 400],
          right: [350, 400],
        }
        const [x, y] = pos[zone]!
        expect(outcomeAt(x, y, W, H, zones)).toBe(action)
      }
    }
  })

  it('反转：左右互换，上下不变（R-S3）', () => {
    const inverted = invertHorizontalZones(DEFAULT)
    expect(inverted.left).toBe('next')
    expect(inverted.right).toBe('prev')
    expect(inverted.top).toBe('prev')
    expect(inverted.bottom).toBe('next')
  })

  it('预设值正确（R-S4）', () => {
    expect(TAP_PRESETS.default!.zones).toEqual(DEFAULT)
    expect(TAP_PRESETS.paging!.zones).toEqual({ top: 'none', left: 'prev', bottom: 'none', right: 'next' })
    expect(TAP_PRESETS.reversed!.zones).toEqual({ top: 'none', left: 'next', bottom: 'none', right: 'prev' })
    expect(TAP_PRESETS.menuOnly!.zones).toEqual({ top: 'none', left: 'none', bottom: 'none', right: 'none' })
  })

  it('零尺寸防御', () => {
    expect(resolveZone(1, 1, 0, 0)).toBe('center')
  })
})
