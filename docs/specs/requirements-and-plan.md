# MangaYun Reader：需求分析与实现方案

日期：2026-10-24
状态：已定稿（2026-10-24），首版实现完成（2026-10-25，见文末“实现记录”）。开发者自行实现，完成后按第 6 节交付验收。

本文补充 [手机优先设计](../superpowers/specs/2026-10-23-mobile-reader-design.md)（下称“基线规格”）。基线规格已定的细节（点击区几何、ZIP 目录结构、存储降级、保存流程）不再重复；两者冲突时以本文为准。

## 0. 结论速览

- 首版范围是用户列出的全部功能，外加几项低成本增强（标【增】）。P0、P1 只区分是否阻塞验收，不代表砍掉需求。
- 最大风险在站点适配：原站接口请求带前端签名。脚本不复刻签名，只读取原站自己发出的请求结果；批量下载借原站页面流程逐话获取图片清单（§3.3）。
- comicbox 来源的图片是打乱后在前端用 canvas 还原并重新编码的，原始字节不能直接打包，首版不支持该来源下载（§3.4）。
- 原站目录顺序经过前端整理，下载编号必须与原站“正序”一致（§3.5）。
- 先做最小闭环：在安卓真机上用增强阅读器读完一话，并下载这一话的 ZIP，再铺开其余功能（§5 M2）。

## 1. 需求分析

### 1.1 使用环境

- 主要：安卓 + Chromium 内核浏览器 + Tampermonkey，单手竖屏为主，横屏为辅。
- 次要：桌面 Chromium，保证可用，不单独优化。
- 原站页面已设置 `viewport-fit=cover`，未禁用双指缩放。

### 1.2 原站已有能力与差距

2026-10-24 读取原站前端代码确认：

| 能力 | 原站现状 | 本脚本补足 |
| --- | --- | --- |
| 纵向连续 | 有，默认模式 | 宽度调节、页内位置记忆 |
| 横向翻页 | 有，按整页定位，提供上一页／下一页 | 不按整页定位的连续横滑、右→左方向；独立单页模式与四区点击配置 |
| 模式记忆 | 全站共用一个值 | 每部漫画独立偏好 |
| 阅读进度 | 登录后书架同步（粒度未核实） | 本地记录到页及页内位置，不依赖登录 |
| 目录、主题 | 有 | 在增强阅读器内统一提供 |
| 下载 | 无 | 单话、多话、整部，打包为一个 ZIP |

### 1.3 原始需求对照

每条原始需求都有编号，验收时逐条核对，避免遗漏。

| 原始需求 | 需求编号 |
| --- | --- |
| 日漫横向连续，左右方向可选 | R-J1～R-J6 |
| 韩漫纵向连续，适配屏宽，可调宽度，不裁切 | R-K1～R-K6 |
| 普通单页，四个点击区可配置，中间呼出菜单 | R-S1～R-S7 |
| 区分点击、滑动和缩放，放大拖动不翻页 | R-G1～R-G4 |
| 记忆阅读位置和每部漫画的模式偏好 | R-P1～R-P6 |
| 目录跳转、预加载、失败重试、键盘、全屏、背景 | R-C3～R-C8 |
| 退出后原站正常 | R-C1、N-4 |
| 下载当前话、多话、整部，固定当前来源 | R-D1、R-D2 |
| 文件夹和页面编号、保留真实格式、一个 ZIP | R-D3～R-D5 |
| 进度、暂停／继续、取消、有限重试、失败清单，缺页不算成功 | R-D6～R-D9 |
| 限制并发，限流时退避 | R-D10 |
| 桌面流式写 ZIP，兼容方式有容量保护 | R-D11、R-D12 |

### 1.4 范围

首版包含上表全部内容。另外参考 Mihon 和 Manga OnlineViewer，加入以下低成本增强：点击区预设与一键左右反转、单页适应方式、页码与进度滑块、屏幕常亮、章首章尾切换卡片、设置导入导出。

首版不做：双页对开、自动裁边、宽图切分、亮度滤镜、跨话无限拼接、自动翻译、云同步、多站点。

做不到，因此不列为需求：

- 音量键翻页：网页收不到安卓音量键事件。
- 切后台或熄屏后持续下载：安卓会暂停或回收页面。
- 跨来源合并同名漫画的章节：版本和页序无法保证一致。

## 2. 功能需求

每条需求后面的“验收”是判定依据。优先级：P0 为首版必须且阻塞验收；P1 为首版必须；【增】为建议新增，可删。

### 2.1 公共阅读（R-C）

| 编号 | 需求 | 验收 | 级别 |
| --- | --- | --- | --- |
| R-C1 | 阅读页显示可拖动的悬浮入口，点击进入增强阅读器；退出后原站阅读器、页面滚动和手势恢复原样 | 连续进出 20 次：原站可正常翻页，界面不重复挂载，监听器数量不增长 | P0 |
| R-C2 | 切换模式、阅读方向、屏幕朝向或阅读宽度后，停留在同一逻辑页及页内位置 | 当前页码不变；页内位置误差不超过视口的 10% | P0 |
| R-C3 | 底部面板提供目录，可切换正序／倒序，标出当前话，可跳转 | 跳转后进入目标话第 1 页，模式不变 | P1 |
| R-C4 | 预加载当前页之前 1 页、之后 3 页（可设置）；窗口外的图片释放 `src`，保留占位尺寸 | 200 页的章节同时持有图片的元素不超过窗口大小加 2；返回已读页面时不跳动 | P0 |
| R-C5 | 单页加载失败自动重试 2 次，仍失败时显示“重试”和“重新解析本话” | 断网后恢复网络，点击重试可显示该页 | P1 |
| R-C6 | 键盘操作：方向键按视觉方向移动，PageDown 和空格前进，PageUp 后退，Esc 退出，F 切换全屏 | 右→左模式下按左方向键前进 | P1 |
| R-C7 | 支持全屏 API 时提供全屏按钮；不支持时提供隐藏工具栏的沉浸模式，界面文案不混用两者 | 两种环境下按钮文案各自正确 | P1 |
| R-C8 | 背景可选黑、深灰、白、跟随系统，全局保存 | 刷新后保持 | P1 |
| R-C9 | 工具栏默认收起，点击中央区域呼出；按钮不小于 48 CSS 像素，适配安全区 | 刘海屏和手势导航机型上按钮不被遮挡 | P0 |
| R-C10 | 【增】页码与进度滑块，显示“当前页／总页数”，拖动可跳页 | 拖到任意位置松手后显示该页 | 增 |
| R-C11 | 【增】屏幕常亮：阅读和下载时请求 Wake Lock，可关闭，不支持时静默跳过 | 开启后 5 分钟不熄屏 | 增 |
| R-C12 | 【增】章尾显示“下一话”、章首显示“上一话”卡片；切换后保持当前模式与设置 | 切话后模式和宽度不变 | P1 |

