/**
 * 手势状态机（§4.5），Pointer Events 实现：
 *
 *   idle ──单指按下──▶ pending
 *   pending ──抬起（位移<10px 且 <300ms）──▶ tap
 *   pending ──位移≥10px──▶ pan（连续模式交给原生滚动；单页判断翻页滑动）
 *   pending ──静止 500ms──▶ longpress（无动作，保留系统菜单）
 *   任意 ──第二根手指──▶ multi ──全部抬起──▶ cooldown 300ms ──▶ idle
 *   pointercancel ──▶ idle（不产生 tap）
 *
 * 手指计数自行维护（Pointer Events 无 touches）。
 * 纯逻辑类，不绑定 DOM，由各模式转发指针事件。
 */
export type GestureState = 'idle' | 'pending' | 'pan' | 'longpress' | 'multi' | 'cooldown'

export interface GestureThresholds {
  tapMovePx: number
  tapMs: number
  longpressMs: number
  swipeMinRatioW: number // 水平位移 ≥ 视口宽的比例
  swipeVelocity: number // px/ms
  swipeHorizontalDominance: number // 水平位移 ≥ 垂直位移的倍数
  cooldownMs: number
  viewportWidth: number
}

export const DEFAULT_THRESHOLDS: GestureThresholds = {
  tapMovePx: 10,
  tapMs: 300,
  longpressMs: 500,
  swipeMinRatioW: 0.15,
  swipeVelocity: 0.5,
  swipeHorizontalDominance: 1.5,
  cooldownMs: 300,
  viewportWidth: 400,
}

export interface GestureCallbacks {
  /** 单击（含坐标，交给点击区判定）。 */
  onTap?: (x: number, y: number) => void
  /** 单页翻页滑动（抬起时判定）。dir 为视觉方向。 */
  onSwipe?: (dir: 'left' | 'right', velocity: number) => void
  /** 平移（单页放大态）。 */
  onPan?: (dx: number, dy: number) => void
  onLongPress?: () => void
  /** 多指阶段（缩放交给浏览器或单页自行处理时，用于屏蔽点击）。 */
  onMultiTouch?: (active: boolean) => void
}

interface PointerRecord {
  x: number
  y: number
  t: number
}

export class GestureRecognizer {
  #state: GestureState = 'idle'
  #thresholds: GestureThresholds
  #cb: GestureCallbacks
  #start: PointerRecord | null = null
  #last: PointerRecord | null = null
  #activePointers = new Map<number, PointerRecord>()
  #longpressTimer: ReturnType<typeof setTimeout> | null = null
  #cooldownTimer: ReturnType<typeof setTimeout> | null = null

  constructor(cb: GestureCallbacks, thresholds?: Partial<GestureThresholds>) {
    this.#cb = cb
    this.#thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds }
  }

  get state(): GestureState {
    return this.#state
  }

  updateThresholds(patch: Partial<GestureThresholds>): void {
    this.#thresholds = { ...this.#thresholds, ...patch }
  }

  pointerDown(id: number, x: number, y: number, t: number): void {
    if (this.#state === 'cooldown') return
    this.#activePointers.set(id, { x, y, t })
    if (this.#activePointers.size === 2) {
      this.#toMulti()
      return
    }
    if (this.#activePointers.size > 2) return
    this.#state = 'pending'
    this.#start = { x, y, t }
    this.#last = { x, y, t }
    this.#longpressTimer = setTimeout(() => {
      if (this.#state !== 'pending') return
      this.#state = 'longpress'
      this.#cb.onLongPress?.()
    }, this.#thresholds.longpressMs)
  }

  pointerMove(id: number, x: number, y: number, t: number): void {
    const rec = this.#activePointers.get(id)
    if (!rec) return
    rec.x = x
    rec.y = y
    rec.t = t
    if (this.#state === 'pending' && this.#start) {
      const dx = x - this.#start.x
      const dy = y - this.#start.y
      if (Math.hypot(dx, dy) >= this.#thresholds.tapMovePx) {
        this.#clearLongpress()
        this.#state = 'pan'
      } else {
        this.#last = { x, y, t }
        return
      }
    }
    if (this.#state === 'pan' && this.#last) {
      const dx = x - this.#last.x
      const dy = y - this.#last.y
      this.#cb.onPan?.(dx, dy)
    }
    this.#last = { x, y, t }
  }

  pointerUp(id: number, x: number, y: number, t: number): void {
    this.#activePointers.delete(id)
    if (this.#state === 'multi') {
      if (this.#activePointers.size === 0) this.#startCooldown()
      return
    }
    if (this.#state === 'cooldown') return
    if (this.#state === 'pending' && this.#start) {
      const dist = Math.hypot(x - this.#start.x, y - this.#start.y)
      const dur = t - this.#start.t
      this.#clearLongpress()
      if (dist < this.#thresholds.tapMovePx && dur < this.#thresholds.tapMs) {
        this.#state = 'idle'
        this.#cb.onTap?.(x, y)
        return
      }
    }
    if (this.#state === 'pan' && this.#start) {
      const dx = x - this.#start.x
      const dy = y - this.#start.y
      const dur = Math.max(1, t - this.#start.t)
      const velocity = Math.hypot(dx, dy) / dur
      this.#state = 'idle'
      this.#maybeSwipe(dx, dy, velocity)
      return
    }
    this.#state = 'idle'
  }

  pointerCancel(id: number): void {
    this.#activePointers.delete(id)
    this.#clearLongpress()
    // 浏览器接管滚动/缩放：不产生任何动作（R-G1）
    if (this.#state === 'multi') {
      if (this.#activePointers.size === 0) this.#startCooldown()
      return
    }
    this.#state = this.#activePointers.size > 0 ? 'pending' : 'idle'
    if (this.#state === 'idle') this.#start = null
  }

  #toMulti(): void {
    this.#clearLongpress()
    this.#state = 'multi'
    this.#cb.onMultiTouch?.(true)
  }

  #startCooldown(): void {
    this.#cb.onMultiTouch?.(false)
    this.#state = 'cooldown'
    this.#start = null
    this.#cooldownTimer = setTimeout(() => {
      this.#cooldownTimer = null
      if (this.#state === 'cooldown') this.#state = 'idle'
    }, this.#thresholds.cooldownMs)
  }

  #clearLongpress(): void {
    if (this.#longpressTimer != null) {
      clearTimeout(this.#longpressTimer)
      this.#longpressTimer = null
    }
  }

  /** §4.5：水平位移 ≥ 15% 视口宽，或速度 ≥ 0.5 px/ms，且水平位移 ≥ 1.5 倍垂直位移。 */
  #maybeSwipe(dx: number, dy: number, velocity: number): void {
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)
    if (ay > 0 && ax < ay * this.#thresholds.swipeHorizontalDominance) return
    if (ay === 0 && ax === 0) return
    const far = ax >= this.#thresholds.viewportWidth * this.#thresholds.swipeMinRatioW
    const fast = velocity >= this.#thresholds.swipeVelocity
    if (!far && !fast) return
    this.#cb.onSwipe?.(dx < 0 ? 'left' : 'right', velocity)
  }

  dispose(): void {
    this.#clearLongpress()
    if (this.#cooldownTimer != null) clearTimeout(this.#cooldownTimer)
    this.#activePointers.clear()
    this.#state = 'idle'
    this.#start = null
    this.#last = null
  }
}
