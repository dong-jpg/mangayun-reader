import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingEntry } from '../../src/ui/entry'

const entries: FloatingEntry[] = []

function viewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function fixture(position?: { x: number; y: number; side?: 'left' | 'right'; yRatio?: number }) {
  const onTap = vi.fn()
  const savePosition = vi.fn()
  const entry = new FloatingEntry({ onTap, savePosition, loadPosition: () => position })
  entries.push(entry)
  entry.show()
  const host = [...document.documentElement.children].find(
    (el) => el.shadowRoot?.querySelector('.myr-entry'),
  ) as HTMLElement
  const button = host.shadowRoot!.querySelector<HTMLButtonElement>('.myr-entry')!
  button.setPointerCapture = vi.fn()
  button.releasePointerCapture = vi.fn()
  button.hasPointerCapture = vi.fn(() => true)
  return { entry, host, button, onTap, savePosition }
}

function pointer(button: HTMLElement, type: string, x: number, y: number, id = 1): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } })
  button.dispatchEvent(event)
}

beforeEach(() => {
  viewport(412, 915)
})

afterEach(() => {
  for (const entry of entries.splice(0)) entry.hide()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('floating entry', () => {
  it('uses a labelled book icon instead of the two-line badge', () => {
    const { button } = fixture()
    expect(button.getAttribute('aria-label')).toBe('打开增强阅读器')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.textContent).not.toContain('\n')
  })

  it('defaults to the right edge above the bottom navigation area', () => {
    const { host } = fixture()
    expect(Number.parseFloat(host.style.left)).toBe(348)
    const top = Number.parseFloat(host.style.top)
    expect(top).toBeGreaterThan(600)
    expect(top + 52).toBeLessThanOrEqual(915 - 96)
  })

  it('supports native button click and keyboard-generated activation', () => {
    const { button, onTap } = fixture()
    button.click()
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('snaps a dragged entry to the closest edge without opening the reader', () => {
    const { button, host, savePosition, onTap } = fixture()
    pointer(button, 'pointerdown', 374, 790)
    pointer(button, 'pointermove', 45, 230)
    pointer(button, 'pointerup', 45, 230)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(onTap).not.toHaveBeenCalled()
    expect(Number.parseFloat(host.style.left)).toBe(12)
    expect(savePosition).toHaveBeenCalledWith(expect.objectContaining({ side: 'left' }))
    const saved = savePosition.mock.calls[0]![0] as { yRatio: number }
    expect(saved.yRatio).toBeGreaterThanOrEqual(0)
    expect(saved.yRatio).toBeLessThanOrEqual(1)
  })

  it('preserves the chosen edge and vertical ratio across orientation changes', () => {
    const { host } = fixture({ x: 348, y: 400, side: 'right', yRatio: 0.5 })
    viewport(915, 412)
    window.dispatchEvent(new Event('resize'))
    expect(Number.parseFloat(host.style.left)).toBe(851)
    expect(Number.parseFloat(host.style.top)).toBeGreaterThanOrEqual(12)
    expect(Number.parseFloat(host.style.top) + 52).toBeLessThanOrEqual(400)
  })

  it('restores a legacy position to its nearest edge', () => {
    const { host } = fixture({ x: 30, y: 240 })
    expect(Number.parseFloat(host.style.left)).toBe(12)
    expect(Number.parseFloat(host.style.top)).toBe(240)
  })

  it('does not let invalid persisted coordinates move the entry offscreen', () => {
    const { host } = fixture({ x: Number.NaN, y: Number.POSITIVE_INFINITY })
    expect(Number.parseFloat(host.style.left)).toBe(348)
    expect(Number.isFinite(Number.parseFloat(host.style.top))).toBe(true)
  })

  it('clamps within the visual viewport instead of the obscured layout viewport', () => {
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), {
      width: 360, height: 500, offsetLeft: 20, offsetTop: 30, scale: 1,
    }))
    const { host } = fixture()
    expect(Number.parseFloat(host.style.left)).toBe(316)
    expect(Number.parseFloat(host.style.top)).toBeGreaterThanOrEqual(42)
    expect(Number.parseFloat(host.style.top) + 52).toBeLessThanOrEqual(518)
  })

  it('registers viewport listeners only while visible, with idempotent show/hide', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { entry } = fixture()
    entry.show()
    expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1)
    entry.hide()
    entry.hide()
    expect(remove.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1)
  })

  it('cancelling a drag never activates the entry', () => {
    const { button, onTap } = fixture()
    pointer(button, 'pointerdown', 374, 790)
    pointer(button, 'pointermove', 100, 250)
    pointer(button, 'pointercancel', 100, 250)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(onTap).not.toHaveBeenCalled()
  })
})