### 2.2 日漫横向连续（R-J）

| 编号 | 需求 | 验收 | 级别 |
| --- | --- | --- | --- |
| R-J1 | 当前话的图片横向零间隙排列，按阅读区高度适配，保持比例，不裁切 | 页与页之间无缝隙，图片完整显示 | P0 |
| R-J2 | 可选左→右或右→左；右→左只改变排列和前进方向，不镜像图片，不改变页码和下载顺序 | 右→左时第 1 页在最右侧，文字不镜像 | P0 |
| R-J3 | 原生横向滚动，保留惯性，不吸附页边界 | 快速滑动后可停在两页之间 | P0 |
| R-J4 | 点击区沿用 R-S2 的配置，动作为前进／后退 90% 屏宽；可在设置中对连续模式关闭点击区 | 关闭后点击边缘只呼出菜单 | P1 |
| R-J5 | 双指放大后拖动只平移画面，不触发点击区 | 放大状态下拖动 10 次，页码不变 | P0 |
| R-J6 | 跨页大图按高度适配，自然占两屏宽，不切分 | 宽图完整显示 | P1 |

### 2.3 韩漫纵向连续（R-K）

| 编号 | 需求 | 验收 | 级别 |
| --- | --- | --- | --- |
| R-K1 | 图片纵向零间隙排列，默认占阅读区宽度的 100%，保持比例 | 无缝隙、无横向滚动条 | P0 |
| R-K2 | 阅读宽度 50%～100%，步进 10%，居中显示，按漫画记忆 | 调整后立即生效，刷新后保持 | P0 |
| R-K3 | 进度精确到页码和页内比例（0～1） | 在长条图中部退出，重进后回到中部而不是页顶 | P0 |
| R-K4 | 点击区沿用 R-S2 的配置，动作为滚动 90% 屏高；可关闭 | 点击下方区域后，原屏底部内容出现在新屏顶部 | P1 |
| R-K5 | 在阅读区内下拉不触发浏览器的下拉刷新 | 在第 1 页顶部继续下拉，页面不刷新 | P0 |
| R-K6 | 章尾显示下一话卡片，不自动拼接下一话 | 见 R-C12 | P1 |

### 2.4 普通单页（R-S）

| 编号 | 需求 | 验收 | 级别 |
| --- | --- | --- | --- |
| R-S1 | 一次显示一页；适应方式可选适应屏幕（默认）、适应宽度、适应高度、原始大小 | 四种方式显示正确，默认不裁切 | P0／增 |
| R-S2 | 上、下、左、右四个点击区分别配置为上一页、下一页或无操作；中央固定为菜单；几何沿用基线规格 §4.3 | 每个区域的每种取值都生效 | P0 |
| R-S3 | 默认上、左为上一页，下、右为下一页；切换阅读方向时询问是否同时反转左右点击区，不静默修改映射（§7 D4） | 选“否”时映射不变；选“是”时左、右两区的动作互换 | P0 |
| R-S4 | 【增】预设：默认、左右翻页（上下无操作）、左右反转、仅菜单；预设只是一键填入四个区域，之后仍可单独修改 | 选预设后四个区域的值正确 | 增 |
| R-S5 | 设置页提供点击区示意图、立即试用和恢复默认 | 示意图与实际判定一致 | P1 |
| R-S6 | 水平滑动翻页，方向跟随阅读方向；放大时滑动只平移 | 未放大时快速左滑翻页；放大后左滑只平移 | P0 |
| R-S7 | 翻过章尾或章首时显示切话卡片，不直接跳转 | 防止误触切话 | P1 |

### 2.5 手势防误触（R-G）

| 编号 | 需求 | 验收 | 级别 |
| --- | --- | --- | --- |
| R-G1 | 区分点击、拖动／滚动、翻页滑动、长按和多指 | 见 §4.4 的阈值 | P0 |
| R-G2 | 多指操作期间和全部手指抬起后 300 ms 内，不响应点击区和翻页 | 双指缩放结束后立即单击，不翻页 | P0 |
| R-G3 | 放大状态下边缘点击区暂停，只保留中央菜单 | 放大后点击边缘不翻页 | P0 |
| R-G4 | 不做双击缩放，单击不需要等待双击判定；长按不翻页，保留系统长按菜单 | 单击响应无可感知延迟 | P1 |

### 2.6 设置与进度（R-P）

| 编号 | 需求 | 验收 | 级别 |
| --- | --- | --- | --- |
| R-P1 | 使用 Tampermonkey 存储，键名带版本前缀 `myr:v1:`，提供迁移函数 | 升级数据结构后旧数据可读 | P0 |
| R-P2 | 漫画身份为 `siteId` 加来源详情页 URL，章节身份为来源章节 URL；不用标题或图片地址 | 同名漫画的不同来源互不干扰 | P0 |
| R-P3 | 全局默认设置，加每部漫画的覆盖项（模式、方向、宽度、适应方式） | 改 A 漫画的模式不影响 B 漫画 | P0 |
| R-P4 | 进度记录章节、页码和页内比例；滚动停止 500 ms 后保存，页面隐藏或离开时立即保存 | 正常阅读时每秒写入不超过 2 次 | P0 |
| R-P5 | 【增】设置导出、导入为 JSON | 导入后设置一致 | 增 |
| R-P6 | 最多保留 500 部漫画的进度，超出时淘汰最久未读的 | 第 501 部写入后，最旧的一部被删除 | P1 |

