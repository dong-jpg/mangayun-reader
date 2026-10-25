/**
 * 图片缓存（R-D11，基线规格 §8.2）：OPFS 流式 → IndexedDB → 内存（上限 100 MiB）。
 * 只操作 `myr-v1` 命名空间（N-3 / §8.2：不得清空整个站点的存储）。
 * 完成标记晚于缓存持久化，记录字节数与 CRC32；恢复时核对（R-D13）。
 */
import { crc32 } from '../utils/crc32'

export interface CachedImage {
  bytes: Uint8Array
  length: number
  crc: number
}

export class MemoryCapError extends Error {
  constructor(public capBytes: number) {
    super(`内存模式达到 ${Math.round(capBytes / 1024 / 1024)} MiB 上限`)
    this.name = 'MemoryCapError'
  }
}

export class CacheUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CacheUnavailableError'
  }
}

export const MEMORY_MODE_CAP_MIB = 100
export const CACHE_NAMESPACE = 'myr-v1'

export interface ImageCache {
  readonly kind: 'opfs' | 'idb' | 'memory'
  readonly capBytes: number | null
  init(): Promise<void>
  get(key: string): Promise<CachedImage | null>
  put(key: string, bytes: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clearTask(prefix: string): Promise<void>
  usedBytes(): number
}

// ---------- 内存模式 ----------

export class MemoryCache implements ImageCache {
  readonly kind = 'memory' as const
  readonly capBytes = MEMORY_MODE_CAP_MIB * 1024 * 1024
  #map = new Map<string, CachedImage>()
  #bytes = 0

  async init(): Promise<void> {}

  async get(key: string): Promise<CachedImage | null> {
    return this.#map.get(key) ?? null
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const existing = this.#map.get(key)
    const incoming = existing ? bytes.length - existing.length : bytes.length
    if (this.#bytes + incoming > this.capBytes) throw new MemoryCapError(this.capBytes)
    this.#map.set(key, { bytes, length: bytes.length, crc: crc32(bytes) })
    this.#bytes += incoming
  }

  async remove(key: string): Promise<void> {
    const existing = this.#map.get(key)
    if (existing) {
      this.#bytes -= existing.length
      this.#map.delete(key)
    }
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.#map.keys()]
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all
  }

  async clearTask(prefix: string): Promise<void> {
    for (const key of await this.keys(prefix)) await this.remove(key)
  }

  usedBytes(): number {
    return this.#bytes
  }
}

// ---------- IndexedDB 模式 ----------

interface IdbRecord {
  blob: Blob
  length: number
  crc: number
}

export class IdbCache implements ImageCache {
  readonly kind = 'idb' as const
  readonly capBytes = null
  #db: IDBDatabase | null = null
  #bytes = 0

  async init(): Promise<void> {
    this.#db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(`${CACHE_NAMESPACE}-images`, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new CacheUnavailableError('IndexedDB 打开失败'))
    })
    for (const rec of await this.#all<IdbRecord>()) this.#bytes += rec.length
  }

  #tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = this.#db
    if (!db) throw new CacheUnavailableError('IndexedDB 未初始化')
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode)
      const req = fn(tx.objectStore('images'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
    })
  }

  async #all<T>(): Promise<T[]> {
    const records = await this.#tx<T[]>('readonly', (s) => s.getAll() as IDBRequest<T[]>)
    return records ?? []
  }

  async get(key: string): Promise<CachedImage | null> {
    const rec = await this.#tx<IdbRecord | undefined>('readonly', (s) => s.get(key))
    if (!rec) return null
    const bytes = new Uint8Array(await rec.blob.arrayBuffer())
    // 恢复时核对长度与校验和（R-D13）
    if (bytes.length !== rec.length || crc32(bytes) !== rec.crc) return null
    return { bytes, length: rec.length, crc: rec.crc }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const rec: IdbRecord = { blob: new Blob([bytes as unknown as BlobPart]), length: bytes.length, crc: crc32(bytes) }
    const existing = await this.#tx<IdbRecord | undefined>('readonly', (s) => s.get(key))
    if (existing) this.#bytes -= existing.length
    this.#bytes += bytes.length
    await this.#tx('readwrite', (s) => s.put(rec, key))
  }

  async remove(key: string): Promise<void> {
    const existing = await this.#tx<IdbRecord | undefined>('readonly', (s) => s.get(key))
    if (existing) this.#bytes -= existing.length
    await this.#tx('readwrite', (s) => s.delete(key))
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = await this.#tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    const keys = (all ?? []).filter((k): k is string => typeof k === 'string')
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys
  }

  async clearTask(prefix: string): Promise<void> {
    for (const key of await this.keys(prefix)) await this.remove(key)
  }

  usedBytes(): number {
    return this.#bytes
  }
}

