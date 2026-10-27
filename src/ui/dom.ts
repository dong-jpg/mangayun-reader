export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | number | boolean | ((e: Event) => void)>,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener)
    } else if (typeof value === 'boolean') {
      if (value) el.setAttribute(key, '')
    } else {
      el.setAttribute(key, String(value))
    }
  }
  for (const child of children) {
    if (child != null) el.append(child instanceof Node ? child : document.createTextNode(child))
  }
  return el
}
