# Jovrel workflow and regression review — 8 October 2026

Live inspection of the installed **Jovrel 1.51.1** at `C:\Program Files\Jovrel\Jovrel.exe`. This is a fresh review of the newer build, not a restatement of the previous 1.51.0 findings.

- [Audit](audit.md): 12 actionable findings, with reproduction steps, priority, evidence and limits.
- [Orchestrator prompt](orchestrator-prompt.md): implementation order and acceptance criteria.
- `Evidence/`: 21 screenshots with corresponding accessibility snapshots. These include passing states as well as defects.
- `manifest.csv`: SHA-256 hashes for the packaged files.

## What was inspected

Home and recent documents; a 34-page report; search/replace and no-results states; print configuration and validation; crop defaults and dialog scrolling; invalid and valid page navigation; maximized and restored windows; compact inspector and navigator drawers; preferences categories; Book View entry, next-page and exit.

The restored window screenshot measured approximately 997 × 658 pixels; the maximized capture was 2560 × 1440 pixels. These are capture dimensions, not verified CSS pixels or Windows DIPs. Display scaling was not changed. No frame-time or GPU profiling was performed.

No PDF changes, crop, replacement, export or print job were committed. Print and crop dialogs were cancelled; preferences were inspected without changing their values. The app was left open with report.pdf at page 11 and the window maximized. Reversible navigation and opening the report can update session/recent-document state.

## Improvements observed

The zero-document Home has an inset brand, no empty tab band, no sample gallery and no save controls. Recent-file details align and the bundled fixture recents no longer show the false Missing state seen previously. The dock uses **All commands** instead of **Tools**. Restoring the window preserved page 10; the compact inspector opens as a drawer, the context drawer opens and switches to Outline, and the application menu stays within the compact window. The animation preference now explains its scope clearly.

Search highlights a match, reports no results and disables unavailable navigation/replacement actions; Escape closes it. Print rejects a blank custom range and page 999 with a specific out-of-range message; range 2–3 shows two pages/two sheets, and two-up changes the count to one sheet. Book View entered on page 10, advanced to page 11 and returned the editor to page 11. Do not reopen the older page-reset finding on this evidence.

## Limits

This was a targeted live UI review, not an exhaustive correctness or accessibility certification. Actual print output, crop persistence, multi-monitor placement, screen-reader operation, touch, high-DPI changes, GPU memory and page-turn smoothness were not measured. Previously reported OCR, export, annotation and command-pinning problems were not all retested in this pass; their absence here does not establish that they are fixed. Source-code causes described in the prompt are investigation targets, not verified diagnoses.
