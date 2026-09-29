// @vitest-environment jsdom
// Phase 58 (chunk 5) — tab reorder. Pins the PURE ordering logic: the
// `moveTab` helper and the reducer's `move` action. The pointer gesture
// itself (threshold, selection guard, drop marker) is verified in a real
// browser by qa; here we lock the state contract: forward/backward moves,
// clamping, identity no-ops, and active-id preservation.
//
// DEF-411 — also pins the restore rule the reorder commit relies on:
// committing a reorder must leave the pre-drag active tab active, while
// an ordinary click (no drag) still activates the clicked tab.
//
// DEF-412 — also pins the single-tab gesture: the ARM gate no longer
// requires >1 tab (a detached window holds exactly one), the reorder
// COMMIT owns that guard, and the arm threshold is TOTAL movement so a
// straight-downward tear-out arms the drag.
//
// DEF-413 — also pins the title-activation timing: a mousedown inside a
// NON-active tab's .tab-title no longer activates immediately; it defers
// to a mouseup, and a drag-select over the title suppresses activation
// entirely. A mousedown outside the title (padding/chip) stays immediate.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AppHeader, shouldRestoreActiveOnReorder, tearOutDecision } from "../../../src/renderer/components/AppHeader";
import { tabExitAction } from "../../../src/renderer/App";
import type { Theme } from "../../../src/renderer/state/theme";
import {
  initialTabsState,
  moveTab,
  tabsReducer,
  type TabMeta,
} from "../../../src/renderer/state/tabs";

const make = (i: number): TabMeta => ({
  id: `tab-${i}`,
  title: `${i}.pdf`,
  filePath: `${i}.pdf`,
  kind: "file",
  modified: false,
});

const ids = (tabs: readonly TabMeta[]): string[] => tabs.map((t) => t.id);

describe("moveTab", () => {
  it("moves a tab forward to the right index", () => {
    const tabs = [make(1), make(2), make(3), make(4)];
    const next = moveTab(tabs, "tab-1", 2);
    expect(ids(next)).toEqual(["tab-2", "tab-3", "tab-1", "tab-4"]);
  });

  it("moves a tab backward to the right index", () => {
    const tabs = [make(1), make(2), make(3), make(4)];
    const next = moveTab(tabs, "tab-4", 1);
    expect(ids(next)).toEqual(["tab-1", "tab-4", "tab-2", "tab-3"]);
  });

  it("moves to the last slot when the target is exactly length-1", () => {
    const tabs = [make(1), make(2), make(3)];
    const next = moveTab(tabs, "tab-1", 2);
    expect(ids(next)).toEqual(["tab-2", "tab-3", "tab-1"]);
  });

  it("clamps an out-of-range target to the last slot", () => {
    const tabs = [make(1), make(2), make(3)];
    const next = moveTab(tabs, "tab-1", 99);
    expect(ids(next)).toEqual(["tab-2", "tab-3", "tab-1"]);
  });

  it("clamps a negative target to the first slot", () => {
    const tabs = [make(1), make(2), make(3)];
    const next = moveTab(tabs, "tab-3", -5);
    expect(ids(next)).toEqual(["tab-3", "tab-1", "tab-2"]);
  });

  it("returns the SAME array for an unknown id", () => {
    const tabs = [make(1), make(2)];
    expect(moveTab(tabs, "nope", 0)).toBe(tabs);
  });

  it("returns the SAME array for a same-index move", () => {
    const tabs = [make(1), make(2), make(3)];
    expect(moveTab(tabs, "tab-2", 1)).toBe(tabs);
  });

  it("treats a clamped equal index as a no-op (same array)", () => {
    const tabs = [make(1), make(2), make(3)];
    expect(moveTab(tabs, "tab-3", 99)).toBe(tabs);
  });

  it("does not mutate the input array", () => {
    const tabs = [make(1), make(2), make(3)];
    const snapshot = ids(tabs);
    moveTab(tabs, "tab-1", 2);
    expect(ids(tabs)).toEqual(snapshot);
  });
});

