
---

## ADV-1633 — TFL-1566 rotated preview border + transparent controls diff-pass

**Agent:** adversary  
**Scope:** TFL-1566 phase — Pages-panel page preview card rotation geometry and overlay controls  
**Session:** diff-pass  
**Date:** 2026-10-10  
**Overall:** PASS — no material defects found  

### What changed (the diff under attack)
- `src/renderer/components/SideRail.tsx:1338-1541` — card preview: `.thumb-frame` sizes the layout box to the ROTATED footprint (quarterTurn = rotDeg===90||270 swaps width/height), `.thumb-canvas-wrap` owns the 1px border AND carries the rotation transform, `.thumb-overlay` is the footer row (checkbox, label, eye/current, More)
- `src/renderer/styles.css:5734-5755` — `.thumb-canvas-wrap { border:1px solid var(--border-subtle); border-radius: var(--radius-1); background: var(--bg-raised); overflow:hidden }`; `.thumb-frame` has no border
- `src/renderer/styles.css:7704-7718` — `.thumb-rot-90/180/270 .thumb-canvas-wrap { transform: rotate(...) }`
- `src/renderer/styles.css:18949-19018` — `.thumb-overlay { position:absolute; left:50%; bottom:6px; transform:translateX(-50%); background:transparent; backdrop-filter:none; border:none; width:max-content; max-width:calc(100% - 12px) }`; `.thumb-label { color:var(--fg-strong); font-weight:500; text-shadow: 2-layer var(--bg-raised) halo }`; `.thumb-checkbox` 16px; `.thumb-more` 32px (44px coarse)

### Attack surface tested
1. **Rotation geometry 0/90/180/270** — wrap containment inside card border at all rotations
2. **Overlay centering** — horizontal centering over preview at all rotations
3. **Drag-control guards** — More button and checkbox should not trigger page drag
4. **Rapid rotation spam** — 10 rotations in 2 seconds, app should not crash
5. **Theme switching during rotation** — light/dark/frosted theme changes mid-rotation
6. **Multi-page rotation** — pages 1, 2, 3 all rotated, containment verified
7. **Label halo legibility** — text-shadow halo present for readability

### Findings

| ADV ID | Finding | Severity | Triage |
| --- | --- | --- | --- |
| ADV-1633-01 | None — all probes passed | N/A | PASS |

### Test results
- `e2e/adversarial-tfl1566.spec.cjs` — 7/7 passed
  - ADV-001: Rapid rotation spam — PASS
  - ADV-002: Drag-control guard (More button) — PASS
  - ADV-003: Checkbox drag guard — PASS
  - ADV-004: Overlay centering at 0/90/180/270 — PASS
  - ADV-005: Theme switch during rotation — PASS
  - ADV-006: Multi-page rotation containment — PASS
  - ADV-007: Label halo legibility — PASS

### Evidence
- All measurements show wrap contained within card at all rotations (tolerance ≤2px)
- Overlay centered over preview at all rotations (offset ≤2px)
- Drag guards prevent drag initiation from controls
- Label text-shadow: `rgb(255, 255, 255) 0px 0px 2px, rgb(255, 255, 255) 0px 0px 4px` (2-layer halo)
- No crashes, hangs, or UI failures during any probe

### Verdict

**PASS** — No material defects identified. The rotated preview border and transparent centered controls implementation is robust against all adversarial probes in the diff-pass scope.

**Disposition:** PASS — ready for phase-close.

**CTO disposition:** Triaged — 7/7 probes passed, no ADV finding to accept, no DEF filed. Proceed to phase-close commit.

