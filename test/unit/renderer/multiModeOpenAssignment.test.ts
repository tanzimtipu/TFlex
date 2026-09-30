// @vitest-environment jsdom
//
// Phase 32 — DEF-277 / DEF-278: opening a document while Multi Mode is on.
//
// The amended contract: every generic open path (Open control / File > Open /
// Ctrl+O, sample cards, recent files) assigns the new document to the FOCUSED
// pane — replacing that pane's document, with the previous document still
// open as a tab; the pane's own Open action assigns to that pane. An
// assignment that cannot be honoured — the file is already the OTHER pane's
// document — is refused with a user-visible message, BEFORE a tab is created
// for it (a document must never end up as a hidden tab with no visible
// effect). Single mode is unchanged and no path can create a third pane.
//
// The pure decisions live in multiMode.ts / multiModeRouting.ts; these tests
// compose them the way App's handlers do (the composition style the
// multiModeRouting tests use) and then pin the App wiring by source scan.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  initialMultiModeState,
  multiModeReducer,
  paneAssignError,
  paneAssignPathError,
  paneTabId,
  type MultiModeState,
  type PaneId,
} from "../../../src/renderer/state/multiMode";
import {
  tabsReducer,
  type TabMeta,
  type TabsState,
} from "../../../src/renderer/state/tabs";

function tab(id: string, filePath = `${id}.pdf`): TabMeta {
  return { id, title: `${id}.pdf`, filePath, kind: "file", modified: false };
}

interface Model {
  tabs: TabsState;
  multi: MultiModeState;
  toasts: string[];
}

function model(tabList: TabMeta[], active: string | null, multi: MultiModeState): Model {
  return { tabs: { tabs: tabList, activeId: active }, multi, toasts: [] };
}

const filePathFor =
  (m: Model) =>
  (id: string): string | null =>
    m.tabs.tabs.find((t) => t.id === id)?.filePath ?? null;

/** App's `assignPaneDocument`: tab guard THEN path guard, then
 *  assign + focus + activate. A refusal toasts and changes nothing. */
function assignPaneDocument(m: Model, pane: PaneId, tabId: string): Model {
  const error =
    paneAssignError(m.multi, pane, tabId) ??
    paneAssignPathError(m.multi, pane, filePathFor(m)(tabId), filePathFor(m));
  if (error !== null) return { ...m, toasts: [...m.toasts, error] };
  const multi = multiModeReducer(
    multiModeReducer(m.multi, { type: "assign", pane, tabId }),
    { type: "focus", pane },
  );
  return { ...m, multi, tabs: tabsReducer(m.tabs, { type: "activate", id: tabId }) };
}

/** App's `showOpenedTab`: Multi Mode only; single mode is untouched. */
function showOpenedTab(m: Model, tabId: string): Model {
  if (!m.multi.enabled) return m;
  return assignPaneDocument(m, m.multi.focused, tabId);
}

/** App's `refuseOpenIntoPane` (open-time guard, BEFORE a tab exists).
 *  Returns the refused model (with the toast), or null when allowed. */
function refuseOpenIntoPane(m: Model, pane: PaneId, filePath: string | null): Model | null {
  const error = paneAssignPathError(m.multi, pane, filePath, filePathFor(m));
  return error === null ? null : { ...m, toasts: [...m.toasts, error] };
}

/** App's generic open: refuse check -> open (the tabs reducer dedupes onto an
 *  existing path and activates it) -> assign the EFFECTIVE id it activated. */
function genericOpen(m: Model, incoming: TabMeta): Model {
  const refused = refuseOpenIntoPane(m, m.multi.focused, incoming.filePath);
  if (refused !== null) return refused;
  const tabs = tabsReducer(m.tabs, { type: "open", tab: incoming });
  return showOpenedTab({ ...m, tabs }, tabs.activeId ?? incoming.id);
}

const BOTH: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };
const EMPTY_B: MultiModeState = { enabled: true, paneA: "a", paneB: null, focused: "A" };

