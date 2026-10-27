/**
 * harness 服务端：确定性 PNG 生成与故障注入端点（dev 与 preview 共用）。
 * 图片为真实 PNG 字节，供阅读器显示与下载校验（文件头判定）使用。
 */
import zlib from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function hashSeed(seed) {
  let h = 2166136261
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const pngCache = new Map()

/** 按种子确定性生成 PNG（RGBA，颜色随种子/坐标变化，便于肉眼区分页序）。 */
export function makePng(seed, width = 600, height = 900) {
  const key = `${seed}:${width}x${height}`
  const hit = pngCache.get(key)
  if (hit) return hit
  const h = hashSeed(seed)
  const r = (h & 0xff) | 0x40
  const g = ((h >> 8) & 0xff) | 0x40
  const b = ((h >> 16) & 0xff) | 0x40
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4)
    raw[row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 4
      // 简单棋盘 + 渐变纹理
      const checker = ((x >> 5) + (y >> 5)) % 2 === 0 ? 40 : 0
      raw[p] = Math.min(255, r + checker + (y * 40 / height) | 0)
      raw[p + 1] = Math.min(255, g + checker | 0)
      raw[p + 2] = Math.min(255, b + checker + (x * 40 / width) | 0)
      raw[p + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  pngCache.set(key, png)
  return png
}

/** 故障端点的命中计数（如 429 两次后放行）。 */
export const hitCounts = new Map()

export function hit(path) {
  const n = (hitCounts.get(path) ?? 0) + 1
  hitCounts.set(path, n)
  return n
}

/**
 * 中间件：挂到 vite dev（configureServer）与 preview（configurePreviewServer）。
 */
export function mockServerPlugin() {
  const handle = (req, res, next) => {
    const url = new URL(req.url, 'http://mock.local')
    const path = url.pathname
    const send = (status, body, headers = {}) => {
      res.statusCode = status
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
      res.end(body)
    }
    // 假“原站阅读器”页面：不发出捕获事件，只渲染 img（含封面/重复干扰），
    // 供 DOM 抓取兜底路径的 e2e 使用（chapterUrl 任意）
    if (path.startsWith('/read/')) {
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div role="dialog" aria-label="漫画阅读器">
  <img class="thumb-img" referrerpolicy="no-referrer" src="/mock/img/cover.png">
  <img class="thumb-img" referrerpolicy="no-referrer" src="https://static.example.com/cover/foo.jpg">
  <div class="reader-pages"></div>
  <script>
    setTimeout(() => {
      const wrap = document.querySelector('.reader-pages')
      for (let i = 0; i < 5; i++) {
        const img = document.createElement('img')
        img.setAttribute('referrerpolicy', 'no-referrer')
        img.src = '/mock/img/scrape-p' + i + '.png?w=300&h=450'
        wrap.appendChild(img)
        if (i === 1) wrap.appendChild(img.cloneNode())
      }
    }, 600)
  </${'script'}>
</div></body></html>`
      send(200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return
    }
    if (path.startsWith('/mock/img/')) {
      const seed = decodeURIComponent(path.slice('/mock/img/'.length).replace(/\.png$/, ''))
      const w = Number(url.searchParams.get('w') ?? 600)
      const h = Number(url.searchParams.get('h') ?? 900)
      const bytes = makePng(seed, w, h)
      const etag = `"${seed}-${w}-${h}"`
      if (req.headers['if-none-match'] === etag) {
        send(304, null)
        return
      }
      send(200, bytes, { 'content-type': 'image/png', 'content-length': String(bytes.length), 'cache-control': 'no-store', etag })
      return
    }
    if (path.startsWith('/mock/slow/')) {
      const seed = decodeURIComponent(path.slice('/mock/slow/'.length).replace(/\.png$/, ''))
      const delay = Number(url.searchParams.get('delay') ?? 400)
      const w = Number(url.searchParams.get('w') ?? 600)
      const h = Number(url.searchParams.get('h') ?? 900)
      const bytes = makePng(seed, w, h)
      setTimeout(() => send(200, bytes, { 'content-type': 'image/png', 'content-length': String(bytes.length), 'cache-control': 'no-store' }), delay)
      return
    }
    if (path === '/mock/f/404.png') {
      send(404, 'not found', { 'content-type': 'text/plain' })
      return
    }
    if (path === '/mock/f/429.png') {
      const n = hit(path)
      if (n <= 2) {
        send(429, 'slow down', { 'content-type': 'text/plain', 'retry-after': '1' })
        return
      }
      const bytes = makePng('rate-limit-ok', 600, 900)
      send(200, bytes, { 'content-type': 'image/png', 'content-length': String(bytes.length), 'cache-control': 'no-store' })
      return
    }
    if (path === '/mock/f/html.png') {
      send(200, '<!DOCTYPE html><html><body>error page</body></html>', { 'content-type': 'text/html; charset=utf-8' })
      return
    }
    if (path === '/mock/f/expired.png') {
      send(403, 'forbidden (signature expired)', { 'content-type': 'text/plain' })
      return
    }
    next()
  }
  return {
    name: 'myr-mock-server',
    configureServer(server) {
      server.middlewares.use(handle)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle)
    },
  }
}