### 2.7 下载（R-D）

| 编号 | 需求 | 验收 | 级别 |
| --- | --- | --- | --- |
| R-D1 | 范围可选当前话、勾选多话、整部；一个任务只属于一个来源 | 任务中不会出现其他来源的章节 | P0 |
| R-D2 | 确认页显示来源、漫画名、所选话数、存储方式和容量提示 | 信息与实际一致 | P1 |
| R-D3 | 文件夹名为 `{完整目录正序序号}_{话名}`，序号至少 4 位，超过时自动加位；只选第 10 话时仍为 `0010_…` | 跳选第 2、5、9 话，文件夹为 `0002`、`0005`、`0009` | P0 |
| R-D4 | 图片名为 `{页序}.{真实扩展名}`，页序至少 4 位；扩展名由文件头判断；无法识别的格式记为失败 | 混合格式的章节扩展名全部正确 | P0 |
| R-D5 | 输出一个 ZIP，条目不压缩（STORE），根目录为漫画名，包含 `download-report.json` | 解包结构与基线规格 §7 一致 | P0 |
| R-D6 | 进度面板显示总体进度、当前话、速度和失败数；可暂停、继续、取消 | 暂停后 2 秒内不再发出新请求 | P0 |
| R-D7 | 每张图片最多尝试 3 次，间隔约 1 s、3 s 并加入随机抖动；提供“只重试失败项” | 404 图片恰好请求 3 次 | P0 |
| R-D8 | 有失败项时，任务结束状态为“未完成”，不显示“下载成功” | 模拟 1 张失败，状态为未完成 | P0 |
| R-D9 | 用户明确选择后可导出部分结果：文件名加 `_partial`，报告列出缺页 | 报告中的缺页与实际缺失文件一致 | P0 |
| R-D10 | 默认并发 2（可设 1～4），章节解析串行；遇到 429 或 503 时全局暂停，遵守 `Retry-After`，否则指数退避，最长 60 s | 模拟 429 后，在等待时间内没有任何请求 | P0 |
| R-D11 | 存储与打包按基线规格 §8.2：OPFS 流式 → IndexedDB → 内存模式（上限 100 MiB） | 三条路径各自可用；内存模式达到上限时暂停并说明 | P0 |
| R-D12 | 打包完成后由用户点击“保存 ZIP”触发保存；区分“已交给系统下载”和“确认已保存” | 状态文案准确 | P0 |
| R-D13 | 刷新后可恢复任务：已通过校验的图片跳过；未完成的图片重新解析本话后再下载，不复用旧的签名地址 | 恢复后不重复下载已完成图片 | P1 |
| R-D14 | 同一任务同时只有一个标签页在执行（Web Locks） | 两个标签页同时恢复，只有一个在下载 | P1 |
| R-D15 | 不支持下载的来源在勾选阶段提示并拦截，不建立任务 | 见 §3.4 | P0 |

### 2.8 非功能需求（N）

| 编号 | 需求 | 验收 |
| --- | --- | --- |
| N-1 | 性能：200 页以上的章节在真机上连续阅读 10 分钟不崩溃；首张图显示不晚于原站阅读器 | 真机清单 |
| N-2 | 体积：产物目标不超过 300 KB（含 ZIP 库），超出时说明原因 | 构建输出 |
| N-3 | 隔离：界面放在 Shadow DOM 中；只临时修改原站样式并在退出时还原；不写原站的 localStorage 键 | 代码审查 |
| N-4 | 隐私：不读取、不发送登录令牌 `ym_auth_token`；无遥测；数据只存本地 | 代码审查 |
| N-5 | 降级：适配失败时提示并保留原站阅读器，不白屏，不阻断原站 | 模拟接口结构变化 |
| N-6 | 权限最小：`@match` 只匹配本站，`@grant` 只列用到的，`@connect` 列出实测图片域名 | 检查元数据头 |

## 3. 站点适配

### 3.1 已确认的事实

2026-10-24 读取首页 HTML 和前端代码包确认。这些来自代码阅读，不等于抓包结果；响应结构、签名有效期等仍需按 §3.6 实测。

- 技术栈：Vue 3 + Vite 单页应用。阅读器是懒加载组件，弹层为 `[role="dialog"][aria-modal="true"][aria-label="漫画阅读器"]`，目录为 `[role="dialog"][aria-label="章节目录"]`。
- 阅读页 URL：`/read/{A}/{B}`。A 是 base64url 编码的 JSON `["siteId","来源详情页URL"]`，B 是 base64url 编码的来源章节 URL。示例解码：`["manhuazhijia","https://www.manhuazhijia.cc/comic/…"]`、`https://www.manhuazhijia.cc/chapter/8690778`。
- 接口（POST，JSON，字段以抓包为准）：
  - `/api/details`：`{siteId, detailUrl}` → `data.chapters`，章节含 `id`、`name`、`url`、`order`，部分有 `category`。
  - `/api/chapter-images`：`{siteId, chapterUrl, refresh}` → `data.images`，即图片地址数组。
  - 原站的“重新加载”带 `refresh: true` 重新解析，这是刷新过期图片地址的正规途径。
- 所有 `/api/*` 请求都带前端计算的签名头 `x-ym-ts`、`x-ym-nonce`、`x-ym-sign`。
- 图片代理 `/api/image?url=…&siteId=…`（同源）。当前规则：`hamreus.com`、`cdndm5.com`、`ccavbox.com`、`bgm.tv`、`tuku.cc` 等域名，以及 `manhuagui`、`comicbox`、`manben`、`dm5`、`tuku` 来源走代理，其余直连。规则会随原站版本变化。
- 阅读器图片设置 `referrerpolicy="no-referrer"`，前 2 页 `loading="eager"`，其余为 `lazy`；相邻页用 `new Image()` 预取。
- comicbox 来源：图片加载后在 canvas 中按条带重新排列，再导出为 JPEG（质量 0.9）替换显示。
- 目录顺序：前端会对接口返回的章节重新排序（§3.5），接口原始顺序不等于显示顺序。
- 原站 localStorage 保存阅读模式（`horizontal`／`vertical`，全站共用）和登录令牌 `ym_auth_token`。
- 搜索时排除 `manhuazhan`、`kanman` 两个来源。

