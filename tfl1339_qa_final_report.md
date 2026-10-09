# TFL-1339 — Phase 116 "Thread Stream" focused QA + CONTROL-INDEX sweep (final)

Status: **FAIL** (verification complete; 2 genuine Phase-116 product defects filed)

## 1. Phase 116 unit suites — PASS
Command:
`npm.cmd run test:unit -- test/unit/main/phase116_annMetadata.test.ts test/unit/renderer/phase116_threadStream.test.tsx test/unit/renderer/phase116_filterDraft.test.tsx test/unit/renderer/phase116_inspector.test.tsx test/unit/renderer/phase116_replies.test.tsx test/unit/renderer/phase116_fdfActions.test.tsx test/unit/renderer/phase116_a11y.test.tsx`

Result: `Test Files 7 passed (7)` / `Tests 34 passed (34)` / 0 failed.

## 2. `npm.cmd run verify` — PASS
`conventions: clean (412 source file(s) scanned)` then `typecheck: tsc --noEmit -p tsconfig.json` — exit 0, no errors.
`verify` here is conventions+typecheck only; the unit suite is `verify:full` (release/operator-only, not run).
Targeted `foundationGuards.test.ts` run confirms the KNOWN FOREIGN red and NO Phase-116 entry:
`Test Files 1 failed (1)` / `Tests 3 failed | 27 passed` —
failures are `MIGRATED_SURFACES` completeness (ActivityShelf / FormFieldControl / GuidedFillPanel /
GuidedFillPrimitives / IntakeTray) + raw literals on `.activity-shelf-track-bar--indeterminate`,
`.selection-handle`, `.guided-fill-control`, `.guided-fill-panel`, `.print-preview-cell`.
No `.thread-stream-*`, `.ann-filter-*`, `.ann-empty`, or `annotations/ThreadStream.tsx` appears.

## 3. Focused e2e — 15 passed / 3 failed
Command:
`npx.cmd playwright test e2e/phase116_thread_stream.spec.cjs e2e/def362_flash_verify.spec.cjs e2e/phase51_gate.spec.cjs --reporter=list --workers=1`

| Spec | Pass | Fail | Failing test |
|---|---|---|---|
| def362_flash_verify.spec.cjs | 1 | 0 | — |
| phase116_thread_stream.spec.cjs | 7 | 2 | P116-3, P116-4 |
| phase51_gate.spec.cjs | 7 | 1 | P51-E (out of Phase-116 scope) |

Raw logs: `qa_results_tfl1339_run3.txt`, `qa_verify_tfl1339.txt`, `qa_foundation_tfl1339.txt`.

## 4. CONTROL-INDEX verdicts
| Row | Verdict | Proof |
|---|---|---|
| `data-annotation-row` | PASS | P116-1, P116-2, P116-6 |
| `data-ann-filter` (all / ink / rect) | PASS | P116-2 |
| `data-annotation-empty` / `data-ann-filtered-empty` | PASS | P116-3 |
| `data-ann-empty-action` | **FAIL (DEF-658)** | P116-3 — never rendered |
| `data-inspector-review-actions` / `data-ann-prop` | **FAIL (DEF-650)** | P116-4 — selection never populates the Inspector scope |
| `data-ann-color-box` | PASS (canvas bar) | P116-4 — applies `#ef4444`; Inspector copy blocked by DEF-650 |
| `data-comment-entry` | PASS | P116-5 |
| `exportComments` / `importComments` (`data-ann-io`) | PASS | P116-5 |
| delete | PASS | P116-6 |
| `data-review-category` bates/watermarks/signatures once | PASS | P116-7 |

## 5. Stale-spec repoint
- `e2e/def362_flash_verify.spec.cjs` — repointed to click `[data-annotation-row] button[aria-label^="Jump"]`
  and read `.ann-flash` (the row has no click handler). PASS → DEF-647 CLOSED (test-oracle error).
- `e2e/phase51_gate.spec.cjs` — repointed annotation rows to `[data-annotation-row]` /
  `[aria-label^="Delete"]` / `[data-annotation-panel]`, and multi-mode to the app menu. P51-C/P51-D PASS.
  P51-E still fails: opening report+form+long yields 2 `.tab` (expected 3) — a tab-colour flow outside
  Phase 116, not filed.

## 6. Screenshots (screenshots/)
`phase116-full-light`, `phase116-full-dark`, `phase116-compact-light`, `phase116-highcontrast`,
`phase116-zoom200` (inspected: themes + widths render correctly), plus `phase116-rows`,
`phase116-filter-highlight`/`-all`, `phase116-empty-doc`, `phase116-empty-filtered`,
`phase116-comment-thread`, `phase116-delete-row`, `phase116-review-categories`,
`phase116-inspector-color`, `phase116-no-recolor`, `def-362-ann-flash`.

## 7. Defects
- **DEF-658 (OPEN, MEDIUM)** — empty-document Thread Stream state has no action to open the
  annotation tools; `data-ann-empty-action` never renders (host never supplies `onOpenTools`).
- **DEF-650 (OPEN, MEDIUM, reconfirmed)** — the Inspector's REVIEW annotation scope
  (`data-inspector-review-actions`, `data-ann-prop="color"`) is never populated by an annotation
  selection.
- Closed as test-oracle / harness errors (behaviour verified): DEF-647, DEF-648, DEF-649, DEF-651,
  DEF-652, DEF-653, DEF-654.
