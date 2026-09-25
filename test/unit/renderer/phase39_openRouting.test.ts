// Phase 39 item 2 (operator) — opening a PDF while an EMPTY pane is focused
// must not move the pane split / divider. The root cause was the active
// document being cleared on empty-pane focus (collapsing the Inspector's
// inset); opening then reopened it and moved the divider. The pure decision
// keeps the workspace's active document whenever another pane still holds one.

import { describe, expect, it } from "vitest";
import { shouldClearActiveOnEmptyFocus } from "../../../src/renderer/state/multiModeRouting";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_SOURCE = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");

const state = (
  paneA: string | null,
  paneB: string | null,
  focused: "A" | "B",
): MultiModeState => ({ enabled: true, paneA, paneB, focused });

describe("shouldClearActiveOnEmptyFocus (Phase 39 item 2)", () => {
  it("keeps the active document when the other pane holds one", () => {
    // One document in A, the empty pane B is focused: keep A active so the
    // Inspector's inset (and the divider) does not jump when B opens a file.
    expect(shouldClearActiveOnEmptyFocus(state("t1", null, "B"), "B")).toBe(false);
    expect(shouldClearActiveOnEmptyFocus(state(null, "t1", "A"), "A")).toBe(false);
  });

  it("clears the active document when the workspace has none left", () => {
    expect(shouldClearActiveOnEmptyFocus(state(null, null, "B"), "B")).toBe(true);
    expect(shouldClearActiveOnEmptyFocus(state(null, null, "A"), "A")).toBe(true);
  });
});

describe("open-affordance routing (Phase 39 item 2)", () => {
  it("routes the empty pane's Open through the OS file picker", () => {
    const block = APP_SOURCE.slice(
      APP_SOURCE.indexOf("const onOpenIntoPane ="),
      APP_SOURCE.indexOf("const onOpenIntoPane =") + 700,
    );
    expect(block).toMatch(/window\.tflex\.openFileDialog\(\)/);
    expect(block).toMatch(/refuseOpenIntoPane\(pane, picked\)/);
    expect(block).toMatch(/assignPaneDocument\(pane, tabId\)/);
  });

  it("routes the title-bar Open / File > Open / Ctrl+O through the shared path", () => {
    const block = APP_SOURCE.slice(
      APP_SOURCE.indexOf("const onOpenClick ="),
      APP_SOURCE.indexOf("const onOpenClick =") + 600,
    );
    expect(block).toMatch(/window\.tflex\.openFileDialog\(\)/);
    expect(block).toMatch(/openFromRequest\(picked\)/);
  });
});