describe("DEF-277 — a generic open assigns to the focused pane", () => {
  it("puts a third document in the focused pane, visible, previous doc still a tab", () => {
    const before = model([tab("a"), tab("b")], "a", BOTH);
    const after = genericOpen(before, tab("c"));
    expect(after.multi.paneA).toBe("c"); // focused pane replaced
    expect(after.multi.paneB).toBe("b"); // other pane untouched
    expect(after.multi.focused).toBe("A");
    expect(after.tabs.activeId).toBe("c"); // effective active tab follows
    expect(after.tabs.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(after.toasts).toEqual([]); // no message, but a visible effect
  });

  it("assigns to the FOCUSED pane, not always pane A", () => {
    const focusedB = { ...BOTH, focused: "B" as PaneId };
    const after = genericOpen(model([tab("a"), tab("b")], "b", focusedB), tab("c"));
    expect(after.multi.paneB).toBe("c");
    expect(after.multi.paneA).toBe("a");
    expect(after.tabs.activeId).toBe("c");
  });

  it("the pane's Open action assigns to THAT pane and focuses it", () => {
    const before = model([tab("a")], "a", EMPTY_B);
    expect(refuseOpenIntoPane(before, "B", "c.pdf")).toBeNull();
    const opened = tabsReducer(before.tabs, { type: "open", tab: tab("c") });
    const after = assignPaneDocument({ ...before, tabs: opened }, "B", "c");
    expect(after.multi.paneA).toBe("a");
    expect(after.multi.paneB).toBe("c");
    expect(after.multi.focused).toBe("B");
    expect(after.tabs.activeId).toBe("c");
  });
});

describe("DEF-278 — the same-file guard is reachable and refuses loud", () => {
  it("refuses the other pane's TAB with a message (pick list / tab strip)", () => {
    const before = model([tab("a"), tab("b"), tab("c")], "a", BOTH);
    const after = assignPaneDocument(before, "A", "b");
    expect(after.multi.paneA).toBe("a");
    expect(after.multi.paneB).toBe("b");
    expect(after.toasts).toEqual(["That document is already shown in the other pane."]);
  });

  it("refuses the same FILE PATH even when the tab ids differ", () => {
    const before = model(
      [tab("a", "other.pdf"), tab("b", "dup.pdf"), tab("b2", "dup.pdf")],
      "a",
      BOTH,
    );
    const after = assignPaneDocument(before, "A", "b2");
    expect(after.toasts).toEqual(["That file is already shown in the other pane."]);
    expect(after.multi.paneA).toBe("a");
    expect(after.multi.paneB).toBe("b");
  });

  it("the pane Open path refuses the other pane's file and creates no tab", () => {
    const before = model([tab("a", "report.pdf")], "a", EMPTY_B);
    const refused = refuseOpenIntoPane(before, "B", "report.pdf");
    expect(refused).not.toBeNull();
    expect(refused!.toasts).toEqual(["That file is already shown in the other pane."]);
    expect(refused!.tabs.tabs.map((t) => t.id)).toEqual(["a"]); // no stray tab
  });

  it("a generic open of the other pane's file is refused before any tab exists", () => {
    const before = model([tab("a", "report.pdf"), tab("b", "long.pdf")], "a", BOTH);
    const after = genericOpen(before, tab("b2", "long.pdf"));
    expect(after.toasts).toEqual(["That file is already shown in the other pane."]);
    expect(after.tabs.tabs.map((t) => t.id)).toEqual(["a", "b"]); // no third tab
    expect(after.multi.paneA).toBe("a");
  });
});

describe("single mode is unchanged; no path creates a third pane", () => {
  it("single mode: a generic open just activates, no assignment, no message", () => {
    const before = model([tab("a"), tab("b")], "a", initialMultiModeState);
    const after = genericOpen(before, tab("c"));
    expect(after.multi).toBe(initialMultiModeState); // identity, untouched
    expect(after.tabs.activeId).toBe("c");
    expect(after.toasts).toEqual([]);
  });

  it("repeated opens never mint a third pane", () => {
    let m = model([tab("a"), tab("b"), tab("c"), tab("d")], "a", BOTH);
    m = genericOpen(m, tab("c"));
    m = genericOpen(m, tab("d"));
    expect(Object.keys(m.multi).sort()).toEqual(["enabled", "focused", "paneA", "paneB"]);
    expect(paneTabId(m.multi, "A")).toBe("d");
    expect(paneTabId(m.multi, "B")).toBe("b");
    // An id outside the two known slots is refused, not coerced.
    expect(
      multiModeReducer(m.multi, { type: "assign", pane: "C" as PaneId, tabId: "x" }),
    ).toBe(m.multi);
  });
});

// ---------------------------------------------------------------------------
// The App wiring itself. App.tsx is far too large to mount, so the wiring is
// pinned by reading the source (the pattern multiModeRouting.test.ts uses).
// ---------------------------------------------------------------------------

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
  "utf8",
);

