import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const script = fileURLToPath(new URL('./verify-samples.py', import.meta.url))

export function verifySamples(args = [], bytes) {
  const result = spawnSync(python, [script, ...args], { input: bytes, encoding: 'utf8', windowsHide: true })
  if (result.error) throw new Error(`Python 3 is required for independent ZIP verification: ${result.error.message}`)
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'ZIP verification failed')
  process.stdout.write(result.stdout)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { verifySamples(process.argv.slice(2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
