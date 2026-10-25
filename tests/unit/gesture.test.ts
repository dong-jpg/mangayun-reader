import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { GestureRecognizer, DEFAULT_THRESHOLDS } from '../../src/reader/gesture'

describe('手势状态机（§4.5）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tap：位移 < 10px 且 < 300ms', () => {
    const onTap = vi.fn()
    const g = new GestureRecognizer({ onTap })
    g.pointerDown(1, 100, 100, 0)
    expect(g.state).toBe('pending')
    g.pointerUp(1, 105, 103, 150)
    expect(g.state).toBe('idle')
    expect(onTap).toHaveBeenCalledWith(105, 103)
  })

  it('拖动 ≥10px 进入 pan，不产生 tap', () => {
    const onTap = vi.fn()
    const g = new GestureRecognizer({ onTap })
    g.pointerDown(1, 100, 100, 0)
    g.pointerMove(1, 130, 105, 50)
    expect(g.state).toBe('pan')
    g.pointerUp(1, 130, 105, 100)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('tap 超时 300ms 不触发（转为 pan/普通抬起）', () => {
    const onTap = vi.fn()
    const g = new GestureRecognizer({ onTap })
    g.pointerDown(1, 100, 100, 0)
    g.pointerUp(1, 102, 101, 400)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('静止 500ms → longpress，无动作不产生 tap', () => {
    const onLongPress = vi.fn()
    const onTap = vi.fn()
    const g = new GestureRecognizer({ onLongPress, onTap })
    g.pointerDown(1, 100, 100, 0)
    vi.advanceTimersByTime(500)
    expect(g.state).toBe('longpress')
    expect(onLongPress).toHaveBeenCalled()
    g.pointerUp(1, 101, 100, 600)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('多指 → multi；全部抬起后 300ms 内不响应点击（R-G2）', () => {
    const onTap = vi.fn()
    const g = new GestureRecognizer({ onTap })
    g.pointerDown(1, 100, 100, 0)
    g.pointerDown(2, 200, 200, 30)
    expect(g.state).toBe('multi')
    g.pointerUp(1, 100, 100, 100)
    g.pointerUp(2, 200, 200, 110)
    expect(g.state).toBe('cooldown')
    // 冷却期内单击无效
    g.pointerDown(3, 300, 300, 200)
    g.pointerUp(3, 300, 300, 220)
    expect(onTap).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(g.state).toBe('idle')
    g.pointerDown(4, 300, 300, 600)
    g.pointerUp(4, 300, 300, 620)
    expect(onTap).toHaveBeenCalled()
  })

  it('pointercancel → idle，不产生 tap（浏览器接管）', () => {
    const onTap = vi.fn()
    const g = new GestureRecognizer({ onTap })
    g.pointerDown(1, 100, 100, 0)
    g.pointerCancel(1)
    expect(g.state).toBe('idle')
    expect(onTap).not.toHaveBeenCalled()
  })

  it('单页翻页滑动：水平位移 ≥ 15% 视口宽（R-S6 判定）', () => {
    const onSwipe = vi.fn()
    const g = new GestureRecognizer({ onSwipe }, { viewportWidth: 400 })
    g.pointerDown(1, 300, 200, 0)
    g.pointerMove(1, 100, 205, 100) // dx=-200（50%），dy=5
    g.pointerUp(1, 100, 205, 120)
    expect(onSwipe).toHaveBeenCalledWith('left', expect.any(Number))
  })

  it('快速滑动按速度判定（≥0.5px/ms）', () => {
    const onSwipe = vi.fn()
    const g = new GestureRecognizer({ onSwipe }, { viewportWidth: 4000 })
    g.pointerDown(1, 100, 200, 0)
    g.pointerMove(1, 190, 202, 90) // dx=90 位移小但 1px/ms
    g.pointerUp(1, 190, 202, 100)
    expect(onSwipe).toHaveBeenCalledWith('right', expect.any(Number))
  })

  it('垂直主导的滑动不是翻页滑动', () => {
    const onSwipe = vi.fn()
    const g = new GestureRecognizer({ onSwipe }, { viewportWidth: 400 })
    g.pointerDown(1, 200, 100, 0)
    g.pointerMove(1, 220, 400, 100)
    g.pointerUp(1, 220, 400, 120)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('pan 回调携带增量（单页平移用）', () => {
    const onPan = vi.fn()
    const g = new GestureRecognizer({ onPan })
    g.pointerDown(1, 100, 100, 0)
    g.pointerMove(1, 120, 110, 50) // 触发 pan 状态
    g.pointerMove(1, 130, 112, 60)
    expect(onPan).toHaveBeenCalledWith(10, 2)
  })

  it('默认阈值常量完整', () => {
    expect(DEFAULT_THRESHOLDS.tapMovePx).toBe(10)
    expect(DEFAULT_THRESHOLDS.tapMs).toBe(300)
    expect(DEFAULT_THRESHOLDS.longpressMs).toBe(500)
    expect(DEFAULT_THRESHOLDS.cooldownMs).toBe(300)
  })
})
