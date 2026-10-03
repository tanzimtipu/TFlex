# TFL-545 / TFL-515-D - Phase 93 phase-close QA evidence

Task type: Focused verification (phase-close QA). Owner: qa.
Model: openrouter/deepseek/deepseek-v4.1-flash.
Verification was run against the final tree after `npm.cmd run build:renderer`
(refreshed so `dist/renderer` matches the Phase 93 CSS; the checked-in bundle
predated it, as the adversary had also noted). No product source, test, or
config was modified. `e2e/lib/launch.cjs` was patched only for the duration of
the e2e runs to strip the harness-injected `ELECTRON_RUN_AS_NODE` and was then
restored byte-for-byte (`git diff --stat e2e/lib/launch.cjs` empty).

## Commands and results

1. `npm.cmd run test:unit -- bookViewTurnSmoothness bookViewSpread bookView bookViewAnnotations`
   -> Test Files 5 passed (5); Tests 38 passed (38). Expected 5 files / 38 tests: matches.
2. `npm.cmd run test:e2e -- phase93_bookview_flip.spec.cjs`
   -> 5 passed (21.5s). Single flicker: blankFront=0 / frontSamples=19; frame gaps
   max 16.8ms (budget 33ms); spine maxGapPx 0.42 (next) / 0 (prev); rapid
   maxLeaves=1, turningNoLeaf=false, leaves=0 after; reduced: no leaf, no turning,
   transform none; regression: entry `tf-book-view-enter`, labels "Page 1-2 of 520"
   / "Page 1 of 520", dock unchanged, document scroll 0 -> 600.
3. `npm.cmd run test:e2e -- phase93_adversarial_flip_probe.spec.cjs`
   -> 8 passed (1.6m). All attack classes A-H HOLDS: clamp bursts, direction
   reversal, mid-turn layout toggle, close/re-enter mid-turn, edge/crease clicks,
   reduced-motion mid-session, Animations OFF mid-session, storm audit. Watch
   invariant across every sequence: maxLeaves=1, turningNoLeaf=false, no ghost
   canvas, armed tool survives, controls keep advancing.
4. `npm.cmd run verify`
   -> `conventions: clean (341 source file(s) scanned)`; `tsc --noEmit` exit 0.

Evidence logs (run scratch): p93flipA.log, p93adv.log, verify.log.
Regenerated evidence: `test-fixtures/TFL-534-phase93-frame-timing.md` (177 lines),
`screenshots/phase93/single-*.png`, `screenshots/phase93/spread-*.png`.

## Per-item verdicts

1. BookView.tsx reworked turn - PASS. `BookTurn`/`beginTurn`/`finishTurn`/
   `stepForward`/`stepBack`/`renderPageFigure` (lines 104-550): the turning
   figure is the already-mounted outgoing `[data-book-page]` (front face always
   mounted, `data-book-turn-front`); the base spread holds the outgoing index
   until `finishTurn` commits `target` once on `animationend`/fallback; rapid
   input coalesces into one `pendingRef` queued step; instant path
   (`useInstantMotion`) mounts no leaf and commits synchronously.
2. styles.css turn block - PASS. Phase 93 block at 19095-19197: in-place
   rotateY with `transform-origin` at the spine, `backface-visibility` faces,
   `.book-view-face-back` pre-rotated, and the chained-restart keyframes
   `tf-book-turn-next[-b]` / `tf-book-turn-prev[-b]`. Phase 93 hunks are confined
   to old lines ~18926-19041 / new 19095-19197 (the Book View turn block); the
   styles.css file also carries unrelated in-flight Phases 91/92/94/95 edits,
   none of which fall in the Phase 93 hunk range.
3. bookViewTurnSmoothness.test.tsx (new) - PASS (run).
4. bookViewSpread / bookView / bookViewAnnotations (updated) - PASS (run).
5. phase93_bookview_flip.spec.cjs (new) - PASS, 5/5.
6. phase93_adversarial_flip_probe.spec.cjs (new, adversary) - PASS, 8/8 on the
   final tree.
7. Scope - PASS for Phase 93's own set. Renderer-only: BookView.tsx,
   styles.css (turn block); tests: bookViewTurnSmoothness, bookViewSpread,
   bookView, bookViewAnnotations; e2e: phase93_bookview_flip,
   phase93_adversarial_flip_probe; docs/phase-specs/phase-93.md; evidence
   (frame-timing fixture, screenshots/phase93, ADVERSARIAL_REVIEW.md Phase 93
   section). No `TFL-515`/`Phase 93` marker exists in src/main, src/shared or
   src/preload; `package.json` is not modified. The tree additionally carries
   other in-flight phases' uncommitted work (src/main/index.ts, src/shared/*,
   src/preload/preload.ts add +142 lines; Button.tsx/DialogShell.tsx/icons;
   Phases 90-95 specs) - not part of Phase 93 and must not enter the phase-close
   commit per feature E.
8. Defects - PASS. No DEF entry references Phase 93 / TFL-515 / TFL-379 / the
   Book View flicker; the adversary filed no ADV (HOLD). No OPEN or DISPUTED
   DEF exists for Phase 93.

## Blast radius

DocumentView page navigation/scroll verified (regression stage: scroll 0 -> 600
with scrollHeight 710302). Book View exit restores DocumentView (crit 5 panel
state, dock count unchanged). Entry animation (`tf-book-view-enter`, 0.35s),
progress indicator (single/double labels) and single/double toggle unaffected.

## Overall

PASS. Every item 1-8 passes; Phase 93 is ready for the phase-close commit.
