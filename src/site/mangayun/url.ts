/**
 * /read/{A}/{B} URL 编解码（docs/specs/site-probe-2026-10-24.md）。
 * A = base64url(JSON ["siteId","detailUrl"])，B = base64url(来源章节 URL)。
 */
import {
  decodeBase64UrlText,
  encodeBase64UrlText,
} from '../../utils/base64url'
import type { ComicRef } from '../types'

export function encodeComicParam(siteId: string, detailUrl: string): string {
  return encodeBase64UrlText(JSON.stringify([siteId, detailUrl]))
}

export function decodeComicParam(param: string): ComicRef | null {
  try {
    const json = decodeBase64UrlText(param)
    const parsed = JSON.parse(json) as unknown
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { siteId: parsed[0], detailUrl: parsed[1] }
    }
    return null
  } catch {
    return null
  }
}

export function decodeChapterParam(param: string): string | null {
  try {
    const text = decodeBase64UrlText(param)
    return text || null
  } catch {
    return null
  }
}

const READ_PATH_RE = /^\/read\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/

export function parseReadPath(pathname: string): { comic: ComicRef; chapterUrl: string } | null {
  const m = READ_PATH_RE.exec(pathname)
  if (!m) return null
  const comic = decodeComicParam(m[1]!)
  const chapterUrl = decodeChapterParam(m[2]!)
  if (!comic || !chapterUrl) return null
  return { comic, chapterUrl }
}

/** 查询串形式：?site=&manga=&chapter=。 */
export function parseReadSearch(search: string): { comic: ComicRef; chapterUrl: string } | null {
  const params = new URLSearchParams(search)
  const siteId = params.get('site')
  const detailUrl = params.get('manga')
  const chapterUrl = params.get('chapter')
  if (!siteId || !detailUrl || !chapterUrl) return null
  return { comic: { siteId, detailUrl }, chapterUrl }
}

export function buildReadPath(comic: ComicRef, chapterUrl: string): string {
  const a = encodeComicParam(comic.siteId, comic.detailUrl)
  const b = encodeBase64UrlText(chapterUrl)
  return `/read/${a}/${b}`
}

export function buildMangaPath(comic: ComicRef): string {
  return `/m/${encodeComicParam(comic.siteId, comic.detailUrl)}`
}
