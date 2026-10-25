# Release Closure and Reader UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver interoperable downloads, a polished mobile reader entry/settings UI, verified release artifacts, and a repository with only `main`.

**Architecture:** Keep the reader/controller/store boundaries. Extract settings rendering into its own UI module, add viewport-aware entry positioning, and harden the existing STORE/Zip64 writer. Work in the existing checkout and integrate into `main` only after review.

**Tech Stack:** TypeScript strict, Vite, vite-plugin-monkey, Vitest/jsdom, Playwright Chromium, Python standard-library ZIP verification.

## Global Constraints

- Every interactive target is at least 48 CSS pixels.
- Release version: 1.1.0, with `package.json` as the version source used by the userscript header and generated download report.
- Name pages `0001.ext`, `0002.ext`, etc.; preserve full-catalog chapter numbering.
- Partial exports retain the `.zip` extension (`name_partial.zip`).
- Preserve Shadow DOM isolation, reader layout, click-zone geometry, and existing data.
- Use local font fallbacks and inline SVG icons; do not fetch fonts, artwork, or other new third-party assets.
- Never force-push or delete unmerged history.
- Without a connected Android device, keep T1-T19 pending and state the limitation in release notes.

---

## Task 1: Standards-compliant download artifacts

**Files:** `src/utils/zip-store.ts`, `src/download/packer.ts`, `src/utils/naming.ts`, `tests/unit/zip-store.test.ts`, `tests/unit/download.test.ts`, `tests/unit/utils.test.ts`, `scripts/make-samples.mjs`, archive verification helpers/tests.

**Interfaces:** Keep `StoreZipWriter`, `ZipSink`, `MemorySink`, and `packToSink` public signatures. `PackPage.page` is zero-based internally; filenames and report page numbers are one-based. Import the release version from `package.json`.

- [ ] Add failing assertions for central-directory size and `writer.byteLength === emittedBytes.length`, real Zip64 entry-count boundary, one-based filenames, missing cached bytes, and `name_partial.zip`.
- [ ] Run `npm.cmd test -- tests/unit/zip-store.test.ts tests/unit/download.test.ts tests/unit/utils.test.ts`; record the expected failures before changing production code.
- [ ] Accumulate central records with `this.#offset += buf.length`; use correctly sized Zip64 extras and true 64-bit values; emit correct EOCD/locator metadata.
- [ ] Convert the filename input at the packing boundary with `pageFileName(page.page + 1, page.ext)`; reject absent cache data and preserve ZIP suffixes.
- [ ] Verify archives with an independent reader including filename lists, CRCs, compression method, page counts, and report correspondence. Strengthen the sample generator's verification without overwriting samples before successful verification.
- [ ] Re-run the targeted suite and review the diff. Root owns final sample regeneration and commits to avoid concurrent Git/index writes.

## Task 2: Reachable, accessible floating entry

**Files:** `src/ui/entry.ts`, `src/ui/entry-position.ts`, `src/ui/icons.ts`, `src/ui/styles.ts`, `src/store/settings.ts`, `src/main.ts`, `harness/main.ts`, `tests/unit/entry.test.ts`, `tests/e2e/settings.spec.ts`.

**Interfaces:** Preserve `FloatingEntry({onTap, loadPosition, savePosition})`, `show()`, and `hide()`. Extend position data with optional edge/vertical-ratio fields while accepting legacy pixel coordinates.

- [ ] Add failing unit cases for default placement, left/right snapping, legacy/offscreen/invalid values, viewport resize, drag suppression, keyboard activation, and listener cleanup.
- [ ] Run `npm.cmd test -- tests/unit/entry.test.ts` and confirm the behavioral failures.
- [ ] Add a pure positioning helper; clamp against visible viewport/safe-area bounds with a 52-pixel button, 12-pixel edge clearance, and bottom navigation clearance.
- [ ] Render a local SVG book icon; position the host with a normally positioned child; implement pointer capture, native click activation, persisted edge/ratio, and show/hide listener lifecycle.
- [ ] Add a harness entry route and browser assertions for dragging, reopening, and orientation changes. Re-run the targeted tests and inspect mobile screenshots.

