/**
 * 流式 ZIP 写入器（仅 STORE，不压缩），含 Zip64 支持。
 *
 * 方案 §4.1 原选 zip.js；实际实现改为自研，理由（N-2 体积预算 + 用户脚本环境）：
 * zip.js 完整 IIFE 约 270KB，会占满 300KB 产物预算，且其 worker 模式在
 * Tampermonkey 环境需要额外配置。本项目只需要 STORE + Zip64 + 流式写入，
 * 自研约 4KB 并可被单元测试完整覆盖（tests/unit/zip-store.test.ts）。
 */
import { crc32 } from './crc32'

export interface ZipSink {
  write(chunk: Uint8Array): Promise<unknown>
  close?(): Promise<unknown>
  abort?(): Promise<unknown>
}

interface CentralRecord {
  nameBytes: Uint8Array
  crc: number
  size: number
  localOffset: number
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_LOCATOR64 = 0x07064b50
const FLAG_UTF8 = 0x0800
const U32_MAX = 0xffffffff
const U16_MAX = 0xffff
const ZIP64_VERSION = 45
const DEFAULT_VERSION = 20
const ZIP64_EXTRA_ID = 0x0001

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear())
  const date = (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff
  return { time, date }
}

export class StoreZipWriter {
  #sink: ZipSink
  #records: CentralRecord[] = []
  #offset = 0
  #closed = false
  #closePromise: Promise<void> | null = null
  #createdAt = dosDateTime(new Date())

  constructor(sink: ZipSink) {
    this.#sink = sink
  }

