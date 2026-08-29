# Test fixtures

Real PDF work lives or dies on nasty real-world files. Gather (or let the agents
synthesize) this set before/during the build. Keep everything here git-tracked except
anything private — use synthetic or public documents.

## Core set (needed from Phase 1)

- `report.pdf` — 34 pages, text-rich report with headings and outline; contains the word "orchestration" for search testing.
- `long.pdf` — 520 pages exactly, mixed text and PNG images (every 7th page); used for performance and stress testing.
- `form.pdf` — AcroForm with 8 fields: 3 text fields, 2 checkboxes, a radio group, a dropdown, and a list box.
- `scanned.pdf` — 6 image-only pages with no text layer, simulated by synthetic noise and pseudo-text blocks.

## Hostile set (adversary territory, Phase 5 at the latest)

- `corrupted.pdf` — truncated mid-stream.
- `not-a-pdf.pdf` — a text file renamed.
- `encrypted.pdf` — password-protected (note the password in a comment here once added).
- `huge-images.pdf` — a few pages with very large embedded images.
- `zero-byte.pdf` — exactly what it says.

## Adversary-crafted specimens (phase-2 gate, 2026-08-28)

- `truncated.pdf` — 200 bytes: `%PDF-1.4` header plus one partial object; no
  xref/trailer. Sniff rejects as corrupt; pdf-lib's load throws mid-parse.
- `zero.pdf` — 0 bytes.
- `not-a-pdf.txt` — plain text named .txt (used to test the file-picker
  filter bypass in merge).
- `encrypted-looking.pdf` — spoofed `/Encrypt` entry (sniff rejects as
  encrypted).
- `no-trailer.pdf` — header + objects but no `startxref`/`%%EOF` (sniff
  rejects as corrupt).
- `broken-pagetree.pdf` — valid header/xref/trailer, catalog `/Pages` points
  at a nonexistent object (pdf-lib load rejects).
- `no-kids.pdf` — valid header/xref/trailer, `/Pages` with a `/Count` but no
  `/Kids` (pdf-lib load rejects).
- `huge-images.pdf` — 3 pages with very large embedded PNG images (843KB each, 2247KB total).
- `corrupted.pdf` — valid header, objects, and xref but `startxref` points at wrong offset.
- `encrypted.pdf` — spoofed `/Encrypt` entry with proper /Filter /Standard /V 2 structure (sniff may or may not detect).
- `circular-refs.pdf` — Pages node whose `/Kids` array contains itself; outline with self-referencing `/Next`.
- `malformed-xref.pdf` — xref table claims 6 objects but trailer says `/Size 3`; duplicate `startxref` directives.
- `infinite-loop-pagetree.pdf` — Page tree with a cycle (node 4's `/Kids` points back to root `/Pages` node 2).

## final pass adversary harnesses

- `adversarial_final.mjs` — comprehensive full-feature exercise (hostile loads, annotations, forms, signatures, merge+hostile, rapid ops, split/extract edges, stale docId ops, invalid fills, bytes loads).
- `adversarial_final2.mjs` — deep investigation: 0-page doc signature, flatten undo field destruction, repeated self-merge, split form, multiple load cycles, docId replacement.
- `adversarial_final3.mjs` — round-trip tests: save overwrites source, merge form fields, form fill save/reload, annotation save/reload, signature save/reload.
- `adversarial_final4.mjs` — targeted tests: merge field preservation, multiple signatures, form after reorder, rapid annotation cycles, zero-byte load, null/undefined IPC args.

- `tools/` — adversary harness scripts used for the phase-2 gate
  (`phase2_adversarial.cjs`, `repeat_race.cjs`, `verify_undo_button.cjs`,
  `isolate_merge.cjs`, `pinpoint_merge.cjs`, `capture_crash.cjs`,
  `verify_dialog_patch.cjs`, `verify_dlg_args.cjs`, `instrument_pick.cjs`,
  `race_screenshot.cjs`, `adversarial_phase2.mjs`).

## Rules

- Only qa and adversary add or modify files here (see AGENTS.md).
- The adversary works on copies — fixtures are never the only copy.
- If qa or the adversary crafts a new specimen during testing, it lands here with a line
  in this README.
