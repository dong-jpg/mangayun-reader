import { beforeEach, describe, expect, it } from 'vitest'
import { scrapeReaderImages } from '../../src/site/mangayun/batch-resolver'

beforeEach(() => {
  document.body.textContent = ''
})

function mkImg(src: string, className = '', wrapClass = ''): HTMLImageElement {
  const img = document.createElement('img')
  img.setAttribute('referrerpolicy', 'no-referrer')
  if (src) img.setAttribute('src', src)
  img.className = className
  if (wrapClass) {
    const wrap = document.createElement('div')
    wrap.className = wrapClass
    wrap.appendChild(img)
    document.body.appendChild(wrap)
  } else {
    document.body.appendChild(img)
  }
  return img
}

describe('scrapeReaderImages（DOM 抓取兜底）', () => {
  it('按文档序返回阅读器图片，去重', () => {
    mkImg('/mock/img/a.png')
    mkImg('/mock/img/b.png')
    mkImg('/mock/img/a.png') // 重复
    expect(scrapeReaderImages(document)).toEqual(['/mock/img/a.png', '/mock/img/b.png'])
  })

  it('过滤封面缩略图（class 与路径两种形态）', () => {
    mkImg('/mock/img/p0.png')
    mkImg('/mock/img/cover.png', 'thumb-img')
    mkImg('https://static.example.com/cover/foo.jpg')
    mkImg('https://static.example.com/covers/bar.webp', '', 'thumb-hold')
    expect(scrapeReaderImages(document)).toEqual(['/mock/img/p0.png'])
  })

  it('无 referrerpolicy 的图片（脚本自身等）不参与', () => {
    const img = document.createElement('img')
    img.src = '/x.png'
    document.body.appendChild(img)
    expect(scrapeReaderImages(document)).toEqual([])
  })

  it('无 src 的占位 img 跳过', () => {
    mkImg('')
    expect(scrapeReaderImages(document)).toEqual([])
  })
})
