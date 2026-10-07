# Phase 108 (Workspace Rail) — Chunk E phase-close QA verdict evidence (TFL-919)

Run 2026-10-05, agent qa (2fdc7fcc), pinned model openrouter/deepseek/deepseek-v4.1-flash.
All commands from repo root. Mutex acquired then released.

## Commands and results

1. `npm.cmd run build:renderer` -> vite build green (2693 modules, built in 816ms).
2. `npm.cmd run test:e2e -- e2e/phase108_siderail.spec.cjs` -> 3 passed (34.7s).
   - (a) stages=["pages","edit","review","deliver"] names=["Pages stage","Edit stage","Review stage","Deliver stage"]
   - (b) {"railW":72,"pad":"12px 8px","btnMin":"60px","radius":"10px","navSvg":22,"gearSvg":18,"gearMin":"48px"}
   - (c) labels visible at 1440 and 900 (5 labels, display!=none, width>0)
   - (d) marker {"content":"\"\"","width":"3px","height":"20px","left":"2px","top":"20px","radius":"2px","bg":"rgb(124, 58, 237)"}
   - (e) click + Ctrl+1..4 switch; gear preserves active=review; railSwitchMs=24
   - (f) 1440/1100/900 expanded+collapsed: railRight 72, panelLeft 72, abut 0, overlapPanel 0, overlapScroller <= 0 (no overlap)
   - (g) 640x480: all four stages inList=true inWindow=true h=60; gear box y=404 h=56 fully in window
   - (h) contrast light inactive 7.96 / selected 4.73; dark inactive 8.59 / selected 6.59 (all >= budget)
3. `npm.cmd run test:unit -- <7 named specs + buttonSystem + phase40_palettePinToggle>` -> 9 files / 143 tests passed.
4. `npm.cmd run verify` -> conventions clean (379 source files), tsc 0 errors.
5. `npm.cmd run test:e2e -- e2e/phase36_chunk1_rail_gate.spec.cjs` -> 1 failed.
   Failure at :89 setSize(1000,800) waiting for data-stage-rail-compact=true.
   Cause: this spec's local setSize (lines 84-87) does NOT unmaximize; the host launches
   the window maximized, so setSize is ignored and innerWidth stays >=1100. Steps 1-5 of
   the same spec (four stages, order, aria, click switch, Ctrl+1..4, chord guard, gear ->
   prefs) all passed before the resize oracle. Environmental, not a Phase 108 regression.

## Shared-token integrity

`git diff -- src/renderer/styles.css` changed no definition of --accent, --accent-text,
--accent-soft, --accent-selected, --tf-icon-rest, --tf-icon-active, --bg-rail,
--border-subtle, --divider, --fg-muted, --fg-strong or --glass-sidebar-bg.
Only new rail-scoped tokens were added: --tf-siderail-surface|selected-surface|item-radius|
utility-min|marker-radius|utility-icon (light #FFFFFF / #F0EBFC, dark #20232B / #302740,
frosted var(--glass-sidebar-bg) / var(--accent-soft)).

## Ledger state

DEF-578 CLOSED, DEF-584 CLOSED, DEF-585 CLOSED, DEF-586 CLOSED.
ADV-218/219/220 dispositioned ACCEPTED -> DEF-584/585/586 (ID-collision note in DEFECTS.md).
No Phase 108 entry OPEN or DISPUTED.

## Screenshots (this run)

screenshots/phase108-rail-light.png, -dark.png, -narrow-light.png, -dark-narrow.png,
-short-light.png, -forced-colors.png. Inspected against
Visual overhaul/Siderail/Visuals/rail-light.png, rail-dark.png, rail-narrow-dark.png.
