import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../../src/download/scheduler'
import { FetchFailure } from '../../src/download/fetcher'

function deferred(): { promise: Promise<unknown>; resolve: (v?: unknown) => void; reject: (e?: unknown) => void } {
  let resolve!: (v?: unknown) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('scheduler（R-D6、R-D7、R-D10）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('并发不超过上限', async () => {
    const scheduler = new Scheduler(2)
    let active = 0
    let peak = 0
    const jobs = Array.from({ length: 6 }, (_, i) => {
      const d = deferred()
      return {
        key: `k${i}`,
        job: {
          key: `k${i}`,
          run: async () => {
            active++
            peak = Math.max(peak, active)
            await d.promise
            active--
          },
        },
        d,
      }
    })
    const outcomes = jobs.map((j) => scheduler.submit(j.job))
    await vi.advanceTimersByTimeAsync(0)
    expect(peak).toBe(2)
    jobs[0]!.d.resolve()
    jobs[1]!.d.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(peak).toBeLessThanOrEqual(2)
    for (const j of jobs.slice(2)) j.d.resolve()
    const settled = await Promise.all(outcomes)
    expect(settled.every((o) => o.status === 'done')).toBe(true)
  })

  it('网络错误重试：约 1s、3s（含抖动 ≤800ms）后第三次成功', async () => {
    const scheduler = new Scheduler(1)
    let attempts = 0
    const outcome = scheduler.submit({
      key: 'k',
      run: async () => {
        attempts++
        if (attempts < 3) throw new FetchFailure('network', 'boom')
        return 'ok'
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1800)
    expect(attempts).toBe(2)
    await vi.advanceTimersByTimeAsync(3800)
    expect(attempts).toBe(3)
    expect(await outcome).toMatchObject({ status: 'done', attempts: 3 })
  })

  it('404 三次后失败', async () => {
    const scheduler = new Scheduler(1)
    let attempts = 0
    const outcome = scheduler.submit({
      key: 'k',
      run: async () => {
        attempts++
        throw new FetchFailure('http-404', 'HTTP 404', 404)
      },
    })
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await outcome
    expect(attempts).toBe(3)
    expect(result.status).toBe('failed')
    expect(result.attempts).toBe(3)
  })

  it('429 全局暂停并遵守 Retry-After：等待期间没有新请求', async () => {
    const onRateLimited = vi.fn()
    const scheduler = new Scheduler(1, { onRateLimited })
    let attempts = 0
    let secondStarted = false
    const first = scheduler.submit({
      key: 'a',
      run: async () => {
        attempts++
        if (attempts === 1) throw new FetchFailure('http-429', 'HTTP 429', 429, 5000)
        return 'ok'
      },
    })
    const second = scheduler.submit({
      key: 'b',
      run: async () => {
        secondStarted = true
        return 'ok'
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)
    expect(onRateLimited).toHaveBeenCalledWith(5000)
    // 等待期内推进 4.9s：不得发起任何新请求
    await vi.advanceTimersByTimeAsync(4900)
    expect(attempts).toBe(1)
    expect(secondStarted).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(attempts).toBe(2) // a 重试成功
    expect(await first).toMatchObject({ status: 'done' })
    await vi.advanceTimersByTimeAsync(10)
    expect(secondStarted).toBe(true)
    expect(await second).toMatchObject({ status: 'done' })
  })

  it('暂停后不再发出新请求（2 秒内）', async () => {
    const scheduler = new Scheduler(1)
    const started: string[] = []
    const dA = deferred()
    const dB = deferred()
    const dC = deferred()
    const pool: Record<string, ReturnType<typeof deferred>> = { a: dA, b: dB, c: dC }
    const outcomes = (['a', 'b', 'c'] as const).map((key) =>
      scheduler.submit({
        key,
        run: () => {
          started.push(key)
          return pool[key]!.promise
        },
      }),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual(['a'])
    scheduler.pause()
    dA.resolve()
    await vi.advanceTimersByTimeAsync(2000)
    expect(started).toEqual(['a']) // 暂停后 2 秒内无新请求
    scheduler.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual(['a', 'b'])
    dB.resolve()
    dC.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual(['a', 'b', 'c'])
    expect((await Promise.all(outcomes)).every((o) => o.status === 'done')).toBe(true)
  })

  it('explicit Retry-After can exceed the fallback backoff cap', async () => {
    const scheduler = new Scheduler(1)
    let attempts = 0
    const result = scheduler.submit({ key: 'long-wait', run: async () => {
      if (++attempts === 1) throw new FetchFailure('http-429', 'wait', 429, 120_000)
    } })
    await vi.advanceTimersByTimeAsync(119_999)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).status).toBe('done')
    scheduler.cancel()
  })

  it('pause and resume do not bypass an active Retry-After deadline', async () => {
    const scheduler = new Scheduler(1)
    let attempts = 0
    const result = scheduler.submit({ key: 'resume-wait', run: async () => {
      if (++attempts === 1) throw new FetchFailure('http-429', 'wait', 429, 5000)
    } })
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.pause()
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect((await result).status).toBe('done')
    scheduler.cancel()
  })

  it('取消后迟到的回调被丢弃', async () => {
    const scheduler = new Scheduler(2)
    const d1 = deferred()
    const d2 = deferred()
    const d3 = deferred()
    const first = scheduler.submit({ key: 'a', run: () => d1.promise })
    const second = scheduler.submit({ key: 'b', run: () => d2.promise })
    const third = scheduler.submit({ key: 'c', run: () => d3.promise })
    await vi.advanceTimersByTimeAsync(0)
    scheduler.cancel()
    // 取消后迟到的完成/排队回调都返回 cancelled
    d1.resolve('late')
    d2.resolve('late')
    const [o1, o2, o3] = await Promise.all([first, second, third])
    expect(o1.status).toBe('cancelled')
    expect(o2.status).toBe('cancelled')
    expect(o3.status).toBe('cancelled')
  })

  it('expired 不重试直接交给上层', async () => {
    const scheduler = new Scheduler(1)
    const outcome = scheduler.submit({
      key: 'k',
      run: async () => {
        throw new FetchFailure('expired', 'HTML 响应', 403)
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(await outcome).toMatchObject({ status: 'expired' })
  })

  it('退避上限 60s（无 Retry-After 的连续 429）', async () => {
    const scheduler = new Scheduler(1)
    let hits = 0
    const outcome = scheduler.submit({
      key: 'k',
      run: async () => {
        hits++
        if (hits <= 7) throw new FetchFailure('http-429', 'HTTP 429', 429)
        return 'ok'
      },
    })
    // 推进足够长时间：第 7 次退避为 min(2^7=128s, 60s)=60s
    await vi.advanceTimersByTimeAsync(60_000 * 8)
    const result = await outcome
    expect(result.status).toBe('done')
    void scheduler
  })
})
