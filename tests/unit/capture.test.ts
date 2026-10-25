import { describe, expect, it, vi } from 'vitest'
import {
  captureInjectSource,
  CAPTURE_SOURCE,
  installCaptureOnWindow,
} from '../../src/site/mangayun/capture'

/** 页面上下文引导函数的源码文本（构建后自包含性检查，§4.8）。 */
const BOOTSTRAP_NAME = 'pageCaptureBootstrap'

describe('capture 捕获层', () => {
  it('注入源码自包含：不引用模块作用域标识符', () => {
    const src = captureInjectSource('token123')
    expect(src.startsWith('(')).toBe(true)
    expect(src.endsWith(');')).toBe(true)
    expect(src).toContain('"token123"')
    // 提取函数体（去掉外层包裹与调用），扫描常见的外部引用模式
    const bodyStart = src.indexOf('{')
    const body = src.slice(bodyStart)
    for (const forbidden of ['import ', 'require(', 'captureInjectSource', 'CAPTURE_SOURCE', 'PAGE_FLAG']) {
      expect(body).not.toContain(forbidden)
    }
    // 函数名标识符不应在体内被再次引用（自包含）
    const occurrences = body.split(BOOTSTRAP_NAME).length - 1
    expect(occurrences).toBe(0)
  })

  it('注入源码在独立作用域执行：包装 fetch 并发出捕获消息', async () => {
    // 用 Function 构造隔离作用域执行注入源码，模拟页面上下文（CSP 注入路径）
    const events: unknown[] = []
    const json = (obj: unknown): Response =>
      new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json' } })
    const fakeFetch = vi.fn(async (input: unknown, _init?: unknown) => {
      if (String(input).includes('/api/other')) return json({ data: {} })
      return json({ data: { images: ['a', 'b'] } })
    })
    const scope = {
      fetch: fakeFetch,
      location: { origin: 'https://mangayun.com' },
      addEventListener: () => {},
      postMessage: (msg: unknown) => events.push(msg),
    }
    // 断开作用域链：以参数注入全部自由变量，注入源码立即执行
    new Function(
      'window',
      'self',
      'fetch',
      'postMessage',
      `"use strict"; const document = undefined; const location = window.location; ${captureInjectSource('tk')}`,
    )(scope, scope, fakeFetch, scope.postMessage)

    await scope.fetch('/api/chapter-images', {
      method: 'POST',
      body: JSON.stringify({ siteId: 'dm5', chapterUrl: 'https://x/ch/1', refresh: false }),
    })
    await scope.fetch('/api/other')
    // 等 clone().json() 的微任务链
    await new Promise((r) => setTimeout(r, 0))
    const captured = events.find((e) => (e as Record<string, unknown>)['kind'] === 'chapter-images') as Record<string, unknown>
    expect(captured?.['source']).toBe(CAPTURE_SOURCE)
    expect(captured?.['token']).toBe('tk')
    expect(captured?.['chapterUrl']).toBe('https://x/ch/1')
    expect(captured?.['images']).toEqual(['a', 'b'])
    expect(fakeFetch).toHaveBeenCalledTimes(2)
    expect(events).toHaveLength(1) // 非目标接口不发事件
  })

  it('installCaptureOnWindow：沙箱回退路径捕获 details', async () => {
    const events = [] as Array<{ kind: string }>
    const json = (obj: unknown): Response => new Response(JSON.stringify(obj))
    const fakeFetch = vi.fn(async () =>
      json({ data: { title: 'T', chapters: [] } }),
    )
    const target = { fetch: fakeFetch } as unknown as Window & typeof globalThis
    const getEvents = installCaptureOnWindow(target, fakeFetch as typeof fetch, 'tk')
    const res = await target.fetch('/api/details', {
      method: 'POST',
      body: JSON.stringify({ siteId: 'dm5', detailUrl: 'u' }),
    })
    expect(res.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 0))
    for (const e of getEvents()) events.push({ kind: e.kind })
    expect(events.some((e) => e.kind === 'details')).toBe(true)
  })
})
