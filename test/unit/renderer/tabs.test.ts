// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  initialTabsState,
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
