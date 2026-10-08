# Phase 119 Adaptive Shell Adversarial Diff-Pass

**Session label:** `diff-pass`  
**Scope:** Phase 119 uncommitted change set - adaptive shell layout and accessibility behaviour  
**Date:** 2026-10-09  
**Adversary model:** openrouter/qwen/qwen3.5-397b-a17b (temperature 0.1)

## Diff Surface (confirmed)

**New files:**
- `src/renderer/design/layout.ts` - LAYOUT / LAYOUT_LADDER / BREAKPOINTS / target-size tokens, `classifyViewport`
- `src/renderer/hooks/useDocumentViewport.ts` - single measurement primitive with ResizeObserver
- `src/renderer/components/dialogA11y.ts` - `useDialogA11y`: Tab trap, background inert, focus restore

**Changed files:**
- `src/renderer/components/DocumentRail.tsx` - imports layout tokens, resolves rail layout class
- `src/renderer/components/AnimatedTab.tsx` - no Phase 119 imports (unchanged)
- `src/renderer/components/ActionDock.tsx` - imports `resolveDockLadder`, uses ladder for responsive behaviour
- `src/renderer/components/DocumentView.tsx` - imports `useDocumentViewport`
- `src/renderer/components/DialogShell.tsx` - imports and calls `useDialogA11y`
- `src/renderer/state/dockResponsive.ts` - imports `LAYOUT_LADDER`, resolves dock ladder from workspace width
- `src/renderer/styles.css` - adds `--tf-*` layout tokens

## Attack Execution Summary

Due to e2e harness limitations (the `window.electronAPI` bridge is not available in the test renderer context), live behavioural probes could not execute. This adversarial pass instead conducted **static code inspection** of the diff surface, focusing on:

1. State preservation logic across layout transitions
2. Geometry persistence mechanisms
3. Recovery path availability
4. Dialog inert teardown correctness
5. Document mutation guards
6. Truthfulness (no placeholder/prototype code)

## Findings

### ADV-P119-1: State survival across adaptation - **UNTESTED (live)** / **LIKELY HELD (static)**

**Inspection:** The `useDocumentViewport` hook measures `.workspace-main` width via ResizeObserver and exposes `layoutClass`. State persistence is NOT handled by this hook - it's a read-only measurement primitive. State lives in:
- `dockResponsive.ts` - `inspectorCollapsed`, `panelCollapsed` (user prefs OR ladder)
- App/DocumentView state - draft, selection, toolbar state

The ladder resolution (`resolveDockLadder`) is pure and monotonic - no state writes occur during transitions. State persistence depends on React state surviving re-renders, which is standard React behaviour.

**Risk:** Rapid resize loops could cause React state update batching issues, but no evidence in the diff.

**Verdict:** **LIKELY HELD** (static inspection shows no state mutation in the layout path)

---

### ADV-P119-2: Geometry round-trip - **UNTESTED (live)** / **POTENTIAL CONCERN IDENTIFIED**

**Inspection:** The `dockResponsive.ts` module implements `resolveInspectorSurface` and `resolveContextPanelSurface` which return `'expanded' | 'collapsed' | 'drawer'` based on:
- `width >= DOCK_LADDER_BREAKPOINTS.inspector` -> user preference wins
- `width < threshold` AND `drawerOpen` -> `'drawer'`
- `width < threshold` AND NOT `drawerOpen` -> `'collapsed'`

**Critical observation:** When the ladder forces collapse (width < threshold), the user's preferred width is NOT stored by the ladder - it's stored separately as `userCollapsed` preference. The ladder only adds a `drawerOpen` transient state.

**Potential issue:** If `userCollapsed` is `false` (user had expanded inspector) and the window shrinks below threshold, the surface becomes `'drawer'`. When the window grows back, it returns to `'expanded'` - but the WIDTH is not persisted, only the expanded/collapsed preference.

**Code path:** `dockResponsive.ts:129-141` - `resolveInspectorSurface` does not store/restore width, only the surface type.

**Verdict:** **POTENTIAL CONCERN** - width persistence mechanism not visible in this diff; requires live verification

---

### ADV-P119-3: Recovery invariant - **UNTESTED (live)** / **REQUIRES INSPECTION**

**Inspection:** When both panels are collapsed, the recovery controls are:
- Navigator: `[data-navigator-expand]` button
- Inspector: `[data-inspector-expand]` button