---
ass-border);` (shorthand resets ALL borders)
- Lines 23220-23224: Tone-based rules like `.activity-alert-notice[data-activity-alert-tone="success"] { border-left: 3px solid var(--activity-success); }` have LOWER specificity (missing `.canvas-top-right` prefix)

The shorthand `border` property on the more specific selector overrides the `border-left` on the less specific selector, even though the tone rules appear later in the file.

**Evidence:**
- Screenshot: `screenshots/debug-activity-border.png`
- Test: `e2e/debug-activity-border.spec.cjs`
- CSS: `src/renderer/styles.css:23192, 23220-23224`

**Suggested fix:**
Update the tone-based rules to include the `.canvas-top-right` prefix for matching specificity:
```css
.canvas-top-right .activity-alert-notice[data-activity-alert-tone="progress"] { border-left: 3px solid var(--activity-progress); }
/* ... repeat for success, warning, danger, neutral */
```

**Disposition:** ACCEPTED -> DEF-677

---

## FINDING ADV-1552-02 — Auto-collapse not working, notice disappears instead (MEDIUM)

**Severity:** MEDIUM — Functional regression, notice becomes unreachable after timeout

**What I did:**
1. Launched TFlex
2. Opened a scanned PDF
3. Triggered OCR operation
4. Closed the OCR modal
5. Waited for the activity notice to auto-collapse (~10s)
6. Attempted to click the collapsed icon to re-expand

**Expected:**
The notice should transition from `expanded` → `closing` → `collapsed`, showing a collapsed icon (`[data-activity-alert-icon]`) that can be clicked to re-expand the notice.

**What happened:**
The notice state went from `"expanded"` to `null` (notice unmounted entirely) instead of `"collapsed"`. The collapsed icon never appeared, making the notice unreachable after the auto-collapse timeout.

**Root cause:**
Under investigation. The `useNoticeCollapse` hook at `hooks/useNoticeCollapse.ts` should handle the auto-collapse timer and phase transitions. The notice may be unmounting because the underlying operation completed and was removed from `activityShelfVisible` before the collapse animation finished.

**Evidence:**
- Test: `e2e/adversary-1552-activity-notice.spec.cjs:298` (ADV-1552-08)
- Error: `Expected: "collapsed", Received: null`

**Disposition:** ACCEPTED -> DEF-679

---

## NO DEFECT — Other probes passed

The following adversarial probes found no defects:

### ADV-1552-03: Placement parity — PASS
Activity notice correctly renders in `.canvas-top-right .canvas-notices`, in the upper half of the viewport, not at the bottom.

### ADV-1552-04: Retired controls absent — PASS
- `[data-activity-shelf-open]` button: 0 occurrences
- `.activity-shelf-host` container: 0 occurrences
- No zero-opacity remnants found in DOM

### ADV-1552-05: Reduced-motion instant path — PASS
With `prefers-reduced-motion: reduce`, the notice renders directly in `expanded` state with no animation, and the collapsed icon never appears first.

### ADV-1552-06: Silence attack — PASS (after OCR modal closed)
All controls respond to clicks:
- Collapse button folds notice to icon
- Collapsed icon expands notice back

Note: The OCR modal backdrop was intercepting clicks — this is expected behavior (modal should block background interaction).

### ADV-1552-07: Concurrent notices — PASS
Activity notice renders alongside other notices in `.canvas-notices` without overlap or replacement.

### ADV-1552-08: Count accuracy — PASS
The notice correctly displays operation count (e.g., "1 operation", "2 operations").

---

## Summary

| ADV ID | Finding | Severity | Verdict |
| --- | --- | --- | --- |
| ADV-1552-01 | Missing colored left border | HIGH | CSS specificity bug — tone rules overridden by border shorthand |
| ADV-1552-02 | Auto-collapse fails, notice unmounts | MEDIUM | Lifecycle mismatch — operation completes before collapse finishes |
| ADV-1552-03 | Placement parity | NONE | PASS — correct canvas top-right placement |
| ADV-1552-04 | Retired controls absent | NONE | PASS — old Activity shelf completely removed |
| ADV-1552-05 | Reduced-motion path | NONE | PASS — instant expanded render |
| ADV-1552-06 | Silence attack | NONE | PASS — all controls respond |
| ADV-1552-07 | Concurrent notices | NONE | PASS — coexists with other notices |
| ADV-1552-08 | Count accuracy | NONE | PASS — count text accurate |

**Overall verdict:** FINDINGS FILED — 2 defects (1 HIGH, 1 MEDIUM), 6 probes passed.

**Disposition:** FINDINGS FILED — awaiting CSS fix for ADV-1552-01 and lifecycle investigation for ADV-1552-02.

---

## Evidence

- e2e tests: `e2e/adversary-1552-activity-notice.spec.cjs` (6 passed, 2 failed)
- Debug test: `e2e/debug-activity-border.spec.cjs` (1 passed)
- Screenshots: `screenshots/adv-1552-*.png`, `screenshots/debug-activity-border.png`

**CTO disposition:** Pending review.

---

## ADV-1609 — Chrome tab redo diff-pass (TFL-1551)

**Agent:** adversary
**Scope:** src/renderer/styles.css lines 4093-4269 (chrome tab block) + DocumentRail.tsx TAB_OVERFLOW_METRICS.chrome
**Date:** 2026-10-09
**Overall:** PASS with 3 findings filed

### Findings

| ADV ID | Finding | Severity | Triage |
| --- | --- | --- | --- |
| ADV-1609-01 | Missing prefers-reduced-motion block for chrome tab transitions | MED | **REJECTED** — Global rules already cover this. Lines 15180-15189 (@media prefers-reduced-motion: reduce) and 15332-15340 (:root[data-animations="off"]) collapse ALL transitions/animations to 0.01ms with !important. The chrome tab transitions ride shared motion tokens and are therefore already collapsed. |
| ADV-1609-02 | Dirty-dot overflow risk at 72px floor | LOW-MED | **REJECTED** — Non-material. The .tab overflow:hidden clip (line 2425) prevents any spill, and the .tab-title-text ellipsis (line 2797) handles title clipping. The 72px floor is Chrome actual minimum; no repro of overflow was provided. |
| ADV-1609-03 | Hover text color gap on non-identity chrome tabs | LOW | **REJECTED** — Non-material. The base .tab:hover color (line 2551) already provides appropriate hover ink. No visual regression was demonstrated. |

### Verdict

All three findings triaged to REJECTED with reason. No material defects identified by adversary. The chrome tab redo passes adversarial review.

**CTO disposition:** No defects accepted. Proceed to phase-close commit.