### 3.2 设计约束

1. 不复刻签名算法，不提取前端常量。那等于绕过原站的防滥用机制，而且原站一发版就会失效。脚本只读取原站自己发出的请求结果。
2. 捕获层在 `document-start` 注入页面上下文，包装 `fetch`，只读取 `/api/details` 和 `/api/chapter-images` 响应的副本（`response.clone()`），不修改请求和响应。它与脚本主体通过带随机 token 的 `postMessage` 通信，所以不论两者是否在同一个 JS 环境中都能工作。
3. 增强阅读器使用与原站相同的最终图片地址（包括代理改写），图片同样设置 `referrerpolicy="no-referrer"`，这样能命中原站已经加载过的浏览器缓存，不重复消耗流量。
4. 切话交给原站：调用原站的上一话／下一话或站内导航，捕获新章节的清单后刷新增强阅读器；无法调用时整页跳转到对应的 `/read/…`。
5. 不触碰 `ym_auth_token` 和原站的其他存储键。

### 3.3 批量解析方案

未打开的章节不会产生图片清单请求，所以需要让原站自己去请求。

采用方案（§7 D2）：隐藏的同源 iframe，逐话加载该话的 `/read/…` 页面。

- 脚本同样在 iframe 中运行（不加 `@noframes`），通过 `window.name` 的约定前缀识别自己是解析用的 iframe，只启用捕获层，不挂载界面。
- 捕获到清单后用 `postMessage` 交给父页面，父页面校验 `origin` 和 token，然后销毁 iframe。
- 逐话串行，每话间隔至少 1 s。
- 代价：每话都要加载一次单页应用（静态资源有缓存），iframe 内的原站阅读器也会预取少量图片。
- 待验证：登录状态下是否会写入阅读记录或书架进度。如果会，在任务确认页提示用户。

备选方案：iframe 不可行时，引导用户逐话打开章节，打开时自动捕获清单。只适合话数较少的情况。

不采用：伪造签名直接调用接口（违反约束 1）。

图片地址过期时，对该话重新执行一次上述流程。需验证能否在 iframe 中触发原站的 `refresh: true`。

### 3.4 来源支持矩阵

| 类型 | 增强阅读 | 下载 |
| --- | --- | --- |
| 直连图片 | 支持 | 先用页面 `fetch`（无 Referer、不带凭据）；跨域失败时改用 `GM_xmlhttpRequest`（`anonymous`、`responseType: "blob"`），域名需在 `@connect` 中声明 |
| 代理图片 `/api/image` | 支持 | 同源 `fetch` |
| 打乱图片（comicbox） | 首版回退原站阅读器 | 首版不支持，在勾选阶段提示 |
| 未验证来源 | 支持 | 允许下载，报告中标记“未验证来源” |

后续版本可以考虑：在 canvas 还原后导出，并在报告中标注“已重新编码”。这需要单独放开“保留原始字节”的约束。

### 3.5 章节顺序

下载编号必须与原站目录的正序一致，这是验收重点。原站前端的整理规则（读代码所得）：

- 如果至少 35% 的章节能从标题或 URL 解析出话数，并且至少有 3 话：按正篇／番外类别、单位（话、卷等）、话数排序。
- 否则，按来源规则整体反转，或按 `order` 字段排序后判断是否需要反转。

实现方式：

- 适配层实现纯函数 `normalizeChapters(siteId, rawChapters)`。
- 至少用 5 个来源的真实目录做快照测试，覆盖番外、卷、小数话、倒序来源，并与原站显示逐一核对。
- 报告同时记录接口原始下标和正序序号，方便追查。
- 原站以后修改排序时，以原站显示为准修正。

### 3.6 编码前的抓包核对清单

在桌面浏览器开发者工具中，用安卓模拟视口完成：

1. `/api/details` 的响应结构：漫画名、封面、章节字段，以及是否分页。
2. `/api/chapter-images` 的响应：`images` 是否只是字符串数组，有没有宽高信息。
3. 签名图片地址的有效期大概是多久。
4. 直连图片域名是否返回 CORS 头；`GM_xmlhttpRequest` 是否需要去掉 Referer。
5. `/api/image` 是否依赖 Cookie，限流时返回什么状态码。
6. Tampermonkey 能否在原站发出第一个请求之前完成 `fetch` 包装。
7. 隐藏 iframe 方案能否捕获清单，是否产生阅读记录。
8. 原站阅读器在 `window` 上监听了哪些键盘和触摸事件（增强层需要拦截）。
9. 站点的 CSP 是否允许注入页面脚本。
10. 收集显示顺序与接口原始顺序不一致的来源样本。

抓包结果写入 `tests/fixtures/`，去掉签名参数和个人信息后再提交。

## 4. 技术设计

### 4.1 技术栈

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript（strict） | 适配层和下载状态机靠类型约束 |
| 构建 | Vite + vite-plugin-monkey | 生成元数据头，提供 GM API 类型，输出单个 `.user.js` |
| 界面 | 原生 DOM + Shadow DOM | 体积小，与原站样式隔离，不引入框架 |
| ZIP | zip.js（固定版本），只用 STORE | 支持流式写入和 Zip64，BSD-3-Clause |
| 单元测试 | Vitest + jsdom | 纯逻辑：几何、状态机、命名、排序、调度 |
| 端到端测试 | Playwright（移动视口 + 触摸） | jsdom 没有真实布局和滚动，阅读器测试必须用真实浏览器 |

### 4.2 目录结构

