# TFL-662 — QA focused verification report

Task type: Focused verification (NOT phase validation, NOT bug-hunt, NOT performance).
Issue: TFL-662 (TFL-520 chunk B) — dock picker curation + removable greyed rows.
Model: openrouter/deepseek/deepseek-v4.1-flash (pinned, correct).

## Verdict summary

| Item | Check | Verdict |
|------|-------|---------|
| 1 | 8 focused spec files | PASS |
| 2 | npm run verify (conventions + tsc) | PASS |
| 3a | dockPickerIdsForStage curation (all stages) | PASS |
| 3b | sanitizeDockPins / addDockPin refuse non-dock ids | PASS |
| 3c | disabled verb's minus removable + unpins | PASS |
| Blast | renderer unit directory | 1 pre-existing foreign failure (out of scope) |

Overall: PASS for the chunk A/A2 change set.

## Item 1 — focused specs

Command (exact):
npm.cmd run test:unit -- test/unit/renderer/def311_314_dockCuration.test.tsx test/unit/renderer/phase58DockEdit.test.tsx test/unit/renderer/phase98_dockPickerCuration.test.ts test/unit/renderer/phase98_dockRemoveDisabled.test.tsx test/unit/renderer/phase36MultiChrome.test.tsx test/unit/renderer/phase36ActionDock.test.tsx test/unit/renderer/phase37ActionDock.test.tsx test/unit/renderer/def315_dockPillClearance.test.tsx

Summary lines:
Test Files  8 passed (8)
      Tests  149 passed (149)
Exit: 0

## Item 2 — verify

Command (exact): npm.cmd run verify
conventions: clean (344 source file(s) scanned)
typecheck: tsc --noEmit -p tsconfig.json (exit 0)

## Item 3 — core-behaviour citations

3a. phase98_dockPickerCuration.test.ts:35-46 asserts for every stage in
STAGES=['pages','edit','review','deliver'] that each offered id satisfies
`isDockPinnableId(id) === true` (line 38). Lines 49-56 assert
dockPickerIdsForStage('pages') does not contain the NON_DOCK_GLOBALS list
openSample, windowMaximize, windowMinimize, windowClose, toggleTheme,
preferences, save, saveAs, open, tabNew, checkForUpdate.

3b. phase98_dockPickerCuration.test.ts:60-64 asserts
sanitizeDockPins(['undo','openSample','windowMaximize','rotate']) ===
['undo','rotate']; lines 66-69 assert addDockPin([], 'openSample') === []
and addDockPin([], 'undo') === ['undo'].

3c. phase98_dockRemoveDisabled.test.tsx:72-101 renders a dock-pinnable pin
("undo") whose isToolEnabled returns false (line 78), arms EDIT mode, then:
- line 90 verb has disabled attribute;
- line 96 minus.closest('button[disabled]') === null;
- line 97 minus.parentElement === verb.parentElement (sibling inside slot);
- lines 99-101 click calls onUnpinTool('undo') and NOT onRunTool.
All three behaviours are asserted by shipped specs; no QA probe required.

## Blast radius — renderer unit directory

Command: npm.cmd run test:unit -- test/unit/renderer
Summary lines:
Test Files  1 failed | 488 passed (489)
      Tests  1 failed | 5224 passed (5225)

Only failure: test/unit/renderer/defDEF156_158_159_darkPageInk.test.ts >
"declares a theme-independent --fg-on-page ink token" —
expected the DARK block not to match /--fg-on-page:\s*#[0-9a-fA-F]{6}/,
but it contains `--fg-on-page: #0f172a;`.

Causally unrelated to chunk A/A2:
- Chunk A/A2 diff touches src/renderer/state/toolsRegistry.ts,
  src/renderer/state/dockModel.ts, src/renderer/components/ActionDock.tsx,
  src/renderer/components/CommandPalette.tsx (git diff --name-only).
- The failing assertion inspects src/renderer/styles.css theme token blocks.
  `git diff -- src/renderer/styles.css` has NO hunk near --fg-on-page; the
  three --fg-on-page declarations (lines 488, 762, 1000) are identical in
  HEAD and the working tree (`git show HEAD:src/renderer/styles.css`).
- The chunk's only styles.css hunk is the unrelated `.action-dock-verb-slot`
  rule near line 15498, after the token blocks, so it cannot shift theme
  block extraction.
- The failing test file is tracked and clean (not in the chunk A/A2 set).
Out-of-scope observation; not fixed per the task brief.
