import { describe, expect, it } from 'vitest'
import { crc32 } from '../../src/utils/crc32'
import { sniffImageType } from '../../src/utils/mime-sniff'
import { chapterFolderName, padNumber, pageFileName, partialSuffix, sanitizeName } from '../../src/utils/naming'
import { fnv1aHex } from '../../src/utils/fnv'
import { decodeBase64UrlText, encodeBase64UrlText } from '../../src/utils/base64url'

describe('crc32（R-D 缓存校验）', () => {
  it('标准测试向量 "123456789" → 0xCBF43926', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('空输入', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('mime-sniff（R-D4 文件头判断）', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  const avif = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])

  it.each([
    ['jpg', jpg],
    ['png', png],
    ['gif', gif],
    ['webp', webp],
    ['avif', avif],
  ])('%s', (ext, bytes) => {
    expect(sniffImageType(bytes as Uint8Array)?.ext).toBe(ext)
  })

  it('伪装成图片的 HTML → null', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><head></head><body>403</body>')
    expect(sniffImageType(html)).toBeNull()
  })

  it('空文件与过短输入 → null', () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull()
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})

describe('naming（R-D3、R-D4）', () => {
  it('补零到至少 4 位', () => {
    expect(padNumber(1)).toBe('0001')
    expect(padNumber(0)).toBe('0000')
    expect(padNumber(999)).toBe('0999')
    expect(padNumber(1000)).toBe('1000')
  })
  it('超过 4 位自动加位不截断', () => {
    expect(padNumber(12345)).toBe('12345')
    expect(padNumber(123456)).toBe('123456')
  })
  it('非法字符过滤', () => {
    expect(sanitizeName('第1话/下')).toBe('第1话 下')
    expect(sanitizeName('a\\b:c*d?e"f<g>h|i')).not.toMatch(/[\\/:*?"<>|]/)
    expect(sanitizeName('..')).toBe('')
    expect(sanitizeName('.')).toBe('')
    expect(sanitizeName('\u0001\u007f控制')).toBe('控制')
  })
  it('Windows 保留名被拒', () => {
    for (const name of ['CON', 'NUL', 'com1', 'LPT9', 'conin$']) {
      expect(sanitizeName(name)).toBe('')
    }
  })
  it('话名截断到 80 字符并去尾部空白', () => {
    const long = 'a'.repeat(120)
    expect(sanitizeName(long)).toHaveLength(80)
    expect(sanitizeName(`${'b'.repeat(79)}. `)).toBe('b'.repeat(79))
  })
  it('章节文件夹与页文件名', () => {
    expect(chapterFolderName(2, '第2话')).toBe('0002_第2话')
    expect(chapterFolderName(0, '')).toBe('0000_unnamed')
    expect(pageFileName(0, 'jpg')).toBe('0000.jpg')
    expect(pageFileName(12345, 'webp')).toBe('12345.webp')
  })
  it('部分导出后缀（R-D9）', () => {
    expect(partialSuffix('comic.zip')).toBe('comic.zip_partial')
  })
})

describe('fnv1a', () => {
  it('稳定且区分输入', () => {
    expect(fnv1aHex('a\nb')).toBe(fnv1aHex('a\nb'))
    expect(fnv1aHex('a\nb')).not.toBe(fnv1aHex('a\nc'))
    expect(fnv1aHex('')).toBe('811c9dc5')
  })
})

describe('base64url', () => {
  it('UTF-8 往返', () => {
    for (const text of ['', 'hello', '漫画第1话', '𝄞🎵', '?query=a&b=/+']) {
      expect(decodeBase64UrlText(encodeBase64UrlText(text))).toBe(text)
    }
  })
  it('无填充、URL 安全字母表', () => {
    const bytes = new Uint8Array([251, 252, 253, 190, 191]) // 含 +/ 字节的编码
    const encoded = encodeBase64UrlText(new TextDecoder().decode(bytes))
    expect(encoded).not.toMatch(/[+/=]/)
  })
})
