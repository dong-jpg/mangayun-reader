/**
 * 增强阅读器全部样式（Shadow DOM 内，与原站隔离）。
 * 按钮 ≥48px、适配安全区（R-C9）；纵向防下拉刷新、横向零间隙等模式布局。
 */
export const STYLES = `
:host { all: initial }

.myr-root {
  position: fixed; inset: 0;
  display: none;
  font-family: system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
  color: #eee; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.myr-root.myr-open { display: block }
.myr-bg-black { background: #000 }
.myr-bg-gray { background: #3f3f46 }
.myr-bg-white { background: #fff }
.myr-bg-system { background: light-dark(#fff, #000) }

/* ---------- 阅读模式 ---------- */
.myr-mode-root { position: absolute; inset: 0; overflow: hidden }
.myr-scroll {
  position: absolute; inset: 0;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.myr-scroll::-webkit-scrollbar { display: none }
.myr-scroll-v { overflow-y: auto; overflow-x: hidden }
.myr-scroll-h { overflow-x: auto; overflow-y: hidden; white-space: nowrap }
.myr-rtl { direction: rtl }

.myr-strip-v {
  display: flex; flex-direction: column;
  min-height: 100%;
}
.myr-strip-v > .myr-page { width: 100% }

.myr-strip-h {
  display: inline-flex; flex-direction: row;
  height: 100%;
  gap: 0;
}
.myr-rtl .myr-strip-h { flex-direction: row } /* direction:rtl 控制顺序 */
.myr-strip-h > .myr-page { height: 100%; width: auto; flex: 0 0 auto }
.myr-strip-h > .myr-page img { height: 100%; width: auto; display: block }

/* 横向“适应屏幕”适配（竖屏手机）：整页可见、页间留隙、垂直居中 */
.myr-h-screen .myr-strip-h {
  align-items: center;
  gap: 12px;
  padding: 0 6px;
}
.myr-h-screen .myr-strip-h > .myr-page {
  height: auto; width: auto; /* 尺寸由脚本按比例设定 */
}
.myr-h-screen .myr-strip-h > .myr-page img {
  height: 100%; width: 100%; object-fit: contain; display: block;
}
.myr-h-screen .myr-edge-card-h { height: auto; min-height: 40vh; align-self: center }

.myr-page { position: relative; background: inherit }
.myr-page img {
  display: block; width: 100%; height: 100%;
  object-fit: contain;
  background: transparent;
}
.myr-strip-h > .myr-page img { object-fit: fill } /* 高度适配，按比例占位 */

/* 加载占位 */
.myr-page { background-image: none }
.myr-page:not(.myr-page-error) { min-height: 40px }

/* 失败重试 */
.myr-page-error { outline: 1px dashed #666; min-height: 160px;
  display: flex; align-items: center; justify-content: center }
.myr-page-retry {
  position: absolute; inset: 0; z-index: 3;
  display: flex; gap: 12px; align-items: center; justify-content: center;
  flex-wrap: wrap; padding: 12px;
}
.myr-page-retry button {
  min-width: 96px; min-height: 48px; border-radius: 10px;
  border: 1px solid #777; background: #222; color: #eee; font-size: 14px;
}

/* 章首/章尾卡片 */
.myr-edge-card {
  display: flex; align-items: center; justify-content: center;
  padding: 32px 16px; width: 100%;
}
.myr-edge-card-h { min-width: 60vw; height: 100% }
.myr-edge-card button {
  min-width: 128px; min-height: 56px; border-radius: 12px;
  border: 1px solid #666; background: #1c1c1e; color: #eee; font-size: 15px;
}

/* ---------- 单页模式 ---------- */
.myr-single { position: absolute; inset: 0; overflow: hidden; display: flex }
.myr-single-viewport {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  transform-origin: 0 0;
  transition: none;
}
.myr-single .myr-page {
  position: absolute; inset: 0;
  display: none; align-items: center; justify-content: center;
  margin: auto;
}
.myr-single .myr-page.myr-active { display: flex }
.myr-single .myr-page img { width: auto; height: auto; max-width: none; max-height: none; object-fit: none }
.myr-fit-screen .myr-page img { max-width: 100%; max-height: 100%; object-fit: contain }
.myr-fit-width .myr-page img { width: 100%; height: auto; object-fit: contain }
.myr-fit-height .myr-page img { height: 100%; width: auto; object-fit: contain }
.myr-fit-original .myr-page img { width: auto; height: auto }

/* ---------- 工具栏 ---------- */
.myr-toolbar {
  position: absolute; inset: 0;
  pointer-events: none;
  display: flex; flex-direction: column; justify-content: space-between;
  opacity: 0; transition: opacity .18s ease;
  z-index: 10;
}
.myr-toolbar.myr-visible { opacity: 1 }
.myr-toolbar.myr-visible .myr-bar { pointer-events: auto }
.myr-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px max(10px, env(safe-area-inset-left)) calc(8px) max(10px, env(safe-area-inset-right));
  padding-top: max(8px, env(safe-area-inset-top));
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  background: rgba(16, 16, 18, .92);
  backdrop-filter: blur(8px);
  flex-wrap: wrap;
}
.myr-bar-bottom { row-gap: 6px }
.myr-btn {
  min-width: 48px; min-height: 48px; padding: 0 14px;
  border-radius: 10px; border: 1px solid #3a3a3e;
  background: #232326; color: #eee; font-size: 14px;
  cursor: pointer;
}
.myr-btn:active { background: #333338 }
.myr-btn-primary { background: #2f6fed; border-color: #2f6fed; color: #fff }
.myr-btn-small { min-width: 40px; min-height: 40px; padding: 0 10px; font-size: 13px }
.myr-seg-active { background: #3a5bcc; border-color: #5a78e0; color: #fff }
.myr-title {
  flex: 1; text-align: center; font-size: 15px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.myr-cluster { display: flex; gap: 6px; align-items: center; flex-wrap: wrap }
.myr-slider-row {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding-top: 2px;
}
.myr-page-label { font-variant-numeric: tabular-nums; font-size: 13px; min-width: 64px }
.myr-page-slider { flex: 1; height: 40px; accent-color: #5a8bf5 }

/* ---------- 面板 / 弹层 ---------- */
.myr-sheet-wrap {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: flex-end; justify-content: center;
  background: rgba(0, 0, 0, .45);
}
.myr-sheet-wrap.myr-center { align-items: center; padding: 24px }
.myr-sheet {
  width: 100%; max-width: 560px;
  background: #1b1b1e; color: #eee;
  border-radius: 16px 16px 0 0;
  padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
  max-height: 78vh; display: flex; flex-direction: column;
}
.myr-center .myr-sheet { border-radius: 16px }
.myr-sheet-tall { height: 68vh }
.myr-sheet-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px }
.myr-sheet-title { flex: 1; font-size: 16px; font-weight: 600 }
.myr-sheet-body { overflow-y: auto; flex: 1; padding-bottom: 6px }
.myr-sheet-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; flex-wrap: wrap }

/* 目录 */
.myr-catalog-list { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 }
.myr-catalog-item {
  min-height: 48px; text-align: left; padding: 0 14px;
  border-radius: 10px; border: 1px solid #2c2c30;
  background: #232327; color: #ddd; font-size: 14px;
  cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.myr-catalog-now { background: #2c3f78; border-color: #40559b; color: #fff }

/* 设置 */
.myr-settings-group { margin-bottom: 14px }
.myr-settings-label { font-size: 13px; color: #aaa; margin-bottom: 6px }
.myr-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.myr-wrap { flex-wrap: wrap }
.myr-value { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums }
.myr-mini-label { font-size: 13px; min-width: 34px }
.myr-toggle-row { display: flex; align-items: center; justify-content: space-between }
.myr-toggle-row .myr-settings-label { margin: 0 }
.myr-toggle-row input { width: 22px; height: 22px; accent-color: #5a8bf5 }
.myr-select {
  min-height: 44px; border-radius: 8px; padding: 0 8px;
  border: 1px solid #3a3a3e; background: #232326; color: #eee; font-size: 13px;
}
.myr-file-label { position: relative; overflow: hidden; display: inline-flex; align-items: center }
.myr-file-label input {
  position: absolute; inset: 0; opacity: 0;
  width: 100%; height: 100%; cursor: pointer;
}

/* 点击区示意图（与 tap-zones 几何一致） */
.myr-zone-preview {
  width: 220px; aspect-ratio: 9 / 16; margin: 0 auto 8px;
  display: flex; flex-direction: column;
  border: 1px solid #3a3a3e; border-radius: 10px; overflow: hidden;
}
.myr-zone {
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: #ccc; background: #232327;
  border: 1px solid #2c2c30;
}
.myr-zone-top, .myr-zone-bottom { flex: 0 0 20%; width: 100% }
.myr-zone-mid { flex: 1; display: flex }
.myr-zone-left, .myr-zone-right { flex: 0 0 30%; height: 100%; writing-mode: vertical-rl }
.myr-zone-center { flex: 1; background: #2c3f78; color: #fff }

/* 加载 / Toast */
.myr-loading {
  position: absolute; inset: 0; z-index: 30;
  display: flex; flex-direction: column; gap: 14px;
  align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .6);
}
.myr-spinner {
  width: 36px; height: 36px; border-radius: 50%;
  border: 3px solid #444; border-top-color: #7c9bff;
  animation: myr-spin .9s linear infinite;
}
@keyframes myr-spin { to { transform: rotate(360deg) } }
.myr-loading-text { font-size: 14px; color: #ccc }
.myr-toast {
  position: absolute; left: 50%; bottom: calc(96px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  background: rgba(20, 20, 22, .95); color: #eee;
  padding: 10px 18px; border-radius: 10px; font-size: 13px;
  z-index: 40; pointer-events: none; white-space: nowrap;
}

/* ---------- 下载面板 ---------- */
.myr-dl-scope-row { display: flex; gap: 8px; margin: 8px 0 }
.myr-dl-list {
  max-height: 34vh; overflow-y: auto; margin: 8px 0;
  display: flex; flex-direction: column; gap: 4px;
  border: 1px solid #2c2c30; border-radius: 10px; padding: 8px;
}
.myr-dl-chapter {
  display: flex; align-items: center; gap: 8px;
  min-height: 44px; font-size: 13px; color: #ddd;
}
.myr-dl-chapter input { width: 20px; height: 20px; accent-color: #5a8bf5 }
.myr-dl-chapter span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.myr-dl-progress { margin: 10px 0 }
.myr-dl-bar { height: 8px; border-radius: 4px; background: #2c2c30; overflow: hidden }
.myr-dl-bar > div { height: 100%; background: #2f6fed; transition: width .2s }
.myr-dl-meta { display: flex; justify-content: space-between; font-size: 12px; color: #aaa; margin-top: 4px }
.myr-dl-fail-list { font-size: 12px; color: #e6a23c; max-height: 20vh; overflow-y: auto }
.myr-dl-status { font-size: 13px; margin: 6px 0 }

/* ---------- 悬浮入口（R-C1） ---------- */
.myr-entry {
  position: fixed; z-index: 2147483646;
  min-width: 52px; min-height: 52px; border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, .35);
  background: rgba(20, 20, 24, .82); color: #fff;
  font-size: 13px; display: flex; align-items: center; justify-content: center;
  padding: 0 14px; cursor: pointer; user-select: none;
  box-shadow: 0 2px 10px rgba(0, 0, 0, .4);
  touch-action: none;
}
`
