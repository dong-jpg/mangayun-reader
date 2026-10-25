/** FNV-1a 32 位哈希，十六进制输出。漫画存储键 `myr:v1:comic:{hash}` 用。 */
export function fnv1aHex(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
