/**
 * 按文件头识别图片真实编码（R-D4：扩展名由文件头判断，无法识别记为失败）。
 * 只认可 JPEG / PNG / WebP / GIF / AVIF。
 */
export interface SniffResult {
  ext: string
  mime: string
}

export function sniffImageType(bytes: Uint8Array): SniffResult | null {
  if (bytes.length < 12) return null
  const b = bytes
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return { ext: 'png', mime: 'image/png' }
  // GIF: GIF87a / GIF89a
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { ext: 'gif', mime: 'image/gif' }
  // WebP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return { ext: 'webp', mime: 'image/webp' }
  // AVIF/AVIS: ftyp box，major brand 在偏移 8
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!)
    if (brand === 'avif' || brand === 'avis') return { ext: 'avif', mime: 'image/avif' }
  }
  return null
}
