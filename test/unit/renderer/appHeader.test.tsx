// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AppHeader } from "../../../src/renderer/components/AppHeader";
import type { Theme } from "../../../src/renderer/state/theme";

/** Fire a mousedown with an explicit button. React listens at the
 *  root via its own event delegation, so a native bubbling
 *  `mousedown` reaches the AppHeader's onMouseDown exactly the way
 *  a real browser does. We use this instead of testing-library's
 *  fireEvent (not installed) and instead of `el.dispatchEvent` with
 *  a constructed MouseEvent (unreliable in jsdom for non-zero
 *  buttons). */
function mouseDown(el: Element, button: 0 | 1 | 2 = 0): void {
  act((): void => {
    const evt = new MouseEvent("mousedown", { bubbles: true, button });
    el.dispatchEvent(evt);
  });
}

/**
 * Phase 7 — fix #2: the "+ tab" affordance moved from the right
 * edge of the header (sibling of `.tab-list`) to INSIDE `.tab-list`,
 * as the last <li>, so it renders immediately adjacent to the
 * rightmost tab.
 *
 * DEF-055 — welcome screen has no tabs, so the '+' button is
 * gated on `tabs.length >= 1`. The "hides the '+' tab button when
 * there are no tabs" test below pins that gate.
 *
 * Phase 8 / DEF-041 — click-on-padding activates the tab. The
 * mousedown resolver in `state/tabMouseDown.ts` walks up from any
 * hit target to find `.tab`; the second test block below verifies
 * the AppHeader wires that resolver so clicks on the .tab's
 * padding, on its title span, and on the gap between title and
 * close button all activate (rather than being dropped).
 *
 * These tests pin the rendering shape + the activation behaviour
 * without going through the full App — they use the same render
 * prop contract as production code.
 */

interface RenderArgs {
  tabs?: Array<{ id: string; title: string; modified: boolean }>;
  activeId?: string | null;
  onActivate?: (id: string) => void;
  onClose?: (id: string) => void;
  onNewEmptyTab?: () => void;
}

function renderHeader(args: RenderArgs = {}): HTMLElement {
  const onActivate = args.onActivate ?? ((): void => undefined);
  const onClose = args.onClose ?? ((): void => undefined);
  const onNewEmptyTab = args.onNewEmptyTab ?? ((): void => undefined);
  const theme: Theme = "dark";
  const onToggleTheme = (): void => undefined;
  const onOpen = (): void => undefined;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <AppHeader
        activeId={args.activeId ?? null}
        tabs={args.tabs ?? []}
        onActivate={onActivate}
        onClose={onClose}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpen={onOpen}
        onNewEmptyTab={onNewEmptyTab}
      />,
    );
  });
  return container;
}

