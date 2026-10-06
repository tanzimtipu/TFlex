# Phase 112 adversary diff-pass (TFL-997)

Session: diff-pass. Attack surfaces: panel layout persistence, recent-files
persistence, export configuration, panel data freshness, high-risk regressions,
layout overlap. Read-only against product source; ledger (ADVERSARIAL_REVIEW.md)
writes only.

## Findings

| ID | Severity (suggested) | Title | Evidence |
| --- | --- | --- | --- |
| ADV-231 | MEDIUM | The settings echo filter ignores every panel-layout field (panelLeftWidthPx / panelRightWidthPx / inspectorCollapsed / pagesPanelCollapsed) - a stale echo silently reverts a just-committed width or collapse | adv_echo_probe.mjs / .out.log |
| ADV-232 | MEDIUM | A non-contiguous page range is collapsed to [first,last] before the engine call - the Deliver inspector's prepared range silently exports unrequested intermediate pages | adv_range_probe.mjs / .out.log |
| ADV-233 | MEDIUM | A stale recents-only echo is trusted as an authoritative backend write - it can silently revert a renderer-written Pin (C6b sameRecentFiles is bypassed by differsOnlyInRecentFiles) | adv_echo_probe.mjs / .out.log |

## Probe results (decisive lines)

```
left-width stale echo applied?: actual=true (a correct filter would be false)
sameSettings(stale,persisted) (width differs): actual=true (a correct filter would be false)
right-width stale echo applied?: actual=true
inspectorCollapsed stale echo applied?: actual=true
pagesPanelCollapsed stale echo applied?: actual=true
pinned recents-only stale echo applied?: actual=true
differsOnlyInRecentFiles(stale,persisted): actual=true
```

```
expr="1,3"   parsed=[1,3]   engineRange=[1,3] requested=2 enginePages=3 <-- SILENT WIDENING
expr="1,3,5" parsed=[1,3,5] engineRange=[1,5] requested=3 enginePages=5 <-- SILENT WIDENING
expr="2,4-6" parsed=[2,4,5,6] engineRange=[2,6] requested=4 enginePages=5 <-- SILENT WIDENING
expr="1-2,4" parsed=[1,2,4] engineRange=[1,4] requested=3 enginePages=4 <-- SILENT WIDENING
Cases silently widened: 4 of 6 non-empty expressions
```

## Held

- Export config: seeded range is re-parsed/re-validated by the dialog; the
  office gate (xlsx/pptx) holds when the bridge is absent; parser rejects empty,
  descending, out-of-range and huge expressions; no export-time flatten.
- Recent-files safety: Remove never deletes/moves a file; showInFolder /
  locateMissing return typed results and never throw.
- Settings normalisation: preserve-if-valid for all three new fields.
- Delete / merge / save: unchanged by the diff.
- Panel data freshness: panels are presentation over host-published state; no
  new async owner introduced.
- Resize / collapse geometry: clamped bands, no 0/negative panel, no
  dock-centering collision (one LOW note on reserving a closed inspector width).

## Reproduce

    node --experimental-strip-types test-fixtures/phase112-adversary/adv_echo_probe.mjs
    node --experimental-strip-types test-fixtures/phase112-adversary/adv_range_probe.mjs
