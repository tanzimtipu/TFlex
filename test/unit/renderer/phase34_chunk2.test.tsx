// @vitest-environment jsdom
//
// Phase 34 (chunk 2) — the tab-strip and divider-header items from the
// operator's feedback:
//
//   2. Multi Mode shows ONE tab, not two. The single composite tab names
//      BOTH documents, its modified flag follows either document, and
//      closing it prompts once per modified document before closing both.
//   3. Both file names flank the divider: pane A's name/count hug the
//      divider's LEFT side and pane B's the RIGHT side, with the clear
//      control still working and focusing its pane.
//
// Plus the chunk-1 remainder: the rail's APPEND insertion line (a page
// dropped below the last thumbnail).
//
// The App header wiring is asserted at the source level (App.tsx is not
// mountable in a unit test — it bootstraps the whole workspace); the pure
// decision seams and the presentational pieces are exercised directly.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { AppHeader, NEW_TAB_MULTI_MODE_REASON } from "../../../src/renderer/components/AppHeader";
import {
  DocumentStage,
  MultiPaneHeader,
  type StageTab,
} from "../../../src/renderer/components/MultiPane";
import {
  PANE_DIVIDER_W_PX,
  multiPaneGeometry,
} from "../../../src/renderer/components/multiPaneLayout";
import { ThumbnailRail } from "../../../src/renderer/components/SideRail";
import { PageDragProvider, usePageDrag } from "../../../src/renderer/state/PageDragContext";
import { buildDragSource } from "../../../src/renderer/state/pageDrag";
import { collectModifiedTabIds } from "../../../src/renderer/state/closeGate";
import {
  COMPOSITE_EMPTY_LABEL,
  COMPOSITE_TAB_ID,
  advanceCompositeQueue,
  compositeDocRefs,
  compositeHeaderTab,
  planCompositeClose,
  type CompositeDocRef,
} from "../../../src/renderer/state/compositeTab";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const NOOP = (): void => undefined;

