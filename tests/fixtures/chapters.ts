/**
 * 章节目录样本（去敏；结构对应 /api/details 的 data.chapters）。
 * 覆盖：正篇+番外、卷、小数话、倒序来源、无话数来源（§3.5 / §6.4）。
 */
export interface FixtureChapter {
  id?: string
  name?: string
  url?: string
  order?: number
  category?: string
}

export interface CatalogFixture {
  siteId: string
  title: string
  /** 接口原始顺序 */
  raw: FixtureChapter[]
  /** 原站目录正序显示时的章节名（来自原站前端同一算法） */
  expectedNames: string[]
}

/** 漫画之家风格：接口倒序返回，名称含话数与番外。 */
export const manhuazhijiaReversed: CatalogFixture = {
  siteId: 'manhuazhijia',
  title: '进击的巨人',
  raw: [
    { id: 'c40', name: '第40话', url: 'https://example.com/comic/a/chapter/40', order: 0 },
    { id: 'c39', name: '第39话', url: 'https://example.com/comic/a/chapter/39', order: 1 },
    { id: 'c38', name: '第38话', url: 'https://example.com/comic/a/chapter/38', order: 2 },
    { id: 'c37', name: '第37话', url: 'https://example.com/comic/a/chapter/37', order: 3 },
  ],
  expectedNames: ['第37话', '第38话', '第39话', '第40话'],
}

/** 正篇 + 番外（kind 分组：main 在前，extra 在后；可解析话数 ≥3 走数字排序分支）。 */
export const withExtras: CatalogFixture = {
  siteId: 'manhuazhijia',
  title: '一拳超人',
  raw: [
    { id: 'e1', name: '番外1', url: 'https://example.com/comic/b/extra/1', order: 0 },
    { id: 'c10', name: '第10话', url: 'https://example.com/comic/b/chapter/10', order: 1 },
    { id: 'e2', name: '特别篇', url: 'https://example.com/comic/b/extra/2', order: 2 },
    { id: 'c9', name: '第9话', url: 'https://example.com/comic/b/chapter/9', order: 3 },
    { id: 'c8', name: '第8话', url: 'https://example.com/comic/b/chapter/8', order: 4 },
  ],
  expectedNames: ['第8话', '第9话', '第10话', '番外1', '特别篇'],
}

/** 小数话（12.5）与卷。 */
export const decimalAndVolume: CatalogFixture = {
  siteId: 'manhuazhijia',
  title: '海贼王',
  raw: [
    { id: 'v3', name: '第3卷', url: 'https://example.com/comic/c/vol/3', order: 0 },
    { id: 'c12', name: '第12.5话', url: 'https://example.com/comic/c/chapter/12.5', order: 1 },
    { id: 'c12b', name: '第12话', url: 'https://example.com/comic/c/chapter/12', order: 2 },
    { id: 'c11', name: '第11话', url: 'https://example.com/comic/c/chapter/11', order: 3 },
  ],
  expectedNames: ['第11话', '第12话', '第12.5话', '第3卷'],
}

/** 无法解析话数（<35%），order 递减 → 检测倒序并反转。 */
export const orderDescending: CatalogFixture = {
  siteId: 'rumanhua',
  title: '无名条漫',
  raw: [
    { id: 'x4', name: '后日谈', url: 'https://example.com/comic/d/p/4', order: 4 },
    { id: 'x3', name: '雨夜', url: 'https://example.com/comic/d/p/3', order: 3 },
    { id: 'x2', name: '晴空', url: 'https://example.com/comic/d/p/2', order: 2 },
    { id: 'x1', name: '开场', url: 'https://example.com/comic/d/p/1', order: 1 },
  ],
  expectedNames: ['开场', '晴空', '雨夜', '后日谈'],
}

/** 已知来源、首章不是“第1话”且末章也不是 → 整体反转（Xn 规则）。 */
export const siteRuleReverse: CatalogFixture = {
  siteId: 'dm5',
  title: '测试漫画',
  raw: [
    { id: 'm10', name: '第10话', url: 'https://example.com/comic/e/10', order: 0 },
    { id: 'm9', name: '第9话', url: 'https://example.com/comic/e/9', order: 1 },
    { id: 'm8', name: '第8话', url: 'https://example.com/comic/e/8', order: 2 },
  ],
  expectedNames: ['第8话', '第9话', '第10话'],
}

/** 空目录。 */
export const emptyCatalog: CatalogFixture = {
  siteId: 'manhuazhijia',
  title: '空',
  raw: [],
  expectedNames: [],
}
