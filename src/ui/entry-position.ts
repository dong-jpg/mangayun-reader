import type { EntryPosition } from '../store/settings'

export const ENTRY_SIZE = 52
const EDGE = 12
const DEFAULT_BOTTOM_CLEARANCE = 96

export interface EntryViewport {
  left: number
  top: number
  width: number
  height: number
  safeTop?: number
  safeBottom?: number
  safeLeft?: number
  safeRight?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function bounds(viewport: EntryViewport) {
  const left = viewport.left + EDGE + (viewport.safeLeft ?? 0)
  const top = viewport.top + EDGE + (viewport.safeTop ?? 0)
  return {
    left,
    top,
    right: Math.max(left, viewport.left + viewport.width - ENTRY_SIZE - EDGE - (viewport.safeRight ?? 0)),
    bottom: Math.max(top, viewport.top + viewport.height - ENTRY_SIZE - EDGE - (viewport.safeBottom ?? 0)),
  }
}

export function clampEntryPosition(x: number, y: number, viewport: EntryViewport): EntryPosition {
  const box = bounds(viewport)
  return { x: clamp(x, box.left, box.right), y: clamp(y, box.top, box.bottom) }
}

export function restoreEntryPosition(saved: EntryPosition | undefined, viewport: EntryViewport): EntryPosition {
  const box = bounds(viewport)
  const side = saved?.side === 'left' || saved?.side === 'right'
    ? saved.side
    : Number.isFinite(saved?.x) && saved!.x < (box.left + box.right) / 2 ? 'left' : 'right'
  const defaultY = viewport.top + viewport.height - ENTRY_SIZE - DEFAULT_BOTTOM_CLEARANCE - (viewport.safeBottom ?? 0)
  const y = Number.isFinite(saved?.yRatio)
    ? box.top + clamp(saved!.yRatio!, 0, 1) * (box.bottom - box.top)
    : Number.isFinite(saved?.y) ? saved!.y : defaultY
  const top = clamp(y, box.top, box.bottom)
  return {
    x: side === 'left' ? box.left : box.right,
    y: top,
    side,
    yRatio: box.bottom === box.top ? 0 : (top - box.top) / (box.bottom - box.top),
  }
}

export function snapEntryPosition(position: EntryPosition, viewport: EntryViewport): EntryPosition {
  return restoreEntryPosition({ x: position.x, y: position.y }, viewport)
}
