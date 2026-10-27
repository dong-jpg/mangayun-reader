import { crc32 } from '../../src/utils/crc32'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_LOCATOR64 = 0x07064b50
const U16_MAX = 0xffff
const U32_MAX = 0xffffffff

export interface ParsedZipEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
  data: Uint8Array
}

export interface ParsedZip {
  entries: ParsedZipEntry[]
  eocdOffset: number
  eocdEntryCount: number
  centralDirectoryOffset: number
  centralDirectorySize: number
  zip64: boolean
  zip64EocdOffset: number | null
  zip64EntryCount: number | null
}

function u64(view: DataView, offset: number, label: string): number {
  const value = view.getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds Number.MAX_SAFE_INTEGER`)
  }
  return Number(value)
}

function findEocd(view: DataView, length: number): number {
  for (let i = length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== SIG_EOCD) continue
    const commentLength = view.getUint16(i + 20, true)
    if (i + 22 + commentLength === length) return i
  }
  throw new Error('EOCD not found')
}

function readCentralExtra(
  view: DataView,
  start: number,
  length: number,
  needsUncompressed: boolean,
  needsCompressed: boolean,
  needsOffset: boolean,
): { uncompressed?: number; compressed?: number; localOffset?: number } {
  const end = start + length
  let offset = start
  while (offset + 4 <= end) {
    const id = view.getUint16(offset, true)
    const size = view.getUint16(offset + 2, true)
    const dataStart = offset + 4
    const dataEnd = dataStart + size
    if (dataEnd > end) throw new Error('central extra field exceeds its declared length')
    if (id === 0x0001) {
      let p = dataStart
      const result: { uncompressed?: number; compressed?: number; localOffset?: number } = {}
      if (needsUncompressed) {
        if (p + 8 > dataEnd) throw new Error('Zip64 extra is missing uncompressed size')
        result.uncompressed = u64(view, p, 'Zip64 uncompressed size')
        p += 8
      }
      if (needsCompressed) {
        if (p + 8 > dataEnd) throw new Error('Zip64 extra is missing compressed size')
        result.compressed = u64(view, p, 'Zip64 compressed size')
        p += 8
      }
      if (needsOffset) {
        if (p + 8 > dataEnd) throw new Error('Zip64 extra is missing local offset')
        result.localOffset = u64(view, p, 'Zip64 local offset')
      }
      return result
    }
    offset = dataEnd
  }
  return {}
}

/** Independent-enough STORE ZIP reader used by the unit tests. */
export function readStoredZip(bytes: Uint8Array): ParsedZip {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const eocdOffset = findEocd(view, bytes.length)
  const eocdEntryCount = view.getUint16(eocdOffset + 10, true)
  const eocdCdSize = view.getUint32(eocdOffset + 12, true)
  const eocdCdOffset = view.getUint32(eocdOffset + 16, true)
  const locatorOffset = eocdOffset - 20
  const hasLocator =
    locatorOffset >= 0 && view.getUint32(locatorOffset, true) === SIG_LOCATOR64

  let zip64 = false
  let zip64EocdOffset: number | null = null
  let zip64EntryCount: number | null = null
  let centralDirectoryOffset = eocdCdOffset
  let centralDirectorySize = eocdCdSize
  let entryCount = eocdEntryCount

  if (hasLocator) {
    zip64 = true
    if (view.getUint32(locatorOffset + 4, true) !== 0) {
      throw new Error('Zip64 locator points at a non-zero disk')
    }
    zip64EocdOffset = u64(view, locatorOffset + 8, 'Zip64 EOCD offset')
    if (view.getUint32(locatorOffset + 16, true) !== 1) {
      throw new Error('Zip64 locator does not declare one disk')
    }
    if (zip64EocdOffset + 56 !== locatorOffset) {
      throw new Error('Zip64 EOCD is not immediately before its locator')
    }
    if (view.getUint32(zip64EocdOffset, true) !== SIG_EOCD64) {
      throw new Error('Zip64 EOCD signature mismatch')
    }
    if (u64(view, zip64EocdOffset + 4, 'Zip64 EOCD record size') !== 44) {
      throw new Error('Zip64 EOCD record size is not 44')
    }
    if (view.getUint32(zip64EocdOffset + 16, true) !== 0 ||
        view.getUint32(zip64EocdOffset + 20, true) !== 0) {
      throw new Error('Zip64 EOCD declares a multi-disk archive')
    }
    const diskCount = u64(view, zip64EocdOffset + 24, 'Zip64 entries on disk')
    const totalCount = u64(view, zip64EocdOffset + 32, 'Zip64 total entries')
    if (diskCount !== totalCount) throw new Error('Zip64 entry counts differ')
    zip64EntryCount = totalCount
    entryCount = totalCount
    centralDirectorySize = u64(view, zip64EocdOffset + 40, 'Zip64 central directory size')
    centralDirectoryOffset = u64(view, zip64EocdOffset + 48, 'Zip64 central directory offset')
  } else if (
    eocdEntryCount === U16_MAX ||
    eocdCdSize === U32_MAX ||
    eocdCdOffset === U32_MAX
  ) {
    throw new Error('EOCD uses Zip64 sentinels but has no Zip64 locator')
  }

  const centralEnd = centralDirectoryOffset + centralDirectorySize
  const expectedCentralEnd = zip64EocdOffset ?? eocdOffset
  if (centralEnd !== expectedCentralEnd) {
    throw new Error(
      `central directory extent mismatch: ${centralDirectoryOffset}+${centralDirectorySize} != ${expectedCentralEnd}`,
    )
  }

  const entries: ParsedZipEntry[] = []
  let offset = centralDirectoryOffset
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > centralEnd) throw new Error('central directory record is truncated')
    if (view.getUint32(offset, true) !== SIG_CENTRAL) {
      throw new Error(`bad central signature at ${offset}`)
    }
    const method = view.getUint16(offset + 10, true)
    const crc = view.getUint32(offset + 16, true)
    const compressed32 = view.getUint32(offset + 20, true)
    const uncompressed32 = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset32 = view.getUint32(offset + 42, true)
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength
    if (recordEnd > centralEnd) throw new Error('central directory record exceeds its extent')

    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    const extra = readCentralExtra(
      view,
      offset + 46 + nameLength,
      extraLength,
      uncompressed32 === U32_MAX,
      compressed32 === U32_MAX,
      localOffset32 === U32_MAX,
    )
    const compressedSize = compressed32 === U32_MAX ? extra.compressed : compressed32
    const uncompressedSize = uncompressed32 === U32_MAX ? extra.uncompressed : uncompressed32
    const localOffset = localOffset32 === U32_MAX ? extra.localOffset : localOffset32
    if (compressedSize == null || uncompressedSize == null || localOffset == null) {
      throw new Error(`missing Zip64 value for ${name}`)
    }
    if (compressedSize !== uncompressedSize) {
      throw new Error(`STORE entry has different compressed/uncompressed sizes: ${name}`)
    }

    if (localOffset + 30 > bytes.length) throw new Error(`local header out of range: ${name}`)
    if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`bad local signature for ${name}`)
    }
    const localMethod = view.getUint16(localOffset + 8, true)
    const localCrc = view.getUint32(localOffset + 14, true)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const localName = decoder.decode(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
    )
    if (localName !== name) throw new Error(`local/central name mismatch: ${name}`)
    if (localMethod !== method) throw new Error(`local/central method mismatch: ${name}`)
    if (localCrc !== crc) throw new Error(`local/central CRC mismatch: ${name}`)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) throw new Error(`entry data out of range: ${name}`)
    const data = bytes.subarray(dataStart, dataEnd)
    if (crc32(data) !== crc) throw new Error(`CRC mismatch: ${name}`)

    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      data,
    })
    offset = recordEnd
  }
  if (offset !== centralEnd) throw new Error('central directory was not consumed exactly')

  return {
    entries,
    eocdOffset,
    eocdEntryCount,
    centralDirectoryOffset,
    centralDirectorySize,
    zip64,
    zip64EocdOffset,
    zip64EntryCount,
  }
}
