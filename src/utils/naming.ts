/**
 * 下载命名（基线规格 §7 / R-D3、R-D4）：
 * - 章节文件夹 `{正序序号}_{话名}`，页 `{页序}.{真实扩展名}`，编号至少 4 位、超出自动加位
 * - 过滤路径分隔符、控制字符、`.`、`..` 和 Windows 保留名；话名截断 80 字符
 */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'CONIN$', 'CONOUT$',
])

export function padNumber(n: number, minDigits = 4): string {
  if (!Number.isFinite(n) || n < 0) n = 0
  const s = String(Math.floor(n))
  return s.length >= minDigits ? s : s.padStart(minDigits, '0')
}

/** 过滤非法字符与保留名；返回空串表示无效。 */
export function sanitizeName(name: string, maxLength = 80): string {
  let s = name
    // 控制字符与路径分隔符（控制字符过滤为有意行为）
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, ' ')
    .replace(/[<>:"|?*]/g, ' ')
    // 去掉首尾与成组的点，防止 "." / ".." 与隐藏名
    .replace(/\.{2,}/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/[.\s]+$/, '').trim()
  if (!s) return ''
  const upper = s.toUpperCase()
  if (WINDOWS_RESERVED.has(upper)) return ''
  return s
}

export function chapterFolderName(order: number, chapterName: string): string {
  const safe = sanitizeName(chapterName) || 'unnamed'
  return `${padNumber(order)}_${safe}`
}

export function pageFileName(pageIndex: number, ext: string): string {
  return `${padNumber(pageIndex)}.${ext}`
}

export function comicRootName(title: string): string {
  return sanitizeName(title, 120) || 'comic'
}

export function partialSuffix(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)}_partial${name.slice(dot)}` : `${name}_partial`
}
