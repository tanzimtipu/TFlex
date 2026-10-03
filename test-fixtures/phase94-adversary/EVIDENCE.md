# Phase 94 icon migration — adversarial diff-pass evidence (TFL-573)

Session label: `diff-pass`. Adversary, 2026-10-03. Product code / tests / ledgers not modified.

## Commands and results

Targeted guards (build lock `.paperclip-build.lock` held by adversary and released after):

```
node node_modules/vitest/vitest.mjs run \
  test/unit/renderer/phase94_noAdHocIcons.test.ts \
  test/unit/renderer/phase94_iconSystem.test.tsx \
  test/unit/renderer/phase43IconUniqueness.test.ts
```

Result: `Test Files 3 passed (3)`, `Tests 28 passed (28)`, duration 1.72s.

Source diff: `git diff HEAD -- src/renderer` (saved here as `phase94_renderer.diff`, 11750 lines).

## Analysis scripts (run with the repo python)

- `icon_audit.py` — per changed renderer file, flags any Lucide glyph used at HEAD that no
  longer has any usage/import in the working tree.
  Result: only `DeletePageDialog` `Trash2` (real drop -> ADV-184) and the `X` imports that
  moved into `DialogShell` (still rendered at `DialogShell.tsx:174`).
- `icon_count.py` — per glyph usage counts HEAD vs working tree. Same result.
- `size_deltas.py` — removed numeric `size={n}` vs replacement token px; lists the numeric
  to token mapping mismatches (all audited as neutral/cosmetic; see ADVERSARIAL_REVIEW
  Phase 94 section item 4).
- `direct_renders.py` — any direct Lucide render left in a changed file. Result: exactly the
  two live documented exceptions (CommandPalette `Pin`, AnnotationToolbar `Slash`); the
  third (`AnnotationOverlay` `StickyNote`) is in an unchanged file.

## Verdict

No functional or behavioural regression caused by the Phase 94 `Icon` wrapper diff.
One adverse observation: ADV-184 (dropped `Trash2` on the Delete confirm, itself a side
effect of the DialogShell adoption).
