// @vitest-environment jsdom
//
// Phase 32 (chunk 2c) — Multi Mode: the focus -> active-tab routing rules.
//
// The phase's key insight: every document-scoped operation reads the app's
// active tab id (`App.tsx`'s `activeTabIdRefLocal`, mirroring
// `tabs.activeId`). Routing focus through `activateTab` therefore targets
// the focused pane with no handler changes. These tests pin:
//
//   1. The two tab-strip rules (in a pane -> focus it; outside the panes ->
//      assign to the focused pane; the other pane's tab -> focus it).
//   2. Focus drives the active tab, in both directions.
//   3. A document-scoped operation applied while pane B is focused changes
//      only B's document — asserted through the existing seam (the active
//      tab id), never a new one.
//   4. `deactivate` clears the active id without touching any tab, so an
//      empty focused pane cannot misroute an operation.
//   5. The App wiring itself: the strip uses `resolveTabStripActivation`,
//      focus/assign route through `activateTab`, and `performCloseTab`
//      reconciles the panes in the same commit.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  initialMultiModeState,
  multiModeReducer,
  type MultiModeState,
  type PaneId,
} from "../../../src/renderer/state/multiMode";
import {
  resolvePaneClear,
  resolvePaneFocus,
  resolveTabStripActivation,
} from "../../../src/renderer/state/multiModeRouting";
import {
  initialTabsState,
  tabsReducer,
  type TabMeta,
  type TabsState,
} from "../../../src/renderer/state/tabs";

const BOTH: MultiModeState = {
  enabled: true,
  paneA: "a",
  paneB: "b",
  focused: "A",
};

const EMPTY_B: MultiModeState = {
  enabled: true,
  paneA: "a",
  paneB: null,
  focused: "A",
};

function tab(id: string, modified = false): TabMeta {
  return {
    id,
    title: `${id}.pdf`,
    filePath: `${id}.pdf`,
    kind: "file",
    modified,
  };
}

/** The App-shaped composition seam: the same pure decisions App applies. */
interface Model {
  tabs: TabsState;
  multi: MultiModeState;
}

function model(tabIds: string[], active: string | null, multi: MultiModeState): Model {
  return {
    tabs: { tabs: tabIds.map((id) => tab(id)), activeId: active },
    multi,
  };
}

/** App's `onFocusPane` decision, applied to the two reducers. */
function focusPane(m: Model, pane: PaneId): Model {
  const decision = resolvePaneFocus(m.multi, pane);
  const multi = multiModeReducer(m.multi, { type: "focus", pane: decision.focus });
  const tabs =
    decision.activate !== null
      ? tabsReducer(m.tabs, { type: "activate", id: decision.activate })
      : tabsReducer(m.tabs, { type: "deactivate" });
  return { tabs, multi };
}

/** App's `onTabStripActivate` decision, applied to the two reducers. */
function stripActivate(m: Model, id: string): Model {
  const decision = resolveTabStripActivation(m.multi, id);
  let multi = m.multi;
  if (decision.assign !== null) {
    multi = multiModeReducer(multi, { type: "assign", pane: decision.assign, tabId: id });
  }
  if (decision.focus !== null) {
    multi = multiModeReducer(multi, { type: "focus", pane: decision.focus });
  }
  return { multi, tabs: tabsReducer(m.tabs, { type: "activate", id: decision.activate }) };
}

/** A document-scoped operation: it acts on the ACTIVE TAB only (the seam
 *  every App operation path reads). Returns which tab it touched. */
function runDocumentOp(m: Model): string | null {
  return m.tabs.activeId;
}

describe("resolveTabStripActivation — single mode is untouched", () => {
  it("activates the clicked tab and never moves focus or assigns", () => {
    expect(resolveTabStripActivation(initialMultiModeState, "a")).toEqual({
      focus: null,
      assign: null,
      activate: "a",
    });
  });
});

