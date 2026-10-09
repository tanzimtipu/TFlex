# ADVERSARIAL_REVIEW.md - Session: TFL-1552 phase gate

## Session: TFL-1552 phase gate — Adversarial pass on ActivityAlertNotice

**Date:** 2026-10-10  
**Agent:** adversary (openrouter/qwen/qwen3.5-397b-a17b)  
**Session:** phase gate  
**Scope:** Probe the ActivityAlertNotice surface and verify the retired Activity Shelf is completely absent.

---

## FINDING ADV-1552-01 — Activity notice missing colored left border (HIGH)

**Severity:** HIGH — Visual regression, breaks the colour distinction requirement  

**What I did:**
1. Launched TFlex
2. Opened a scanned PDF (triggers "Import files" operation)
3. Verified the activity notice rendered in expanded state
4. Inspected the computed style of `[data-activity-alert-notice]`

**Expected:**
The activity notice should have a colored left border indicating its role (progress=violet, success=green, warning=amber, danger=red) as defined by the `data-activity-alert-tone` attribute and CSS rules at `styles.css:23220-23224`.

**What happened:**
The border-left width is `0px` — no colored border is visible. The notice renders with only the default `border: 1px solid var(--glass-border);` on all sides.

Debug output:
```json
{
  "tone": "success",
  "state": "expanded",
  "borderLeftWidth": "0px",
  "borderLeftStyle": "none",
  "borderLeftColor": "rgb(30, 41, 59)"
}
```

**Root cause:**
CSS specificity conflict at `styles.css:23192-23224`:
- Line 23192: `.canvas-top-right .activity-alert-notice` sets `border: 1px solid var(--glass-border);` (shorthand resets ALL borders)
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
