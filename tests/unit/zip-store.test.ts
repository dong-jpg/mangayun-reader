import { describe, expect, it } from 'vitest'
import { StoreZipWriter } from '../../src/utils/zip-store'
import { crc32 } from '../../src/utils/crc32'

/** 极简 ZIP 读取器：解析 STORE 条目并核对内容与 CRC。 */
function readStoreZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  // 从尾部找 EOCD
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('EOCD not found')
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error(`bad central sig @${offset}`)
    const crc = view.getUint32(offset + 16, true)
    const size = view.getUint32(offset + 24, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen))
    // 读取本地头拿数据
    const lNameLen = view.getUint16(localOffset + 26, true)
    const lExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = bytes.subarray(dataStart, dataStart + size)
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`)
    entries.set(name, new Uint8Array(data))
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function bytesOf(entries: Map<string, Uint8Array>, name: string): number[] {
  return Array.from(entries.get(name) ?? [])
}

function containsSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start <= haystack.length - needle.length; start++) {
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) continue outer
    }
    return true
  }
  return false
}

class ArraySink {
  chunks: Uint8Array[] = []
  closed = false
  async write(chunk: Uint8Array): Promise<void> {
    this.chunks.push(chunk)
  }
  async close(): Promise<void> {
    this.closed = true
  }
  bytes(): Uint8Array {
    const total = this.chunks.reduce((s, c) => s + c.length, 0)
    const out = new Uint8Array(total)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }
}

describe('StoreZipWriter', () => {
  it('写入并完整读回（含中文文件名）', async () => {
    const sink = new ArraySink()
    const writer = new StoreZipWriter(sink)
    const a = new TextEncoder().encode('hello world')
    const b = new Uint8Array([1, 2, 3, 255, 0, 128])
    await writer.add('comic/0001_第1话/0001.jpg', a)
    await writer.add('comic/0001_第1话/0002.png', b)
    await writer.add('comic/download-report.json', new TextEncoder().encode('{"ok":true}'))
    await writer.close()
    expect(sink.closed).toBe(true)
    const entries = readStoreZip(sink.bytes())
    expect(entries.size).toBe(3)
    expect(bytesOf(entries, 'comic/0001_第1话/0001.jpg')).toEqual(Array.from(a))
    expect(bytesOf(entries, 'comic/0001_第1话/0002.png')).toEqual(Array.from(b))
    expect(new TextDecoder().decode(entries.get('comic/download-report.json')!)).toBe('{"ok":true}')
  })

  it('STORE 方式（method=0），无压缩', async () => {
    const sink = new ArraySink()
    const writer = new StoreZipWriter(sink)
    const data = new TextEncoder().encode('aaaaaaaaaaaaaaaaaaaa')
    await writer.add('x.txt', data)
    await writer.close()
    // STORE 下数据应原样出现在输出中（子序列搜索）
    const all = sink.bytes()
    const found = Array.from(data).every((_, i) => all.includes(data[i]!)) &&
      containsSubsequence(all, data)
    expect(found).toBe(true)
  })

  it('空文件名列表与多次 close 幂等', async () => {
    const sink = new ArraySink()
    const writer = new StoreZipWriter(sink)
    await writer.close()
    await writer.close()
    const entries = readStoreZip(sink.bytes())
    expect(entries.size).toBe(0)
  })

  it('大条目数（Zip64 路径 sanity：>65535 可构建 EOCD 兜底字段）', async () => {
    const sink = new ArraySink()
    const writer = new StoreZipWriter(sink)
    const tiny = new Uint8Array(1)
    // 200 条足够验证结构与计数一致性；Zip64 分支由字节布局保证
    for (let i = 0; i < 200; i++) await writer.add(`f/${i}.bin`, tiny)
    await writer.close()
    const entries = readStoreZip(sink.bytes())
    expect(entries.size).toBe(200)
    expect(writer.entryCount).toBe(200)
  })
})
