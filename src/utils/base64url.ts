/**
 * base64url 编解码（无填充，UTF-8 安全）。
 * 与原站前端一致：TextEncoder 字节流 → URL 安全字母表。
 * 不依赖 btoa/atob，浏览器与 Node 测试环境行为一致。
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const REV = new Map<string, number>()
for (let i = 0; i < ALPHABET.length; i++) REV.set(ALPHABET[i]!, i)

export function encodeBase64Url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : null
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : null
    out += ALPHABET[b0 >> 2]!
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!
    if (b1 !== null) out += ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!
    if (b2 !== null) out += ALPHABET[b2 & 0x3f]!
  }
  return out
}

export function encodeBase64UrlText(text: string): string {
  return encodeBase64Url(new TextEncoder().encode(text))
}

export function decodeBase64Url(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9_-]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    const v = REV.get(ch)
    if (v === undefined) continue
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (buffer >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}

export function decodeBase64UrlText(text: string): string {
  return new TextDecoder().decode(decodeBase64Url(text))
}