function mount(element: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Render AppHeader with the given tabs (same prop contract as App). */
function renderHeader(args: {
  tabs: Array<{ id: string; title: string; modified: boolean }>;
  activeId: string | null;
  onActivate?: (id: string) => void;
  onClose?: (id: string) => void;
  multiModeEnabled?: boolean;
}): HTMLElement {
  return mount(
    <AppHeader
      activeId={args.activeId}
      tabs={args.tabs}
      onActivate={args.onActivate ?? NOOP}
      onClose={args.onClose ?? NOOP}
      theme="frosted"
      onThemeChange={NOOP}
      onNewEmptyTab={NOOP}
      onOpenPreferences={NOOP}
      multiModeEnabled={args.multiModeEnabled ?? false}
    />,
  ).host;
}

const DOCS: CompositeDocRef[] = [
  { id: "a", title: "report.pdf", modified: false },
  { id: "b", title: "long.pdf", modified: false },
];

const byId = (id: string): CompositeDocRef | null =>
  DOCS.find((d) => d.id === id) ?? null;

// ---------------------------------------------------------------------------
// ITEM 2 — the composite tab's pure projection.
// ---------------------------------------------------------------------------

describe("Phase 34 — item 2: the composite tab projection", () => {
  it("joins both document names with ' + '", () => {
    const refs = compositeDocRefs("a", "b", byId);
    const tab = compositeHeaderTab(refs);
    expect(tab.id).toBe(COMPOSITE_TAB_ID);
    expect(tab.title).toBe("report.pdf + long.pdf");
  });

  it("follows EITHER document's modified flag", () => {
    expect(compositeHeaderTab([{ id: "a", title: "report.pdf", modified: false }, { id: "b", title: "long.pdf", modified: false }]).modified).toBe(false);
    expect(compositeHeaderTab([{ id: "a", title: "report.pdf", modified: true }, { id: "b", title: "long.pdf", modified: false }]).modified).toBe(true);
    expect(compositeHeaderTab([{ id: "a", title: "report.pdf", modified: false }, { id: "b", title: "long.pdf", modified: true }]).modified).toBe(true);
  });

  it("is still ONE tab when only one pane has a document", () => {
    const tab = compositeHeaderTab(compositeDocRefs("a", null, byId));
    expect(tab.title).toBe("report.pdf");
  });

  it("is still ONE tab when both panes are empty", () => {
    const tab = compositeHeaderTab([]);
    expect(tab.id).toBe(COMPOSITE_TAB_ID);
    expect(tab.title).toBe(COMPOSITE_EMPTY_LABEL);
    expect(tab.modified).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ITEM 2 — the single tab renders in the strip.
// ---------------------------------------------------------------------------

describe("Phase 34 — item 2: the strip renders exactly one composite tab", () => {
  it("shows one active tab whose label contains BOTH names", () => {
    const composite = compositeHeaderTab(compositeDocRefs("a", "b", byId));
    const host = renderHeader({ tabs: [composite], activeId: COMPOSITE_TAB_ID });
    try {
      const tabs = host.querySelectorAll(".tab");
      expect(tabs.length).toBe(1);
      const title = host.querySelector(".tab-title");
      expect(title?.textContent).toContain("report.pdf");
      expect(title?.textContent).toContain("long.pdf");
      // Graceful truncation keeps the full names in the tooltip.
      expect(title?.getAttribute("title")).toBe("report.pdf + long.pdf");
      expect(host.querySelector("[data-tab-id]")?.classList.contains("tab-active")).toBe(true);
    } finally {
      host.remove();
    }
  });

  it("shows the modified dot when either document is dirty", () => {
    const composite = compositeHeaderTab([
      { id: "a", title: "report.pdf", modified: false },
      { id: "b", title: "long.pdf", modified: true },
    ]);
    const host = renderHeader({ tabs: [composite], activeId: COMPOSITE_TAB_ID });
    try {
      const dot = host.querySelector(".tab-modified-dot");
      expect(dot).not.toBeNull();
      expect(dot?.classList.contains("tab-modified-dot-hidden")).toBe(false);
    } finally {
      host.remove();
    }
  });

  it("routes the composite close to the host onClose", () => {
    const onClose = vi.fn();
    const composite = compositeHeaderTab(compositeDocRefs("a", "b", byId));
    const host = renderHeader({ tabs: [composite], activeId: COMPOSITE_TAB_ID, onClose });
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>(".tab-close")?.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledWith(COMPOSITE_TAB_ID);
    } finally {
      host.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-288 — "+ tab" is VISIBLY DISABLED while Multi Mode is on, with a clear
// reason. Single mode keeps the enabled "New empty tab" behaviour exactly.
// ---------------------------------------------------------------------------

describe("DEF-288 — the '+' is disabled with a reason in Multi Mode", () => {
  const tabs = [{ id: "a", title: "report.pdf", modified: false }];

  it("disables the + and explains why while Multi Mode is on", () => {
    const host = renderHeader({ tabs, activeId: "a", multiModeEnabled: true });
    try {
      const plus = host.querySelector<HTMLButtonElement>("[data-new-tab]");
      expect(plus).not.toBeNull();
      expect(plus?.disabled).toBe(true);
      expect(plus?.getAttribute("title")).toBe(NEW_TAB_MULTI_MODE_REASON);
      expect(plus?.getAttribute("aria-label")).toBe(NEW_TAB_MULTI_MODE_REASON);
      // The wrapper carries the tooltip too (a disabled button does not
      // reliably surface one in Chromium).
      expect(host.querySelector(".tab-list-new")?.getAttribute("title")).toBe(
        NEW_TAB_MULTI_MODE_REASON,
      );
    } finally {
      host.remove();
    }
  });

  it("keeps the + enabled with the normal label in single mode", () => {
    const host = renderHeader({ tabs, activeId: "a", multiModeEnabled: false });
    try {
      const plus = host.querySelector<HTMLButtonElement>("[data-new-tab]");
      expect(plus?.disabled).toBe(false);
      expect(plus?.getAttribute("title")).toBe("New empty tab");
      expect(host.querySelector(".tab-list-new")?.getAttribute("title")).toBeNull();
    } finally {
      host.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-289 — the composite tab's close always ACTS. With no document in
// either pane it leaves the Multi Mode workspace instead of silently
// no-opping. (App.tsx is not mountable; pin the source contract like the
// other App wiring tests above.)
// ---------------------------------------------------------------------------

describe("DEF-289 — the empty composite close leaves the workspace", () => {
  const appSrc = readFileSync(APP_PATH, "utf8");

  it("disables Multi Mode when both panes are empty", () => {
    const start = appSrc.indexOf("const onCloseCompositeTab = useCallback");
    const block = appSrc.slice(start, start + 1200);
    // The empty branch leaves the workspace through the SAME shared helper
    // the toolbar toggle uses, so it also restores a real active tab.
    expect(block).toMatch(/if \(ids\.length === 0\) \{[\s\S]*?leaveMultiMode\(\)/);
    // The old bare early-return (a silent no-op) is gone.
    expect(block).not.toMatch(/if \(ids\.length === 0\) return;/);
    // The shared helper still disables Multi Mode and restores an active tab
    // when the active id was cleared (never a blank workspace).
    const helperStart = appSrc.indexOf("const leaveMultiMode = useCallback");
    expect(helperStart).toBeGreaterThan(-1);
    const helper = appSrc.slice(helperStart, helperStart + 900);
    expect(helper).toMatch(/dispatchMultiMode\(\{ type: "disable" \}\)/);
    expect(helper).toMatch(/if \(tabs\.activeId === null\) \{/);
    expect(helper).toMatch(/activateTab\(restore\)/);
  });

  it("keeps the modified-queue close for the dirty-document cases", () => {
    const start = appSrc.indexOf("const onCloseCompositeTab = useCallback");
    const block = appSrc.slice(start, start + 2200);
    expect(block).toMatch(/planCompositeClose\(/);
    expect(block).toMatch(/setPendingCloseTabId\(plan\.promptIds\[0\] \?\? null\)/);
  });
});

// ---------------------------------------------------------------------------
// ITEM 2 � the composite close: one prompt per modified document, then BOTH
// documents close. The seams are the SAME ones the DEF-142 window-close gate
// uses (`collectModifiedTabIds` + the ordered queue), just over the two pane
// documents instead of the whole tab list.
// ---------------------------------------------------------------------------

describe("Phase 34 � item 2: the composite close covers both documents", () => {
  const tabs = [
    { id: "a", modified: false },
    { id: "b", modified: true },
  ];
  const engineUi = {
    a: { state: { modified: true } }, // engine mirror catches the batched window
    b: { state: { modified: false } },
  };

  it("prompts for EACH modified document, in pane order", () => {
    const modified = collectModifiedTabIds(tabs, engineUi);
    const plan = planCompositeClose("a", "b", modified);
    expect(plan.ids).toEqual(["a", "b"]);
    expect(plan.promptIds).toEqual(["a", "b"]);
  });

  it("walks the queue one prompt at a time and closes BOTH at the end", () => {
    const plan = planCompositeClose("a", "b", ["a", "b"]);
    const prompts: string[] = [];
    let remaining = [...plan.promptIds];
    let closed: string[] = [];
    // Every prompt answer advances the queue; only the final `done` closes.
    for (;;) {
      prompts.push(remaining[0] ?? "");
      const step = advanceCompositeQueue(remaining);
      if (step.done) {
        closed = plan.ids;
        break;
      }
      remaining = step.next;
    }
    expect(prompts).toEqual(["a", "b"]);
    expect(closed).toEqual(["a", "b"]);
  });

  it("with no modified document it prompts for none and closes both", () => {
    const plan = planCompositeClose("a", "b", []);
    expect(plan.promptIds).toEqual([]);
    expect(plan.ids).toEqual(["a", "b"]);
  });

  it("skips the empty pane: only the present document is in the plan", () => {
    const plan = planCompositeClose("a", null, ["a"]);
    expect(plan.ids).toEqual(["a"]);
    expect(plan.promptIds).toEqual(["a"]);
  });
});

function findRuleBody(src: string, selector: string): string | null {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const idx = stripped.indexOf(selector);
  if (idx === -1) return null;
  const braceOpen = stripped.indexOf("{", idx);
  if (braceOpen === -1) return null;
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ITEM 2 � the App wiring (App.tsx is not mountable; pin the source contract).
// ---------------------------------------------------------------------------

describe("Phase 34 � item 2: App wires the composite tab", () => {
  const appSrc = readFileSync(APP_PATH, "utf8");

  it("projects ONE header tab while the mode is on and restores the tabs off", () => {
    expect(appSrc).toMatch(/stripTabs = useMemo/);
    expect(appSrc).toMatch(
      /multiMode\.enabled \? \[compositeHeaderTab\(multiHeaderDocRefs\)\] : headerTabs/,
    );
    // The single composite tab is the active one; single mode keeps the store id.
    expect(appSrc).toMatch(
      /stripActiveId = multiMode\.enabled \? COMPOSITE_TAB_ID : tabs\.activeId/,
    );
  });

  it("routes the header close through onHeaderClose -> onCloseCompositeTab", () => {
    expect(appSrc).toMatch(/const onHeaderClose = useCallback/);
    expect(appSrc).toMatch(/if \(id === COMPOSITE_TAB_ID\) \{[\s\S]*?onCloseCompositeTab\(\)/);
    expect(appSrc).toMatch(/onClose=\{onHeaderClose\}/);
  });

  it("collects the modified pane documents with the SAME gate closeTab uses", () => {
    const start = appSrc.indexOf("const onCloseCompositeTab = useCallback");
    const block = appSrc.slice(start, start + 2200);
    expect(block).toMatch(/collectModifiedTabIds\(/);
    expect(block).toMatch(/engineUiRef\.current/);
    expect(block).toMatch(/planCompositeClose\(/);
  });

  it("advances the queue and closes BOTH, then leaves the mode", () => {
    const start = appSrc.indexOf("const advanceCompositeClose = useCallback");
    const block = appSrc.slice(start, start + 1600);
    expect(block).toMatch(/advanceCompositeQueue\(queue\)/);
    expect(block).toMatch(/for \(const closeId of ids\) performCloseTab\(closeId\)/);
    expect(block).toMatch(/dispatchMultiMode\(\{ type: "disable" \}\)/);
  });

  it("a tab-strip click is a no-op while the composite tab is shown", () => {
    const start = appSrc.indexOf("const onTabStripActivate = useCallback");
    const block = appSrc.slice(start, start + 900);
    expect(block).toMatch(/if \(multiMode\.enabled\) return;/);
  });

  it("the prompt handler aborts a composite close on Cancel", () => {
    const start = appSrc.indexOf("const onCloseTabPromptChoose = useCallback");
    const block = appSrc.slice(start, start + 1600);
    expect(block).toMatch(/compositeCloseQueueRef\.current = null/);
    expect(block).toMatch(/compositeCloseIdsRef\.current = null/);
  });
});

// ---------------------------------------------------------------------------
// ITEM 3 � the names flank the divider.
// ---------------------------------------------------------------------------

const STAGE_TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 5 },
];
const BOTH: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };

interface StageHandlers {
  onFocusPane?: (pane: "A" | "B") => void;
  onClearPane?: (pane: "A" | "B") => void;
}

function renderStage(
  tabs: StageTab[],
  multi: MultiModeState,
  handlers: StageHandlers = {},
): { host: HTMLElement; root: ReturnType<typeof createRoot> } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const element = (
    <DocumentStage
      tabs={tabs}
      activeId="a"
      showWelcome={false}
      welcomeKey="welcome"
      welcome={null}
      multiMode={multi}
      splitFraction={0.5}
      onSplitChange={NOOP}
      onFocusPane={handlers.onFocusPane ?? NOOP}
      onClearPane={handlers.onClearPane ?? NOOP}
      onPickPane={NOOP}
      onOpenIntoPane={NOOP}
      renderDocument={(id): ReactElement => <div data-doc={id} />}
    />
  );
  act((): void => {
    root.render(element);
  });
  return { host, root };
}

const paneHeader = (host: HTMLElement, pane: "A" | "B"): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-pane-header][data-pane="${pane}"]`);

describe("Phase 34 � item 3: each document's name sits in its pane header", () => {
  it("shows pane A's name/count and pane B's name/count", () => {
    const { host } = renderStage(STAGE_TABS, BOTH);
    try {
      expect(paneHeader(host, "A")?.querySelector(".multi-pane-title")?.textContent).toBe(
        "Alpha.pdf",
      );
      expect(paneHeader(host, "A")?.querySelector(".multi-pane-count")?.textContent).toBe(
        "3 pages",
      );
      expect(paneHeader(host, "B")?.querySelector(".multi-pane-title")?.textContent).toBe(
        "Beta.pdf",
      );
      expect(paneHeader(host, "B")?.querySelector(".multi-pane-count")?.textContent).toBe(
        "5 pages",
      );
      // The badge is kept.
      expect(paneHeader(host, "A")?.querySelector(".multi-pane-badge")?.textContent).toBe("A");
      expect(paneHeader(host, "B")?.querySelector(".multi-pane-badge")?.textContent).toBe("B");
    } finally {
      host.remove();
    }
  });

  it("keeps each header INSIDE its pane, so it can only be on that pane's side", () => {
    const { host } = renderStage(STAGE_TABS, BOTH);
    try {
      // Left header is a descendant of pane A; right header of pane B.
      expect(
        host.querySelector('.tab-pane[data-pane="A"] [data-pane-header]'),
      ).toBe(paneHeader(host, "A"));
      expect(
        host.querySelector('.tab-pane[data-pane="B"] [data-pane-header]'),
      ).toBe(paneHeader(host, "B"));
    } finally {
      host.remove();
    }
  });

  it("updates a pane's name when its document is replaced", () => {
    const { host, root } = renderStage(STAGE_TABS, BOTH);
    try {
      const nextTabs: StageTab[] = [
        { id: "a", title: "Alpha.pdf", pageCount: 3 },
        { id: "c", title: "Gamma.pdf", pageCount: 9 },
      ];
      act((): void => {
        root.render(
          <DocumentStage
            tabs={nextTabs}
            activeId="a"
            showWelcome={false}
            welcomeKey="welcome"
            welcome={null}
            multiMode={{ enabled: true, paneA: "a", paneB: "c", focused: "A" }}
            splitFraction={0.5}
            onSplitChange={NOOP}
            onFocusPane={NOOP}
            onClearPane={NOOP}
            onPickPane={NOOP}
            onOpenIntoPane={NOOP}
            renderDocument={(id): ReactElement => <div data-doc={id} />}
          />,
        );
      });
      expect(paneHeader(host, "B")?.querySelector(".multi-pane-title")?.textContent).toBe(
        "Gamma.pdf",
      );
      expect(paneHeader(host, "B")?.querySelector(".multi-pane-count")?.textContent).toBe(
        "9 pages",
      );
    } finally {
      act((): void => root.unmount());
      host.remove();
    }
  });

  it("clears its pane, and a pointerdown on it focuses that pane", () => {
    const onClearPane = vi.fn();
    const onFocusPane = vi.fn();
    // Focused on B, so a pointerdown in pane A must move focus to A.
    const { host } = renderStage(
      STAGE_TABS,
      { enabled: true, paneA: "a", paneB: "b", focused: "B" },
      { onClearPane, onFocusPane },
    );
    try {
      const clearBtn = paneHeader(host, "A")?.querySelector<HTMLButtonElement>("[data-pane-clear]");
      expect(clearBtn).not.toBeNull();
      act((): void => {
        clearBtn?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        clearBtn?.click();
      });
      expect(onFocusPane).toHaveBeenCalledWith("A");
      expect(onClearPane).toHaveBeenCalledWith("A");
    } finally {
      host.remove();
    }
  });

  it("renders the header standalone with its selectors intact", () => {
    const onClear = vi.fn();
    const { host } = mount(
      <MultiPaneHeader pane="B" title="Beta.pdf" pageCount={5} onClear={onClear} />,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-pane-clear]")?.click();
      });
      expect(onClear).toHaveBeenCalledTimes(1);
    } finally {
      host.remove();
    }
  });
});

// The rects relationship, modelled on the SAME geometry chunk 1 pinned.
// DEF-286 — both panes give up HALF the inset, so the divider's centre sits
// at `W * frac - inset/2` and stays exactly between the panes.
const DIVIDER_W = PANE_DIVIDER_W_PX;
function geometry(stageW: number, inset: number, frac: number): {
  aWidth: number;
  dividerLeft: number;
  bLeft: number;
} {
  const g = multiPaneGeometry(stageW, inset, frac);
  return { aWidth: g.paneA.width, dividerLeft: g.dividerLeft, bLeft: g.paneB.left };
}

describe("Phase 34 � item 3: the header content is on its side of the divider", () => {
  const src = readFileSync(STYLES_PATH, "utf8");

  it("pane A packs to its inner (right) edge, pane B to its inner (left)", () => {
    const a = findRuleBody(
      src,
      '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane="A"] .multi-pane-header',
    );
    const b = findRuleBody(
      src,
      '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane="B"] .multi-pane-header',
    );
    expect(a ?? "").toMatch(/justify-content:\s*flex-end\s*;/);
    expect(b ?? "").toMatch(/justify-content:\s*flex-start\s*;/);
  });

  it("the name no longer grows, so it stays packed against the divider", () => {
    const title = findRuleBody(src, ".multi-pane-title");
    expect(title ?? "").toMatch(/flex:\s*0 1 auto\s*;/);
    expect(title ?? "").not.toMatch(/flex:\s*1 1 auto\s*;/);
  });

  it("the names' edges stay on their side of the divider rect", () => {
    // With pane A's header packed right (inner edge = its right edge) and
    // pane B's packed left (inner edge = its left edge):
    const g = geometry(1400, 240, 0.65);
    const aNameRight = g.aWidth; // pane A content hugs its right edge
    const dividerLeft = g.dividerLeft;
    const dividerRight = g.dividerLeft + DIVIDER_W;
    const bNameLeft = g.bLeft; // pane B content hugs its left edge
    expect(aNameRight).toBeLessThanOrEqual(dividerLeft);
    expect(bNameLeft).toBeGreaterThanOrEqual(dividerRight);
    expect(aNameRight).toBeLessThan(bNameLeft);
  });

  it("the clear control moves to the pane's OUTER side on both", () => {
    const a = findRuleBody(
      src,
      '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane="A"] .multi-pane-clear',
    );
    const b = findRuleBody(
      src,
      '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane="B"] .multi-pane-clear',
    );
expect(a ?? "").toMatch(/order:\s*-1\s*;/);
    expect(b ?? "").toMatch(/order:\s*1\s*;/);
  });
});

// ---------------------------------------------------------------------------
// ITEM 5 (chunk-1 remainder) — the rail's APPEND insertion line.
// ---------------------------------------------------------------------------

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

function makeDocStub(numPages: number): never {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as never;
}

const rotations = (n: number): number[] => Array.from({ length: n }, () => 0);
const visibleMap = (n: number): Map<number, number> =>
  new Map(Array.from({ length: n }, (_, i) => [i + 1, i + 1]));

function dragEvent(type: string): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", {
    value: {
      effectAllowed: "",
      dropEffect: "",
      setData: (): void => undefined,
      getData: (): string => "",
    },
  });
  Object.defineProperty(ev, "ctrlKey", { value: false });
  Object.defineProperty(ev, "altKey", { value: false });
  return ev;
}

/** A rail section whose drag source starts in the OTHER document ("b"). */
function RailHarness(props: { pageCount: number }): ReactElement {
  const d = usePageDrag();
  return (
    <div>
      <button
        type="button"
        data-begin-from-b
        onClick={(): void => d.begin(buildDragSource("b", 2, null))}
      >
        begin b
      </button>
      <ThumbnailRail
        doc={makeDocStub(props.pageCount)}
        pageCount={props.pageCount}
        currentPage={1}
        aspectRatio={792 / 612}
        rotations={rotations(props.pageCount)}
        visibleToSource={visibleMap(props.pageCount)}
        proxyVisibleOrder={false}
        canUndo={false}
        onJump={NOOP}
        crossDoc={{ tabId: "a", onDrop: NOOP }}
      />
    </div>
  );
}

const thumbEl = (host: HTMLElement, page: number): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.thumb[data-page="${page}"]`);

describe("Phase 34 — item 5: the rail's append slot shows an after-line", () => {
  it("renders the line BELOW the last thumb when the empty scroller is hovered", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness pageCount={5} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-b]")?.click();
      });
      const scrollerInner = host.querySelector(".thumb-scroller-inner");
      act((): void => {
        scrollerInner?.dispatchEvent(dragEvent("dragover"));
      });
      const line = thumbEl(host, 5)?.querySelector("[data-thumb-drop-line]");
      expect(line).not.toBeNull();
      expect(line?.classList.contains("thumb-drop-line-after")).toBe(true);
      // Only the LAST thumb carries the append line.
      expect(thumbEl(host, 4)?.querySelector("[data-thumb-drop-line]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("clears the append line on drag end", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness pageCount={5} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-b]")?.click();
      });
      act((): void => {
        host.querySelector(".thumb-scroller-inner")?.dispatchEvent(dragEvent("dragover"));
      });
      expect(host.querySelector("[data-thumb-drop-line]")).not.toBeNull();
      act((): void => {
        thumbEl(host, 5)?.dispatchEvent(dragEvent("dragend"));
      });
      expect(host.querySelector("[data-thumb-drop-line]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("the append line sits BELOW its thumb (static CSS guard)", () => {
    const src = readFileSync(STYLES_PATH, "utf8");
    const body = findRuleBody(src, ".thumb-drop-line-after");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/top:\s*auto\s*;/);
    expect(body ?? "").toMatch(/bottom:\s*-5px\s*;/);
  });
});
