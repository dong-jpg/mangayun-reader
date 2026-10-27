/**
 * 真站桌面端捕获验证（诊断脚本，不入库）：
 * 模拟 Tampermonkey 在 document-start 向页面上下文注入我们的捕获引导，
 * 访问真实 /read URL，验证 /api/chapter-images 的捕获消息能否产生。
 */
import { chromium } from '@playwright/test'

const TOKEN = 'diag-token-1'

// 与 src/site/mangayun/capture.ts 的 pageCaptureBootstrap 保持一致的复刻
const BOOTSTRAP = `
window.__diagEvents = []
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.__diag) window.__diagEvents.push(e.data.__diag)
})
;(function pageCaptureBootstrap(token) {
  const w = window
  const page = w
  if (page.__myrCaptureV1) return
  page.__myrCaptureV1 = token
  const orig = w.fetch.bind(w)
  const send = (msg) => {
    try {
      w.postMessage(Object.assign({ source: 'myr:v1:capture', token, __diag: true }, msg), w.location.origin)
    } catch {}
  }
  w.fetch = function (input, init) {
    let url = ''
    try { url = typeof input === 'string' ? input : String(input && input.url ? input.url : '') } catch {}
    const p = orig(input, init)
    const path = url.split('?')[0] || ''
    if (!/\\/api\\/(details|chapter-images)$/.test(path)) return p
    let req = {}
    try { if (init && typeof init.body === 'string') req = JSON.parse(init.body) } catch {}
    p.then((res) => {
      try {
        res.clone().json().then((json) => {
          const data = json && json.data
          if (path.endsWith('/api/details')) {
            send({ kind: 'raw-details', status: res.status, ok: res.ok, hasChapters: !!(data && Array.isArray(data.chapters)), keys: json ? Object.keys(json) : null })
          } else if (path.endsWith('/api/chapter-images')) {
            send({ kind: 'raw-images', status: res.status, ok: res.ok, hasImages: !!(data && Array.isArray(data.images)), imagesLen: data && Array.isArray(data.images) ? data.images.length : null, keys: json ? Object.keys(json) : null, sample: json ? JSON.stringify(json).slice(0, 300) : null })
          }
        }).catch((e) => {
          if (path.endsWith('/api/chapter-images')) send({ kind: 'raw-images', status: res.status, ok: res.ok, parseError: String(e).slice(0, 120) })
        })
      } catch {}
    }).catch((e) => {
      if (path.endsWith('/api/chapter-images')) send({ kind: 'raw-images', networkError: String(e).slice(0, 120) })
    })
    return p
  }
})('${TOKEN}')
`

function b64url(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function main() {
  const comic = ['manhuazhijia', 'https://www.manhuazhijia.cc/comic/guimiezhiren']
  const chapter = 'https://www.manhuazhijia.cc/chapter/8680473'
  const readUrl = `https://mangayun.com/read/${b64url(JSON.stringify(comic))}/${b64url(chapter)}`

  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)))
  // CDP 级网络监听：真实状态码与响应体
  page.on('response', async (res) => {
    if (res.url().includes('/api/chapter-images')) {
      console.log('[net] chapter-images 状态:', res.status())
      try {
        const body = await res.text()
        console.log('[net] 响应体前 400 字:', body.slice(0, 400))
      } catch (e) {
        console.log('[net] 读取响应体失败:', String(e).slice(0, 120))
      }
    }
    if (res.url().includes('/api/details')) {
      console.log('[net] details 状态:', res.status())
    }
  })
  page.on('request', (req) => {
    if (req.url().includes('/api/chapter-images')) {
      console.log('[net] chapter-images 请求方式: resource=' + req.resourceType())
    }
  })
  await page.addInitScript(BOOTSTRAP)

  console.log('打开', readUrl)
  await page.goto(readUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // 轮询捕获事件，最多 40 秒
  const deadline = Date.now() + 40000
  let sawImages = false
  while (Date.now() < deadline) {
    const events = await page.evaluate(() => window.__diagEvents ?? [])
    const images = events.filter((e) => e.kind === 'raw-images')
    if (images.length > 0) sawImages = true
    if (sawImages) {
      for (const ev of events) console.log('事件:', JSON.stringify(ev))
      await browser.close()
      return
    }
    await page.waitForTimeout(1000)
  }
  // 超时：完整转储现场
  const dump = await page.evaluate(async () => {
    const events = window.__diagEvents ?? []
    const swReg = await (navigator.serviceWorker?.getRegistrations?.() ?? Promise.resolve([]))
    return {
      events,
      fetchWrapped: window.fetch.toString().includes('myrWrappedFetch') || window.fetch.toString().includes('pageCaptureBootstrap') || window.fetch.toString().length < 200 ? window.fetch.toString().slice(0, 150) : '原生? ' + window.fetch.toString().slice(0, 80),
      flag: window.__myrCaptureV1 ?? null,
      swCount: swReg.length,
      swScope: swReg[0]?.scope ?? null,
      readerImgs: document.querySelectorAll('img[referrerpolicy="no-referrer"]').length,
      bodyText: document.body.innerText.slice(0, 200),
    }
  })
  console.log('✗ 超时未捕获。现场：', JSON.stringify(dump, null, 1))
  await browser.close()
  process.exit(1)
  // 超时：转储现场
  const events = await page.evaluate(() => window.__diagEvents ?? [])
  console.log('✗ 40s 内未捕获到 chapter-images。事件数：', events.length)
  const netRequests = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('/api/')).slice(0, 10))
  console.log('页面实际发起的 /api 请求：', netRequests)
  const html = await page.content()
  console.log('页面标题：', await page.title())
  console.log('URL：', page.url())
  console.log('包含登录字样：', /登录|login/i.test(html.slice(0, 5000)))
  await browser.close()
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
