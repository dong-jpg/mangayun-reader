/**
 * 点击区几何（基线规格 §4.3）：顶部/底部各占高 20%，中间行左右各占宽 30%，
 * 剩余中央为菜单；四角归顶/底区域。纯函数，无 DOM 依赖。
 */
import type { TapAction, TapZones } from '../store/settings'

export type ZoneName = 'top' | 'bottom' | 'left' | 'right' | 'center'
export type ZoneOutcome = TapAction | 'menu'

export function resolveZone(x: number, y: number, w: number, h: number): ZoneName {
  if (h <= 0 || w <= 0) return 'center'
  if (y < h * 0.2) return 'top'
  if (y >= h * 0.8) return 'bottom'
  if (x < w * 0.3) return 'left'
  if (x >= w * 0.7) return 'right'
  return 'center'
}

export function zoneOutcome(zone: ZoneName, config: TapZones): ZoneOutcome {
  if (zone === 'center') return 'menu'
  return config[zone]
}

/** 点击坐标直接到动作。 */
export function outcomeAt(x: number, y: number, w: number, h: number, config: TapZones): ZoneOutcome {
  return zoneOutcome(resolveZone(x, y, w, h), config)
}

/** R-S3：左右两区互换（切换阅读方向时经用户确认后调用）。 */
export function invertHorizontalZones(zones: TapZones): TapZones {
  return { ...zones, left: zones.right, right: zones.left }
}

/** R-S4：预设只是一键填入四个区域，之后仍可单独修改。 */
export const TAP_PRESETS: Record<string, { label: string; zones: TapZones }> = {
  default: { label: '默认', zones: { top: 'prev', left: 'prev', bottom: 'next', right: 'next' } },
  paging: {
    label: '左右翻页',
    zones: { top: 'none', left: 'prev', bottom: 'none', right: 'next' },
  },
  reversed: {
    label: '左右反转',
    zones: { top: 'none', left: 'next', bottom: 'none', right: 'prev' },
  },
  menuOnly: { label: '仅菜单', zones: { top: 'none', left: 'none', bottom: 'none', right: 'none' } },
}
