/**
 * 清理表（§4.4 清理）：所有监听器、观察器、定时器和对象 URL 登记到一起，
 * 退出时统一释放。测试构建通过 cleanupActiveCount 暴露计数（§6.4）。
 */
let activeCount = 0

export function cleanupActiveCount(): number {
  return activeCount
}

export class Cleanup {
  #items: Array<() => void> = []
  #done = false

  /** 登记一个释放动作，返回撤销登记（不执行）函数。 */
  add(dispose: () => void): () => void {
    if (this.#done) {
      dispose()
      return () => {}
    }
    let disposed = false
    const wrapper = () => {
      if (disposed) return
      disposed = true
      activeCount--
      dispose()
    }
    activeCount++
    this.#items.push(wrapper)
    return () => {
      if (disposed) return
      const i = this.#items.indexOf(wrapper)
      if (i >= 0) this.#items.splice(i, 1)
      wrapper()
    }
  }

  addListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, listener, options)
    this.add(() => target.removeEventListener(type, listener, options))
  }

  setTimeout(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      cancel()
      fn()
    }, ms)
    const cancel = this.add(() => clearTimeout(id))
  }

  setInterval(fn: () => void, ms: number): void {
    const id = setInterval(fn, ms)
    this.add(() => clearInterval(id))
  }

  objectUrl(obj: Blob | MediaSource): string {
    const url = URL.createObjectURL(obj)
    this.add(() => URL.revokeObjectURL(url))
    return url
  }

  get size(): number {
    return this.#items.length
  }

  run(): void {
    if (this.#done) return
    this.#done = true
    // 后注册的先释放
    for (const dispose of this.#items.splice(0).reverse()) dispose()
  }
}
