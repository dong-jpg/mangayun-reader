export type IconName = 'book' | 'vertical' | 'horizontal' | 'single' | 'close' | 'check' | 'download' | 'sliders' | 'gesture'

const PATHS: Record<IconName, string> = {
  book: 'M12 5.5C9 3.8 5.5 3.5 3 4.5v14c3-1 6.5-.5 9 1 2.5-1.5 6-2 9-1v-14c-2.5-1-6-.7-9 1Zm0 0v14M6 8l3 .5M6 11l3 .5M15 8.5l3-.5M15 11.5l3-.5',
  vertical: 'M5 3h14v5H5zM5 12h14v5H5zM9 21h6',
  horizontal: 'M3 5h5v14H3zM12 5h5v14h-5zM21 9v6',
  single: 'M5 3h14v18H5zM9 7h6M9 11h6',
  close: 'm6 6 12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  sliders: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
  gesture: 'M8 12V5a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v4-1a2 2 0 0 1 4 0v5c0 4-3 6-6 6h-1c-2 0-3-1-4-2l-5-6a2 2 0 0 1 3-2l2 2',
}

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  })) svg.setAttribute(key, value)
  svg.classList.add('myr-icon')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', PATHS[name])
  svg.append(path)
  return svg
}
