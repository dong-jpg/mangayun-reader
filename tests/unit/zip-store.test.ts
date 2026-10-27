import { describe, expect, it } from 'vitest'
import { StoreZipWriter } from '../../src/utils/zip-store'
import { readStoredZip } from './archive-test-helpers'

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
    const output = sink.bytes()
    const archive = readStoredZip(output)
    const entries = new Map(archive.entries.map((entry) => [entry.name, entry]))
    expect(entries.size).toBe(3)
    expect(Array.from(entries.get('comic/0001_第1话/0001.jpg')!.data)).toEqual(Array.from(a))
    expect(Array.from(entries.get('comic/0001_第1话/0002.png')!.data)).toEqual(Array.from(b))
    expect(new TextDecoder().decode(entries.get('comic/download-report.json')!.data)).toBe('{"ok":true}')
    expect(archive.centralDirectorySize).toBeGreaterThan(0)
    expect(archive.centralDirectoryOffset + archive.centralDirectorySize).toBe(archive.eocdOffset)
    expect(archive.eocdEntryCount).toBe(3)
    expect(writer.byteLength).toBe(output.length)
    expect(writer.entryCount).toBe(3)
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
    const archive = readStoredZip(all)
    expect(archive.entries).toHaveLength(1)
    expect(archive.entries[0]!.method).toBe(0)
    expect(Array.from(archive.entries[0]!.data)).toEqual(Array.from(data))
  })

  it('空文件名列表与多次 close 幂等', async () => {
    const sink = new ArraySink()
    const writer = new StoreZipWriter(sink)
    await writer.close()
    await writer.close()
    const output = sink.bytes()
    const archive = readStoredZip(output)
    expect(archive.entries).toHaveLength(0)
    expect(archive.centralDirectorySize).toBe(0)
    expect(writer.byteLength).toBe(output.length)
  })

  it.each([65_535, 65_536])('%i entries use readable Zip64 counts and locator offsets', async (count) => {
    const sink = new ArraySink()
    const writer = new StoreZipWriter(sink)
    const empty = new Uint8Array(0)
    for (let i = 0; i < count; i++) await writer.add(`f/${i}.bin`, empty)
    await writer.close()
    const output = sink.bytes()
    const archive = readStoredZip(output)
    expect(archive.entries).toHaveLength(count)
    expect(archive.entries[0]!.name).toBe('f/0.bin')
    expect(archive.entries.at(-1)!.name).toBe(`f/${count - 1}.bin`)
    expect(archive.zip64).toBe(true)
    expect(archive.zip64EntryCount).toBe(count)
    expect(archive.eocdEntryCount).toBe(0xffff)
    expect(archive.zip64EocdOffset).not.toBeNull()
    expect(writer.entryCount).toBe(count)
    expect(writer.byteLength).toBe(output.length)
  }, 30_000)
})
