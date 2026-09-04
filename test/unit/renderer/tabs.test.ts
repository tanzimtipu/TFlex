// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  initialTabsState,
  resolveOpenId,
  tabsReducer,
  type TabMeta,
} from "../../../src/renderer/state/tabs";

const make = (i: number, path: string): TabMeta => ({
  id: `tab-${i}`,
  title: `${i}.pdf`,
  filePath: path,
  kind: "file",
  modified: false,
});

describe("tabs reducer", () => {
  it("starts empty", () => {
    expect(initialTabsState).toEqual({ tabs: [], activeId: null });
  });

  it("opens a new tab and activates it", () => {
    const next = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    expect(next.tabs).toHaveLength(1);
    expect(next.activeId).toBe("tab-1");
  });

  it("reuses an existing tab when opening the same path", () => {
    const a = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    const b = tabsReducer(a, { type: "open", tab: make(1, "a.pdf") }); // same path, new id
    expect(b.tabs).toHaveLength(1);
    expect(b.activeId).toBe("tab-1");
  });

  it("activates an existing tab", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    s = tabsReducer(s, { type: "open", tab: make(2, "b.pdf") });
    expect(s.activeId).toBe("tab-2");
    s = tabsReducer(s, { type: "activate", id: "tab-1" });
    expect(s.activeId).toBe("tab-1");
  });

  it("ignores activate for unknown id", () => {
    const s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    const next = tabsReducer(s, { type: "activate", id: "nope" });
    expect(next).toEqual(s);
  });

  it("closes a tab and elects a left neighbor when active tab is closed", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    s = tabsReducer(s, { type: "open", tab: make(2, "b.pdf") });
    s = tabsReducer(s, { type: "open", tab: make(3, "c.pdf") });
    expect(s.activeId).toBe("tab-3");
    s = tabsReducer(s, { type: "close", id: "tab-3" });
    expect(s.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"]);
    expect(s.activeId).toBe("tab-2");
    s = tabsReducer(s, { type: "close", id: "tab-2" });
    // closing active (no left neighbor) -> falls to tab-1
    expect(s.activeId).toBe("tab-1");
  });

it("clearing the last tab nulls the active id", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    s = tabsReducer(s, { type: "close", id: "tab-1" });
    expect(s).toEqual({ tabs: [], activeId: null });
  });

  it("set-modified flips the modified flag on the matching tab", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    s = tabsReducer(s, { type: "open", tab: make(2, "b.pdf") });
    s = tabsReducer(s, { type: "set-modified", id: "tab-1", modified: true });
    expect(s.tabs.find((t) => t.id === "tab-1")?.modified).toBe(true);
    expect(s.tabs.find((t) => t.id === "tab-2")?.modified).toBe(false);
  });

  it("set-modified is a no-op when the flag is unchanged", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    const before = s;
    s = tabsReducer(s, { type: "set-modified", id: "tab-1", modified: false });
    expect(s).toBe(before);
  });

  it("set-modified on an unknown id is a no-op", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    const before = s;
    s = tabsReducer(s, { type: "set-modified", id: "missing", modified: true });
    expect(s).toBe(before);
  });

  it("rename updates the title of the matching tab", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    s = tabsReducer(s, { type: "rename", id: "tab-1", title: "report-edited.pdf" });
    expect(s.tabs.find((t) => t.id === "tab-1")?.title).toBe("report-edited.pdf");
  });