```text
src/
  main.ts                  入口：幂等初始化，判断顶层页面还是解析用 iframe
  site/
    types.ts               SiteAdapter 等接口
    mangayun/
      url.ts               /read/ URL 编解码
      capture.ts           页面上下文 fetch 捕获层
      chapters.ts          normalizeChapters
      images.ts            最终图片地址与来源支持等级
      batch-resolver.ts    隐藏 iframe 批量解析
  reader/
    controller.ts          状态、模式切换、锚点
    modes/                 horizontal.ts、vertical.ts、single.ts
    gesture.ts             手势状态机
    tap-zones.ts           点击区几何（纯函数）
    window.ts              预加载窗口与占位
  ui/                      shadow-root、toolbar、catalog、settings、download-panel
  store/                   settings.ts、progress.ts、migrate.ts
  download/
    task.ts                任务模型与状态机
    scheduler.ts           并发、退避、暂停、取消
    fetcher.ts             图片请求与校验
    cache/                 opfs.ts、idb.ts、memory.ts
    packer.ts              流式 ZIP 与报告
    saver.ts               GM_download 与对象 URL 两条保存路径
  utils/                   crc32.ts、mime-sniff.ts、naming.ts、lock.ts
tests/
  unit/  e2e/  fixtures/   抓包样本已去敏
harness/                   本地验收页：mock 适配器 + 自制测试图片
```

### 4.3 核心接口

```ts
interface ComicRef { siteId: string; detailUrl: string }   // 漫画身份（R-P2）
interface Chapter {
  url: string;          // 来源章节 URL，即章节身份
  name: string;
  order: number;        // 完整目录正序序号，从 1 开始，用于文件夹编号
  rawIndex: number;     // 接口原始下标，写入报告
  category?: string;    // 正篇、番外等
}
interface ComicInfo { ref: ComicRef; title: string; chapters: Chapter[] }
interface PageList { chapterUrl: string; images: string[]; resolvedAt: number }
type SourceSupport = 'full' | 'read-only' | 'unsupported';

interface SiteAdapter {
  matchReadUrl(url: URL): { comic: ComicRef; chapterUrl: string } | null;
  buildReadUrl(comic: ComicRef, chapterUrl: string): string;
  onComicInfo(cb: (info: ComicInfo) => void): () => void;  // 来自捕获层
  onPageList(cb: (list: PageList) => void): () => void;    // 来自捕获层
  resolveComic(comic: ComicRef): Promise<ComicInfo>;       // 批量解析，见 §3.3
  resolveChapter(comic: ComicRef, chapterUrl: string): Promise<PageList>;
  supportOf(siteId: string): SourceSupport;
}

interface ReadingAnchor { chapterUrl: string; page: number; offset: number } // offset 为页内比例 0～1

interface ReaderMode {
  mount(root: HTMLElement, pages: string[], anchor: ReadingAnchor): void;
  getAnchor(): ReadingAnchor;
  goTo(page: number, offset?: number): void;
  step(dir: 1 | -1): void;   // 单页翻一页；连续模式滚动约 90% 视口
  unmount(): void;           // 移除自己注册的全部监听器和观察器
}
```

阅读核心只依赖 `SiteAdapter`。harness 用 mock 适配器即可跑通阅读和下载全流程，不需要访问真实站点。

### 4.4 阅读器实现要点

挂载与隔离

- 宿主节点挂在 `document.documentElement` 下，`position: fixed; inset: 0`，z-index 取最大值，界面放在 Shadow DOM 中。
- 进入时把原站阅读弹层设为 `display: none`，阻止它继续懒加载；退出时还原内联样式。
- 进入时锁定页面滚动，并给 `html` 设置 `overscroll-behavior: none`，退出时还原。

连续模式

- 使用原生滚动，滚动容器设置 `overscroll-behavior: contain`，不用 JS 模拟惯性。
- 右→左用 `direction: rtl` 排列。不同 Chromium 版本对 RTL 下 `scrollLeft` 的取值不一致，所以锚点一律用 `getBoundingClientRect()` 计算相对位置，再用 `scrollBy` 修正，不直接读写 `scrollLeft`。
- 图片尺寸未知时用上一页的宽高比占位（第 1 页按 3:4）。图片加载后如果实际尺寸改变了锚点之前的布局，立即补偿滚动量，不依赖 `overflow-anchor`。
- 用 IntersectionObserver 按阅读方向设置 `rootMargin`，窗口内设置 `src`，窗口外移除 `src`、保留占位尺寸；当前页设置 `fetchpriority="high"`。

缩放

- 连续模式使用浏览器原生双指缩放，用 `visualViewport.scale > 1.01` 判断是否处于放大状态。
- 单页模式自己实现双指缩放和拖动（对图片层使用 CSS transform），这样才能可靠地区分“拖动”和“翻页”。

事件与路由

- 键盘：在 `document-start` 时于 `window` 捕获阶段注册监听，增强层激活时自行处理按键并 `stopImmediatePropagation`，避免原站阅读器同时翻页。
- 指针和触摸：在宿主节点的冒泡阶段 `stopPropagation`，原站挂在 document 或 window 上的冒泡监听收不到。若实测原站在 window 捕获阶段监听触摸，再单独处理。
- 包装 `history.pushState`、`replaceState` 并监听 `popstate`：进入阅读路由时显示入口，离开时卸载增强层。

清理

- 所有监听器、观察器、定时器和对象 URL 都登记到一个清理表，退出时统一释放。
- 用全局标记保证只初始化一次。

### 4.5 手势状态机

使用 Pointer Events，各模式的 `touch-action`：纵向 `pan-y pinch-zoom`，横向 `pan-x pinch-zoom`，单页 `none`（缩放由脚本处理）。手指数以 TouchEvent 的 `touches.length` 为准。

```text
idle ──单指按下──▶ pending
pending ──抬起，位移 < 10px 且时长 < 300ms──▶ tap ──▶ resolveZone ──▶ 执行动作
pending ──位移 ≥ 10px──▶ pan（连续模式交给原生滚动；单页模式判断是否为翻页滑动）
pending ──静止 500ms──▶ longpress（不做任何动作）
任意状态 ──第二根手指按下──▶ multi ──全部抬起──▶ cooldown 300ms ──▶ idle
pointercancel（浏览器接管了滚动或缩放）──▶ idle，不产生 tap
```

- 单页翻页滑动：水平位移 ≥ 15% 视口宽，或速度 ≥ 0.5 px/ms，并且水平位移 ≥ 1.5 倍垂直位移。
- 放大状态：tap 只响应中央菜单，pan 只平移。
- `resolveZone(x, y, w, h, config)` 是纯函数，返回区域和动作，单元测试覆盖所有边界和四角。

### 4.6 存储与默认设置

Tampermonkey 存储的键：

