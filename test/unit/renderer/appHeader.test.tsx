// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { DocumentRail } from "../../../src/renderer/components/DocumentRail";

/**
 * Phase 105 (chunk C) — the tab strip moved out of AppHeader into the
 * document rail. These tests pin the "+ tab" placement and the DEF-034 /
 * DEF-041 activation contract on the rail, where the strip now lives.
 *
 * The '+ tab' affordance is the last <li> INSIDE `.tab-list` (Phase 7 fix #2)
 * and is hidden while no tabs are open (DEF-055).
 */

function mouseDown(el: Element, button: 0 | 1 | 2 = 0): void {
  act((): void => {
    const evt = new MouseEvent("mousedown", { bubbles: true, button });
    el.dispatchEvent(evt);
  });
}

interface RenderArgs {
  tabs?: Array<{ id: string; title: string; modified: boolean }>;
  activeId?: string | null;
  onActivate?: (id: string) => void;
  onClose?: (id: string) => void;
  onNewEmptyTab?: () => void;
}

function renderRail(args: RenderArgs = {}): HTMLElement {
  const onActivate = args.onActivate ?? ((): void => undefined);
  const onClose = args.onClose ?? ((): void => undefined);
  const onNewEmptyTab = args.onNewEmptyTab ?? ((): void => undefined);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <DocumentRail
        activeId={args.activeId ?? null}
        tabs={args.tabs ?? []}
        onActivate={onActivate}
        onClose={onClose}
        onNewEmptyTab={onNewEmptyTab}
      />,
    );
  });
  return container;
}

describe("DocumentRail — '+ tab' placement (Phase 7 fix #2)", () => {
  it("renders the '+ tab' and All-tabs controls as the trailing <li>s", () => {
    const root = renderRail({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: true },
      ],
      activeId: "a",
    });

    const tabList = root.querySelector(".tab-list");
    expect(tabList).not.toBeNull();
    const items = tabList!.children;
    // 2 tabs + the "+" + the All-tabs control.
    expect(items.length).toBe(4);
    const last = items[items.length - 1] as HTMLElement;
    expect(last.classList.contains("tab-list-all")).toBe(true);
    const plusItem = items[items.length - 2] as HTMLElement;
    expect(plusItem.classList.contains("tab-list-new")).toBe(true);
    const plus = plusItem.querySelector("[data-new-tab]");
    expect(plus).not.toBeNull();
  });

  it("keeps the '+ tab' button immediately after the rightmost tab", () => {
    const root = renderRail({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: false },
        { id: "c", title: "c.pdf", modified: false },
      ],
      activeId: "c",
    });
    const items = Array.from(root.querySelectorAll(".tab-list > li"));
    expect(items.length).toBe(5);
    expect(items[items.length - 3]?.querySelector("[data-tab-id='c']")).not.toBeNull();
    expect(items[items.length - 2]?.querySelector("[data-new-tab]")).not.toBeNull();
    expect(items[items.length - 1]?.querySelector("[data-all-tabs]")).not.toBeNull();
  });

  it("hides the '+ tab' button when there are no tabs (DEF-055 welcome)", () => {
    const root = renderRail({ tabs: [], activeId: null });
    const tabList = root.querySelector(".tab-list");
    expect(tabList).not.toBeNull();
    expect(tabList!.children.length).toBe(0);
    expect(root.querySelector("[data-new-tab]")).toBeNull();
  });

  it("shows the '+ tab' button once at least one tab is open", () => {
    const root = renderRail({
      tabs: [{ id: "a", title: "a.pdf", modified: false }],
      activeId: "a",
    });
    const items = Array.from(root.querySelectorAll(".tab-list > li"));
    // 1 tab + the "+" + the All-tabs control.
    expect(items.length).toBe(3);
    expect(items[0]?.querySelector("[data-tab-id='a']")).not.toBeNull();
    expect(items[1]?.querySelector("[data-new-tab]")).not.toBeNull();
    expect(items[2]?.querySelector("[data-all-tabs]")).not.toBeNull();
  });

  it("does not render the '+ tab' button outside .tab-list", () => {
    const root = renderRail({
      tabs: [{ id: "a", title: "a.pdf", modified: false }],
    });
    const tabArea = root.querySelector(".tab-area");
    expect(tabArea).not.toBeNull();
    const children = Array.from(tabArea!.children);
    expect(children.length).toBe(1);
    expect(children[0]?.classList.contains("tab-list")).toBe(true);
  });

  it("renders the rail shell with the document-rail row", () => {
    const root = renderRail({ tabs: [{ id: "a", title: "a.pdf", modified: false }] });
    expect(root.querySelector("[data-document-rail]")).not.toBeNull();
    expect(root.querySelector(".document-rail")).not.toBeNull();
  });
});

describe("DocumentRail — click on padding / gap activates the tab (DEF-041)", () => {
  it("activates when the mousedown lands on the outer .tab container", () => {
    const onActivate = vi.fn();
    const root = renderRail({
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
    const root = renderRail({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: false },
      ],
      activeId: "a",
      onActivate,
    });
    const title = root.querySelector<HTMLElement>("[data-tab-id='b'] .tab-title");
    expect(title).not.toBeNull();
    if (title === null) return;
    mouseDown(title);
    expect(onActivate).toHaveBeenCalledWith("b");
  });

  it("does not re-activate when the mousedown lands on the already-active tab", () => {
    const onActivate = vi.fn();
    const root = renderRail({
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
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const root = renderRail({
      tabs: [
        { id: "a", title: "a.pdf", modified: false },
        { id: "b", title: "b.pdf", modified: true },
      ],
      activeId: "a",
      onActivate,
      onClose,
    });
    const closeBtn = root.querySelector<HTMLButtonElement>("[data-tab-id='b'] .tab-close");
    expect(closeBtn).not.toBeNull();
    if (closeBtn === null) return;
    mouseDown(closeBtn);
    expect(onActivate).not.toHaveBeenCalled();
    act((): void => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalledWith("b");
  });

  it("ignores non-primary mouse buttons", () => {
    const onActivate = vi.fn();
    const root = renderRail({
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
    const onActivate = vi.fn();
    const root = renderRail({
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
