// @vitest-environment jsdom
//
// Phase 119 (chunk C) — the document rail's adaptive overflow.
//
// At a "tight" measured rail the standalone "+" utility (`.tab-list-new`)
// collapses and a labelled "New tab" row leads the All-tabs popover, wired to
// the SAME `onNewEmptyTab` prop (never two New-tab affordances at once). The
// All-tabs switcher itself never collapses and still lists EVERY session.
//
// Setup / harness mirror test/unit/renderer/phase105_documentRail.test.tsx
// (react-dom/client + `act`; the repo does not ship @testing-library/react).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { LAYOUT } from "../../../src/renderer/design/layout";
import {
  DocumentRail,
  NEW_TAB_MULTI_MODE_REASON,
  RAIL_TAB_MIN_WIDTH,
} from "../../../src/renderer/components/DocumentRail";

interface TabSpec {
  id: string;
  title: string;
  modified: boolean;
  colorId?: string;
  filePath?: string;
}

function mountRail(opts: {
  tabs: TabSpec[];
  activeId?: string | null;
  onNewEmptyTab?: () => void;
  multiModeEnabled?: boolean;
}): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <DocumentRail
        activeId={opts.activeId ?? null}
        tabs={opts.tabs}
        onActivate={(): void => undefined}
        onClose={(): void => undefined}
        onNewEmptyTab={opts.onNewEmptyTab ?? ((): void => undefined)}
        multiModeEnabled={opts.multiModeEnabled}
      />,
    );
  });
  return container;
}

function openSwitcher(host: HTMLElement): HTMLElement {
  const trigger = host.querySelector<HTMLElement>("[data-all-tabs]");
  expect(trigger).not.toBeNull();
  act((): void => {
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const popover = host.querySelector<HTMLElement>("[data-all-tabs-popover]");
  expect(popover).not.toBeNull();
  return popover as HTMLElement;
}

const TABS: TabSpec[] = [
  { id: "a", title: "alpha.pdf", modified: false },
  { id: "b", title: "beta.pdf", modified: true },
  { id: "c", title: "gamma.pdf", modified: false },
];

describe("Phase 119 (chunk C) — the rail minimum tab width", () => {
  it("RAIL_TAB_MIN_WIDTH is the shared LAYOUT.railMinTabPx (148)", () => {
    expect(RAIL_TAB_MIN_WIDTH).toBe(LAYOUT.railMinTabPx);
    expect(RAIL_TAB_MIN_WIDTH).toBe(148);
  });
});

describe("Phase 119 (chunk C) — the rail layout-class adaptivity", () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const hadOwnClientWidth = Object.prototype.hasOwnProperty.call(proto, "clientWidth");
  const originalClientWidth = hadOwnClientWidth
    ? Object.getOwnPropertyDescriptor(proto, "clientWidth")
    : undefined;
  let stubWidth = 0;

  beforeEach((): void => {
    stubWidth = 0;
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get(this: HTMLElement): number {
        return this.classList?.contains("tab-list") ? stubWidth : 0;
      },
    });
  });

  afterEach((): void => {
    if (hadOwnClientWidth && originalClientWidth !== undefined) {
      Object.defineProperty(proto, "clientWidth", originalClientWidth);
    } else {
      delete proto.clientWidth;
    }
    document.body.innerHTML = "";
  });

  it("at a tight width collapses the + and moves New tab into the popover", () => {
    stubWidth = 300;
    const onNewEmptyTab = vi.fn();
    const host = mountRail({ tabs: TABS, activeId: "a", onNewEmptyTab });
    const root = host.querySelector<HTMLElement>("[data-document-rail]");
    expect(root?.getAttribute("data-rail-overflow")).toBe("true");
    expect(host.querySelector('[data-rail-new-collapsed="true"]')).not.toBeNull();
    expect(host.querySelector("[data-new-tab]:not([hidden])")).toBeNull();
    const popover = openSwitcher(host);
    const newRow = popover.querySelector<HTMLElement>("[data-rail-overflow-new]");
    expect(newRow).not.toBeNull();
    expect(newRow?.textContent).toContain("New tab");
    act((): void => {
      newRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNewEmptyTab).toHaveBeenCalledTimes(1);
  });

  it("at a tight width still lists EVERY session, with New tab as the first row", () => {
    stubWidth = 300;
    const host = mountRail({ tabs: TABS, activeId: "a" });
    const popover = openSwitcher(host);
    const rows = [...popover.querySelectorAll<HTMLElement>("[data-all-tabs-row]")];
    expect(rows.map((r) => r.getAttribute("data-all-tabs-row"))).toEqual(["a", "b", "c"]);
    const first = popover.querySelector<HTMLElement>(".all-tabs-rows")?.firstElementChild;
    expect(first?.hasAttribute("data-rail-overflow-new")).toBe(true);
  });

  it("at a tight width disables the overflow New-tab row under Multi Mode", () => {
    stubWidth = 300;
    const host = mountRail({ tabs: TABS, activeId: "a", multiModeEnabled: true });
    const popover = openSwitcher(host);
    const newRow = popover.querySelector<HTMLElement>("[data-rail-overflow-new]");
    expect(newRow).not.toBeNull();
    expect(newRow?.hasAttribute("disabled")).toBe(true);
    expect(newRow?.getAttribute("title")).toBe(NEW_TAB_MULTI_MODE_REASON);
  });

  it("at a wide width keeps the standalone + and renders no overflow New-tab row", () => {
    stubWidth = 1200;
    const host = mountRail({ tabs: TABS, activeId: "a" });
    const root = host.querySelector<HTMLElement>("[data-document-rail]");
    expect(root?.getAttribute("data-rail-overflow")).toBeNull();
    expect(host.querySelector("[data-new-tab]:not([hidden])")).not.toBeNull();
    const popover = openSwitcher(host);
    expect(popover.querySelector("[data-rail-overflow-new]")).toBeNull();
  });
});
