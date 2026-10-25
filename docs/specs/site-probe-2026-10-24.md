# 站点适配核对记录（2026-10-24）

来源：读取 `https://mangayun.com` 首页 HTML 与前端代码包（Vue 3 + Vite 单页应用）。本文对应《需求分析与实现方案》§3.6 的核对清单，是适配层实现的事实依据。原站发版后以原站行为为准修正。

## 入口与资源

- 首页：`/assets/index-*.js` 为入口，懒加载 chunk：`ReaderOverlay`、`DetailPanel`、`MangaAtlas`、`ResultList`、`AdminPanel`、`comicbox-engine`。
- 路由：`/read/{A}/{B}`、`/m/{A}`、`/s/{keyword}`，另有查询串形式 `?site=&manga=&chapter=`。`/read` 的正则：`^\/read\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)`。
- A/B 编码：`TextEncoder` → `btoa` → URL 安全字母表（`+`→`-`、`/`→`_`）、去 `=` 填充；A 为 JSON `["siteId","detailUrl"]`，B 为来源章节 URL 字符串。

## 接口

所有请求经同一个签名包装函数发出（`Content-Type: application/json`，头 `x-ym-ts`/`x-ym-nonce`/`x-ym-sign`）。本脚本不复刻签名，只捕获响应。

- `POST /api/details`，body `{siteId, detailUrl}`，取 `.data`：`{title, coverUrl, chapters, …}`；`chapters` 为 `{id, name, url, order, category?}` 数组。
- `POST /api/chapter-images`，body `{siteId, chapterUrl, refresh}`，取 `.data.images`：字符串数组。`refresh:true` 为"重新加载"，用于刷新过期地址。
- 其余：`/api/search`、`/api/sites?v=3`、`/api/home-sections`、`/api/user/*`、`/api/image`。

## 章节正序规则（normalizeChapters，已从代码逐行核对）

函数签名 `(chapters, siteId)`：

1. 每章解析：`num`（话数）、`kind`（`main`/`extra`）、`unit`（`episode`/`volume`）。
   - `extra` 判定：名称或 category 匹配 `外传|外傳|番外|特别篇|特別篇|特典|附录|附錄|加笔|加筆|短篇|单行本特典|\bSP\b|\bExtra\b|\bOmake\b|\bGaiden\b`。
   - `volume` 判定：名称匹配 `卷|Vol(?:ume)?`。
   - `num` 解析顺序：① 序章/预告/开篇/前言/第零 → 0；② 最终话/终章/完结篇/大结局（且不含数字）→ 1e6；③ `(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:话|話|回|集|卷|期|章|篇)`；④ `(?:EP|Ch(?:apter)?|Vol(?:ume)?)\s*[.\-_]?\s*(\d+(?:\.\d+)?)`；⑤ 开头数字 `^(\d+)(?:\.(\d+))?…`（小数部分 ≤2 位）；⑥ 纯数字整名；⑦ URL 中 `chapter_slot=(\d+)`。
2. 若可解析话数的章 ≥35% 且 ≥3 章：按 `kind`（main 前）→ `unit`（episode 前）→ `num` 升序 → 原始下标排序。
3. 否则若来源在已知集合（`dm5,mangabz,manben,manhuagui,manhuazhijia,tuku,rumanhua,comicbox,manhuazhan`）且章节数 ≥2：首章名匹配 `第0*1(话|話|回|集|章)` 而末章不匹配 → 整体反转。
4. 否则：按 `order` 字段（缺省用下标）排序，取前 8 与后 8 的均值判断是否再反转（首均值 > 尾均值+1 → 反转）。
5. 输出把正序序号写回 `order` 字段（从 0 开始，本脚本转换为从 1 开始的 `order`）。

## 图片地址与代理

- 代理路径 `/api/image?url=<abs>&siteId=<id>`（同源）。
- 域名白名单（host 相等或为其子域）：`hamreus.com`、`cdndm5.com`、`ccavbox.com`、`bgm.tv`、`tuku.cc`。
- 来源白名单（siteId 命中即代理）：`manhuagui`、`comicbox`、`manben`、`dm5`、`tuku`。
- 已经是代理地址的直接沿用；其余解析为绝对 URL 后按上述规则决定代理或直连。
- 图片元素统一 `referrerpolicy="no-referrer"`；阅读器前几页 eager、其余 lazy，向后预取 4 张（`new Image()`）。
- 图片加载失败时原站会把地址重写为代理形式再试一次；单章累计 ≥3 次失败触发整章 `refresh:true` 重新解析。

## comicbox 打乱来源

- 判定：`siteId === "comicbox"`，或地址含 `ccavbox.com`、`/break_2/`、`comicbox.xyz`。
- 原站做法：canvas 按 MD5 派生的条带顺序重排后导出 JPEG（质量 0.9）替换显示。本脚本按 §3.4 回退原站阅读器、不支持下载。

## 阅读器与存储

- 阅读弹层与目录：`.catalog-sheet[role="dialog"][aria-label="章节目录"]`；阅读器导航 `role="group"[aria-label="阅读导航"]`。
- 原站横向模式为整页吸附（`scrollLeft = 页 × clientWidth`，80ms 内取整），点击区为左 28% 上一页、右 28% 下一页、中央菜单；纵向为连续滚动，距底 72px 内显示工具。
- 键盘：`window` keydown，Esc 关闭（先关目录）、方向键/空格翻页。
- localStorage 键：`ym_auth_token`（登录令牌，禁止读取）、`cloudream_read_mode`（`horizontal`/`vertical`，全站共用）、`cloudream_reader_theme`、`reader-lock`（body 类名）、`cloudream_admin_*`。
- 搜索排除来源：`manhuazhan`、`kanman`。

## 对实现的影响

- 捕获层只需包装 `fetch`，按 URL 前缀过滤 `/api/details` 与 `/api/chapter-images`，读取请求 body 中的 `siteId`/`chapterUrl` 用于关联。
- 增强阅读器使用 `finalizeImageUrl(siteId, url)` 之后的地址，与原站一致以命中缓存。
- 下载编号依赖 normalizeChapters 的正序序号（实现于 `src/site/mangayun/chapters.ts`，快照样本见 `tests/fixtures/`）。
