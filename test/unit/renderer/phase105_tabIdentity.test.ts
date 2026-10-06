// Phase 105 (chunk B) — PER-SESSION TAB IDENTITY.
//
// The Phase-45/51/72 tab colour was derived from the strip INDEX (a 4-slot
// cycle), so closing or reordering a tab re-flowed every other tab's colour.
// This suite pins the replacement model: every session gets a stable
// `colorId`, minted once at creation (unused-identity-first, then a
// contrast-checked extended variant), carried on `TabMeta` and preserved by
// every reorder/rename/fill. Colour is a property of the session, never of
// its current index.

import { describe, expect, it } from "vitest";
import { tabsReducer, type TabMeta, type TabsState } from "../../../src/renderer/state/tabs";
import {
  IDENTITY_PALETTE,
  IDENTITY_PALETTE_SIZE,
  allocateColorId,
} from "../../../src/renderer/state/tabColour";

function meta(id: string, colorId: string, overrides: Partial<TabMeta> = {}): TabMeta {
  return {
    id,
    title: `${id}.pdf`,
    filePath: `${id}.pdf`,
    kind: "file",
    colorId,
    modified: false,
    ...overrides,
  };
}

const ALL_IDS: readonly string[] = [...IDENTITY_PALETTE];

describe("Phase 105 (chunk B) — the unused-first identity allocator", () => {
  it("returns the first palette id when nothing is in use", () => {
    expect(allocateColorId([])).toBe(IDENTITY_PALETTE[0]);
    expect(allocateColorId([])).toBe("violet");
  });

  it("returns the first UNUSED id, not a positional cycle", () => {
    expect(allocateColorId(["violet", "ocean"])).toBe("terracotta");
    // Order of `used` must not matter — this is a set membership test, not an
    // index walk.
    expect(allocateColorId(["ocean", "violet"])).toBe("terracotta");
    // A hole in the middle is filled before a later id.
    expect(allocateColorId(["violet", "ocean", "jade"])).toBe("terracotta");
  });

  it("offers twelve distinct canonical identities", () => {
    expect(IDENTITY_PALETTE_SIZE).toBe(12);
    expect(new Set(IDENTITY_PALETTE).size).toBe(IDENTITY_PALETTE_SIZE);
  });

  it("falls back to a distinct extended variant after all twelve are used", () => {
    const extended = allocateColorId(ALL_IDS);
    expect(extended.length).toBeGreaterThan(0);
    expect(IDENTITY_PALETTE).not.toContain(extended);
    // Extended variants are unique against each other too.
    const next = allocateColorId([...ALL_IDS, extended]);
    expect(next).not.toBe(extended);
    expect(IDENTITY_PALETTE).not.toContain(next);
  });
});

describe("Phase 105 (chunk B) — the reducer preserves colorId", () => {
  it("open keeps the incoming meta colorId", () => {
    const next = tabsReducer({ tabs: [], activeId: null }, {
      type: "open",
      tab: meta("a", "iris"),
    });
    expect(next.tabs[0].colorId).toBe("iris");
  });

  it("open-empty keeps the incoming meta colorId", () => {
    const next = tabsReducer({ tabs: [], activeId: null }, {
      type: "open-empty",
      tab: meta("e", "jade", { kind: "empty", filePath: "" }),
    });
    expect(next.tabs[0].colorId).toBe("jade");
  });

  it("rename preserves colorId", () => {
    const state: TabsState = { tabs: [meta("a", "rose")], activeId: "a" };
    const next = tabsReducer(state, { type: "rename", id: "a", title: "Renamed.pdf" });
    expect(next.tabs[0].title).toBe("Renamed.pdf");
    expect(next.tabs[0].colorId).toBe("rose");
  });

  it("move preserves each tab's colorId (reorder never recolours)", () => {
    const state: TabsState = {
      tabs: [meta("a", "violet"), meta("b", "ocean"), meta("c", "terracotta")],
      activeId: "a",
    };
    const next = tabsReducer(state, { type: "move", id: "c", toIndex: 0 });
    const byId = new Map(next.tabs.map((t) => [t.id, t.colorId]));
    expect(byId.get("a")).toBe("violet");
    expect(byId.get("b")).toBe("ocean");
    expect(byId.get("c")).toBe("terracotta");
    expect(byId.size).toBe(3);
  });

  it("fill-empty preserves colorId (opening a file into an empty tab)", () => {
    const state: TabsState = {
      tabs: [meta("e", "ochre", { kind: "empty", title: "Empty tab", filePath: "" })],
      activeId: "e",
    };
    const next = tabsReducer(state, {
      type: "fill-empty",
      id: "e",
      title: "Doc.pdf",
      filePath: "C:\\Temp\\Doc.pdf",
    });
    expect(next.tabs[0].kind).toBe("file");
    expect(next.tabs[0].title).toBe("Doc.pdf");
    expect(next.tabs[0].colorId).toBe("ochre");
  });

  it("two adjacent tabs never share an identity", () => {
    // Open 12 sessions, allocating each against the ids already in use — the
    // exact production rule. Every tab must be distinct AND adjacent pairs
    // must differ after an arbitrary reorder.
    let state: TabsState = { tabs: [], activeId: null };
    for (let i = 0; i < IDENTITY_PALETTE_SIZE; i += 1) {
      const id = `t${i}`;
      const colorId = allocateColorId(state.tabs.map((t) => t.colorId ?? ""));
      state = tabsReducer(state, { type: "open", tab: meta(id, colorId) });
    }
    const ids = state.tabs.map((t) => t.colorId);
    expect(new Set(ids).size).toBe(IDENTITY_PALETTE_SIZE);
    for (let i = 0; i + 1 < ids.length; i += 1) {
      expect(ids[i], `tabs ${i}/${i + 1}`).not.toBe(ids[i + 1]);
    }
    // Reorder the last tab to the front; identities travel with the session,
    // so the set is unchanged and neighbours still differ.
    const moved = tabsReducer(state, { type: "move", id: `t${IDENTITY_PALETTE_SIZE - 1}`, toIndex: 0 });
    const movedIds = moved.tabs.map((t) => t.colorId);
    expect(new Set(movedIds)).toEqual(new Set(ids));
    for (let i = 0; i + 1 < movedIds.length; i += 1) {
      expect(movedIds[i], `moved tabs ${i}/${i + 1}`).not.toBe(movedIds[i + 1]);
    }
  });
});