describe("tabs reducer — move", () => {
  const seed = (): ReturnType<typeof tabsReducer> =>
    [1, 2, 3, 4].reduce(
      (s, i) => tabsReducer(s, { type: "open", tab: make(i) }),
      initialTabsState,
    );

  it("reorders without changing the active id", () => {
    const s = seed();
    const active = tabsReducer(s, { type: "activate", id: "tab-2" });
    expect(active.activeId).toBe("tab-2");
    const moved = tabsReducer(active, { type: "move", id: "tab-1", toIndex: 2 });
    expect(ids(moved.tabs)).toEqual(["tab-2", "tab-3", "tab-1", "tab-4"]);
    expect(moved.activeId).toBe("tab-2");
  });

  it("preserves the active id even when the moved tab is the active one", () => {
    const s = seed(); // active is tab-4 after the seed opens
    expect(s.activeId).toBe("tab-4");
    const next = tabsReducer(s, { type: "move", id: "tab-4", toIndex: 0 });
    expect(ids(next.tabs)).toEqual(["tab-4", "tab-1", "tab-2", "tab-3"]);
    expect(next.activeId).toBe("tab-4");
  });

  it("is an identity no-op when the move resolves to the same slot", () => {
    const s = seed();
    const next = tabsReducer(s, { type: "move", id: "tab-2", toIndex: 1 });
    expect(next).toBe(s);
  });

  it("is an identity no-op for an unknown id", () => {
    const s = seed();
    const next = tabsReducer(s, { type: "move", id: "missing", toIndex: 0 });
    expect(next).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// DEF-411 — the restore rule. The DEF-034 activation fires on the
// pointerdown that ARMS the reorder drag, so a background tab becomes
// active before the reorder commits. The commit restores the pre-drag
// active tab; these tests pin the decision predicate and the component
// wiring.
// ---------------------------------------------------------------------------
describe("shouldRestoreActiveOnReorder (DEF-411)", () => {
  it("restores when a background tab is dragged to a new slot", () => {
    expect(shouldRestoreActiveOnReorder("a", "c", 2, 1)).toBe(true);
  });

  it("does not restore when the dragged tab was already active", () => {
    expect(shouldRestoreActiveOnReorder("c", "c", 2, 0)).toBe(false);
  });

  it("does not restore when the release slot equals the origin slot", () => {
    expect(shouldRestoreActiveOnReorder("a", "c", 2, 2)).toBe(false);
  });

  it("does not restore when no tab was active before the drag", () => {
    expect(shouldRestoreActiveOnReorder(null, "c", 2, 0)).toBe(false);
  });

  it("restores when the origin index is unknown (defensive)", () => {
    expect(shouldRestoreActiveOnReorder("a", "c", null, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEF-411 — component wiring. jsdom has no layout, so the tab rects are
// stubbed to a simple 100px row; the real threshold / drop-marker
// geometry is qa's browser job. These tests drive the production
// pointer handlers and assert the commit restores the pre-drag active
// tab while a plain click still activates normally.
// ---------------------------------------------------------------------------
interface ReorderRender {
  root: HTMLElement;
  onActivate: ReturnType<typeof vi.fn>;
  onMoveTab: ReturnType<typeof vi.fn>;
}

const TAB_DEFS = [
  { id: "a", title: "a.pdf", modified: false },
  { id: "b", title: "b.pdf", modified: false },
  { id: "c", title: "c.pdf", modified: false },
];

function rect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 0,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as unknown as DOMRect;
}

function pointerEvent(type: string, clientX: number, pointerId = 1): Event {
  const e = new MouseEvent(type, { bubbles: true, button: 0, clientX });
  Object.defineProperty(e, "pointerId", { value: pointerId });
  return e;
}

function renderReorderHeader(activeId: string): ReorderRender {
  const onActivate = vi.fn();
  const onMoveTab = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(AppHeader, {
        activeId,
        tabs: TAB_DEFS,
        onActivate,
        onClose: (): void => undefined,
        theme: "frosted" as Theme,
        onThemeChange: (): void => undefined,
        onNewEmptyTab: (): void => undefined,
        onOpenPreferences: (): void => undefined,
        onMoveTab,
      }),
    );
  });
  // Stub the geometry: a, b, c laid out left-to-right at 100px each.
  const list = container.querySelector<HTMLElement>(".tab-list");
  if (list !== null) list.getBoundingClientRect = (): DOMRect => rect(0, 300);
  TAB_DEFS.forEach((tab, i) => {
    const el = container.querySelector<HTMLElement>(`[data-tab-id='${tab.id}']`);
    if (el !== null) el.getBoundingClientRect = (): DOMRect => rect(i * 100, 100);
  });
  return { root: container, onActivate, onMoveTab };
}

function armDrag(el: HTMLElement, clientX: number): void {
  act((): void => {
    el.dispatchEvent(pointerEvent("pointerdown", clientX));
  });
}

function movePointer(clientX: number): void {
  act((): void => {
    window.dispatchEvent(pointerEvent("pointermove", clientX));
  });
}

function releasePointer(): void {
  act((): void => {
    window.dispatchEvent(pointerEvent("pointerup", 0));
  });
}

describe("AppHeader reorder commit restores the pre-drag active tab (DEF-411)", () => {
  it("dragging a background tab left restores the pre-drag active tab", () => {
    const { root, onActivate, onMoveTab } = renderReorderHeader("a");
    const tabC = root.querySelector<HTMLElement>("[data-tab-id='c']");
    expect(tabC).not.toBeNull();
    if (tabC === null) return;
    // DEF-034 — the arming mousedown activates the dragged tab.
    act((): void => {
      tabC.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    expect(onActivate).toHaveBeenCalledWith("c");
    armDrag(tabC, 220);
    movePointer(120); // past b's midpoint -> target slot 1
    releasePointer();
    expect(onMoveTab).toHaveBeenCalledWith("c", 1);
    expect(onActivate).toHaveBeenLastCalledWith("a");
  });

  it("dragging the already-active tab does not add a restore activation", () => {
    const { root, onActivate, onMoveTab } = renderReorderHeader("c");
    const tabC = root.querySelector<HTMLElement>("[data-tab-id='c']");
    if (tabC === null) return;
    act((): void => {
      tabC.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    armDrag(tabC, 220);
    movePointer(10); // target slot 0
    releasePointer();
    expect(onMoveTab).toHaveBeenCalledWith("c", 0);
    // The already-active tab's mousedown is a no-op (AnimatedTab guard),
    // and the commit adds no restore activation either.
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("releasing at the origin slot does not restore", () => {
    const { root, onActivate } = renderReorderHeader("a");
    const tabC = root.querySelector<HTMLElement>("[data-tab-id='c']");
    if (tabC === null) return;
    act((): void => {
      tabC.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    armDrag(tabC, 220);
    movePointer(280); // past every midpoint -> target slot 2 === origin
    releasePointer();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("a plain click (no drag) activates once and never restores", () => {
    const { root, onActivate, onMoveTab } = renderReorderHeader("a");
    const tabC = root.querySelector<HTMLElement>("[data-tab-id='c']");
    if (tabC === null) return;
    act((): void => {
      tabC.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
    armDrag(tabC, 220);
    releasePointer(); // no pointermove -> never began a drag
    expect(onMoveTab).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("c");
  });
});

// ---------------------------------------------------------------------------
// DEF-413 — a mousedown inside a NON-active tab's .tab-title must not
// activate immediately: it waits for the release, and a drag-select over
// the title (a non-collapsed selection inside it) suppresses activation
// entirely. Clicks outside the title keep the immediate DEF-034 path;
// those are pinned by the reorder tests above and by appHeader.test.tsx.
// ---------------------------------------------------------------------------
describe("AnimatedTab — title activation defers to a non-selecting mouseup (DEF-413)", () => {
  const downOnTitle = (el: HTMLElement): void => {
    act((): void => {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });
  };
  const upOnWindow = (): void => {
    act((): void => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    });
  };

  it("activates on a title mousedown followed by a collapsed-selection mouseup", () => {
    const { root, onActivate } = renderReorderHeader("a");
    const selection = window.getSelection();
    selection?.removeAllRanges(); // guarantee a collapsed selection
    const title = root.querySelector<HTMLElement>("[data-tab-id='c'] .tab-title");
    expect(title).not.toBeNull();
    if (title === null) return;
    downOnTitle(title);
    // DEF-413 — the mousedown alone must NOT activate a title hit.
    expect(onActivate).not.toHaveBeenCalled();
    upOnWindow();
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("c");
  });

  it("does NOT activate when the mouseup follows a non-collapsed title selection", () => {
    const { root, onActivate } = renderReorderHeader("a");
    const title = root.querySelector<HTMLElement>("[data-tab-id='c'] .tab-title");
    expect(title).not.toBeNull();
    if (title === null) return;
    // A real drag-select inside the title: a non-collapsed Range whose
    // start/end containers fall inside .tab-title.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(title);
    selection?.removeAllRanges();
    selection?.addRange(range);
    downOnTitle(title);
    upOnWindow();
    expect(onActivate).not.toHaveBeenCalled();
    selection?.removeAllRanges();
  });
});

// ---------------------------------------------------------------------------
// Phase 58 (chunk 6b) — tear-out. The PURE decision: a release past the
// threshold BELOW the strip detaches; everything else reorders. A
// horizontal escape alone is NOT a detach, and a missing detach handler
// can never detach.
// ---------------------------------------------------------------------------
describe("tearOutDecision (Phase 58 chunk 6b)", () => {
  const strip = { left: 0, right: 300, top: 0, bottom: 28 };

  it("returns reorder for a pointer inside the strip", () => {
    expect(
      tearOutDecision({ pointer: { x: 120, y: 10 }, strip, hasDetach: true }),
    ).toBe("reorder");
  });

  it("returns detach for a pointer more than the threshold below the strip", () => {
    // bottom 28 + default threshold 24 = 52; 53 is past it.
    expect(
      tearOutDecision({ pointer: { x: 120, y: 53 }, strip, hasDetach: true }),
    ).toBe("detach");
  });

  it("returns reorder when the pointer is below the strip but within the threshold", () => {
    // Exactly at the boundary is NOT past it.
    expect(
      tearOutDecision({ pointer: { x: 120, y: 52 }, strip, hasDetach: true }),
    ).toBe("reorder");
  });

  it("honours an explicit threshold", () => {
    expect(
      tearOutDecision({ pointer: { x: 120, y: 60 }, strip, hasDetach: true, threshold: 100 }),
    ).toBe("reorder");
  });

  it("always reorders when hasDetach is false", () => {
    expect(
      tearOutDecision({ pointer: { x: 120, y: 500 }, strip, hasDetach: false }),
    ).toBe("reorder");
  });

  it("a horizontal escape alone stays a reorder", () => {
    expect(
      tearOutDecision({ pointer: { x: -400, y: 10 }, strip, hasDetach: true }),
    ).toBe("reorder");
    expect(
      tearOutDecision({ pointer: { x: 4000, y: 10 }, strip, hasDetach: true }),
    ).toBe("reorder");
  });
});

// ---------------------------------------------------------------------------
// Phase 58 (chunk 6b) — component wiring. jsdom has no layout, so the
// strip rect is stubbed with a real `bottom`. A downward release must
// call `onDetachTab` and NOT `onMoveTab`; an in-strip release must call
// `onMoveTab` and NOT `onDetachTab`.
// ---------------------------------------------------------------------------
interface DetachRender {
  root: HTMLElement;
  onDetachTab: ReturnType<typeof vi.fn>;
  onMoveTab: ReturnType<typeof vi.fn>;
}

function pointerEventXY(type: string, clientX: number, clientY: number, pointerId = 1): Event {
  const e = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(e, "pointerId", { value: pointerId });
  return e;
}

function renderDetachHeader(activeId: string): DetachRender {
  const onActivate = vi.fn();
  const onMoveTab = vi.fn();
  const onDetachTab = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(AppHeader, {
        activeId,
        tabs: TAB_DEFS,
        onActivate,
        onClose: (): void => undefined,
        theme: "frosted" as Theme,
        onThemeChange: (): void => undefined,
        onNewEmptyTab: (): void => undefined,
        onOpenPreferences: (): void => undefined,
        onMoveTab,
        onDetachTab,
      }),
    );
  });
  // The strip sits at y [0, 28]; tabs laid out left-to-right at 100px each.
  const list = container.querySelector<HTMLElement>(".tab-list");
  if (list !== null) {
    list.getBoundingClientRect = (): DOMRect => ({
      left: 0,
      right: 300,
      width: 300,
      top: 0,
      bottom: 28,
      height: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
  }
  TAB_DEFS.forEach((tab, i) => {
    const el = container.querySelector<HTMLElement>(`[data-tab-id='${tab.id}']`);
    if (el !== null) el.getBoundingClientRect = (): DOMRect => rect(i * 100, 100);
  });
  return { root: container, onDetachTab, onMoveTab };
}

describe("AppHeader tear-out gesture (Phase 58 chunk 6b)", () => {
  it("a downward release past the threshold calls onDetachTab and NOT onMoveTab", () => {
    const { root, onDetachTab, onMoveTab } = renderDetachHeader("a");
    const tabC = root.querySelector<HTMLElement>("[data-tab-id='c']");
    if (tabC === null) return;
    armDrag(tabC, 220);
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointermove", 120, 100));
    });
    // The affordance is on while the gesture is past the threshold.
    const list = root.querySelector<HTMLElement>(".tab-list");
    expect(list?.getAttribute("data-tab-tearout")).toBe("true");
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointerup", 120, 100));
    });
    expect(onDetachTab).toHaveBeenCalledWith("c");
    expect(onMoveTab).not.toHaveBeenCalled();
    // The affordance clears once the gesture ends.
    expect(list?.getAttribute("data-tab-tearout")).toBeNull();
  });

  it("an in-strip release calls onMoveTab and NOT onDetachTab", () => {
    const { root, onDetachTab, onMoveTab } = renderDetachHeader("a");
    const tabC = root.querySelector<HTMLElement>("[data-tab-id='c']");
    if (tabC === null) return;
    armDrag(tabC, 220);
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointermove", 120, 10));
    });
    const list = root.querySelector<HTMLElement>(".tab-list");
    expect(list?.getAttribute("data-tab-tearout")).toBeNull();
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointerup", 120, 10));
    });
    expect(onMoveTab).toHaveBeenCalledWith("c", 1);
    expect(onDetachTab).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DEF-412 — single-tab gestures. A freshly detached window holds exactly
// one tab, so BOTH the tear-out (origin window) and the drag-back (detached
// window) gestures must ARM there. The arm gate no longer requires >1 tab;
// the REORDER COMMIT owns that guard, so a single-tab drag can still detach
// while a non-tear-out release is a harmless no-op (never a bogus index).
// ---------------------------------------------------------------------------
interface SingleTabRender {
  root: HTMLElement;
  onMoveTab: ReturnType<typeof vi.fn>;
  onDetachTab: ReturnType<typeof vi.fn>;
}

const SOLO_TAB = [{ id: "solo", title: "solo.pdf", modified: false }];

function renderSingleTabHeader(detach: boolean): SingleTabRender {
  const onMoveTab = vi.fn();
  const onDetachTab = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(AppHeader, {
        activeId: "solo",
        tabs: SOLO_TAB,
        onActivate: (): void => undefined,
        onClose: (): void => undefined,
        theme: "frosted" as Theme,
        onThemeChange: (): void => undefined,
        onNewEmptyTab: (): void => undefined,
        onOpenPreferences: (): void => undefined,
        onMoveTab,
        ...(detach ? { onDetachTab } : {}),
      }),
    );
  });
  // The strip sits at y [0, 28]; the single tab spans x [0, 100].
  const list = container.querySelector<HTMLElement>(".tab-list");
  if (list !== null) {
    list.getBoundingClientRect = (): DOMRect => ({
      left: 0,
      right: 100,
      width: 100,
      top: 0,
      bottom: 28,
      height: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
  }
  const el = container.querySelector<HTMLElement>("[data-tab-id='solo']");
  if (el !== null) el.getBoundingClientRect = (): DOMRect => rect(0, 100);
  return { root: container, onMoveTab, onDetachTab };
}

describe("AppHeader single-tab drag gestures (DEF-412)", () => {
  it("arms with one tab: a tear-out drop calls onDetachTab and NOT onMoveTab", () => {
    const { root, onMoveTab, onDetachTab } = renderSingleTabHeader(true);
    const tab = root.querySelector<HTMLElement>("[data-tab-id='solo']");
    expect(tab).not.toBeNull();
    if (tab === null) return;
    armDrag(tab, 50);
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointermove", 50, 100));
    });
    const list = root.querySelector<HTMLElement>(".tab-list");
    // The arm gate no longer needs >1 tab, so the gesture is live.
    expect(list?.getAttribute("data-dragging-tab")).toBe("solo");
    expect(list?.getAttribute("data-tab-tearout")).toBe("true");
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointerup", 50, 100));
    });
    expect(onDetachTab).toHaveBeenCalledWith("solo");
    expect(onMoveTab).not.toHaveBeenCalled();
  });

  it("arms with one tab: a non-tear-out downward release is a harmless no-op", () => {
    const { root, onMoveTab, onDetachTab } = renderSingleTabHeader(false);
    const tab = root.querySelector<HTMLElement>("[data-tab-id='solo']");
    if (tab === null) return;
    armDrag(tab, 50);
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointermove", 50, 100));
    });
    const list = root.querySelector<HTMLElement>(".tab-list");
    expect(list?.getAttribute("data-dragging-tab")).toBe("solo");
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointerup", 50, 100));
    });
    // No detach handler and no meaningful reorder target: nothing fires.
    expect(onMoveTab).not.toHaveBeenCalled();
    expect(onDetachTab).not.toHaveBeenCalled();
  });

  it("arms on a purely VERTICAL move past the threshold (no horizontal nudge)", () => {
    const { root } = renderDetachHeader("a");
    const tabC = root.querySelector<HTMLElement>("[data-tab-id='c']");
    if (tabC === null) return;
    armDrag(tabC, 220);
    // Same clientX as the arm point: only clientY changes.
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointermove", 220, 10));
    });
    const list = root.querySelector<HTMLElement>(".tab-list");
    expect(list?.getAttribute("data-dragging-tab")).toBe("c");
  });

  it("does not arm below the total-movement threshold", () => {
    const { root } = renderDetachHeader("a");
    const tabC = root.querySelector<HTMLElement>("[data-tab-id='c']");
    if (tabC === null) return;
    armDrag(tabC, 220);
    act((): void => {
      window.dispatchEvent(pointerEventXY("pointermove", 220, 4));
    });
    const list = root.querySelector<HTMLElement>(".tab-list");
    expect(list?.getAttribute("data-dragging-tab")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 58 (chunk 6c) — the detached-window half. The SAME tear-out gesture
// that detaches a tab in the origin window returns it in a detached window.
// `tabExitAction` is the pure branch the `detachTab` handler reads; the
// notify-once empty-window close is exercised by qa's real two-window round
// trip (it lives inline in the App component, which jsdom cannot drive here
// without the full IPC surface).
// ---------------------------------------------------------------------------
describe("tabExitAction (Phase 58 chunk 6c)", () => {
  it("returns 'return' for a detached window", () => {
    expect(tabExitAction(true)).toBe("return");
  });

  it("returns 'detach' for the origin window", () => {
    expect(tabExitAction(false)).toBe("detach");
  });
});
