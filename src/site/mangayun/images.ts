/**
 * 最终图片地址与来源支持等级（§3.2 约束 3、§3.4）。
 * 规则移植自原站前端：命中代理域名/来源的图片经同源 /api/image 代理，其余直连。
 * 增强阅读器使用与原站一致的地址以命中浏览器缓存。
 */
import type { SourceSupport } from '../types'

export const PROXY_PATH = '/api/image'
const PROXY_HOSTS = ['hamreus.com', 'cdndm5.com', 'ccavbox.com', 'bgm.tv', 'tuku.cc']
const PROXY_SOURCES = new Set(['manhuagui', 'comicbox', 'manben', 'dm5', 'tuku'])

/** 打乱（canvas 重排）来源判定：这些图片的原始字节不能直接使用（§3.4）。 */
export function isScrambledImage(siteId: string | undefined, url: string): boolean {
  if (siteId === 'comicbox') return true
  try {
    const u = decodeURIComponent(url)
    return u.includes('ccavbox.com') || u.includes('/break_2/') || u.includes('comicbox.xyz')
  } catch {
    return false
  }
}

export function supportOf(siteId: string): SourceSupport {
  // comicbox：增强阅读回退原站、不支持下载（§7 D3）
  if (siteId === 'comicbox') return 'unsupported'
  return 'full'
}

/** 已实测核对的来源；下载报告中未列出的标记“未验证来源”（§3.4）。 */
export const VERIFIED_SOURCES = new Set([
  'dm5', 'mangabz', 'manben', 'manhuagui', 'manhuazhijia',
  'tuku', 'rumanhua', 'manhuazhan',
])

function toUrl(url: string, base: string): URL | null {
  try {
    return new URL(url, base)
  } catch {
    return null
  }
}

function isProxyPath(u: URL): boolean {
  return u.pathname === PROXY_PATH && !!u.searchParams.get('url')
}

function isProxyHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return PROXY_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))
}

function buildProxyUrl(absoluteUrl: string, siteId: string | undefined, base: string): string {
  const params = new URLSearchParams()
  params.set('url', absoluteUrl)
  if (siteId) params.set('siteId', siteId)
  return new URL(`${PROXY_PATH}?${params.toString()}`, base).toString()
}

/**
 * 与原站一致的最终地址：已是代理的直接沿用；命中代理规则的包一层 /api/image；
 * 其余返回绝对化的直连地址。
 */
export function finalizeImageUrl(
  siteId: string | undefined,
  url: string,
  base = 'https://mangayun.com',
): string {
  if (!url) return ''
  const asUrl = toUrl(url, base)
  if (asUrl && isProxyPath(asUrl)) return url
  // 解包已有的代理包装（保留其 url/siteId 参数）
  let rawUrl = url
  let unwrappedSiteId: string | undefined
  if (asUrl && asUrl.pathname === PROXY_PATH) {
    const inner = asUrl.searchParams.get('url')
    unwrappedSiteId = asUrl.searchParams.get('siteId') ?? undefined
    if (inner) rawUrl = inner
  }
  const abs = toUrl(rawUrl, base)
  if (!abs) return url
  if (abs.pathname === PROXY_PATH) return url
  if (
    isProxyHost(abs.hostname) ||
    (siteId != null && PROXY_SOURCES.has(siteId)) ||
    rawUrl !== url
  ) {
    return buildProxyUrl(abs.toString(), siteId || unwrappedSiteId, base)
  }
  return abs.toString()
}

/** 图片请求是否经同源代理（决定下载走同源 fetch 还是跨域回退）。 */
export function isProxiedUrl(url: string, base = 'https://mangayun.com'): boolean {
  const u = toUrl(url, base)
  return !!u && isProxyPath(u)
}
