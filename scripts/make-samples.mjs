/**
 * 生成交付样本 ZIP（方案 §6.1 交付物 4）：
 * - samples/sample-single-chapter.zip：单话（第3话，6 页条漫）
 * - samples/sample-multi-skip.zip：跳选第 1、3 话（跳过第 2 话 → 文件夹保持 0001/0003 全局序号，R-D3）
 * 由 harness 页 + mock 适配器驱动真实下载流水线产生，并解包核验报告与条目。
 */
import { execSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const PORT = 4180
const ROOT = resolve(import.meta.dirname, '..')

function log(...args) {
  console.log('[samples]', ...args)
}

async function main() {
  log('构建 harness…')
  execSync('npx vite build --config harness/vite.config.ts', { cwd: ROOT, stdio: 'pipe' })

  const server = spawn(
    'npx',
    ['vite', 'preview', '--config', 'harness/vite.config.ts', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, shell: true, stdio: 'pipe' },
  )
  try {
    await waitForServer(PORT)
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
    const page = await ctx.newPage()

    const single = await downloadAsBase64(page, [2]) // 第3话
    const multi = await downloadAsBase64(page, [0, 2]) // 第1话 + 第3话（跳过第2话）

    mkdirSync(resolve(ROOT, 'samples'), { recursive: true })
    const singleBuf = Buffer.from(single.base64, 'base64')
    const multiBuf = Buffer.from(multi.base64, 'base64')
    writeFileSync(resolve(ROOT, 'samples', 'sample-single-chapter.zip'), singleBuf)
    writeFileSync(resolve(ROOT, 'samples', 'sample-multi-skip.zip'), multiBuf)

    verify('sample-single-chapter.zip', singleBuf, ['0003_第3话'])
    verify('sample-multi-skip.zip', multiBuf, ['0001_第1话', '0003_第3话'])
    await browser.close()
    log('完成：samples/ 下两个样本 ZIP 已生成并核验')
  } finally {
    server.kill()
  }
}

async function downloadAsBase64(page, chapterIndexes) {
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await page.waitForFunction(
    () => {
       
      const h = window.__harness
      return h && h.controller.pages.length > 0
    },
    undefined,
    { timeout: 20000, polling: 200 },
  )
  return page.evaluate(async (indexes) => {
     
    const h = window.__harness
    const info = await h.adapter.resolveComic({ siteId: 'harness', detailUrl: 'x' })
    const targets = indexes.map((i) => info.chapters[i])
    await h.manager.start(info.ref, info.title, targets)
    await new Promise((resolveWait, reject) => {
      const t0 = Date.now()
      const tick = setInterval(() => {
        const state = h.manager.task?.state
        if (state === 'packed' || state === 'incomplete' || state === 'failed') {
          clearInterval(tick)
          if (state === 'packed') resolveWait()
          else reject(new Error(`任务结束于 ${state}`))
        } else if (Date.now() - t0 > 120000) {
          clearInterval(tick)
          reject(new Error('超时'))
        }
      }, 200)
    })
    const pack = h.manager.packHandle
    if (!pack) throw new Error('没有打包产物')
    const source = pack.file ?? pack.blob
    const buf = new Uint8Array(await source.arrayBuffer())
    let bin = ''
    const chunk = 0x8000
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode(...buf.subarray(i, i + chunk))
    }
    return { base64: btoa(bin), fileName: pack.fileName, report: pack.report }
  }, chapterIndexes)
}

/** 极简 ZIP 核验：EOCD → 中央目录 → 条目名 + download-report.json 内容。 */
function verify(name, buf, expectedFolders) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`${name}: EOCD 未找到`)
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries = []
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error(`${name}: 中央目录签名错误`)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    entries.push(buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8'))
    offset += 46 + nameLen + extraLen + commentLen
  }
  const folders = [...new Set(entries.map((e) => e.split('/')[1]).filter((f) => f && f !== 'download-report.json'))]
  for (const folder of expectedFolders) {
    if (!folders.includes(folder)) throw new Error(`${name}: 缺少文件夹 ${folder}（实际：${folders.join(',')}）`)
  }
  if (!entries.some((e) => e.endsWith('/download-report.json'))) {
    throw new Error(`${name}: 缺少 download-report.json`)
  }
  log(`${name} 核验通过：${count} 条目，文件夹 ${folders.join(' / ')}`)
}

function waitForServer(port) {
  return new Promise((resolveWait, reject) => {
    let tries = 0
    const timer = setInterval(async () => {
      tries++
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`)
        if (res.ok) {
          clearInterval(timer)
          resolveWait()
        }
      } catch {
        /* 尚未就绪 */
      }
      if (tries > 60) {
        clearInterval(timer)
        reject(new Error('preview 服务器启动超时'))
      }
    }, 500)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
