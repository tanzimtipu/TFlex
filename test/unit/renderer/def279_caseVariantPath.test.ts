// @vitest-environment jsdom
//
// DEF-279 — a Windows case-variant path must not defeat the open dedupe or
// the same-file pane guard.
//
// The defect: both comparisons were raw string equality, so
// `...-p32-samefile.pdf` and `...-P32-SAMEFILE.PDF` were treated as two
// files. Opening the variant minted a SECOND tab for one on-disk document,
// pane B accepted that tab, and a later save from pane B silently
// overwrote pane A's saved edit. These tests pin the fixed behaviour:
//   - the open dedupe collapses a variant path onto the existing tab
//     (exactly one tab, no second engine document);
//   - the pane guard refuses the variant with the user-visible message and
//     assigns nothing and creates no stray tab;
//   - genuinely different paths are unaffected.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  initialMultiModeState,
  multiModeReducer,
  paneAssignError,
  paneAssignPathError,
  type MultiModeState,
} from "../../../src/renderer/state/multiMode";
import {
  tabsReducer,
  type TabMeta,
  type TabsState,
} from "../../../src/renderer/state/tabs";

const EXACT = "C:\\Temp\\report-p32-samefile.pdf";
const VARIANT = "c:/TEMP/REPORT-P32-SAMEFILE.PDF";
const OTHER = "C:\\Temp\\long.pdf";

function tab(id: string, filePath: string, title = `${id}.pdf`): TabMeta {
  return { id, title, filePath, kind: "file", modified: false };
}

// ---------------------------------------------------------------------------
// 1. The open dedupe (tabs reducer — the canonical open path).
// ---------------------------------------------------------------------------

describe("DEF-279 — open dedupe collapses a case-variant path", () => {
  it("a variant open reuses the existing tab: one tab, variant id dropped", () => {
    const after = tabsReducer(
      { tabs: [tab("a", EXACT)], activeId: "a" },
      { type: "open", tab: tab("b", VARIANT) },
    );
    expect(after.tabs).toHaveLength(1); // no second tab
    expect(after.tabs[0].id).toBe("a"); // the original tab
    expect(after.activeId).toBe("a"); // activated, so no hidden tab
  });

  it("the same collapse happens for a slash variant and a trailing slash", () => {
    let state: TabsState = { tabs: [tab("a", EXACT)], activeId: "a" };
    state = tabsReducer(state, { type: "open", tab: tab("b", VARIANT) });
    expect(state.tabs).toHaveLength(1);
    expect(state.activeId).toBe("a");
  });

  it("a genuinely different path still appends a new tab", () => {
    const after = tabsReducer(
      { tabs: [tab("a", EXACT)], activeId: "a" },
      { type: "open", tab: tab("b", OTHER) },
    );
    expect(after.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(after.activeId).toBe("b");
  });

  it("dedupePath:false derived tabs are still exempt (DEF-170 preserved)", () => {
    const after = tabsReducer(
      { tabs: [tab("a", EXACT)], activeId: "a" },
      { type: "open", tab: tab("b", VARIANT), dedupePath: false },
    );
    expect(after.tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// 2. The same-file pane guard (multiMode's paneAssignPathError).
// ---------------------------------------------------------------------------

const BOTH: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };

const filePathFor =
  (tabs: TabMeta[]) =>
  (id: string): string | null =>
    tabs.find((t) => t.id === id)?.filePath ?? null;

describe("DEF-279 — the pane guard refuses the case-variant path", () => {
  // Pane A holds the exact-case path; the user tries to put the variant
  // into the empty pane B.
  const EMPTY_B: MultiModeState = { enabled: true, paneA: "a", paneB: null, focused: "B" };

  it("refuses the variant as the other pane's file, with the message", () => {
    const tabs = [tab("a", EXACT)];
    const error = paneAssignPathError(EMPTY_B, "B", VARIANT, filePathFor(tabs));
    expect(error).toBe("That file is already shown in the other pane.");
  });

  it("refuses in the reverse direction too (variant held, exact incoming)", () => {
    const tabs = [tab("b", VARIANT)];
    const emptyA: MultiModeState = { enabled: true, paneA: null, paneB: "b", focused: "A" };
    expect(paneAssignPathError(emptyA, "A", EXACT, filePathFor(tabs))).toBe(
      "That file is already shown in the other pane.",
    );
  });

  it("does not fire for a genuinely different path", () => {
    const tabs = [tab("a", EXACT)];
    expect(paneAssignPathError(EMPTY_B, "B", OTHER, filePathFor(tabs))).toBeNull();
  });

  it("assigning the variant tab into pane B leaves pane A's tab alone", () => {
    // Model App's assignPaneDocument: tab guard -> path guard -> assign.
    const tabs: TabsState = { tabs: [tab("a", EXACT), tab("b2", VARIANT)], activeId: "a" };
    const fp = filePathFor(tabs.tabs);
    const error = paneAssignPathError(BOTH, "B", fp("b2"), fp);
    expect(error).toBe("That file is already shown in the other pane.");
    // Refusal changes nothing: no assignment, no stray tab.
    const after = error === null ? multiModeReducer(BOTH, { type: "assign", pane: "B", tabId: "b2" }) : BOTH;
    expect(after.paneA).toBe("a");
    expect(after.paneB).toBe("b");
    expect(tabs.tabs.map((t) => t.id)).toEqual(["a", "b2"]);
  });

  it("the tab-id guard still runs first and is unchanged", () => {
    const tabs = [tab("a", EXACT), tab("b", OTHER)];
    const fp = filePathFor(tabs);
    expect(paneAssignError(BOTH, "A", "b")).toBe(
      "That document is already shown in the other pane.",
    );
    expect(paneAssignPathError(BOTH, "A", fp("a"), fp)).toBeNull();
  });

  it("single mode (disabled) is untouched by the guard", () => {
    const tabs = [tab("a", EXACT), tab("b2", VARIANT)];
    const fp = filePathFor(tabs);
    expect(paneAssignPathError(initialMultiModeState, "A", fp("b2"), fp)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. App wiring — the dedupe lookup must use the canonical key.
// ---------------------------------------------------------------------------

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
  "utf8",
);

describe("DEF-279 — App dedupeTarget uses the canonical path key", () => {
  it("finds the existing tab via isSamePath, not raw equality", () => {
    expect(appSource).toMatch(
      /tabsRef\.current\.tabs\.find\(\(t\) => isSamePath\(t\.filePath, source\.path\)\)/,
    );
    expect(appSource).not.toMatch(/tabsRef\.current\.tabs\.find\(\(t\) => t\.filePath === source\.path\)/);
  });

  it("still returns the reducer-activated id to Multi Mode", () => {
    expect(appSource).toMatch(/const effectiveId = dedupeTarget\?\.id \?\? id;/);
    expect(appSource).toMatch(/return \{ tabId: effectiveId \};/);
  });
});