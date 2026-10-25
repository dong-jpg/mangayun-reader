# MangaYun Reader

面向安卓 Chromium 系浏览器和 Tampermonkey 的漫画阅读增强脚本项目，适配 <https://mangayun.com>。

## 项目状态

首版（v1.0.0）已实现：三种阅读模式、手势与点击区、进度记忆、单话/多话/整部下载（一个 ZIP）。
单元测试 113 项、Playwright e2e 8 项全部通过（Pixel 7 视口 + 触摸仿真，基于本地 harness 页）；
**安卓真机清单（方案 §6.5）尚未执行**，交付验收前需在真机上逐项确认。

## 安装

- 仓库内置构建产物 [dist/mangayun-reader.user.js](dist/mangayun-reader.user.js)（约 177 KB）。
  安卓 Tampermonkey 中通过 raw 链接安装（如托管在 GitHub 时访问该文件的 raw 地址），或在桌面浏览器拖入安装。
- 需要 Tampermonkey（或兼容管理器）。不支持 Violentmonkey 的部分 GM API 场景未验证。

## 功能

- 日漫横向连续阅读（左→右 / 右→左，右→左只改变排列与前进方向，不镜像图片）。
- 韩漫纵向连续阅读，宽度 50%～100% 可调，进度记忆到页内比例（长条图中部可恢复）。
- 普通单页阅读，上/下/左/右四区点击可配置（含预设与一键反转），中央呼出菜单；脚本自管双指缩放，放大时拖动只平移。
- 目录跳转（正序/倒序）、页码与进度滑块、全屏、背景色、屏幕常亮、章首/章尾切话卡片、键盘操作。
- 下载当前话/勾选多话/整部 → 单个 ZIP（STORE 不压缩），文件夹与页序按目录正序编号（至少 4 位），扩展名按文件头判定，
  含 `download-report.json`；支持暂停/继续/取消、有限重试（1s/3s+抖动）、429/503 限流退避（遵守 Retry-After）、
  失败清单与部分导出（`_partial`）、刷新后恢复任务（不重复下载）、Web Locks 单标签页执行。
- 存储：OPFS 流式 → IndexedDB → 内存模式（上限 100 MiB）逐级回退。

## 权限说明

`@match https://mangayun.com/*`；GM 存储四项 + `GM_xmlhttpRequest`/`GM_download`（跨域图片回退与保存）；
`@connect` 仅列出实测图片域名，未列出的域名由 Tampermonkey 弹窗询问。不读取登录令牌 `ym_auth_token`，无遥测，数据只存本地。

## 已知限制

- comicbox 打乱来源：回退原站阅读器、不支持下载（勾选阶段拦截）。
- 图片地址过期依赖重新加载章节页面（隐藏 iframe）刷新，不调用带签名的接口。
- 不承诺后台持续下载、任意大小 ZIP 或站点清数据后的任务恢复；签名地址有效期等仍以真机实测为准。
- 站点前端发版可能改变接口/排序/代理规则（核对记录见 [docs/specs/site-probe-2026-10-24.md](docs/specs/site-probe-2026-10-24.md)）。

## 开发

```bash
npm install
npm run dev            # 用户脚本开发模式（Tampermonkey 指向本地）
npm run build          # 构建 dist/mangayun-reader.user.js
npm test               # 单元测试（Vitest + jsdom）
npm run e2e            # Playwright e2e（自动构建并预览 harness 页）
npm run typecheck      # tsc --noEmit（strict）
npm run lint           # ESLint
npm run build:harness  # 构建 harness 验收页
```

harness（`harness/`）是不访问真实站点的本地验收页：mock 适配器 + 服务端确定性生成 PNG +
故障注入端点（404、429+Retry-After、HTML 伪装、过期后重解析），驱动与用户脚本完全相同的 app 装配（`src/app.ts`）。

## 文档

- [需求分析与实现方案](docs/specs/requirements-and-plan.md)：需求编号与验收标准、技术设计、里程碑（含实现记录）
- [手机优先设计](docs/superpowers/specs/2026-10-23-mobile-reader-design.md)：基线规格
- [站点适配核对记录](docs/specs/site-probe-2026-10-24.md)：接口、排序规则、代理域名（读原站前端代码所得）

## 兼容性原则

不依赖桌面的保存文件选择器，不需要额外服务器。根据浏览器实际提供的存储和下载能力选择实现路径。
仅处理用户正常可访问的资源，不绕过登录、付费或其他访问限制；不复刻原站请求签名，只读取原站自己发出的请求结果。
