/**
 * 生成交付样本 ZIP（方案 §6.1 交付物 4）：
 * - samples/sample-single-chapter.zip：单话（第3话，6 页条漫）
 * - samples/sample-multi-skip.zip：跳选第 1、3 话（跳过第 2 话 → 文件夹保持 0001/0003 全局序号，R-D3）
 * 由 harness 页 + mock 适配器驱动真实下载流水线产生，并解包核验报告与条目。
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { verifySamples } from './verify-samples.mjs'

const PORT = 4180
const ROOT = resolve(import.meta.dirname, '..')

function log(...args) {
  console.log('[samples]', ...args)
}

async function main() {
  log('构建 harness…')
  const vite = resolve(ROOT, 'node_modules/vite/bin/vite.js')
  execFileSync(process.execPath, [vite, 'build', '--config', 'harness/vite.config.ts'], { cwd: ROOT, stdio: 'pipe', windowsHide: true })

  const server = spawn(
    process.execPath,
    [vite, 'preview', '--config', 'harness/vite.config.ts', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'pipe', windowsHide: true },
  )
  let browser
  try {
    await waitForServer(PORT, server)
    browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
    const page = await ctx.newPage()

    const single = await downloadAsBase64(page, [2]) // 第3话
    const multi = await downloadAsBase64(page, [0, 2]) // 第1话 + 第3话（跳过第2话）

    const singleBuf = Buffer.from(single.base64, 'base64')
    const multiBuf = Buffer.from(multi.base64, 'base64')
    verifySamples(['--stdin', 'sample-single-chapter.zip'], singleBuf)
    verifySamples(['--stdin', 'sample-multi-skip.zip'], multiBuf)
    mkdirSync(resolve(ROOT, 'samples'), { recursive: true })
    writeFileSync(resolve(ROOT, 'samples', 'sample-single-chapter.zip'), singleBuf)
    writeFileSync(resolve(ROOT, 'samples', 'sample-multi-skip.zip'), multiBuf)

    log('完成：samples/ 下两个样本 ZIP 已生成并核验')
  } finally {
    await browser?.close()
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

async function waitForServer(port, server) {
  let output = ''
  let errors = ''
  const readOutput = (chunk) => { output += chunk.toString() }
  const readError = (chunk) => { errors += chunk.toString() }
  server.stdout.on('data', readOutput)
  server.stderr.on('data', readError)
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null || server.signalCode !== null) {
        throw new Error(`Preview server exited before startup: ${errors}`)
      }
      if (output.includes(`http://127.0.0.1:${port}/`)) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
          if (response.ok) return
        } catch { /* Wait until the announced server accepts requests. */ }
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
    throw new Error(`Preview server startup timed out: ${errors}`)
  } finally {
    server.stdout.off('data', readOutput)
    server.stderr.off('data', readError)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