```text
myr:v1:settings            全局设置
myr:v1:comic:{hash}        单部漫画的覆盖项和阅读进度，值内保存完整 ComicRef 以防哈希冲突
myr:v1:recent              最近阅读列表，用于 R-P6 的淘汰
myr:v1:task:{id}           下载任务元数据（不含图片）
```

`hash` 为 `siteId + "\n" + detailUrl` 的 FNV-1a 十六进制值。图片缓存和输出 ZIP 放在 OPFS 或 IndexedDB 的 `myr-v1` 命名空间下，清理时只删这个命名空间。

```ts
const DEFAULT_SETTINGS = {
  schema: 1,
  autoEnter: false,                     // 进入阅读页时是否自动打开增强阅读器
  mode: 'vertical',                     // 'horizontal' | 'vertical' | 'single'
  direction: 'rtl',                     // 横向和单页的阅读方向
  verticalWidth: 100,                   // 50～100
  singleFit: 'screen',                  // 'screen' | 'width' | 'height' | 'original'
  tapZones: { top: 'prev', left: 'prev', bottom: 'next', right: 'next' },
  tapInContinuous: true,
  preload: { before: 1, after: 3 },
  background: 'black',                  // 'black' | 'gray' | 'white' | 'system'
  keepAwake: true,
  download: { concurrency: 2 },         // 1～4
};

const MEMORY_MODE_CAP_MIB = 100;        // 固定值，不提供设置（§7 D7）
```

### 4.7 下载流水线

```text
任务：draft → resolving ⇄ downloading ⇄ paused → packing → packed → handed-off
                       └────────────→ incomplete / cancelled
图片：pending → fetching → cached（已校验）
                       └→ failed（附原因与尝试次数）
```

每话的处理步骤：

1. `resolveChapter` 取得页面清单，页序以清单下标为准，不以请求完成顺序为准。
2. 图片进入调度器，按并发上限请求，`referrerPolicy: 'no-referrer'`。
3. 校验：状态码为 2xx；Content-Type 不是 `text/html`；文件头是 JPEG、PNG、WebP、GIF 或 AVIF 之一；长度大于 0，并且与 Content-Length 一致（如果有）。
4. 写入缓存后计算 CRC32，与长度一起记录，然后才把该图标记为 `cached`。
5. 全部完成或用户选择导出部分结果后，用 zip.js 按“章节序号、页序”顺序把条目流式写入 OPFS 文件，最后写入报告。

失败处理：

| 情况 | 处理 |
| --- | --- |
| 网络错误、5xx | 按 R-D7 重试 |
| 429、503 | 全局暂停（R-D10），恢复后并发临时降为 1，持续 60 s |
| 403、返回 HTML、文件头无效 | 疑似地址过期：对该话重新解析一次，再按新清单重试；仍失败则记为失败 |
| 404 | 重试后记为失败 |

报告示例（不写入签名参数、请求头或 Cookie）：

```json
{
  "tool": "mangayun-reader",
  "version": "1.0.0",
  "createdAt": "2026-10-24T08:00:00Z",
  "site": { "siteId": "manhuazhijia", "verified": true },
  "comic": { "title": "…", "detailUrl": "https://www.manhuazhijia.cc/comic/…" },
  "result": "partial",
  "chapters": [
    {
      "folder": "0002_第2话", "order": 2, "rawIndex": 1,
      "url": "https://www.manhuazhijia.cc/chapter/…",
      "expectedPages": 24, "savedPages": 23,
      "missing": [{ "page": 17, "reason": "http-404", "attempts": 3 }]
    }
  ]
}
```

### 4.8 元数据头与安全

```text
// @name         MangaYun Reader
// @namespace    https://github.com/<owner>/mangayun-reader
// @version      1.0.0
// @match        https://mangayun.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      （按 §3.6 实测的直连图片域名逐个列出）
```

- 未列出的域名由 Tampermonkey 弹窗询问用户，不使用 `@connect *`。
- 捕获层以内联 `<script>` 注入页面上下文。如果 CSP 阻止，改为包装 `unsafeWindow.fetch`（需加 `@grant unsafeWindow`）。两种方式在真机上验证后择一。
- 捕获层写成不引用外部变量的函数，用 `(${fn})(token)` 的形式注入。构建工具可能向函数体注入辅助函数而破坏自包含，构建后必须用端到端测试验证。
- 不执行网页提供的任何文本，不用 `eval` 或 `new Function`。
- `postMessage` 校验 `origin` 和随机 token。
- 文件名过滤路径分隔符、控制字符、`.`、`..` 和 Windows 保留名（`CON`、`NUL` 等），话名截断到 80 个字符，保留数字前缀。
- 不向第三方发送任何数据。

## 5. 实现计划

先做风险最高的部分：先确认真实站点和安卓保存可行，再打磨界面。每个里程碑以“退出条件”为准，不预估天数。

| 里程碑 | 内容 | 退出条件 |
| --- | --- | --- |
| M0 脚手架 | Vite + vite-plugin-monkey、TypeScript strict、ESLint、Vitest、Playwright；脚本 `dev`、`build`、`test`、`e2e`、`typecheck`；harness 页面；构建产物提交到 `dist/`，便于安卓用 raw 链接安装和更新 | 安卓 Tampermonkey 能装上，原站无任何变化，`npm test` 通过 |
| M1 站点捕获 | §3.6 核对清单；`url`、`capture`、`chapters`、`images` 及其单元测试和样本 | 真机打开任意一话，日志中的漫画名、话数、页数与原站一致；原站功能正常 |
| M2 最小闭环 | 纵向模式、入口和退出、单话下载（先用内存模式）、保存 | 真机读完一话；下载该话的 ZIP 能解压，页序和扩展名正确 |
| M3 三种模式 | 横向（两个方向）、单页、手势状态机、锚点恢复、目录、工具栏、背景、全屏、键盘、进度滑块、切话卡片 | R-J、R-K、R-S、R-G、R-C 的 P0 全部通过，相关 e2e 测试为绿色 |
| M4 设置与进度 | 设置面板、点击区示意图与预设、单部漫画覆盖项、进度保存与恢复、导入导出、淘汰 | R-P 全部通过 |
| M5 完整下载 | 多话和整部、隐藏 iframe 解析、OPFS 和 IndexedDB 缓存、流式 ZIP、暂停、继续、取消、重试、限流、部分导出、任务恢复、多标签页锁 | R-D 全部通过，故障注入测试为绿色 |
| M6 打磨与交付 | 真机清单、README（安装、权限说明、已知限制）、验收材料 | 按 §6 提交 |

