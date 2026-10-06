# Phase 110 (TFL-864 "Quiet Precision") - phase-close QA report (TFL-950 chunk F)

Status: PASS
Model: openrouter/deepseek/deepseek-v4.1-flash (pinned; no fallback)
Task type: Phase validation.

## Commands and counts

| Command | Result |
| --- | --- |
| `npm.cmd run verify` | PASS - conventions clean (380 files), tsc noEmit clean |
| `npm.cmd run build:renderer` | PASS - vite build, 2696 modules, built in 845ms (warnings only) |
| `npm.cmd run test:unit -- <7 named specs>` | PASS - 7 files / 65 tests |
| `npm.cmd run test:e2e -- e2e/phase110_typography.spec.cjs` | PASS - 4/4 tests (P110-A..D) |

Named unit specs (all green): phase110_typographyScale, phase110_typographyChrome,
phase110_typographyContent, phase110_homeContrast,
phase110_documentTypographyIsolation, phase38LegibilityContrast, foundationMirrors.

E2E evidence log: `test-fixtures/phase110-qa/e2e-phase110-typography.log`.

## Item 1 - DEF-594 retest + close (PASS)

Light Home hero measured on the rendered app (e2e P110-A / P110-D):
- `.welcome-sub` and `.welcome-section h3 .count` compute to `--fg-muted` #556070
  (rgb 85,96,112) on `--bg-sunken` #e4e9ef = **5.22:1** (was 4.07), >= 4.5.
- Dark: #929BAC on #08090b = **7.12:1**.
- `phase110_homeContrast` and the extended `phase38LegibilityContrast` pass.
DEF-594 set to CLOSED in `DEFECTS.md` with this evidence.

## Item 2 - Frosted Home hero composited contrast (PASS)

Frosted rides the global `--tf-text-supporting` #667085. The rendered pixels were
captured via Electron `capturePage` (dominant background colour in a patch around
each label) and cross-checked against the CSS ancestor-chain composite; both agree.

| Theme | `.welcome-sub` | `.welcome-section h3 .count` |
| --- | --- | --- |
| light | 5.22:1 (on #e4e9ef) | 5.22:1 (on #e4e9ef) |
| dark | 7.12:1 (on #08090b) | 7.12:1 (on #08090b) |
| frosted | **4.84:1** (on rgb 251,252,253) | **4.63:1** (on rgb 245,247,249) |

Both frosted labels clear 4.5:1 (the dev's raw-token 4.16 was the 0.42/0.62 white
film issue; the composited surface is near-white). No defect filed.
Record: `screenshots/phase110-hero-contrast.json`; screenshot `screenshots/phase110-home-frosted.png`.

## Item 3 - Per-criterion verdicts (success criteria 1-8)

1. **One semantic app-wide scale - PASS.** phase110_typographyScale/Chrome/Content
   green; `src/renderer/design/typography.ts` `TYPE_ROLES`; role tokens in `:root`
   with legacy aliases; verify/typecheck clean.
2. **Segoe stack + tabular/proportional figures - PASS.** P110-A: body first family
   `"Segoe UI Variable"`, `--type-family` Segoe stack, not Inter-first;
   `.page-total`/`.zoom-percent` = tabular-nums; `.recent-row .doc-path` = normal.
3. **Supporting-text role + >=4.5 floors - PASS.** #667085 light / #929BAC dark;
   ratios measured (items 1-2): light 5.22, dark 7.12, frosted 4.84 & 4.63; all >= 4.5.
4. **Compact exceptions retained, no shrink/clipping - PASS.** phase110_typographyChrome/Content
   green; 11px rail/accelerator is the sole documented exception (DESIGN-SYSTEM 18.5);
   P110-C 200% captures show no clipping.
5. **PDF/document typography untouched - PASS.** phase110_documentTypographyIsolation
   green (5 document-pipeline files reference no UI token; document font stacks intact);
   `git status` shows no document-pipeline file modified by this phase.
6. **No conflict/overlap - PASS.** phase110_typographyScale/Content/Chrome green;
   verify conventions clean; shared primitives migrated before chrome/content.
7. **Accessibility/scale - PASS.** P110-C: devicePixelRatio=2, `home-200dpi` /
   `editor-200dpi` / `editor-200dpi-dark` captured; light/dark screenshots for five
   surfaces. Recorded limitation (CTO ruling 6): the app has no OS text-only scaling
   path - it scales with DPI/UI scale and adds no density setting.
8. **No fixture/status-only/preview-only shipping - PASS.** verify/conventions clean;
   this is a presentation-only, renderer-only, offline change set.

## Item 4 - Ledger state (PASS)

Only DEF-594 carried `- Phase: 110`; it is now CLOSED. No OPEN or DISPUTED Phase 110
defect remains (zero `- Status: DISPUTED` entries; the only other Phase-110-phase OPEN
scan hit was DEF-594 itself). DEF-593 (`foundationGuards` `MIGRATED_SURFACES`) is
external (TFL-855) and out of scope; `foundationGuards` was not run.

## Final phase verdict: PASS

No item is FAIL or INCONCLUSIVE.

## Findings

- **Test bug corrected (not a product failure).** P110-A carried a stale pre-fix
  assertion (`light .welcome-sub = #667085`) that the DEF-594 fix invalidated; QA
  corrected it to the post-fix `#556070` Home-hero ink. Re-run 4/4 green.
- **Record-path gap (documentation hygiene).** The phase spec criterion 3 / CTO
  ruling 10 name `docs/typography/supporting-text-contrast.json`; that file does not
  exist. The chunk-D record is at `screenshots/supporting-text-contrast.json`, and the
  phase-close hero record at `screenshots/phase110-hero-contrast.json`. The 4.5 floor
  is met in every theme, so this does not fail SC3; flagged for the CTO/git-agent.

## Commit

Work product left uncommitted per the qa role (git-agent is the only committer).
