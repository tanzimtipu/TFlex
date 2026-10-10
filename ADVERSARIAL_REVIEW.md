
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

---

## Phase 128 (TFL-1571) diff-pass — scanned-document instant open/switch cache

**Agent:** adversary
**Scope:** Session-level page bitmap cache for scanned documents
**Session:** diff-pass
**Date:** 2026-10-10
**Fixture:** `assets/samples/scanned.pdf` (500,493 bytes, 6 pages)
**Overall:** PASS — no material defects found

### Files under review
- `src/renderer/pdf/pageBitmapCache.ts` (whole file, 129 lines)
- `src/renderer/components/PageView.tsx:535-560` (cache-hit early return), `846-853` (capture+store)
- `src/renderer/App.tsx:2506` (eager page-1 pre-render), `8945` (invalidateProxyCache), `3341` (clearTabCache in performCloseTab)
- `test/unit/renderer/pageBitmapCache.test.ts` (existing unit coverage)
- `e2e/tfl1571_scanned_instant.spec.cjs` (e2e benchmark)

### Cache API (verbatim)
- `key = ${tabId}:${sourcePage}:${cssScale}:${rotation}`
- `getCachedBitmap(tabId, sourcePage, cssScale, rotation): ImageBitmap | null` (refreshes LRU timestamp on hit)
- `setCachedBitmap(tabId, sourcePage, cssScale, rotation, bitmap): void` (replacing a key calls `bitmap.close()` on the old one)
- `pruneTabCache(tabId, maxEntries = 24): void` (LRU by timestamp; evicts with `bitmap.close()`)
- `clearTabCache(tabId): void` (closes every bitmap)
- `invalidateProxyCache(tabId)` is an alias of `clearTabCache(tabId)`
- `PAGE_BITMAP_CACHE_LIMIT = 24`

### Required attacks executed

#### 1. Close-while-referenced / use-after-close (ADV-1571-01)
**Probe:** `clearTabCache` calls `bitmap.close()` while `PageView.tsx:539-560` may still hold that same `ImageBitmap` and `drawImage` it on the next render.

**What I did:**
1. Set a bitmap in the cache
2. Called `clearTabCache` (simulating tab close)
3. Verified the bitmap's `close()` was called and `bitmap.closed` flag set to `true`
4. Checked if a subsequent `drawImage` would throw

**Expected:** If PageView tries to `drawImage` a closed bitmap, it should throw "ImageBitmap is closed" or similar.

**What happened:** The bitmap is correctly closed with `close()` called once. However, the implementation is SAFE because:
- `performCloseTab` (App.tsx:3341) calls `clearTabCache` AFTER `setOpenTabs` removes the tab from state
- React's render cycle runs AFTER state updates, so PageView unmounts BEFORE the cache is cleared
- PageView's cleanup (`useEffect` return at line 875) cancels deferred render tasks on unmount

**Verdict:** SAFE — React's state-update → unmount → cleanup ordering prevents use-after-close.

#### 2. Stale bitmap across proxy refresh (ADV-1571-02)
**Probe:** Edit a document (forces `refreshDocProxyFor` then `invalidateProxyCache` at App.tsx:8945). Confirm post-edit content is shown, never the pre-edit cached bitmap.

**What I did:**
1. Set a bitmap in the cache (simulating pre-edit render)
2. Called `invalidateProxyCache` (alias of `clearTabCache`)
3. Verified `getCachedBitmap` returns `null`

**Expected:** Cache should be cleared before any subsequent read, forcing a re-render with the new document.

**What happened:** `invalidateProxyCache` correctly clears all cached bitmaps. The call at App.tsx:8945 runs BEFORE the new `doc` prop is passed to `DocumentView`, so any subsequent `getCachedBitmap` call misses and forces a fresh render.

**Verdict:** SAFE — Invalidation runs before cache read, preventing stale bitmap reuse.

#### 3. Zoom / rotation identity (ADV-1571-03)
**Probe:** The key includes `cssScale` and `rotation`. Zoom in then switch back — expect a miss and a correct paint, never a wrong-scale/rotation bitmap.

**What I did:**
1. Stored a bitmap at `cssScale = 1.5`
2. Looked up at `cssScale = 1.5000000001` (simulating float drift from repeated multiplication)
3. Verified cache MISS

**Expected:** Float drift should cause a cache miss (safe, re-renders correctly).

**What happened:** Cache key uses string interpolation (`${cssScale}`), so `1.5 !== 1.5000000001`. The lookup correctly misses, forcing a re-render at the new scale.

**Verdict:** SAFE — Exact string comparison prevents wrong-scale bitmap reuse. Float drift causes inefficiency (re-render) but no correctness bug.

#### 4. Eviction correctness (ADV-1571-04)
**Probe:** Drive more than 24 distinct cache entries in one tab, force `pruneTabCache`, confirm the evicted oldest page re-renders cleanly on return.

**What I did:**
1. Stored 30 bitmaps (pages 1-30) in one tab's cache
2. Called `pruneTabCache("tab-a")` (default limit 24)
3. Verified pages 1-6 were evicted and closed, pages 7-30 remained cached

**Expected:** Oldest 6 entries evicted, remaining 24 accessible.

**What happened:** LRU eviction worked correctly. Pages 1-6 were closed (`.close()` called once each), pages 7-30 remained cached. The `pruneTabCache` is called AFTER render completes (PageView.tsx:852), so evicted bitmaps are not in-flight.

**Verdict:** SAFE — Eviction runs after render, LRU ordering correct, no closed-bitmap draw.

#### 5. Rapid open/close/switch churn (ADV-1571-05)
**Probe:** 20x open scanned.pdf, switch and close; confirm no unbounded growth of the module cache and no leaked ImageBitmaps.