/** The full text of an App `useCallback` handler. */
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

describe("App wiring — every generic open routes through the ref", () => {
  // Phase 35 — the Open dialog, the recent-file click, the OS-open listener
  // and the OS file drop all route through the ONE `openFromRequest`
  // callback, which composes the routing ref with `openRequestedPath`
  // (the pure helper pinned in phase35_openRequestedPath.test.ts).
  it("openFromRequest is the ONE path: refuse -> open -> assign", () => {
    const body = handlerBody("openFromRequest");
    expect(body).toMatch(/routeOpenedTabRef\.current/);
    expect(body).toMatch(
      /openRequestedPath\(path, openPdfFromPath, routeOpenedTabRef\.current\)/,
    );
  });

  it("onOpenClick (Open control / File > Open / Ctrl+O) routes through the shared path", () => {
    const body = handlerBody("onOpenClick");
    expect(body).toMatch(/openFromRequest\(picked\)/);
  });

  it("openSampleByName (sample cards) refuses then shows the opened tab", () => {
    const body = handlerBody("openSampleByName");
    expect(body).toMatch(/routing\.refuseFocused\(samplePath\)/);
    expect(body).toMatch(/routing\.show\(opened\.tabId\)/);
    expect(handlerBody("onSampleClick")).toMatch(/openSampleByName\(sample\.name\)/);
  });

  it("onRecentClick (recent files) routes through the shared path", () => {
    const body = handlerBody("onRecentClick");
    expect(body).toMatch(/openFromRequest\(entry\.path\)/);
  });

  it("the ref is filled with refuseFocused and show", () => {
    expect(appSource).toMatch(/routeOpenedTabRef\.current = \{/);
    expect(appSource).toMatch(/refuseFocused: \(filePath: string \| null\): boolean =>/);
    expect(appSource).toMatch(/show: showOpenedTab,/);
  });
});

describe("App wiring — assign path, pane Open, single mode", () => {
  it("assignPaneDocument enforces the tab rule AND the file-path rule", () => {
    const body = handlerBody("assignPaneDocument");
    expect(body).toMatch(/paneAssignError\(multiMode, pane, tabId\)/);
    expect(body).toMatch(
      /paneAssignPathError\(multiMode, pane, tabFilePath\(tabId\), tabFilePath\)/,
    );
    expect(body).toMatch(/pushToast\("error", error\)/);
  });

  it("onOpenIntoPane (data-pane-open) runs the guard before opening", () => {
    const body = handlerBody("onOpenIntoPane");
    expect(body).toMatch(/if \(refuseOpenIntoPane\(pane, picked\)\) return;/);
    expect(body).toMatch(/assignPaneDocument\(pane, tabId\)/);
  });

  it("showOpenedTab is a no-op in single mode (single-mode open unchanged)", () => {
    const body = handlerBody("showOpenedTab");
    expect(body).toMatch(/if \(!multiMode\.enabled\) return;/);
    expect(body).toMatch(/assignPaneDocument\(multiMode\.focused, tabId\)/);
  });

  it("openFromBytes returns the id the reducer activated (dedupe-safe)", () => {
    expect(appSource).toMatch(/const effectiveId = dedupeTarget\?\.id \?\? id;/);
    // Phase 40 item 4 — the return now also carries the engine doc id (the
    // from-scratch merge addresses the doc directly). The tab-id contract is
    // unchanged, so the dedupe-safe id assertion is intact.
    expect(appSource).toMatch(/return \{ tabId: effectiveId, engineDocId \};/);
  });
});

describe("there is no third pane", () => {
  it("the pane id type has exactly two members", () => {
    const multiSource = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "src", "renderer", "state", "multiMode.ts"),
      "utf8",
    );
    expect(multiSource).toMatch(/export type PaneId = 'A' \| 'B';/);
  });
});
