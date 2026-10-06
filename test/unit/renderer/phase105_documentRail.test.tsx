// @vitest-environment jsdom
//
// Phase 105 (chunk D) — the document rail's responsive overflow, the All-tabs
// switcher, the identity finish and the accessibility contract.
//
// The retired uniform-shrink regime squeezed every tab toward 0. The rail now
// plans a capacity (`planRailCapacity`): the New-tab and All-tabs controls are
// reserved FIRST, the ideal tab is 200px, and a tab is NEVER rendered below
// 136px — the sessions past the capacity are hidden but stay open and reachable
// through the All-tabs switcher.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  DocumentRail,
  RAIL_TAB_IDEAL_WIDTH,
  RAIL_TAB_MIN_WIDTH,
  buildSwitcherRows,
  planRailCapacity,
  tabFolderLabel,
} from "../../../src/renderer/components/DocumentRail";

interface TabSpec {
  id: string;
  title: string;
  modified: boolean;
  colorId?: string;
  filePath?: string;
}

function makeTabs(count: number, overrides: (i: number) => Partial<TabSpec> = () => ({})): TabSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i}`,
    title: `doc-${i}.pdf`,
    modified: false,
    ...overrides(i),
  }));
}

function mountRail(opts: {
  tabs: TabSpec[];
  activeId?: string | null;
  onActivate?: (id: string) => void;
}): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <DocumentRail
        activeId={opts.activeId ?? null}
        tabs={opts.tabs}
        onActivate={opts.onActivate ?? ((): void => undefined)}
        onClose={(): void => undefined}
        onNewEmptyTab={(): void => undefined}
      />,
    );
  });
  return container;
}

describe("Phase 105 (chunk D) — planRailCapacity", () => {
  it("reserves the controls FIRST (a bigger reserve hides more tabs)", () => {
    const roomy = planRailCapacity({ count: 4, availableWidth: 900, reserveWidths: 0 });
    expect(roomy.visibleCount).toBe(4);
    const squeezed = planRailCapacity({ count: 4, availableWidth: 900, reserveWidths: 400 });
    expect(squeezed.visibleCount).toBeLessThan(4);
    expect(squeezed.width).toBe(RAIL_TAB_MIN_WIDTH);
  });

  it("at a wide width returns every tab visible at the ideal width", () => {
    const plan = planRailCapacity({ count: 3, availableWidth: 1000, reserveWidths: 0 });
    expect(plan.visibleCount).toBe(3);
    expect(plan.width).toBe(RAIL_TAB_IDEAL_WIDTH);
  });

  it("at a narrow width every rendered tab stays at or above 136px", () => {
    const plan = planRailCapacity({ count: 12, availableWidth: 700, reserveWidths: 0 });
    expect(plan.visibleCount).toBeLessThan(12);
    expect(plan.width).toBeGreaterThanOrEqual(RAIL_TAB_MIN_WIDTH);
  });

  it("with 12 and 30 tabs at a narrow width visibleCount < count", () => {
    for (const count of [12, 30]) {
      const plan = planRailCapacity({ count, availableWidth: 640, reserveWidths: 40 });
      expect(plan.visibleCount, `count ${count}`).toBeLessThan(count);
      expect(plan.visibleCount, `count ${count}`).toBeGreaterThan(0);
      expect(plan.width).toBeGreaterThanOrEqual(RAIL_TAB_MIN_WIDTH);
    }
  });

  it("never plans a width outside the [min, ideal] band", () => {
    for (let count = 0; count <= 40; count += 1) {
      for (const availableWidth of [0, 120, 300, 640, 1200, 4000]) {
        const plan = planRailCapacity({ count, availableWidth, reserveWidths: 56 });
        expect(plan.width, `count ${count} @ ${availableWidth}`).toBeGreaterThanOrEqual(
          RAIL_TAB_MIN_WIDTH,
        );
        expect(plan.width).toBeLessThanOrEqual(RAIL_TAB_IDEAL_WIDTH);
        expect(plan.visibleCount).toBeLessThanOrEqual(count);
      }
    }
  });
});

describe("Phase 105 (chunk D) — the switcher rows", () => {
  it("attaches no context when every basename is unique", () => {
    const rows = buildSwitcherRows([
      { id: "a", title: "alpha.pdf", modified: false },
      { id: "b", title: "beta.pdf", modified: false },
    ]);
    expect(rows.map((r) => r.context)).toEqual(["", ""]);
  });

  it("disambiguates duplicate basenames by parent folder, never a full path", () => {
    const rows = buildSwitcherRows([
      { id: "a", title: "report.pdf", modified: false, filePath: "C:\\Work\\report.pdf" },
      { id: "b", title: "report.pdf", modified: false, filePath: "D:\\Archive\\report.pdf" },
    ]);
    expect(rows[0].context).toBe("Work");
    expect(rows[1].context).toBe("Archive");
    for (const row of rows) expect(row.context).not.toContain("\\");
  });

  it("tabFolderLabel returns the immediate parent only, for both separators", () => {
    expect(tabFolderLabel("C:\\Users\\me\\docs\\file.pdf")).toBe("docs");
    expect(tabFolderLabel("/home/me/docs/file.pdf")).toBe("docs");
    expect(tabFolderLabel("file.pdf")).toBe("");
    expect(tabFolderLabel(undefined)).toBe("");
  });
});
describe("Phase 105 (chunk D) � the All-tabs switcher DOM", () => {
  const TABS: TabSpec[] = [
    { id: "a", title: "alpha.pdf", modified: false, colorId: "violet" },
    { id: "b", title: "beta.pdf", modified: true, colorId: "ocean" },
    { id: "c", title: "gamma.pdf", modified: false, colorId: "jade" },
  ];

  afterEach((): void => {
    document.body.innerHTML = "";
  });

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

  it("renders every session in canonical order", () => {
    const host = mountRail({ tabs: TABS, activeId: "a" });
    const popover = openSwitcher(host);
    const rows = [...popover.querySelectorAll<HTMLElement>("[data-all-tabs-row]")];
    expect(rows.map((r) => r.getAttribute("data-all-tabs-row"))).toEqual(["a", "b", "c"]);
    expect(popover.querySelector(".all-tabs-count")?.textContent).toBe("3 documents");
  });

  it("shows the complete filename, never truncated by the rail", () => {
    const host = mountRail({
      tabs: [{ id: "x", title: "a-very-long-document-name-that-would-ellipsize.pdf", modified: false }],
    });
    const popover = openSwitcher(host);
    expect(popover.querySelector(".all-tabs-name")?.textContent).toBe(
      "a-very-long-document-name-that-would-ellipsize.pdf",
    );
  });

  it("shows a dirty dot and description only for modified sessions", () => {
    const host = mountRail({ tabs: TABS, activeId: "a" });
    const popover = openSwitcher(host);
    const dirty = popover.querySelector<HTMLElement>("[data-all-tabs-row='b']");
    const clean = popover.querySelector<HTMLElement>("[data-all-tabs-row='a']");
    expect(dirty?.querySelector(".all-tabs-dot")).not.toBeNull();
    expect(dirty?.getAttribute("aria-label")).toContain("unsaved changes");
    expect(clean?.querySelector(".all-tabs-dot")).toBeNull();
  });

  it("disambiguates two sessions with the same basename", () => {
    const host = mountRail({
      tabs: [
        { id: "a", title: "report.pdf", modified: false, filePath: "C:\\Work\\report.pdf" },
        { id: "b", title: "report.pdf", modified: false, filePath: "D:\\Archive\\report.pdf" },
      ],
    });
    const popover = openSwitcher(host);
    const contexts = [...popover.querySelectorAll<HTMLElement>(".all-tabs-context")].map(
      (n) => n.textContent,
    );
    expect(contexts).toEqual(["Work", "Archive"]);
  });

  it("clicking a row calls onActivate with the session id and closes", () => {
    const onActivate = vi.fn();
    const host = mountRail({ tabs: TABS, activeId: "a", onActivate });
    const popover = openSwitcher(host);
    const row = popover.querySelector<HTMLElement>("[data-all-tabs-row='c']");
    act((): void => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
expect(onActivate).toHaveBeenCalledWith("c");
    expect(host.querySelector("[data-all-tabs]")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes the popover and returns focus to [data-all-tabs]", () => {
    const host = mountRail({ tabs: TABS, activeId: "a" });
    openSwitcher(host);
    const trigger = host.querySelector<HTMLElement>("[data-all-tabs]");
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("the trigger's accessible name includes the session count", () => {
    const host = mountRail({ tabs: TABS, activeId: "a" });
    const trigger = host.querySelector<HTMLElement>("[data-all-tabs]");
    expect(trigger?.getAttribute("aria-label")).toContain("3");
  });
});

describe("Phase 105 (chunk D) � the rail at a narrow width", () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const hadOwnClientWidth = Object.prototype.hasOwnProperty.call(proto, "clientWidth");
  const originalClientWidth = hadOwnClientWidth
    ? Object.getOwnPropertyDescriptor(proto, "clientWidth")
    : undefined;

  beforeEach((): void => {
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get(this: HTMLElement): number {
        return this.classList?.contains("tab-list") ? 400 : 0;
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

  it("never renders a tab below 136px, and keeps both controls present", () => {
    const host = mountRail({ tabs: makeTabs(12), activeId: "t0" });
    const list = host.querySelector<HTMLElement>(".tab-list");
    const width = parseFloat(list?.style.getPropertyValue("--tf-tab-width") ?? "0");
    expect(width).toBeGreaterThanOrEqual(RAIL_TAB_MIN_WIDTH);
const rendered = host.querySelectorAll(
      '.tab-list > li:not([data-tab-overflow="hidden"]) > [data-tab-id]',
    );
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(12);
    expect(host.querySelector("[data-new-tab]")).not.toBeNull();
    expect(host.querySelector("[data-all-tabs]")).not.toBeNull();
  });

  it("shifts the visible window so a late active tab is still shown", () => {
    const host = mountRail({ tabs: makeTabs(12), activeId: "t11" });
    const active = host.querySelector<HTMLElement>("[data-tab-id='t11']");
    const first = host.querySelector<HTMLElement>("[data-tab-id='t0']");
    expect(active).not.toBeNull();
    expect(active?.closest("[data-tab-overflow='hidden']")).toBeNull();
    expect(first?.closest("[data-tab-overflow='hidden']")).not.toBeNull();
  });
});
