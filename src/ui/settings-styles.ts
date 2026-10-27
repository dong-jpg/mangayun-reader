export const SETTINGS_STYLES = `
.myr-settings-wrap {
  background: #050a1499; backdrop-filter: blur(8px);
  padding: max(12px, env(safe-area-inset-top)) env(safe-area-inset-right) 0 env(safe-area-inset-left);
}
.myr-sheet.myr-settings {
  width: 100%; max-width: 640px; height: min(88dvh, 860px);
  max-height: calc(100dvh - max(12px, env(safe-area-inset-top)));
  padding: 0; overflow: hidden; border: 1px solid #5e739444;
  border-bottom: 0; border-radius: 26px 26px 0 0;
  background: linear-gradient(155deg, #202c3e 0, var(--myr-ink) 250px);
  box-shadow: 0 -18px 70px #0005;
  color: var(--myr-text); color-scheme: dark;
  font-family: "MiSans", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px; line-height: 1.5;
  animation: myr-settings-in .2s ease-out both;
}
.myr-settings h2, .myr-settings h3, .myr-settings p { margin: 0 }
.myr-sheet-grip { flex-shrink: 0; width: 34px; height: 4px; margin: 9px auto 0; border-radius: 4px; background: #a4b7d045 }
.myr-settings-header { display: flex; align-items: center; gap: 12px; padding: 17px 20px 18px; flex-shrink: 0 }
.myr-settings-mark {
  width: 43px; height: 43px; display: grid; place-items: center; flex: 0 0 auto;
  background: linear-gradient(140deg, #9fc3ff24, #9fc3ff06); color: var(--myr-accent);
  border: 1px solid #9fc3ff38; border-radius: 14px;
}
.myr-settings-mark .myr-icon { width: 25px; height: 25px }
.myr-settings-heading { flex: 1; min-width: 0 }
.myr-settings .myr-eyebrow { display: block; font-size: 9px; font-weight: 700; letter-spacing: .16em; color: var(--myr-accent); margin-bottom: 3px }
.myr-settings h2 { font-size: 22px; font-weight: 650; letter-spacing: .02em; line-height: 1.35 }
.myr-settings .myr-icon-button { padding: 0; width: 48px; height: 48px; display: grid; place-items: center; background: #ffffff05 }
.myr-settings .myr-btn, .myr-settings .myr-select {
  min-height: 48px; min-width: 48px; border-color: var(--myr-line);
  font: inherit; color: var(--myr-text); background: #202a39; border-radius: 12px;
}
.myr-settings .myr-btn { padding: 0 14px; touch-action: manipulation }
.myr-settings .myr-btn:hover { background: #2c394d }
.myr-settings .myr-btn:active { background: #354962 }
.myr-settings .myr-btn-primary { color: #12233e; background: var(--myr-accent); border-color: transparent; font-weight: 650 }
.myr-settings .myr-btn-primary:hover { background: #bed6ff }
.myr-settings .myr-btn:disabled { opacity: .3; cursor: default }
.myr-settings :is(button, input, select):focus-visible { outline: 3px solid var(--myr-accent); outline-offset: 3px }
.myr-settings-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: 0 20px 16px; padding: 4px; border: 1px solid #4b5c7433; border-radius: 16px; background: #0a101b70; flex-shrink: 0 }
.myr-settings-tab { min-height: 48px; min-width: 48px; padding: 0 12px; border: 0; border-radius: 11px; background: transparent; color: var(--myr-muted); font: inherit; font-weight: 600; cursor: pointer }
.myr-settings-tab[aria-selected="true"] { background: #344e72; color: #edf4ff; box-shadow: 0 2px 6px #0002, inset 0 1px 0 #a5c8ff25 }
.myr-settings-body { min-height: 0; padding: 0; border-top: 1px solid #819cc21c; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #40516b transparent }
.myr-settings-content { display: flex; flex-direction: column; gap: 16px; padding: 20px }
.myr-section-caption { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 600; color: #b9c9df }
.myr-scope-tag { font-size: 10px; font-weight: 500; padding: 3px 8px; border-radius: 6px; background: #8fa9d013; color: #9daec6 }
.myr-mode-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: -6px }
.myr-mode-card {
  min-height: 104px; min-width: 0; padding: 14px 6px 12px; cursor: pointer;
  border: 1px solid #344052; border-radius: 15px; background: #1e2836;
  color: #b4c2d5; display: flex; flex-direction: column; align-items: center; gap: 5px; font: inherit;
}
.myr-mode-card > .myr-icon { margin-bottom: 3px; width: 25px; height: 25px }
.myr-mode-card[aria-pressed="true"] { color: #dbeaff; border-color: #9fc3ff; background: linear-gradient(150deg, #385478, #24394f); box-shadow: inset 0 0 0 1px #9fc3ff20 }
.myr-mode-name { font-size: 13px; font-weight: 650 }
.myr-mode-note { font-size: 10px; color: #9fb3cd }
.myr-settings-card { padding: 16px; border: 1px solid #8a9cbb1c; border-radius: 17px; background: #202a387a }
.myr-card-heading { margin-bottom: 14px }
.myr-settings h3 { font-size: 15px; font-weight: 650; color: #edf3fc; margin-bottom: 4px }
.myr-setting-hint { display: block; font-size: 12px; font-weight: 400; line-height: 1.65; color: var(--myr-muted); overflow-wrap: anywhere }
.myr-setting-title { display: block; font-size: 13px; line-height: 1.5; font-weight: 550; color: #e5ecf6 }
.myr-setting-segments { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px }
.myr-settings .myr-setting-choice { padding: 8px 5px; min-width: 0; font-size: 12px }
.myr-settings .myr-setting-choice[aria-pressed="true"] { color: #d5e7ff; border-color: #94b9f0; background: #354c6a }
.myr-setting-segments.myr-two-columns { grid-template-columns: repeat(2, minmax(0, 1fr)) }
.myr-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 64px; padding: 12px 0; cursor: pointer }
.myr-setting-row + .myr-setting-row, .myr-setting-segments + .myr-setting-row { border-top: 1px solid #8a9cbb1c }
.myr-setting-segments + .myr-setting-row { margin-top: 14px; padding-bottom: 0 }
.myr-card-heading + .myr-setting-row { padding-top: 0 }
.myr-setting-row:last-child { padding-bottom: 0 }
.myr-setting-copy { flex: 1; min-width: 0 }
.myr-setting-copy .myr-setting-hint { margin-top: 3px }
.myr-switch { position: relative; width: 52px; height: 48px; flex: 0 0 52px }
.myr-switch input { position: absolute; inset: 0; width: 52px; height: 48px; margin: 0; opacity: 0; cursor: pointer; z-index: 1 }
.myr-switch-track { position: absolute; top: 10px; left: 2px; width: 48px; height: 28px; border-radius: 18px; background: #435066; pointer-events: none }
.myr-switch-track::after { content: ''; position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: 50%; background: #d3deee }
.myr-switch input:checked + .myr-switch-track { background: var(--myr-accent) }
.myr-switch input:checked + .myr-switch-track::after { transform: translateX(20px); background: #1b3150 }
.myr-switch input:focus-visible + .myr-switch-track { outline: 3px solid var(--myr-accent); outline-offset: 4px }
.myr-width-control { display: flex; align-items: center; gap: 16px }
.myr-width-slider { width: 100%; flex: 1; min-width: 0; height: 48px; margin: 0; accent-color: var(--myr-accent); cursor: pointer }
.myr-width-value { min-width: 59px; padding: 6px 8px; text-align: center; border-radius: 9px; background: #9fc3ff14; color: #c1d9ff; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums }
.myr-range-legend { display: flex; justify-content: space-between; padding-right: 76px; font-size: 10px; color: #8d9db4 }
.myr-backgrounds { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px }
.myr-settings .myr-backgrounds .myr-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 12px 2px; font-size: 11px }
.myr-color-swatch { width: 24px; height: 24px; border-radius: 50%; border: 1px solid #8195b0; display: block }
.myr-swatch-black { background: #000 }
.myr-swatch-gray { background: #3f3f46 }
.myr-swatch-white { background: #f5f5f4 }
.myr-swatch-system { background: linear-gradient(90deg, #e9eef5 50%, #15202e 50%) }
.myr-settings .myr-settings-note { text-align: center; color: #8b9bb1; font-size: 11px; line-height: 1.7; padding: 0 8px }
.myr-stepper-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0 }
.myr-stepper-row + .myr-stepper-row { border-top: 1px solid #8a9cbb1c }
.myr-stepper { display: flex; align-items: center; gap: 3px; flex: 0 0 auto }
.myr-settings .myr-stepper-button { width: 48px; height: 48px; padding: 0; font-size: 21px; font-weight: 400; background: #121b28 }
.myr-stepper-value { min-width: 32px; text-align: center; font-variant-numeric: tabular-nums; font-size: 16px }
.myr-settings .myr-text-button { flex: 0 0 auto; font-size: 12px; padding: 0 10px; color: var(--myr-accent); background: #9fc3ff0b }
.myr-backup-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px }
.myr-backup-actions .myr-btn { justify-content: center }
.myr-settings .myr-file-label { min-height: 50px }
.myr-file-label:focus-within { outline: 3px solid var(--myr-accent); outline-offset: 3px }
.myr-zone-editor { display: grid; grid-template-columns: 124px minmax(0, 1fr); align-items: center; gap: 18px; margin: 16px 0 20px }
.myr-settings .myr-zone-preview { width: 124px; margin: 0; border-radius: 15px; border: 1px solid #536981; box-shadow: 0 6px 14px #0002 }
.myr-settings .myr-zone { background: #24334a; border-color: #354d6d; color: #c8d9f0; font-size: 10px }
.myr-settings .myr-zone-center { color: #17263e; background: #9fc3ff; font-weight: 650 }
.myr-zone-mappings { display: flex; flex-direction: column; gap: 8px; min-width: 0 }
.myr-zone-mapping { display: flex; align-items: center; gap: 8px; min-width: 0 }
.myr-zone-mapping > span { font-size: 12px; color: var(--myr-muted) }
.myr-zone-mapping .myr-select { width: 100%; min-width: 0; font-size: 12px; padding: 0 6px; background: #15202e }
.myr-preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px }
.myr-settings .myr-preset-grid .myr-btn, .myr-settings .myr-setting-tools .myr-btn { padding: 0 6px; font-size: 12px }
.myr-setting-tools { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px }
.myr-gesture-note { display: flex; gap: 12px; align-items: center; padding: 0 6px; color: #8fa7c8 }
.myr-gesture-note p { font-size: 11px; line-height: 1.8 }
.myr-gesture-note .myr-icon { width: 24px; height: 24px }
.myr-settings-footer { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 20px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid #8a9cbb20; background: #172130; flex: 0 0 auto }
.myr-saved-indicator { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #a9bbd4 }
.myr-saved-indicator .myr-icon { width: 16px; height: 16px; color: var(--myr-accent) }
.myr-settings-footer .myr-btn { min-width: 96px }
@keyframes myr-settings-in { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: translateY(0) } }
@media (min-width: 768px) {
  .myr-settings-wrap { align-items: center; padding: 24px }
  .myr-sheet.myr-settings { height: min(840px, calc(100dvh - 48px)); max-height: calc(100dvh - 48px); border-radius: 24px; border-bottom: 1px solid #5e739444; box-shadow: 0 30px 100px #0007 }
  .myr-settings .myr-sheet-grip { display: none }
  .myr-settings-header { padding-top: 22px }
}
@media (max-width: 374px) {
  .myr-settings-content { padding: 16px }
  .myr-settings-card { padding: 14px }
  .myr-zone-editor { grid-template-columns: 112px minmax(0, 1fr); gap: 12px }
  .myr-settings .myr-zone-preview { width: 112px }
  .myr-settings-header { padding-inline: 16px }
  .myr-settings-tabs { margin-inline: 16px }
}
@media (max-height: 500px) {
  .myr-sheet.myr-settings { height: calc(100dvh - 12px); max-height: calc(100dvh - 12px) }
  .myr-settings-header { padding-block: 8px }
  .myr-settings .myr-eyebrow, .myr-settings .myr-sheet-grip { display: none }
  .myr-settings-tabs { margin-bottom: 8px }
  .myr-settings-footer { padding-block: 8px }
}
@media (prefers-reduced-motion: reduce) {
  .myr-settings, .myr-entry { animation: none !important; transition: none !important }
}
`