## Task 3: Grouped mobile settings

**Files:** `src/ui/settings-panel.ts`, `src/ui/dom.ts`, `src/ui/icons.ts`, `src/ui/overlay.ts`, `src/ui/styles.ts`, `src/app.ts`, `src/reader/controller.ts`, `tests/unit/settings-panel.test.ts`, `tests/e2e/settings.spec.ts`.

**Interfaces:** Settings UI consumes existing `UIActions`; add explicit actions for download concurrency and entry-position reset. Preserve existing setters and their book/global scope. Overlay owns opening and closing the sheet.

- [ ] Add failing tests for Reading/Gestures/General tabs, labelled controls, 10% width increments, repeated preload steps, live tap-zone preview/presets, import errors, and setter calls.
- [ ] Run `npm.cmd test -- tests/unit/settings-panel.test.ts` and confirm failures.
- [ ] Extract the shared DOM helper and settings rendering. Use a fixed header/tab strip and scrollable card groups; preserve existing control options and data scope.
- [ ] Use native labelled controls with visible focus. Read current stepper values on each click and update `aria-pressed`/`aria-selected` consistently.
- [ ] Wire new actions through `createReaderApp`, release wake lock when turned off, and refresh live settings after a successful import.
- [ ] Add browser tests for persistent settings, previews, small-screen overflow, keyboard focus/close behavior, and reader anchor preservation. Inspect 360/412-pixel portrait, landscape, and desktop layouts.

## Task 4: Acceptance gaps and independent review

**Files:** download/lock regression tests as needed, `tests/e2e/download.spec.ts`, `playwright.config.ts`, review reports under ignored `.superpowers/`.

- [ ] Verify OPFS-to-IndexedDB fallback, bounded memory behavior, and same-task multi-tab locking using the actual cache/manager paths; add regressions where absent.
- [ ] Run all tests with a fresh harness server and no retry masking.
- [ ] Obtain an independent code review of the release changes. Fix important findings with reproducing tests and re-review them.

## Task 5: Release evidence and documentation

**Files:** `package.json`, `package-lock.json`, `vite.config.ts`, `README.md`, `docs/specs/requirements-and-plan.md`, `docs/specs/device-checklist.md`, release verification notes, `samples/`, `dist/mangayun-reader.user.js`.

- [ ] Synchronize version 1.1.0 and release documentation; distinguish fresh results from historical 1.0.0 evidence.
- [ ] Run `npm.cmd ci`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd test`, and `npm.cmd run e2e -- --retries=0` with `CI=1` for a fresh server.
- [ ] Run `npm.cmd run samples` and independently check both final ZIPs with Python `zipfile`, including CRC, naming, STORE, and report consistency.
- [ ] Build the userscript twice into separate directories; compare SHA-256, header version, and the 300 KB size target.
- [ ] Save visual-check evidence and complete the browser acceptance report. Explicitly list unavailable Android verification instead of marking it passed.

## Task 6: Preserve history and retain only main

**Files:** Git refs and release commit(s); no destructive filesystem operations.

- [ ] Fetch origin and inspect branch ancestry and the remote default branch.
- [ ] Commit all reviewed release changes. Create/check out local `main` and fast-forward or merge the feature branch while preserving history.
- [ ] Run the final verification on the integrated state; push `main` without force.
- [ ] Verify the remote main tip contains every feature-branch tip. Delete only the now-merged feature branch locally and remotely; ensure the remote default is `main`.
- [ ] Confirm `git status --short --branch`, `git branch -a`, and `git ls-remote --heads origin` show a clean checkout and only `main` branches. Report the exact commit and verification limits.
