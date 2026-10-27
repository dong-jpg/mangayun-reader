/**
 * 打包（R-D5）：一个 ZIP、条目 STORE 不压缩、根目录为漫画名、
 * 含 download-report.json；按“章节序号、页序”流式写入（§4.7）。
 */
import type { Chapter, ComicRef } from '../site/types'
import { StoreZipWriter, type ZipSink } from '../utils/zip-store'
import { chapterFolderName, comicRootName, pageFileName, partialSuffix } from '../utils/naming'
import type { ImageCache } from './cache'
import { version } from '../../package.json'

export interface PackPage {
  /** 0 起页序。 */
  page: number
  ext: string | null
  bytes?: Uint8Array
}

export interface PackChapter {
  chapter: Chapter
  expectedPages: number
  pages: PackPage[]
}

export interface PackInput {
  ref: ComicRef
  title: string
  chapters: PackChapter[]
  partial: boolean
  siteVerified: boolean
}

export interface DownloadReportChapter {
  folder: string
  order: number
  rawIndex: number
  url: string
  name: string
  expectedPages: number
  savedPages: number
  missing: { page: number; reason: string; attempts: number }[]
}

export interface DownloadReport {
  tool: string
  version: string
  createdAt: string
  site: { siteId: string; verified: boolean }
  comic: { title: string; detailUrl: string }
  result: 'complete' | 'partial' | 'cancelled'
  chapters: DownloadReportChapter[]
}

export interface PackResult {
  byteLength: number
  entryCount: number
  report: DownloadReport
}

export function buildReport(input: PackInput): DownloadReport {
  const chapters: DownloadReportChapter[] = input.chapters.map((c) => {
    const missing = c.pages
      .filter((p) => p.ext == null)
      .map((p) => ({ page: p.page + 1, reason: 'fetch-failed', attempts: 3 }))
    return {
      folder: chapterFolderName(c.chapter.order, c.chapter.name),
      order: c.chapter.order,
      rawIndex: c.chapter.rawIndex,
      url: c.chapter.url,
      name: c.chapter.name,
      expectedPages: c.expectedPages,
      savedPages: c.pages.length - missing.length,
      missing,
    }
  })
  const complete = chapters.every((c) => c.missing.length === 0)
  return {
    tool: 'mangayun-reader',
    version,
    createdAt: new Date().toISOString(),
    site: { siteId: input.ref.siteId, verified: input.siteVerified },
    comic: { title: input.title, detailUrl: input.ref.detailUrl },
    result: complete ? 'complete' : 'partial',
    chapters,
  }
}

export function zipFileName(title: string, partial: boolean): string {
  const base = `${comicRootName(title)}.zip`
  return partial ? partialSuffix(base) : base
}

/**
 * 从缓存流式写入 ZIP。逐条读取缓存图片（内存中同时只有一张），
 * 报告不写入签名参数、请求头或 Cookie。
 */
export async function packToSink(
  sink: ZipSink,
  input: PackInput,
  loadBytes: (key: string) => Promise<Uint8Array | null>,
  keyOf: (chapterIndex: number, page: number) => string,
): Promise<PackResult> {
  const writer = new StoreZipWriter(sink)
  const root = comicRootName(input.title)
  try {
    for (const [ci, c] of input.chapters.entries()) {
      const folder = chapterFolderName(c.chapter.order, c.chapter.name)
      for (const page of c.pages) {
        if (page.ext == null) continue
        const bytes = page.bytes ?? (await loadBytes(keyOf(ci, page.page)))
        if (!bytes) {
          throw new Error(
            `missing cached page ${c.chapter.name} page ${page.page + 1} (${keyOf(ci, page.page)})`,
          )
        }
        await writer.add(`${root}/${folder}/${pageFileName(page.page + 1, page.ext)}`, bytes)
      }
    }
    const report = buildReport(input)
    await writer.add(
      `${root}/download-report.json`,
      new TextEncoder().encode(JSON.stringify(report, null, 2)),
    )
    await writer.close()
    return { byteLength: writer.byteLength, entryCount: writer.entryCount, report }
  } catch (error) {
    try { await sink.abort?.() } catch { /* Preserve the original packing failure. */ }
    throw error
  }
}

/** OPFS 输出文件 sink：流式写入，避免整包进内存。 */
export function opfsSink(writable: FileSystemWritableFileStream): ZipSink {
  return {
    async write(chunk) {
      await writable.write(chunk as unknown as FileSystemWriteChunkType)
    },
    async close() {
      await writable.close()
    },
    async abort() {
      await writable.abort()
    },
  }
}

/** 内存 sink：拼成 Blob（内存模式的容量保护在缓存层）。 */
export class MemorySink implements ZipSink {
  #chunks: BlobPart[] = []
  #bytes = 0

  async write(chunk: Uint8Array): Promise<void> {
    this.#chunks.push(new Uint8Array(chunk) as unknown as BlobPart)
    this.#bytes += chunk.length
  }

  async close(): Promise<void> {}

  async abort(): Promise<void> {
    this.#chunks = []
    this.#bytes = 0
  }

  get byteLength(): number {
    return this.#bytes
  }

  toBlob(): Blob {
    return new Blob(this.#chunks, { type: 'application/zip' })
  }
}

export type { ImageCache }