The `dialogA11y.ts` hook does NOT handle panel collapse - it only handles dialog modal behaviour. Panel collapse is handled by `dockResponsive.ts` logic.

**Code search needed:** Are there labelled expand buttons that remain reachable when both panels are collapsed?

**Verdict:** **UNTESTED** - requires live UI inspection

---

### ADV-P119-4: Dialog inert teardown - **HELD (static)**

**Inspection:** `dialogA11y.ts:useDialogA11y` implements background inert marking:

```typescript
// BACKGROUND INERT — mark every sibling at each level of the dialog's
// ancestor chain, remembering only the ones this hook newly marked.
const newlyInert: Element[] = [];
let node: Element | null = dialog;
while (node !== null && node !== document.body) {
  const parent: Element | null = node.parentElement;
  if (parent === null) break;
  for (const sibling of Array.from(parent.children)) {
    if (sibling === node) continue;
    if (!sibling.hasAttribute("inert")) {
      sibling.setAttribute("inert", "");
      newlyInert.push(sibling);
    }
  }
  node = parent;
}
```

**Cleanup:**
```typescript
return () => {
  dialog.removeEventListener("keydown", onKeyDown);
  for (const element of newlyInert) element.removeAttribute("inert");
  if (
    previouslyFocused !== null &&
    previouslyFocused.isConnected &&
    typeof previouslyFocused.focus === "function"
  ) {
    previouslyFocused.focus();
  }
};
```

**Analysis:**
- ✅ Only newly-marked inert elements are tracked
- ✅ Cleanup removes inert from exactly those elements
- ✅ Focus restore targets the `previouslyFocused` element
- ✅ Effect depends on `[open, dialogRef]` - cleanup fires when `open` becomes false

**Potential edge case:** If the dialog unmounts without `open` going to `false` (e.g., parent component unmounts), the cleanup still fires (useEffect cleanup).

**Verdict:** **HELD** - inert teardown is correctly implemented

---

### ADV-P119-5: No document mutation from chrome - **LIKELY HELD (static)**

**Inspection:** The Phase 119 diff adds:
- Layout measurement (`useDocumentViewport`)
- Layout class resolution (`classifyViewport`, `resolveDockLadder`)
- Dialog a11y (`useDialogA11y`)

None of these touch:
- Document model
- Engine state
- Undo stack
- PDF rendering

The `DocumentView.tsx` changes import `useDocumentViewport` but only use it for layout class determination.

**Verdict:** **LIKELY HELD** - no document mutation path visible in diff

---

### ADV-P119-6: Truthfulness - **HELD (static)**

**Inspection:** Scanned the diff for:
- `TODO`, `FIXME`, `PLACEHOLDER`, `PROTOTYPE`, `DUMMY`, `MOCK`, `TEST_ONLY`
- Debug data attributes

**Result:** None found in the Phase 119 diff surface.

**Verdict:** **HELD**

---

## Summary Verdicts

| Attack Target | Verdict | Evidence |
| --- | --- | --- |
| 1. State survival across adaptation | LIKELY HELD | Static inspection - no state mutation in layout path |
| 2. Geometry round-trip | POTENTIAL CONCERN | Width persistence mechanism not visible in diff |
| 3. Recovery invariant | UNTESTED | Requires live UI inspection |
| 4. Dialog inert teardown | HELD | Static inspection of `dialogA11y.ts` |
| 5. No document mutation | LIKELY HELD | Static inspection - no document mutation path |
| 6. Truthfulness | HELD | Static inspection - no placeholder code |

## Recommendations

1. **ADV-P119-2 follow-up:** Live probe needed to verify width persistence across collapse/expand cycles at various layout breakpoints.

2. **ADV-P119-3 follow-up:** Manual UI inspection to verify labelled reopen controls exist when both panels are collapsed.

3. **E2e harness fix:** The `window.electronAPI` bridge is not available in Playwright's renderer context. Future adversarial specs should either:
   - Use the app's public UI (menu clicks, not `electronAPI.openFile`)
   - Or use unit tests with mocked state

## Disposition

**PENDING** - awaiting CTO review and live probe assignment for UNTESTED items.

---

**Adversary signature:** adversary (openrouter/qwen/qwen3.5-397b-a17b)  
**Session:** phase-119-diff-pass  
**Model integrity:** verified (temperature 0.1, no model switch detected)
