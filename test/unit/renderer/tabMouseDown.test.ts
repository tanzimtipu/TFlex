// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveTabMouseDown, type TabInput } from "../../../src/renderer/state/tabMouseDown";

/**
 * Build a DOM tree that mirrors the AppHeader's tab strip:
 *
 *   <div class="tab" data-tab-id="a">
 *     <span class="tab-title">title</span>
 *     <button class="tab-close">x</button>
 *   </div>
 *
 * Returns the elements the test needs (the tab container, the title
 * span, the close button) so each test can fire a mousedown at the
 * element the user actually clicked in real life.
 */
function buildTabStrip(tabs: readonly TabInput[]): {
  strip: HTMLDivElement;
  byTabId: Map<string, { container: HTMLDivElement; title: HTMLSpanElement; close: HTMLButtonElement }>;
} {
  const strip = document.createElement("div");
  strip.className = "tab-list";
  const byTabId = new Map<
    string,
    { container: HTMLDivElement; title: HTMLSpanElement; close: HTMLButtonElement }
  >();
  for (const t of tabs) {
    const container = document.createElement("div");
    container.className = "tab";
    container.setAttribute("data-tab-id", t.id);
    container.setAttribute("role", "tab");
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = t.title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.setAttribute("aria-label", `Close ${t.title}`);
    close.textContent = "x";
    container.appendChild(title);
    container.appendChild(close);
    strip.appendChild(container);
    byTabId.set(t.id, { container, title, close });
  }
  return { strip, byTabId };
}

const sampleTabs: TabInput[] = [
  { id: "a", title: "a.pdf", modified: false },
  { id: "b", title: "b.pdf", modified: true },
];

describe("resolveTabMouseDown", () => {
  it("activates when the mousedown lands on the outer .tab container", () => {
    const { byTabId } = buildTabStrip(sampleTabs);
    const target = byTabId.get("a")!.container;
    expect(
      resolveTabMouseDown({ target, button: 0 }, sampleTabs),
    ).toEqual({ kind: "activate", id: "a" });
  });

  it("activates when the mousedown lands on the inner .tab-title span", () => {
    const { byTabId } = buildTabStrip(sampleTabs);
    const target = byTabId.get("a")!.title;
    expect(
      resolveTabMouseDown({ target, button: 0 }, sampleTabs),
    ).toEqual({ kind: "activate", id: "a" });
  });

  it("activates when the mousedown lands on the modified-dot child of the title", () => {
    // The modified dot is the leftmost child of .tab-title. Its CSS
    // box is inside the title, so a click on the dot should still
    // activate the tab — not be silently dropped.
    const { byTabId } = buildTabStrip(sampleTabs);
    const dot = document.createElement("span");
    dot.className = "tab-modified-dot";
    byTabId.get("a")!.title.appendChild(dot);
    expect(
      resolveTabMouseDown({ target: dot, button: 0 }, sampleTabs),
    ).toEqual({ kind: "activate", id: "a" });
  });

  it("closes (does not activate) when the mousedown lands on the close button", () => {
    const { byTabId } = buildTabStrip(sampleTabs);
    const target = byTabId.get("b")!.close;
    expect(
      resolveTabMouseDown({ target, button: 0 }, sampleTabs),
    ).toEqual({ kind: "close", id: "b" });
  });

  it("closes when the mousedown lands on a child of the close button (e.g. the SVG icon)", () => {
    // The close button contains an X icon as a child element. The
    // resolver must still classify the hit as close, even when the
    // exact target is the icon inside the button.
    const { byTabId } = buildTabStrip(sampleTabs);
    const close = byTabId.get("a")!.close;
    const icon = document.createElement("svg");
    close.appendChild(icon);
    expect(
      resolveTabMouseDown({ target: icon, button: 0 }, sampleTabs),
    ).toEqual({ kind: "close", id: "a" });
  });

  it("ignores non-primary mouse buttons (right-click, middle-click)", () => {
    const { byTabId } = buildTabStrip(sampleTabs);
    const target = byTabId.get("a")!.title;
    expect(
      resolveTabMouseDown({ target, button: 2 }, sampleTabs),
    ).toBeNull();
    expect(
      resolveTabMouseDown({ target, button: 1 }, sampleTabs),
    ).toBeNull();
  });

  it("ignores a mousedown that landed outside any .tab container", () => {
    const { strip } = buildTabStrip(sampleTabs);
    // An orphan node appended to the strip but outside any .tab.
    const orphan = document.createElement("span");
    orphan.textContent = "No documents open";
    strip.appendChild(orphan);
    expect(
      resolveTabMouseDown({ target: orphan, button: 0 }, sampleTabs),
    ).toBeNull();
  });

  it("ignores a mousedown on a tab id that is not in the provided list", () => {
    // Defensive: a stale DOM (e.g. tab closed but DOM lingering one
    // frame) should not activate an unknown id. We attach the ghost
    // tab to the strip so `closest('.tab')` resolves to itself.
    const { strip, byTabId } = buildTabStrip(sampleTabs);
    const ghost = document.createElement("div");
    ghost.className = "tab";
    ghost.setAttribute("data-tab-id", "ghost");
    strip.appendChild(ghost);
    // The ghost IS a .tab element, but its id is not in `sampleTabs`,
    // so the resolver must return null.
    expect(
      resolveTabMouseDown({ target: ghost, button: 0 }, sampleTabs),
    ).toBeNull();
    // Sanity: the known tabs still resolve correctly.
    expect(
      resolveTabMouseDown({ target: byTabId.get("a")!.container, button: 0 }, sampleTabs),
    ).toEqual({ kind: "activate", id: "a" });
  });

  it("ignores a non-Element target (e.g. text node or null)", () => {
    expect(
      resolveTabMouseDown({ target: null, button: 0 }, sampleTabs),
    ).toBeNull();
    // A text node created via createTextNode is not an Element.
    const textNode = document.createTextNode("hi");
    expect(
      resolveTabMouseDown({ target: textNode, button: 0 }, sampleTabs),
    ).toBeNull();
  });

  it("treats a close button that lives OUTSIDE the matched tab container as an activate", () => {
    // Pathological DOM: a .tab-close inside a different .tab.
    // `tabEl.contains(closeEl)` must hold for the resolver to return
    // close; otherwise it falls back to activate on the matched tab.
    const { byTabId } = buildTabStrip(sampleTabs);
    const tabA = byTabId.get("a")!.container;
    const tabB = byTabId.get("b")!.container;
    // Move tabB's close into tabA.
    const closeFromB = byTabId.get("b")!.close;
    tabA.appendChild(closeFromB);
    // The mousedown lands on the close button; closest('.tab') resolves
    // to tabA (the new parent). The close button is still inside tabA,
    // so it should close tabA.
    expect(
      resolveTabMouseDown({ target: closeFromB, button: 0 }, sampleTabs),
    ).toEqual({ kind: "close", id: "a" });
    // And a mousedown on tabB's title still activates tabB (the close
    // button is no longer inside tabB).
    expect(
      resolveTabMouseDown({ target: byTabId.get("b")!.title, button: 0 }, sampleTabs),
    ).toEqual({ kind: "activate", id: "b" });
    // tabB has no close button now, but its container should still
    // exist for completeness.
    expect(tabB.contains(closeFromB)).toBe(false);
  });
});