## 6. 交付与验收

### 6.1 交付物

1. 仓库提交哈希，以及对应的 `dist/mangayun-reader.user.js`。
2. `npm test`、`npm run e2e`、`npm run typecheck` 的完整输出。
3. 填好的真机清单（§6.5）：机型、安卓版本、浏览器及版本、Tampermonkey 版本；每项标注通过、失败或未测，失败项附截图或录屏。
4. 两个样本 ZIP：一个单话，一个跳选多话（例如第 2、5、9 话），以及对应的 `download-report.json`。
5. 已验证的来源列表（`siteId`），以及各自的支持等级。

### 6.2 验收方式

1. 代码审查：逐条对照需求编号。重点检查元数据头权限、Shadow DOM 隔离、清理表、有没有复刻签名、有没有读取登录令牌。
2. 在干净环境中执行 `npm ci`，重新构建并跑全部测试，确认与提交的 `dist` 一致。
3. 在 harness 页面用浏览器实测三种模式、点击区边界、切换模式后的锚点，以及反复进出后的监听器数量。
4. 解包样本 ZIP：核对目录编号、页序、扩展名与文件头是否一致、条目 CRC，以及报告与实际文件是否对应。
5. 对照真机清单的记录和截图。我无法在安卓真机上运行，真机项以你提交的记录为准。

### 6.3 判定规则

- 任一 P0 失败：不通过。
- P1 或【增】失败：列入修复清单，不影响其余部分的确认。
- 真机项标为“未测”不算通过；桌面的移动视口模拟不能代替真机结果。
- 实现与本文不一致时，要么修改实现，要么先更新本文并写明理由。

### 6.4 自动化测试清单

单元测试（Vitest）：

- `url`：编解码往返；非法 base64、非 JSON、缺字段时返回 `null`。
- `chapters`：真实样本快照；番外、卷、小数话、倒序来源、空目录。
- `tap-zones`：四条分界线两侧、四个角、无操作、预设、反转。
- `gesture`：tap、pan、swipe、longpress、multi、cooldown、pointercancel 之间的转换。
- `naming`：补零、超过 4 位、非法字符、保留名、截断、重名。
- `mime-sniff`：JPEG、PNG、WebP、GIF、AVIF；伪装成图片的 HTML；空文件。
- `crc32`：标准测试向量，`"123456789"` → `CBF43926`。
- `scheduler`：并发不超过上限；429 带 `Retry-After`；暂停后不再发出请求；取消后迟到的回调被丢弃；退避上限。
- `progress`：节流频率、淘汰、数据迁移。

端到端测试（Playwright，Pixel 7 视口，开启触摸）：

- 三种模式挂载、切换、退出后没有残留节点，监听器计数归零（清理表在测试构建中暴露计数）。
- 竖屏 → 横屏 → 竖屏后，锚点页码不变。
- 右→左时第 1 页在最右侧，前进方向正确。
- 按点击坐标验证动作，包括放大状态。
- 下载：mock 章节包含 404、带 `Retry-After` 的 429、伪装的 HTML、过期后重新解析成功；解包核对。
- 禁用 OPFS 后改走 IndexedDB；内存模式达到上限时暂停。
- 刷新后恢复任务，只下载未完成的图片。

### 6.5 安卓真机清单

复制此表填写。结果填“通过”“失败”或“未测”，失败项附截图或录屏。

| 编号 | 项目 | 结果 |
| --- | --- | --- |
| T1 | 安装后首页、搜索、原站阅读器均正常 | |
| T2 | 进入、退出增强阅读器 10 次，原站仍能正常翻页 | |
| T3 | 纵向：竖屏、横屏都铺满宽度；宽度调整生效；在第 1 页顶部下拉不刷新 | |
| T4 | 横向左→右、右→左：顺序正确，图片不镜像，惯性滑动可以停在两页之间 | |
| T5 | 单页：四个点击区按配置生效，中央呼出菜单 | |
| T6 | 双指放大后拖动不翻页；缩放结束后立即单击不翻页 | |
| T7 | 纵向 → 单页 → 横向依次切换，始终停在同一页 | |
| T8 | 在长条图中部关闭浏览器，重新打开后回到原位置；漫画 A、B 的模式互不影响 | |
| T9 | 章尾切换到下一话，模式和宽度保持不变 | |
| T10 | 下载单话：保存后可以解压，编号和扩展名正确，图片能打开 | |
| T11 | 跳选第 2、5、9 话下载：文件夹为 `0002`、`0005`、`0009` | |
| T12 | 下载中暂停，切到后台 30 秒再回来，继续后能完成 | |
| T13 | 下载中刷新页面，恢复任务后不重复下载已完成的图片 | |
| T14 | 下载中断网：出现失败清单；恢复网络后“只重试失败项”可以补齐 | |
| T15 | 有缺页时导出部分结果：文件名带 `_partial`，报告列出缺页 | |
| T16 | 不支持下载的来源（comicbox）在勾选阶段有提示 | |
| T17 | 200 页以上的章节连续阅读 10 分钟不崩溃 | |
| T18 | 增强阅读器打开时按系统返回键，行为符合 §7 D6 的决定 | |
| T19 | 两个标签页同时恢复同一任务，只有一个在下载 | |

## 7. 决策

2026-10-24 确认：全部采用推荐方案。实测结果与某项决策矛盾时，按 §6.3 先更新本文再改实现。