**What I did:**
1. Simulated rapid tab creation/closure with 30 pages per tab
2. Verified `clearTabCache` on close closes all bitmaps
3. Verified cache does not grow unbounded (cap 24/tab)

**Expected:** Each tab's cache cleared on close, no leaked bitmaps.

**What happened:** `clearTabCache` correctly closes all bitmaps for the closed tab. Other tabs' caches remain untouched (verified tab isolation). The 24-entry cap per tab prevents unbounded growth.

**Verdict:** SAFE — Tab isolation correct, memory bounded.

#### 6. Eager pre-render race (ADV-1571-06)
**Probe:** App.tsx:2506 `setCachedBitmap(id,1,1,0,bitmap)` runs as a fire-and-forget IIFE alongside the real first render; confirm no double-store closes the bitmap the visible canvas is about to use.

**What I did:**
1. Simulated eager pre-render storing bitmap1
2. Simulated real render storing bitmap2 (same key)
3. Verified bitmap1 was closed (replaced), bitmap2 retained

**Expected:** If eager bitmap is replaced by real render, it should be closed safely.

**What happened:** `setCachedBitmap` correctly calls `disposeEntry` on the old bitmap when replacing the same key. The eager bitmap is closed, the real render's bitmap is retained. The IIFE failures are swallowed (line 2508-2510), so a failed pre-render never blocks open.

**Verdict:** SAFE — Double-store handled correctly, eager failure does not block open.

#### 7. Non-scanned regression (ADV-1571-07)
**Probe:** A text-heavy PDF opens/switches unchanged; the text layer is still built on the next non-hit render.

**What I did:**
1. Reviewed PageView.tsx cache-hit path (lines 539-560)
2. Verified cache miss falls through to full `doc.getPage -> render -> getTextContent -> TextLayer` pipeline

**Expected:** Cache miss should trigger full render pipeline including text layer.

**What happened:** The cache-hit early return (line 560) only executes if `cached !== null`. On a miss, execution continues to line 563 (`beginRender()`) and the full pipeline runs. Text-heavy PDFs without cached bitmaps render normally.

**Verdict:** SAFE — Cache miss correctly falls through to full render.

### Additional probes

#### ADV-1571-08: Concurrent renders same page
**Probe:** Two renders of the same page at the same scale/rotation concurrently.

**What I did:** Reviewed code — `setCachedBitmap` replaces the old bitmap if the key matches.

**Verdict:** SAFE — Last writer wins, old bitmap closed.

#### ADV-1571-09: Rotation normalization
**Probe:** Does rotation=0 and rotation=360 produce the same key?

**What I did:** Checked cache key construction — `${tabId}:${sourcePage}:${cssScale}:${rotation}`.

**Finding:** `rotation=0` and `rotation=360` produce DIFFERENT keys (`tab:1:1:0` vs `tab:1:1:360`). If the UI normalizes rotation to [0, 90, 180, 270], this is fine. If rotation can be 360+, cache misses will occur.

**Verdict:** INFO — Caller should normalize rotation to [0,90,180,270] for cache efficiency. Not a correctness bug, just potential inefficiency.

### Test results
- `test/unit/renderer/pageBitmapCache.test.ts` — 8/8 passed (existing coverage)
- `test/unit/renderer/pageBitmapCache-adversarial.test.ts` — 7/7 passed (adversarial probes)

### Findings

| ADV ID | Finding | Severity | Triage |
| --- | --- | --- | --- |
| ADV-1571-01 | Close-while-referenced race | NONE | SAFE — React ordering prevents use-after-close |
| ADV-1571-02 | Stale bitmap after proxy refresh | NONE | SAFE — Invalidation runs before read |
| ADV-1571-03 | Float drift in cssScale key | NONE | SAFE — Causes miss (inefficient but correct) |
| ADV-1571-04 | Eviction closes in-flight bitmap | NONE | SAFE — Prune runs after render completes |
| ADV-1571-05 | Rapid churn leaks bitmaps | NONE | SAFE — clearTabCache on close, cap 24/tab |
| ADV-1571-06 | Eager pre-render race | NONE | SAFE — Double-store closes old bitmap |
| ADV-1571-07 | Non-scanned regression | NONE | SAFE — Cache miss falls through to full render |
| ADV-1571-08 | Rotation normalization | INFO | Caller should normalize rotation to [0,90,180,270] |

### Verdict

**PASS** — No material defects identified. The bitmap cache implementation is robust against all adversarial probes in the diff-pass scope. All seven required attacks were safely handled by design:

1. React's state → unmount → cleanup ordering prevents use-after-close
2. Invalidation runs before cache read
3. Exact string key comparison prevents wrong-scale bitmap reuse
4. LRU eviction runs after render completes
5. Tab isolation and memory caps prevent leaks
6. Double-store safely closes old bitmaps
7. Cache miss correctly falls through to full render

**Disposition:** PASS — ready for phase-close.

**CTO disposition:** Triaged (CTO, TFL-1571). ADV-1571-01..07 REJECTED — each probe confirmed SAFE with a real run/read, no defect to accept, no DEF filed. ADV-1571-08 (INFO, rotation normalization) REJECTED — rotation is a quarter-turn index, not degrees: `DocumentView.tsx:5134` passes `pageRotation = engineState.rotations[visiblePage - 1] ?? 0` and `PageView.tsx:662,976` consume it as `% 4`, so a `0` vs `360` collision cannot occur; any out-of-range value only produces a safe cache miss (re-render), never a wrong-bitmap draw. No DEF filed. Proceed to phase-close QA then Chunk E commit.

---
