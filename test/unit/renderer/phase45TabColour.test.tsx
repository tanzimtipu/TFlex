// @vitest-environment jsdom
// Phase 45 (item 2 / feature C) — DISTINCT TAB COLOURS.
//
// The operator's report: "file tabs still don't have distinct colors." The
// diagnosis is pinned here in two halves:
//   (a) the pure assignment rule — a fixed palette cycled by strip POSITION,
//       so two ADJACENT tabs are always on different slots, including after a
//       tab is closed (the remaining indices re-flow);
//   (b) the rendered DOM — each tab carries `data-tab-colour` and the colour
//       chip, while the ACTIVE tab keeps its `.tab-active` selection state
//       (a coloured tab must not read as selected).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import {
  TAB_COLOUR_PALETTE_SIZE,
  TAB_COLOUR_TOKENS,
  tabColourSlot,
  tabColoursDiffer,
} from "../../../src/renderer/state/tabColour";

interface TabSpec {
  id: string;
  title: string;
  modified: boolean;
}

function renderHeader(tabs: TabSpec[], activeId: string | null): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <AppHeader
        activeId={activeId}
        tabs={tabs}
        onActivate={(): void => undefined}
        onClose={(): void => undefined}
        theme="frosted"
        onThemeChange={(): void => undefined}
        onNewEmptyTab={(): void => undefined}
        onOpenPreferences={(): void => undefined}
      />,
    );
  });
  return container;
}

describe("Phase 45 item 2 — the tab-colour assignment rule", () => {
  it("offers at least two hues so a cycle can never collide with a neighbour", () => {
    expect(TAB_COLOUR_PALETTE_SIZE).toBeGreaterThanOrEqual(2);
    expect(TAB_COLOUR_TOKENS).toHaveLength(TAB_COLOUR_PALETTE_SIZE);
    // Declared semantic tokens only — no invented values.
    for (const t of TAB_COLOUR_TOKENS) expect(t).toMatch(/^--sem-(primary|attention|affirmative|neutral)$/);
  });

  it("ADJACENT strip positions always land on different slots (the core invariant)", () => {
    for (let i = 0; i < 12; i += 1) {
      expect(tabColoursDiffer(i, i + 1), `tabs ${i} and ${i + 1} collide`).toBe(true);
    }
  });

  it("stays adjacent-distinct AFTER a close: dropping index 1 re-flows the rest", () => {
    // Before: slots for [0,1,2,3]. Close the tab at index 1; the old tab 2
    // becomes index 1, etc. Every surviving neighbour pair must still differ.
    const afterClose = [0, 2, 3].map((originalIndex) => tabColourSlot(originalIndex));
    // Re-flow to the new positions: [a, c, d] -> slots 0,1,2.
    const refowed = [0, 1, 2].map((i) => tabColourSlot(i));
    expect(refowed[0]).not.toBe(refowed[1]);
    expect(refowed[1]).not.toBe(refowed[2]);
    // And the rule is a deterministic cycle, not order-dependent.
    expect(afterClose).toEqual([tabColourSlot(0), tabColourSlot(2), tabColourSlot(3)]);
  });

  it("collapses a non-finite index to slot 0 (never an undefined colour)", () => {
    expect(tabColourSlot(Number.NaN)).toBe(0);
    expect(tabColourSlot(Number.POSITIVE_INFINITY)).toBe(0);
    expect(tabColourSlot(-1)).toBe(tabColourSlot(TAB_COLOUR_PALETTE_SIZE - 1));
  });
});

describe("Phase 45 item 2 — the rendered tab strip", () => {
  const TABS: TabSpec[] = [
    { id: "a", title: "Alpha.pdf", modified: false },
    { id: "b", title: "Beta.pdf", modified: false },
    { id: "c", title: "Gamma.pdf", modified: false },
  ];

  it("every tab carries its own colour slot and NO identity chip (Phase 72)", () => {
    const host = renderHeader(TABS, "a");
    const tabs = [...host.querySelectorAll<HTMLElement>("[data-tab-id]")];
    expect(tabs).toHaveLength(3);
    const slots = tabs.map((t) => t.getAttribute("data-tab-colour"));
    expect(slots).toEqual(["0", "1", "2"]);
    expect(new Set(slots).size).toBe(3);
    for (const t of tabs) {
      // Phase 72 (item 3) — the always-on `.tab-colour-chip` is retired;
      // `data-tab-colour` still drives `--tf-tab-accent`.
      expect(t.querySelector(".tab-colour-chip"), "colour chip gone").toBeNull();
    }
  });

  it("adjacent rendered tabs never share a colour slot", () => {
    const host = renderHeader(TABS, "b");
    const slots = [...host.querySelectorAll<HTMLElement>("[data-tab-id]")].map((t) =>
      Number(t.getAttribute("data-tab-colour")),
    );
    for (let i = 0; i + 1 < slots.length; i += 1) {
      expect(slots[i], `rendered tabs ${i}/${i + 1}`).not.toBe(slots[i + 1]);
    }
  });

  it("the ACTIVE tab keeps its selection state (a coloured tab never looks selected by colour)", () => {
    const host = renderHeader(TABS, "b");
    const active = host.querySelector<HTMLElement>("[data-tab-id='b']");
    const inactive = host.querySelector<HTMLElement>("[data-tab-id='a']");
    expect(active?.classList.contains("tab-active")).toBe(true);
    expect(active?.getAttribute("aria-selected")).toBe("true");
    expect(inactive?.classList.contains("tab-active")).toBe(false);
    // Phase 72 (item 3) — no identity chip on either tab; the selection signal
    // is the surface tint + `.tab-active`, never a per-tab mark.
    expect(active?.querySelector(".tab-colour-chip")).toBeNull();
    expect(inactive?.querySelector(".tab-colour-chip")).toBeNull();
  });
});