| 编号 | 问题 | 结论 | 备选（未采用） |
| --- | --- | --- | --- |
| D1 | 如何进入增强阅读器 | 悬浮入口手动进入；设置中可开启“自动进入” | 默认自动进入 |
| D2 | 批量解析方案 | 隐藏 iframe（§3.3） | 逐话手动打开 |
| D3 | comicbox 来源 | 首版回退原站阅读器，不支持下载 | canvas 还原后重新编码导出 |
| D4 | 横向和单页的默认阅读方向 | 右→左。切换方向时询问是否同时反转左右点击区，不静默修改（见 R-S3） | 左→右 |
| D5 | 连续模式下点击区 | 默认开启，可关闭 | 默认只呼出菜单 |
| D6 | 系统返回键 | 不改动浏览器历史，交给原站路由，路由离开阅读页时增强层自动卸载 | 进入时 `pushState`，返回先关闭增强层 |
| D7 | 内存模式上限 | 固定 100 MiB（沿用基线规格），不提供设置 | 可在设置中调整 |

## 8. 参考

- [Mihon 阅读设置](https://mihon.app/docs/guides/reader-settings)：点击区预设（Default、L shaped、Kindle-ish、Edge、Right and Left、Disabled）和反转选项，对应 R-S4。
- [Aniyomi 阅读设置](https://aniyomi.org/docs/guides/reader-settings)：Mihon 系的点击区反转说明。
- [Manga OnlineViewer](https://greasyfork.org/en/scripts/1319-manga-onlineviewer)：成熟的漫画阅读油猴脚本，提供纵向／WebComic 和双向 Fluid 连续阅读，可参考模式划分和快捷键。
- [PixivBatchDownloader](https://github.com/xuejianxianzun/PixivBatchDownloader)：任务管理、命名和进度恢复的思路。GPL-3.0，不复制源码。
- [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey)：用 Vite 构建油猴脚本，支持 Tampermonkey、Violentmonkey、ScriptCat。
- [zip.js](https://github.com/gildas-lormeau/zip.js)：流式 ZIP，支持 Zip64。
- [Scrollable elements in non-default writing modes](https://people.igalia.com/fwang/scrollable-elements-in-non-default-writing-modes/)：Chromium 中 RTL 下 `scrollLeft` 的取值变化，对应 §4.4。
- [云漫上线说明（linux.do）](https://linux.do/t/topic/2919011)：书架同步等站点功能。
- 基线规格 §11：OPFS 和 `GM_download` 的能力边界。

## 9. 实现记录（2026-10-25）

首版（v1.0.0）已按上述方案实现。对照 §6 的验收材料现状：

### 与方案的偏差（按 §6.3 先行记录理由）

| 项 | 方案 | 实现 | 理由 |
| --- | --- | --- | --- |
| ZIP 库（§4.1） | zip.js（固定版本） | 自研 `StoreZipWriter`（仅 STORE + Zip64，流式，约 4KB，单测含独立 ZIP 读取器校验） | zip.js 完整 IIFE 约 270KB，会占满 N-2 的 300KB 产物预算（实际产物 177KB），且其 worker 模式在 Tampermonkey 环境需额外配置；本项目只需要 STORE+Zip64 |
| §3.6 抓包核对 | 桌面 DevTools 抓包 | 读取原站前端代码包逐行核对（见 `docs/specs/site-probe-2026-10-24.md`） | 原站为 Vue SPA，代码包即接口事实来源；响应结构、签名头、排序算法、代理域名均已确认。真机层面的签名有效期、CORS、阅读记录副作用仍留给真机清单 |
| 章节切换（§3.2 约束 4） | 调用原站上一话/下一话按钮 | `sessionStorage` 返回标记 + 整页跳转 `/read/…`（返回后自动重进增强阅读器） | 不依赖原站 DOM 细节；行为一致且可测 |

### 自动化测试结果

- 单元测试：113 项通过（`npm test`），覆盖 §6.4 全部条目（url、chapters 快照、tap-zones 边界、gesture 状态机、naming、mime-sniff、crc32 标准向量、scheduler 并发/限流/取消/退避、progress 节流与淘汰、迁移导入导出、捕获层自包含性与包装行为、ZIP 读回校验）。
- e2e：9 项通过（`npm run e2e`，Pixel 7 视口 + 触摸），基于 harness 页（mock 适配器 + 故障注入中间件）：三模式挂载/切换/退出无残留（含 20 次进出清理表不增长）、横竖屏锚点、RTL 第 1 页在最右、点击区坐标、长章节预加载窗口（窗口外释放 src、返回不重挂载，R-C4）、404/429/HTML/过期重解析 → 未完成 → 部分导出（含报告与 ZIP 魔数校验）、刷新恢复不重复下载、暂停后无新请求。
- `npm run typecheck`（strict）与 `npm run lint` 零告警；产物 `dist/mangayun-reader.user.js` 178KB（N-2 达标）。

### 样本 ZIP（§6.1 交付物 4，harness 侧）

`samples/sample-single-chapter.zip`（单话）与 `samples/sample-multi-skip.zip`（跳选第 1、3 话）由
`npm run samples`（`scripts/make-samples.mjs`）驱动真实下载流水线生成；已用 PowerShell `Expand-Archive`
独立解包核验：目录/编号与基线规格 §7 一致（跳选保持 `0001/0003` 全局序号）、PNG 头正确、
`download-report.json` 与 §4.7 示例结构一致且未验证来源已标注。真机下载流程中的两枚样本仍需按 §6.1 在真机产生。

### 未完成（交付前必做）

- §6.5 安卓真机清单 T1–T19 全部未测（模板：`docs/specs/device-checklist.md`）；桌面移动视口不能替代真机结果。
- 真机下载流程产生的两枚样本 ZIP 及解包核对。
- 登录状态下隐藏 iframe 解析是否写阅读记录/书架进度（§3.3 待验证）未测。

### 增量（2026-10-25，真机反馈）

- 横向适配增强：新增设置 `horizontalFit`（auto/height/screen，默认 auto）。真机反馈竖屏看日漫时"按高度适配"整页被拉满且横向溢出、观感差；参考 Mihon 的 Fit screen/height 档位，auto 在竖屏自动改为"适应屏幕"（整页可见、页间 12px 间隙、垂直居中），横屏保持 R-J1 的"按高度适配、零间隙"。R-J1 的验收在横屏（该模式的预期使用姿态）下不变；竖屏整页可见属于补充行为。测试：e2e 第 10 项（竖屏 screen 生效、切换 height 生效）。