// ---------- OPFS 模式 ----------

interface OpfsManifest {
  entries: Record<string, { file: string; length: number; crc: number }>
}

export class OpfsCache implements ImageCache {
  readonly kind = 'opfs' as const
  readonly capBytes = null
  #dir: FileSystemDirectoryHandle | null = null
  #manifest: OpfsManifest = { entries: {} }

  async init(): Promise<void> {
    const root = await navigator.storage.getDirectory()
    const ns = await root.getDirectoryHandle(CACHE_NAMESPACE, { create: true })
    this.#dir = await ns.getDirectoryHandle('images', { create: true })
    try {
      const handle = await this.#dir.getFileHandle('manifest.json')
      const text = await (await handle.getFile()).text()
      this.#manifest = JSON.parse(text) as OpfsManifest
      if (!this.#manifest.entries) this.#manifest = { entries: {} }
    } catch {
      this.#manifest = { entries: {} }
    }
  }

  fileName(key: string): string {
    // key 形如 task/chapter/page；文件名做安全编码
    return encodeURIComponent(key).replace(/[.*+?%]/g, (c) => '%' + c.charCodeAt(0).toString(16))
  }

  async #saveManifest(): Promise<void> {
    if (!this.#dir) throw new CacheUnavailableError('OPFS 未初始化')
    const handle = await this.#dir.getFileHandle('manifest.json', { create: true })
    const writable = await handle.createWritable()
    await writable.write(new Blob([JSON.stringify(this.#manifest)]))
    await writable.close()
  }

  async get(key: string): Promise<CachedImage | null> {
    const entry = this.#manifest.entries[key]
    if (!entry || !this.#dir) return null
    try {
      const handle = await this.#dir.getFileHandle(entry.file)
      const file = await handle.getFile()
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.length !== entry.length || crc32(bytes) !== entry.crc) return null
      return { bytes, length: entry.length, crc: entry.crc }
    } catch {
      return null
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    if (!this.#dir) throw new CacheUnavailableError('OPFS 未初始化')
    const file = this.fileName(key)
    const handle = await this.#dir.getFileHandle(file, { create: true })
    const writable = await handle.createWritable()
    await writable.write(bytes as unknown as FileSystemWriteChunkType)
    await writable.close()
    const crc = crc32(bytes)
    this.#manifest.entries[key] = { file, length: bytes.length, crc }
    await this.#saveManifest()
  }

  async remove(key: string): Promise<void> {
    const entry = this.#manifest.entries[key]
    if (!entry || !this.#dir) return
    try {
      await this.#dir.removeEntry(entry.file)
    } catch {
      /* 文件已不存在 */
    }
    delete this.#manifest.entries[key]
    await this.#saveManifest()
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = Object.keys(this.#manifest.entries)
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all
  }

  async clearTask(prefix: string): Promise<void> {
    for (const key of await this.keys(prefix)) await this.remove(key)
  }

  usedBytes(): number {
    return Object.values(this.#manifest.entries).reduce((s, e) => s + e.length, 0)
  }
}

/** OPFS → IndexedDB → 内存 逐级回退。 */
export async function openBestCache(): Promise<ImageCache> {
  const opfs = new OpfsCache()
  try {
    await opfs.init()
    return opfs
  } catch {
    /* 回退 */
  }
  const idb = new IdbCache()
  try {
    await idb.init()
    return idb
  } catch {
    /* 回退 */
  }
  const memory = new MemoryCache()
  await memory.init()
  return memory
}