  async #write(chunk: Uint8Array): Promise<void> {
    await this.#sink.write(chunk)
    this.#offset += chunk.length
  }

  #writeUint64(view: DataView, offset: number, value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} is not a non-negative safe integer`)
    }
    view.setBigUint64(offset, BigInt(value), true)
  }

  async add(name: string, data: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error('zip writer already closed')
    const nameBytes = new TextEncoder().encode(name)
    if (nameBytes.length > U16_MAX) throw new Error('entry name too long')
    const localOffset = this.#offset
    const sizeZip64 = data.length >= U32_MAX
    const offsetZip64 = localOffset >= U32_MAX
    const zip64 = sizeZip64 || offsetZip64
    const crc = crc32(data)
    const localExtraLength = sizeZip64 ? 20 : 0
    const header = new Uint8Array(30 + nameBytes.length + localExtraLength)
    const view = new DataView(header.buffer)
    view.setUint32(0, SIG_LOCAL, true)
    view.setUint16(4, zip64 ? ZIP64_VERSION : DEFAULT_VERSION, true)
    view.setUint16(6, FLAG_UTF8, true)
    view.setUint16(8, 0, true) // method: STORE
    view.setUint16(10, this.#createdAt.time, true)
    view.setUint16(12, this.#createdAt.date, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, sizeZip64 ? U32_MAX : data.length, true)
    view.setUint32(22, sizeZip64 ? U32_MAX : data.length, true)
    view.setUint16(26, nameBytes.length, true)
    view.setUint16(28, localExtraLength, true)
    header.set(nameBytes, 30)
    if (sizeZip64) {
      const extra = 30 + nameBytes.length
      view.setUint16(extra, ZIP64_EXTRA_ID, true)
      view.setUint16(extra + 2, 16, true)
      this.#writeUint64(view, extra + 4, data.length, 'entry size')
      this.#writeUint64(view, extra + 12, data.length, 'entry compressed size')
    }
    await this.#write(header)
    await this.#write(data)
    this.#records.push({ nameBytes, crc, size: data.length, localOffset })
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = this.#close()
    return this.#closePromise
  }

  async #close(): Promise<void> {
    const cdStart = this.#offset
    for (const rec of this.#records) {
      const offsetNeeds64 = rec.localOffset >= U32_MAX
      const sizeNeeds64 = rec.size >= U32_MAX
      const zip64 = sizeNeeds64 || offsetNeeds64
      const extraLen = zip64 ? 4 + (sizeNeeds64 ? 16 : 0) + (offsetNeeds64 ? 8 : 0) : 0
      const buf = new Uint8Array(46 + rec.nameBytes.length + extraLen)
      const view = new DataView(buf.buffer)
      view.setUint32(0, SIG_CENTRAL, true)
      view.setUint16(4, zip64 ? ZIP64_VERSION : DEFAULT_VERSION, true)
      view.setUint16(6, zip64 ? ZIP64_VERSION : DEFAULT_VERSION, true)
      view.setUint16(8, FLAG_UTF8, true)
      view.setUint16(10, 0, true)
      view.setUint16(12, this.#createdAt.time, true)
      view.setUint16(14, this.#createdAt.date, true)
      view.setUint32(16, rec.crc, true)
      view.setUint32(20, sizeNeeds64 ? U32_MAX : rec.size, true)
      view.setUint32(24, sizeNeeds64 ? U32_MAX : rec.size, true)
      view.setUint16(28, rec.nameBytes.length, true)
      view.setUint16(30, extraLen, true)
      view.setUint16(32, 0, true)
      view.setUint16(34, 0, true)
      view.setUint16(36, 0, true)
      view.setUint32(38, 0, true)
      view.setUint32(42, offsetNeeds64 ? U32_MAX : rec.localOffset, true)
      buf.set(rec.nameBytes, 46)
      if (zip64) {
        let p = 46 + rec.nameBytes.length
        view.setUint16(p, ZIP64_EXTRA_ID, true)
        view.setUint16(p + 2, extraLen - 4, true)
        p += 4
        if (sizeNeeds64) {
          this.#writeUint64(view, p, rec.size, 'central entry size')
          this.#writeUint64(view, p + 8, rec.size, 'central entry compressed size')
          p += 16
        }
        if (offsetNeeds64) {
          this.#writeUint64(view, p, rec.localOffset, 'central local-header offset')
        }
      }
      await this.#write(buf)
    }
    const cdSize = this.#offset - cdStart
    const needZip64Eocd =
      this.#records.length >= U16_MAX || cdStart >= U32_MAX || cdSize >= U32_MAX
    if (needZip64Eocd) {
      const zip64Offset = this.#offset
      const eocd64 = new Uint8Array(56)
      const v64 = new DataView(eocd64.buffer)
      v64.setUint32(0, SIG_EOCD64, true)
      v64.setBigUint64(4, BigInt(44), true)
      v64.setUint16(12, ZIP64_VERSION, true)
      v64.setUint16(14, ZIP64_VERSION, true)
      v64.setUint32(16, 0, true)
      v64.setUint32(20, 0, true)
      v64.setBigUint64(24, BigInt(this.#records.length), true)
      v64.setBigUint64(32, BigInt(this.#records.length), true)
      v64.setBigUint64(40, BigInt(cdSize), true)
      v64.setBigUint64(48, BigInt(cdStart), true)
      await this.#write(eocd64)
      const locator = new Uint8Array(20)
      const vl = new DataView(locator.buffer)
      vl.setUint32(0, SIG_LOCATOR64, true)
      vl.setUint32(4, 0, true)
      vl.setBigUint64(8, BigInt(zip64Offset), true)
      vl.setUint32(16, 1, true)
      await this.#write(locator)
    }
    const eocd = new Uint8Array(22)
    const ve = new DataView(eocd.buffer)
    ve.setUint32(0, SIG_EOCD, true)
    ve.setUint16(4, 0, true)
    ve.setUint16(6, 0, true)
    ve.setUint16(8, needZip64Eocd ? U16_MAX : this.#records.length, true)
    ve.setUint16(10, needZip64Eocd ? U16_MAX : this.#records.length, true)
    ve.setUint32(12, needZip64Eocd ? U32_MAX : cdSize, true)
    ve.setUint32(16, needZip64Eocd ? U32_MAX : cdStart, true)
    ve.setUint16(20, 0, true)
    await this.#write(eocd)
    await this.#sink.close?.()
  }

  get byteLength(): number {
    return this.#offset
  }

  get entryCount(): number {
    return this.#records.length
  }
}