describe("resolveTabStripActivation — the two tab-strip rules", () => {
  it("rule 1: a tab in pane A focuses pane A", () => {
    expect(resolveTabStripActivation(BOTH, "a")).toEqual({
      focus: "A",
      assign: null,
      activate: "a",
    });
  });

  it("rule 1: a tab in pane B focuses pane B", () => {
    expect(resolveTabStripActivation(BOTH, "b")).toEqual({
      focus: "B",
      assign: null,
      activate: "b",
    });
  });

  it("rule 2: a tab outside the panes is assigned to the FOCUSED pane", () => {
    expect(resolveTabStripActivation(BOTH, "c")).toEqual({
      focus: "A",
      assign: "A",
      activate: "c",
    });
    const focusedB = { ...BOTH, focused: "B" as PaneId };
    expect(resolveTabStripActivation(focusedB, "c")).toEqual({
      focus: "B",
      assign: "B",
      activate: "c",
    });
  });

  it("rule 2: the other pane's tab focuses that pane instead of assigning", () => {
    // Pane A focused, pane B holds "b": clicking "b" must not try to
    // duplicate it into pane A — it focuses pane B.
    expect(resolveTabStripActivation(BOTH, "b").assign).toBeNull();
    expect(resolveTabStripActivation(BOTH, "b").focus).toBe("B");
  });

  it("assigns into an EMPTY focused pane without a conflict", () => {
    expect(resolveTabStripActivation(EMPTY_B, "c")).toEqual({
      focus: "A",
      assign: "A",
      activate: "c",
    });
  });
});

describe("focus drives the active tab — both directions", () => {
  it("focusing a filled pane makes its document the active tab", () => {
    const before = model(["a", "b", "c"], "a", BOTH);
    const after = focusPane(before, "B");
    expect(after.multi.focused).toBe("B");
    expect(after.tabs.activeId).toBe("b");
    expect(runDocumentOp(after)).toBe("b");
  });

  it("focusing an empty pane clears the active tab (no misrouted operation)", () => {
    const before = model(["a", "c"], "a", EMPTY_B);
    const after = focusPane(before, "B");
    expect(after.multi.focused).toBe("B");
    expect(after.tabs.activeId).toBeNull();
    expect(runDocumentOp(after)).toBeNull();
  });

  it("activating a pane's tab focuses that pane (the reverse direction)", () => {
    const before = model(["a", "b", "c"], "a", BOTH);
    const after = stripActivate(before, "b");
    expect(after.multi.focused).toBe("B");
    expect(after.tabs.activeId).toBe("b");
  });
});

describe("a document-scoped operation targets only the focused pane", () => {
  it("changes only pane B's document while pane B is focused", () => {
    const before = model(["a", "b", "c"], "a", BOTH);
    const focusedB = focusPane(before, "B");
    expect(runDocumentOp(focusedB)).toBe("b");
    // The op seam is the active tab id: pane A's document is not it.
    expect(runDocumentOp(focusedB)).not.toBe("a");
    // Pane A's slot is untouched by the focus move.
    expect(focusedB.multi.paneA).toBe("a");
    expect(focusedB.multi.paneB).toBe("b");
  });

  it("assigns the clicked document into the focused pane and routes the op to it", () => {
    const before = model(["a", "b", "c"], "a", BOTH);
    const after = stripActivate(before, "c");
    expect(after.multi.paneA).toBe("c");
    expect(after.multi.paneB).toBe("b");
    expect(after.multi.focused).toBe("A");
    expect(runDocumentOp(after)).toBe("c");
  });

  it("clicking the other pane's tab focuses it and leaves both slots alone", () => {
    const before = model(["a", "b", "c"], "a", BOTH);
    const after = stripActivate(before, "b");
    expect(after.multi.paneA).toBe("a");
    expect(after.multi.paneB).toBe("b");
    expect(runDocumentOp(after)).toBe("b");
  });
});

