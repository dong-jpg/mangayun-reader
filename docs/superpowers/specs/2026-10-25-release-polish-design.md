# Release Closure and Reader UI Polish

Date: 2026-10-25
Baseline: `79d315f` (`codex/mobile-first`, userscript 1.0.4).

The user requested direct implementation, including release fixes, the floating
entry, settings usability, and consolidation onto `main`. Implementation proceeds
without another design approval round.

## Goals

1. Produce interoperable ZIP downloads with one-based page filenames and reports
   that never claim success when cached data is missing.
2. Replace the two-line floating badge with a compact, recognizable book icon.
   Position it near the lower-right edge by default, support dragging and edge
   snapping, and keep it reachable after viewport changes.
3. Make settings usable with one hand: clear hierarchy, three tabs, immediate
   persistence, properly labelled controls, and a useful tap-zone preview.
4. Verify the finished source and release artifacts independently, preserve the
   distinction between browser emulation and actual Android verification, and
   retain only `main` without discarding any unique commits.

## Visual Direction

Keep the established dark reader and blue accent instead of an unrelated redesign.
Use layered ink surfaces, restrained blue highlights, clear Chinese typography,
subtle borders, and a small amount of sheet-entry motion. Use local font fallbacks
and inline SVG icons; do not fetch fonts, artwork, or other new third-party assets.

A long ungrouped settings sheet remains difficult to scan. A separate full-screen
settings route adds navigation and risks disturbing the current reading position.
The chosen approach is a large bottom sheet with Reading, Gestures, and General
tabs, a fixed header, an independently scrolling content area, and desktop width
constraints. Settings changes must preserve the reader's existing logical anchor.

## Floating Entry

- A 52 CSS-pixel book-icon button; accessible name identifies enhanced reading.
- Position the host, not a separately fixed child. Account for safe areas and the
  visible viewport; default near the right edge and above browser/system controls.
- Drag movement does not activate the reader. On release, snap to the nearest
  horizontal edge and persist side and relative vertical position.
- Read legacy `{x, y}` positions safely; invalid or offscreen values fall back to
  clamped defaults. Rotate/resize without losing the preferred side or ratio.
- Support native keyboard activation and visible keyboard focus. Clean up resize
  and visual-viewport listeners when hidden. Keep route visibility correct.

## Settings

- Reading: reader mode, width, horizontal fit, inter-page gap, single-page fit,
  and background. Preserve all existing options and their persistence scopes.
- Gestures: current four-zone preview, individually labelled mappings, presets,
  explicit left/right reversal, and the continuous-mode tap toggle.
- General: preloading, download concurrency, wake lock, automatic entry,
  floating-entry reset, and settings import/export.
- Every interactive target is at least 48 CSS pixels. Tabs expose selected state,
  panels expose their labels, and controls work with keyboard input.
- Stepper values derive from current values on every activation, not a captured
  initial value. Width uses the specified 10% increment. Boolean controls use
  labelled switch semantics. Unsupported wake lock remains harmless.
- Preserve Shadow DOM isolation, reader layout, click-zone geometry, and existing
  data. Extract settings rendering from the large overlay module rather than
  growing that module further.

## Download Closure

- Track all bytes emitted into central-directory records and write valid EOCD
  and Zip64 sizes, offsets, and counts. Byte-length reporting matches actual output.
- Name pages `0001.ext`, `0002.ext`, etc.; preserve full-catalog chapter numbering.
- Partial exports retain the `.zip` extension (`name_partial.zip`).
- Missing cached bytes must fail packing rather than silently omitting a page and
  returning a complete report.
- Test with an independent standard ZIP reader, not only the writer's companion
  parser. Regenerate both single-chapter and skipped-chapter samples.

## Release and Branches

- Release version: 1.1.0, with `package.json` as the version source used by the
  userscript header and generated download report.
- Run unit tests, browser tests, strict type checking, lint, a clean-dependency
  build, independent archive verification, and mobile/desktop visual inspection.
- Fill only observations actually verified. Without a connected Android device,
  keep T1-T19 pending and state the limitation in release notes.
- Inspect local/remote branch tips and ancestry. Commit the work, integrate all
  valid history into `main`, push `main`, verify remote state, and only then remove
  redundant feature branches. Never force-push or delete unmerged history.

## Non-goals

No new sites, cloud sync, automatic translation, image transformations, publishing
to a userscript marketplace, or authentication changes. Do not claim Android
runtime validation from a desktop mobile viewport.
