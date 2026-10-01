# TFlex Bug-Sweep Ledger

Durable rotation log for the daily **Bug Sweeper** routine ([TFL-285](/TFL/issues/TFL-285)).
Each sweep picks exactly ONE small area, sweeps it for visual and non-visual bugs,
fixes what is in scope, and records the result here. **The next sweep MUST read this
file and choose a different area.**

Format per sweep: area + bounds, date, findings (symptom / root cause / resolution),
what remains. Keep it short. Ledger writers: CTO only (developers and qa return
evidence; the CTO records it here).

## Sweep 1 - 2026-10-02 - Home / Welcome start screen

- Area: the Home / Welcome start screen - welcome hero, editable home-tool row,
  plus picker, recent-files list, bundled sample cards.
- Bounds (in scope):
  - `src/renderer/components/Welcome.tsx`
  - `src/renderer/state/homeTools.ts`
  - `src/renderer/utils/recentPath.ts`
  - `src/renderer/components/BrandLoader.tsx` / `BrandMark.tsx` / `BrandWordmark.tsx`
    (only if a Welcome defect lands there)
  - Welcome-area selectors in `src/renderer/styles/*` (`.welcome*`, `.home-tool*`,
    `.recent-*`, `.samples-*`, `.sample-*`)
  - renderer unit specs `test/unit/renderer/phase58HomeTools.test.tsx` and
    `test/unit/renderer/welcomeSamplesResolver.test.tsx`
- Out of scope: everything else. No main-process, no `src/shared` contract changes,
  no e2e (qa owns e2e), no tabs / forms / notices / Book View / app-header code.
- Status: complete (verified; committed by git-agent).
- Findings (symptom / root cause / resolution):
  1. samplesResolver rejection left the grid on "Loading samples..." forever with an
     unhandled rejection. Root cause: `Welcome.tsx` `.then()` had no rejection handler.
     Fixed: `.catch` settles `samples` to `[]` (`Welcome.tsx:130`).
  2. `splitRecentPath` returned the whole path as the file name for a trailing
     separator / bare drive root. Root cause: empty-basename fallback. Fixed: strip
     trailing separators first (`recentPath.ts:17`).
  3. Home tool row clipped at the 640px minimum (pen/plus unreachable). Root cause:
     `.welcome-actions` was a non-wrapping flex row. Fixed: `flex-wrap: wrap`
     (`styles.css:2987`).
  4. Plus opened an empty picker when every candidate was already on the row. Root
     cause: `full` only tested the cap. Fixed: `noCandidates` gates the plus/portal
     (`Welcome.tsx:216,337,351`).
  5. DEF-472 (LOW, filed then fixed): "Loading samples" ring static - `<BrandLoader />`
     rendered with no spin class. Fixed on [TFL-312](/TFL/issues/TFL-312): render
     `<BrandLoader className="update-indicator-spin" />` (reuses the shared spin class).
  6. DEF-473 (LOW, filed then fixed): portaled plus picker did not re-clamp on window
     resize (detached/clipped). Fixed on [TFL-312](/TFL/issues/TFL-312): a resize
     listener while the picker is open re-reads the plus rect and re-clamps.
- Resolution: all 6 fixed in the workspace, uncommitted, each with a renderer unit
  test. Verification: TFL-310 dev run 3 files / 37 tests + `verify` exit 0; TFL-311 qa
  independent PASS (build + 37 unit + 12 area e2e + 3 bug-hunt e2e); TFL-312 fix run
  3 files / 39 tests + `verify` exit 0; TFL-313 qa FIX-READY PASS (build + 39 unit +
  3 probe e2e + 12 blast-radius e2e), probes confirm both DEF fixes. DEF-472 /
  DEF-473 both CLOSED by qa. Zero OPEN defects.
- Remains: none. **Do not reuse the Home / Welcome area in Sweep 2.**

## Sweep 1 follow-up (fix cycle) - complete

- [TFL-312](/TFL/issues/TFL-312) (frontend-dev, done): DEF-473 picker resize re-clamp +
  DEF-472 samples loading spin.
- [TFL-313](/TFL/issues/TFL-313) (qa, done): FIX-READY re-verification PASS; closed
  DEF-472 and DEF-473.

<!-- Append Sweep 2, Sweep 3, ... below, newest last. Never reuse a swept area. -->