describe("AppHeader — '+ tab' placement (Phase 7 fix #2)", () => {
  it("renders the '+ tab' button as the last <li> inside .tab-list", () => {
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: true },
      ],
      activeId: "a",
    });

    const tabList = root.querySelector(".tab-list");
    expect(tabList).not.toBeNull();
    const items = tabList!.children;
    expect(items.length).toBe(3); // 2 tabs + 1 '+'
    const last = items[items.length - 1] as HTMLElement;
    expect(last.classList.contains("tab-list-new")).toBe(true);
    const plus = last.querySelector("[data-new-tab]");
    expect(plus).not.toBeNull();
  });

  it("keeps the '+ tab' button immediately after the rightmost tab", () => {
    // For three tabs the order must be tab, tab, tab, +. The '+'
    // <li> sits between the last .tab <li> and the end of the list
    // with no other <li> between them.
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: false },
        { id: "c", title: "c.pdf", modified: false },
      ],
      activeId: "c",
    });
    const items = Array.from(root.querySelectorAll(".tab-list > li"));
    expect(items.length).toBe(4);
    // The last two are tab-c and the '+' slot.
    expect(items[items.length - 2]?.querySelector("[data-tab-id='c']")).not.toBeNull();
    expect(items[items.length - 1]?.querySelector("[data-new-tab]")).not.toBeNull();
  });

  it("hides the '+ tab' button when there are no tabs (DEF-055 welcome)", () => {
    // The welcome screen is the user's primary entry point when no
    // tabs are open. A stray '+' button invites a useless empty tab
    // and looks out of place against the welcome pane. The '+' is
    // gated on `tabs.length >= 1` — it only appears once the user has
    // at least one real tab in the strip.
    const root = renderHeader({ tabs: [], activeId: null });
    const tabList = root.querySelector(".tab-list");
    expect(tabList).not.toBeNull();
    // Zero tabs -> zero <li> children (no .tab rows and no '+' slot).
    expect(tabList!.children.length).toBe(0);
    expect(root.querySelector("[data-new-tab]")).toBeNull();
  });

  it("shows the '+ tab' button once at least one tab is open", () => {
    // With exactly one tab the strip has two <li> children: the tab
    // and the '+' slot. The Phase 7 fix-#2 ordering still applies —
    // '+' sits immediately after the rightmost tab.
    const root = renderHeader({
      tabs: [{ id: "a", title: "a.pdf", modified: false }],
      activeId: "a",
    });
    const items = Array.from(root.querySelectorAll(".tab-list > li"));
    expect(items.length).toBe(2);
    expect(items[0]?.querySelector("[data-tab-id='a']")).not.toBeNull();
    expect(items[1]?.querySelector("[data-new-tab]")).not.toBeNull();
  });

  it("does not render the '+ tab' button outside .tab-list", () => {
    const root = renderHeader({
      tabs: [{ id: "a", title: "a.pdf", modified: false }],
    });
    // The '+' button must NOT be a direct sibling of the .tab-list;
    // it must live INSIDE it.
    const tabArea = root.querySelector(".tab-area");
    expect(tabArea).not.toBeNull();
    const children = Array.from(tabArea!.children);
    expect(children.length).toBe(1);
    expect(children[0]?.classList.contains("tab-list")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEF-041 — Phase 8 reappearance of DEF-034. The QA harness for
// phase6_verification relies on clicks at `.tab`'s padding edge and
// on the gap between title and close button activating the tab. The
// tests below pin the AppHeader's onMouseDown wiring (resolver in
// state/tabMouseDown.ts) so the behaviour can't silently regress
// when someone refactors the click handling.
//
// Why mousedown (not click)?
//   The same reasoning as `state/tabMouseDown.ts`. The AppHeader
//   attaches `onMouseDown` to the outer .tab; React routes the
//   mousedown event through the resolver which walks up to .tab.
//   These tests fire `mousedown` so the production code path runs
//   end-to-end.
// ---------------------------------------------------------------------------
describe("AppHeader — click on padding / gap activates the tab (DEF-041)", () => {
  it("activates when the mousedown lands on the outer .tab container", () => {
    const onActivate = vi.fn();
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: true },
      ],
      activeId: "a",
      onActivate,
    });
    const tab = root.querySelector<HTMLElement>("[data-tab-id='b']");
    expect(tab).not.toBeNull();
    if (tab === null) return;
    mouseDown(tab);
    expect(onActivate).toHaveBeenCalledWith("b");
  });

  it("activates when the mousedown lands on the inner .tab-title span", () => {
    const onActivate = vi.fn();
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: false },
      ],
      activeId: "a",
      onActivate,
    });
    const title = root.querySelector<HTMLElement>(
      "[data-tab-id='b'] .tab-title",
    );
    expect(title).not.toBeNull();
    if (title === null) return;
    mouseDown(title);
    expect(onActivate).toHaveBeenCalledWith("b");
  });

  it("activates when the mousedown lands on the modified-dot child of the title", () => {
    // The modified-dot is the leftmost child of the title. Its
    // padding box is inside the tab, so a click on the dot must
    // still activate the tab.
    const onActivate = vi.fn();
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: true },
        { id: "b", title: "b.pdf", modified: false },
      ],
      activeId: "b",
      onActivate,
    });
    const dot = root.querySelector<HTMLElement>(
      "[data-tab-id='a'] .tab-modified-dot",
    );
    expect(dot).not.toBeNull();
    if (dot === null) return;
    mouseDown(dot);
    expect(onActivate).toHaveBeenCalledWith("a");
  });

  it("does not re-activate when the mousedown lands on the already-active tab", () => {
    // The AppHeader's onMouseDown short-circuits when the target
    // tab is already the active one. This is a small efficiency win
    // (avoids a redundant reducer dispatch) but more importantly
    // it stops a re-render from swapping the button element out
    // from under the user's click during state churn (DEF-034
    // original rationale for moving from click -> mousedown).
    const onActivate = vi.fn();
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: false },
      ],
      activeId: "a",
      onActivate,
    });
    const tab = root.querySelector<HTMLElement>("[data-tab-id='a']");
    expect(tab).not.toBeNull();
    if (tab === null) return;
    mouseDown(tab);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("closes (not activates) when the mousedown lands on the close button", () => {
    // The .tab-close handler stops mousedown propagation, so the
    // outer .tab's onMouseDown never sees the event. The close
    // button fires its own onClick. The close handler must NOT
    // also fire an activate.
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: true },
      ],
      activeId: "a",
      onActivate,
      onClose,
    });
    const closeBtn = root.querySelector<HTMLButtonElement>(
      "[data-tab-id='b'] .tab-close",
    );
    expect(closeBtn).not.toBeNull();
    if (closeBtn === null) return;
    mouseDown(closeBtn);
    expect(onActivate).not.toHaveBeenCalled();
    // The close click fires on `click`, not `mousedown`, so we
    // additionally verify the close callback runs on click.
    act((): void => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalledWith("b");
  });

  it("ignores non-primary mouse buttons", () => {
    // Right-click and middle-click should not activate. The
    // resolver in state/tabMouseDown.ts filters by button=0.
    const onActivate = vi.fn();
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: false },
      ],
      activeId: "a",
      onActivate,
    });
    const tab = root.querySelector<HTMLElement>("[data-tab-id='b']");
    expect(tab).not.toBeNull();
    if (tab === null) return;
    mouseDown(tab, 2);
    expect(onActivate).not.toHaveBeenCalled();
    mouseDown(tab, 1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("does not activate a tab when the mousedown lands on the '+' button", () => {
    // The '+ tab' button lives INSIDE .tab-list (Phase 7 fix #2),
    // but outside .tab. The resolver rejects it because
    // `node.closest('.tab')` returns null. Without this guard, a
    // user clicking the '+' button could accidentally re-activate
    // an adjacent tab (regression of the DEF-034 root cause).
    const onActivate = vi.fn();
    const root = renderHeader({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: false },
      ],
      activeId: "a",
      onActivate,
    });
    const plus = root.querySelector<HTMLElement>("[data-new-tab]");
    expect(plus).not.toBeNull();
    if (plus === null) return;
    mouseDown(plus);
    expect(onActivate).not.toHaveBeenCalled();
  });
});