describe("tabsReducer — deactivate", () => {
  it("clears the active id without removing any tab", () => {
    const state: TabsState = { tabs: [tab("a"), tab("b")], activeId: "a" };
    const next = tabsReducer(state, { type: "deactivate" });
    expect(next.activeId).toBeNull();
    expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("is a no-op when nothing is active (identity preserved)", () => {
    const state: TabsState = { ...initialTabsState, tabs: [tab("a")] };
    expect(tabsReducer(state, { type: "deactivate" })).toBe(state);
  });

  it("leaves single-mode activation semantics unchanged", () => {
    const state: TabsState = { tabs: [tab("a"), tab("b")], activeId: "a" };
    expect(tabsReducer(state, { type: "activate", id: "b" }).activeId).toBe("b");
  });
});

describe("resolvePaneClear — clearing a pane must not leave a stale active tab", () => {
  it("clears the active id when the cleared document was active", () => {
    expect(resolvePaneClear(BOTH, "A", "a")).toBeNull();
  });

  it("keeps the active id when another pane's document was cleared", () => {
    expect(resolvePaneClear(BOTH, "B", "a")).toBe("a");
  });

  it("keeps a null active id as null", () => {
    expect(resolvePaneClear(EMPTY_B, "B", null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The App wiring itself. The established pattern for App-level wiring in
// this repo is a source scan (see bugDEF142_closeRequestedWiring.test.ts):
// App.tsx is far too large to mount, so the wiring is pinned by reading it.
// ---------------------------------------------------------------------------

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
  "utf8",
);

/** The full text of an App `useCallback` handler, from its declaration to
 *  its closing dep array / paren at the two-space indent. */
function handlerBody(name: string): string {
  const start = appSource.indexOf(`const ${name} = useCallback(`);
  if (start < 0) throw new Error(`${name} not found in App.tsx`);
  const rest = appSource.slice(start);
  const depArray = rest.search(/\n  \}, \[/);
  const plainClose = rest.search(/\n  \);/);
  const candidates = [depArray, plainClose].filter((n) => n > 0);
  const cut = candidates.length === 0 ? rest.length : Math.min(...candidates);
  return rest.slice(0, cut);
}

describe("App wiring — focus and the strip route through the pure decisions", () => {
  it("the tab strip's onActivate is the routing handler, not raw activateTab", () => {
    expect(appSource).toMatch(/onActivate=\{onTabStripActivate\}/);
  });

  it("onTabStripActivate uses resolveTabStripActivation and activateTab", () => {
    const body = handlerBody("onTabStripActivate");
    expect(body).toMatch(/resolveTabStripActivation\(multiMode, id\)/);
    expect(body).toMatch(/activateTab\(decision\.activate\)/);
    expect(body).toMatch(/assignPaneDocument\(decision\.assign, id\)/);
  });

  it("onFocusPane routes through activateTab and deactivates an empty pane", () => {
    const body = handlerBody("onFocusPane");
    expect(body).toMatch(/resolvePaneFocus\(multiMode, pane\)/);
    expect(body).toMatch(/activateTab\(decision\.activate\)/);
    expect(body).toMatch(/dispatchTabs\(\{ type: "deactivate" \}\)/);
  });

  it("assignPaneDocument focuses the pane and activates its document", () => {
    const body = handlerBody("assignPaneDocument");
    expect(body).toMatch(/dispatchMultiMode\(\{ type: "assign", pane, tabId \}\)/);
    expect(body).toMatch(/activateTab\(tabId\)/);
  });

  it("onClearPane clears the active id with the cleared document", () => {
    const body = handlerBody("onClearPane");
    expect(body).toMatch(/resolvePaneClear\(multiMode, pane, tabs\.activeId\)/);
    expect(body).toMatch(/dispatchTabs\(\{ type: "deactivate" \}\)/);
  });

  it("leaving Multi Mode restores a real active tab (single mode never hides every pane)", () => {
    // The toggle delegates to the shared leave helper (also used by the
    // composite tab close), and the helper owns the restore.
    const body = handlerBody("onMultiModeToggle");
    expect(body).toMatch(/leaveMultiMode\(\)/);
    const helper = handlerBody("leaveMultiMode");
    expect(helper).toMatch(/multiMode\.paneA \?\? multiMode\.paneB/);
    expect(helper).toMatch(/activateTab\(restore\)/);
  });
});

describe("App wiring — tab close reconciles the panes in the same commit", () => {
  it("performCloseTab dispatches reconcile with the post-close tab ids", () => {
    const body = handlerBody("performCloseTab");
    expect(body).toMatch(/dispatchTabs\(\{ type: "close", id \}\)/);
    expect(body).toMatch(/type: "reconcile"/);
    expect(body).toMatch(/tabsRef\.current\.tabs\.filter\(\(t\) => t\.id !== id\)/);
  });

  it("keeps the tab-list effect as the reconcile safety net", () => {
    expect(appSource).toMatch(
      /dispatchMultiMode\(\{ type: "reconcile", tabIds: liveTabIds \}\)/,
    );
  });
});