it("rename is a no-op when the title is unchanged", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    const before = s;
    s = tabsReducer(s, { type: "rename", id: "tab-1", title: "1.pdf" });
    expect(s).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — empty tab affordance

describe("tabs reducer — empty tab", () => {
  it("open-empty appends and activates", () => {
    const s = tabsReducer(initialTabsState, {
      type: "open-empty",
      tab: {
        id: "empty-1",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe("empty-1");
    expect(s.tabs[0]?.kind).toBe("empty");
  });

  it("opening a PDF while an empty tab is active fills the empty tab in place", () => {
    // DEF-036 contract: the caller (`openFromBytes` via `resolveOpenId`)
    // computes the id and dispatches with it on the meta. The reducer
    // mutates the empty tab in place by id — it does NOT allocate a
    // fresh id (that was the source of the lookup-mismatch bug).
    const withEmpty = tabsReducer(initialTabsState, {
      type: "open-empty",
      tab: {
        id: "empty-1",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    const { id, fillsEmptyId } = resolveOpenId(withEmpty, {
      kind: "file",
      filePath: "a.pdf",
    });
    expect(id).toBe("empty-1");
    expect(fillsEmptyId).toBe("empty-1");
    const filled = tabsReducer(withEmpty, {
      type: "open",
      tab: {
        id,
        title: "1.pdf",
        filePath: "a.pdf",
        kind: "file",
        modified: false,
      },
    });
    expect(filled.tabs).toHaveLength(1);
    expect(filled.activeId).toBe("empty-1");
    expect(filled.tabs[0]?.kind).toBe("file");
    expect(filled.tabs[0]?.title).toBe("1.pdf");
    expect(filled.tabs[0]?.filePath).toBe("a.pdf");
  });

  it("opening a PDF while a real tab is active does NOT fill an empty tab", () => {
    const a = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    const withEmpty = tabsReducer(a, {
      type: "open-empty",
      tab: {
        id: "empty-1",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    // The active tab is now the empty one — that's expected when
    // open-empty runs without an explicit activate. Re-activate a
    // real tab to assert the fill-in-place path doesn't fire.
    const onReal = tabsReducer(withEmpty, { type: "activate", id: "tab-1" });
    const { id, fillsEmptyId } = resolveOpenId(onReal, {
      kind: "file",
      filePath: "b.pdf",
    });
    expect(fillsEmptyId).toBeNull();
    expect(id).not.toBe("empty-1");
    const next = tabsReducer(onReal, {
      type: "open",
      tab: {
        id,
        title: "2.pdf",
        filePath: "b.pdf",
        kind: "file",
        modified: false,
      },
    });
    expect(next.tabs).toHaveLength(3);
    // The empty tab is preserved (not filled because the active is
    // a real tab).
    expect(next.tabs.find((t) => t.id === "empty-1")?.kind).toBe("empty");
  });

  it("re-opening a PDF whose empty tab fill is in flight still keeps one tab", () => {
    // DEF-036 regression guard: after the empty-fill, opening the same
    // path again should NOT create a duplicate — it should activate the
    // now-real tab. The reducer dedupes by filePath when the meta's id
    // does not match an existing tab.
    const withEmpty = tabsReducer(initialTabsState, {
      type: "open-empty",
      tab: {
        id: "empty-1",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    const filled = tabsReducer(withEmpty, {
      type: "open",
      tab: {
        id: "empty-1",
        title: "report.pdf",
        filePath: "/tmp/report.pdf",
        kind: "file",
        modified: false,
      },
    });
    // Activate a different tab, then re-open the same path.
    const back = tabsReducer(filled, { type: "activate", id: "tab-not-real" });
    expect(back).toBe(filled); // unknown id -> no-op
    const reopened = tabsReducer(filled, {
      type: "open",
      tab: {
        id: "fresh-id-2",
        title: "report.pdf",
        filePath: "/tmp/report.pdf",
        kind: "file",
        modified: false,
      },
    });
    expect(reopened.tabs).toHaveLength(1);
    expect(reopened.activeId).toBe("empty-1");
  });

  it("single-source id: resolveOpenId is deterministic for empty fill", () => {
    // The bug was that the meta and the session ended up under
    // different ids. resolveOpenId is the single source of truth:
    // callers must use `id` for both. This test pins the contract.
    const state = tabsReducer(initialTabsState, {
      type: "open-empty",
      tab: {
        id: "empty-9",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    const a = resolveOpenId(state, { kind: "file", filePath: "/x/a.pdf" });
    const b = resolveOpenId(state, { kind: "sample", filePath: "samples/b.pdf" });
    // Empty fill always reuses the empty tab's id, regardless of
    // kind (file vs sample), because the user is opening a real
    // document into the placeholder.
    expect(a.id).toBe("empty-9");
    expect(b.id).toBe("empty-9");
    expect(a.fillsEmptyId).toBe("empty-9");
    expect(b.fillsEmptyId).toBe("empty-9");
  });

  it("resolveOpenId mints when active is not empty", () => {
    const state = tabsReducer(initialTabsState, {
      type: "open",
      tab: make(1, "a.pdf"),
    });
    let minted = 0;
    const r = resolveOpenId(
      state,
      { kind: "file", filePath: "b.pdf" },
      (): string => {
        minted += 1;
        return `fresh-${minted}`;
      },
    );
    expect(r.fillsEmptyId).toBeNull();
    expect(r.id).toBe("fresh-1");
  });

  it("resolveOpenId mints when no tab is active (empty state)", () => {
    let minted = 0;
    const r = resolveOpenId(
      initialTabsState,
      { kind: "file", filePath: "a.pdf" },
      (): string => {
        minted += 1;
        return `fresh-${minted}`;
      },
    );
    expect(r.fillsEmptyId).toBeNull();
    expect(r.id).toBe("fresh-1");
  });

  it("DEF-036: openFromBytes's id and the reducer's active id agree after empty fill", () => {
    // Reproduces the exact end-to-end shape of openFromBytes for the
    // empty-tab case: compute id with resolveOpenId, build the meta
    // with that id, dispatch. After the dispatch, the tab bar's
    // activeId MUST equal the id the caller used for openTabs[id]
    // (the document session map). Pre-fix, the reducer silently
    // picked a different id and the lookup openTabs[activeId]
    // returned undefined, leaving DocumentView unmounted.
    let nextId = 100;
    const mint = (): string => `fresh-${nextId++}`;
    const state = tabsReducer(initialTabsState, {
      type: "open-empty",
      tab: {
        id: "empty-1",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    const { id } = resolveOpenId(
      state,
      { kind: "file", filePath: "/disk/report.pdf" },
      mint,
    );
    expect(id).toBe("empty-1");
    const afterOpen = tabsReducer(state, {
      type: "open",
      tab: {
        id,
        title: "report.pdf",
        filePath: "/disk/report.pdf",
        kind: "file",
        modified: false,
      },
    });
    // The id used for the session is the same as activeId.
    expect(afterOpen.activeId).toBe(id);
    // The tab is now a real file tab in the original slot.
    expect(afterOpen.tabs.find((t) => t.id === id)?.kind).toBe("file");
    expect(afterOpen.tabs).toHaveLength(1);
  });

  it("fill-empty flips the empty tab to file kind", () => {
    const withEmpty = tabsReducer(initialTabsState, {
      type: "open-empty",
      tab: {
        id: "empty-1",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    const next = tabsReducer(withEmpty, {
      type: "fill-empty",
      id: "empty-1",
      title: "report.pdf",
      filePath: "/tmp/report.pdf",
    });
    expect(next.tabs[0]?.kind).toBe("file");
    expect(next.tabs[0]?.title).toBe("report.pdf");
    expect(next.tabs[0]?.filePath).toBe("/tmp/report.pdf");
  });

  it("closing the only empty tab nulls the active id", () => {
    const withEmpty = tabsReducer(initialTabsState, {
      type: "open-empty",
      tab: {
        id: "empty-1",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    const next = tabsReducer(withEmpty, { type: "close", id: "empty-1" });
    expect(next).toEqual({ tabs: [], activeId: null });
  });

  it("closing an empty tab activates the previous tab", () => {
    let s = tabsReducer(initialTabsState, { type: "open", tab: make(1, "a.pdf") });
    s = tabsReducer(s, {
      type: "open-empty",
      tab: {
        id: "empty-1",
        title: "Empty tab",
        filePath: "",
        kind: "empty",
        modified: false,
      },
    });
    // Now close the active empty tab — should fall back to tab-1.
    s = tabsReducer(s, { type: "close", id: "empty-1" });
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe("tab-1");
  });
});

// ---------------------------------------------------------------------------
// DEF-170 — sequential extracts must each open a brand-new tab

describe("DEF-170 sequential extract results", () => {
  /** Simulate the exact openFromBytes shape for an extract result:
   *  resolveOpenId mints the tab id from the CURRENT tab state, the
   *  caller registers the doc session under that id, and the meta is
   *  dispatched with `dedupePath: false`. Returns the new state plus
   *  the id the session was registered under. */
  const runExtract = (
    state: ReturnType<typeof tabsReducer>,
    mint: () => string,
    pageLabel: string,
  ): { state: ReturnType<typeof tabsReducer>; sessionId: string } => {
    const { id } = resolveOpenId(state, {
      kind: "file",
      filePath: "<extract>report.pdf",
    }, mint);
    const next = tabsReducer(state, {
      type: "open",
      tab: {
        id,
        title: `report.pdf — pages ${pageLabel}`,
        filePath: "<extract>report.pdf",
        kind: "file",
        modified: false,
      },
      dedupePath: false,
    });
    return { state: next, sessionId: id };
  };

  it("two sequential extracts open two distinct tabs, each owning its own session id", () => {
    // Start from a real source document.
    let state = tabsReducer(initialTabsState, { type: "open", tab: make(1, "report.pdf") });
    expect(state.tabs).toHaveLength(1);

    let nextId = 1;
    const mint = (): string => `extract-tab-${nextId++}`;

    const first = runExtract(state, mint, "10-20");
    expect(first.sessionId).toBe("extract-tab-1");
    state = first.state;
    // First extract appends a fresh tab and activates it.
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-1", "extract-tab-1"]);
    expect(state.activeId).toBe("extract-tab-1");

    // Second extract while the first result tab is still open (and active).
    const second = runExtract(state, mint, "30-40");
    expect(second.sessionId).toBe("extract-tab-2");
    state = second.state;
    // Pre-fix the reducer collapsed the second open onto the first via
    // the shared `<extract>report.pdf` path — tab count stayed at 2 and
    // the old result tab was refocused. With dedupePath:false the second
    // extract mints and appends its OWN tab; both keep their own session
    // ids (nothing orphaned).
    expect(state.tabs.map((t) => t.id)).toEqual([
      "tab-1",
      "extract-tab-1",
      "extract-tab-2",
    ]);
    expect(state.tabs).toHaveLength(3);
    expect(state.activeId).toBe("extract-tab-2");
    expect(state.tabs[1]?.filePath).toBe("<extract>report.pdf");
    expect(state.tabs[2]?.filePath).toBe("<extract>report.pdf");
    // Each result tab carries its own id, so openTabs[sessionId] lookups
    // point at distinct document sessions.
    expect(new Set(state.tabs.map((t) => t.id)).size).toBe(3);
  });

  it("the same-path dedupe still applies to real files (dedupePath unset)", () => {
    // Regression guard: re-opening a real on-disk path must keep
    // collapsing onto the existing tab — the DEF-170 opt-out must not
    // weaken the regular re-open behavior.
    let state = tabsReducer(initialTabsState, { type: "open", tab: make(1, "report.pdf") });
    state = tabsReducer(state, {
      type: "open",
      tab: { id: "fresh-1", title: "report.pdf", filePath: "report.pdf", kind: "file", modified: false },
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.activeId).toBe("tab-1");
  });
});
