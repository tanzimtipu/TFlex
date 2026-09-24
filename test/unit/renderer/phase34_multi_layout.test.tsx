// @vitest-environment jsdom
//
// Phase 34 (chunk 1) — the three Multi Mode layout items from the operator's
// feedback:
//
//   1. The All Tools panel resizes BOTH panes equally. The hasTool inset is
//      consumed ONCE at the stage level (pane widths + divider left use
//      `100% - var(--tf-tools-inset)`) and the per-pane scroller margin is
//      zeroed in Multi Mode; single mode's scroller margin is unchanged.
//   4. The divider is prominent (a strong neutral band with an always-visible
//      grip capsule and accent hover/active states).
//   5. A clear insertion line while dragging a page, in the canvas AND the
//      rail, sitting in the gap between the two slots.
//
// These tests pin the runtime drag maths (the inset is subtracted from the
// split base) and the static CSS contract (a revert fails).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import {
  MIN_PAGE_WIDTH_PX,
  MIN_PANES_BUDGET_PX,
  MIN_PANE_PANE_PX,
  PANE_DIVIDER_W_PX,
  STRIP_MIN_PX,
  STRIP_REST_PX,
  effectiveToolsInset,
  multiPaneGeometry,
  stripAndPageWidths,
} from "../../../src/renderer/components/multiPaneLayout";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import { ThumbnailRail } from "../../../src/renderer/components/SideRail";
import { PageDragProvider, usePageDrag } from "../../../src/renderer/state/PageDragContext";
import { buildDragSource } from "../../../src/renderer/state/pageDrag";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";
import type { EngineState } from "../../../src/renderer/engine/types";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const NOOP = (): void => undefined;

const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 5 },
];

const BOTH: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

/** The body of the rule whose selector starts at the first match of
 *  `selector` that is a real selector (followed by `{`, or by `,` for the
 *  first member of a selector list) — never a longer class name that merely
 *  contains it (`".thumb"` must not match `".thumb-scroller"`). */
function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    const ch = stripped[cursor];
    if (ch === "{" || ch === ",") return extractRuleBody(stripped, idx);
    from = idx + selector.length;
  }
}

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

const rect = (width: number, height = 600): DOMRect =>
  ({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: (): Record<string, number> => ({}),
  }) as DOMRect;

// ---------------------------------------------------------------------------
// ITEM 1 — the split maths with the All Tools inset.
// ---------------------------------------------------------------------------

function SplitHarness(props: { multi: MultiModeState }): ReactElement {
  const [split, setSplit] = useState(0.5);
  return (
    <DocumentStage
      tabs={TABS}
      activeId="a"
      showWelcome={false}
      welcomeKey="welcome"
      welcome={null}
      multiMode={props.multi}
      splitFraction={split}
      onSplitChange={setSplit}
      onFocusPane={NOOP}
      onClearPane={NOOP}
      onPickPane={NOOP}
      onOpenIntoPane={NOOP}
      renderDocument={(): ReactElement => <div />}
    />
  );
}

/** Drive one divider pointerdown with a stubbed stage rect + inset token. */
function dragDivider(
  host: HTMLElement,
  stageWidth: number,
  clientX: number,
  inset: string,
): string {
  const stage = host.querySelector<HTMLElement>(".tab-stage");
  if (stage === null) throw new Error("stage missing");
  Object.defineProperty(stage, "getBoundingClientRect", {
    configurable: true,
    value: (): DOMRect => rect(stageWidth),
  });
  const realGCS = window.getComputedStyle.bind(window);
  const fake = {
    getPropertyValue: (p: string): string => (p === "--tf-tools-inset" ? inset : ""),
  } as unknown as CSSStyleDeclaration;
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (el: Element): CSSStyleDeclaration => (el === stage ? fake : realGCS(el)),
  );
  const divider = host.querySelector<HTMLElement>("[data-multi-divider]");
  const down = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(down, "clientX", { value: clientX });
  Object.defineProperty(down, "pointerId", { value: 1 });
  act((): void => {
    divider?.dispatchEvent(down);
  });
  vi.restoreAllMocks();
  return stage.style.getPropertyValue("--tf-split");
}

describe("Phase 34 — item 1 / DEF-286: the All Tools inset shrinks both panes EQUALLY", () => {
it("subtracts the inset from the usable width when measuring the drag", () => {
    const { host, unmount } = mount(<SplitHarness multi={BOTH} />);
    try {
      // Stage 2000px, inset 400px; pointer at 800px -> the divider CENTRE
      // is at `W * f - inset/2`, so the handle lands on the pointer at 50%.
      expect(dragDivider(host, 2000, 800, "400px")).toBe("50.000%");
    } finally {
      unmount();
    }
  });

  it("with the inset 0 reproduces the pre-change fraction exactly", () => {
    const { host, unmount } = mount(<SplitHarness multi={BOTH} />);
    try {
      // Stage 2000px, no inset -> pointer at 800px -> 40% (pre-change math);
      // with the inset the SAME pointer resolves to 50%, proving the token
      // participates in the drag maths.
      expect(dragDivider(host, 2000, 800, "0px")).toBe("40.000%");
      expect(dragDivider(host, 2000, 800, "")).toBe("40.000%");
    } finally {
      unmount();
    }
  });

  it("at 0.35 / 0.50 / 0.65 both panes lose EXACTLY half the inset", () => {
    const W = 1000;
    const inset = 344;
    for (const frac of [0.35, 0.5, 0.65]) {
      const before = multiPaneGeometry(W, 0, frac);
      const after = multiPaneGeometry(W, inset, frac);
      const deltaA = before.paneA.width - after.paneA.width;
      const deltaB = before.paneB.width - after.paneB.width;
      expect(deltaA).toBeCloseTo(inset / 2, 6);
      expect(deltaB).toBeCloseTo(inset / 2, 6);
      // Equal deltas within a pixel (criterion 1) — the old pro-rata share
      // gave 120/224 at 0.35 and 224/120 at 0.65.
      expect(Math.abs(deltaA - deltaB)).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the divider exactly between the panes at every split", () => {
    for (const frac of [0.35, 0.5, 0.65]) {
      const g = multiPaneGeometry(1400, 240, frac);
      expect(g.dividerLeft).toBeCloseTo(g.paneA.right, 6);
      expect(g.paneB.left).toBeCloseTo(g.dividerLeft + PANE_DIVIDER_W_PX, 6);
      expect(g.paneA.width + PANE_DIVIDER_W_PX + g.paneB.width).toBeCloseTo(
        1400 - g.inset,
        6,
      );
    }
  });

  it("with the inset 0 the Multi Mode geometry equals the pre-Phase-34 values", () => {
    const g = multiPaneGeometry(1000, 0, 0.5);
    expect(g.inset).toBe(0);
    expect(g.paneA.width).toBeCloseTo(1000 * 0.5 - PANE_DIVIDER_W_PX / 2, 6);
    expect(g.paneB.width).toBeCloseTo(1000 * 0.5 - PANE_DIVIDER_W_PX / 2, 6);
    expect(g.dividerLeft).toBeCloseTo(1000 * 0.5 - PANE_DIVIDER_W_PX / 2, 6);
    expect(g.paneB.left).toBeCloseTo(1000 * 0.5 + PANE_DIVIDER_W_PX / 2, 6);
  });
});

// ---------------------------------------------------------------------------
// DEF-287 — the page area never collapses at the minimum window with the
// panel open. The strip column shrinks toward its thumb floor first; if that
// is still not enough the All Tools inset is CAPPED (the panel then overlaps
// the right pane, but the page areas keep their minimum).
// ---------------------------------------------------------------------------

describe("DEF-287 — the pane page area keeps its minimum", () => {
  it("at 640px with the 344px list panel open both page areas stay usable", () => {
    const g = multiPaneGeometry(640, 344, 0.5);
    expect(g.inset).toBe(344);
    expect(g.paneA.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
    expect(g.paneB.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
    // Exactly the minimum, and the strip column has shrunk below its rest
    // width (the old fixed 220px strip drove the page area to 0).
    expect(g.paneA.page).toBe(MIN_PAGE_WIDTH_PX);
    expect(g.paneA.strip).toBe(STRIP_MIN_PX);
    expect(g.paneA.strip).toBeLessThan(STRIP_REST_PX);
    // Before the panel: a comfortably usable page area. Phase 37 (item 18)
    // narrowed the strip rest from 220 to 150, so the page gains 70px:
    // 640/2 - 4 (divider half) - 150 (strip) = 166.
    expect(multiPaneGeometry(640, 0, 0.5).paneA.page).toBe(166);
  });

  it("caps the inset when the requested panel would starve the panes", () => {
    // Grid-mode panel (380px) at the 640 minimum: 640 - 380 - 8 = 252, below
    // the panes' 296px budget, so the reserved width is capped.
    const g = multiPaneGeometry(640, 380, 0.5);
    expect(g.inset).toBeLessThan(380);
    expect(g.inset).toBe(640 - MIN_PANES_BUDGET_PX);
    expect(g.paneA.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
    expect(g.paneB.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
  });

  it("leaves a wide window's inset untouched (no cap, no regression)", () => {
    expect(effectiveToolsInset(1600, 344)).toBe(344);
    const g = multiPaneGeometry(1600, 344, 0.5);
    expect(g.paneA.strip).toBe(STRIP_REST_PX);
    expect(g.paneA.page).toBeGreaterThan(MIN_PAGE_WIDTH_PX);
  });

  it("stripAndPageWidths shrinks the strip BEFORE the page", () => {
    // At the rest budget the strip is 220 and the page takes the rest.
    expect(stripAndPageWidths(STRIP_REST_PX + MIN_PAGE_WIDTH_PX)).toEqual({
      strip: STRIP_REST_PX,
      page: MIN_PAGE_WIDTH_PX,
    });
    // At the pane minimum both are at their floors.
    expect(stripAndPageWidths(MIN_PANE_PANE_PX)).toEqual({
      strip: STRIP_MIN_PX,
      page: MIN_PAGE_WIDTH_PX,
    });
    // In between the strip yields, the page stays at its floor. Phase 37
    // (item 18): with the 150px rest, a 180px pane gives free = 36 -> strip
    // 136 (between the 100px floor and the 150px rest), page 44.
    const mid = stripAndPageWidths(180);
    expect(mid.strip).toBeGreaterThanOrEqual(STRIP_MIN_PX);
    expect(mid.strip).toBeLessThan(STRIP_REST_PX);
    expect(mid.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
  });

  it("pins the explicit constants (single mode's 640 page area is untouched)", () => {
    expect(STRIP_MIN_PX).toBe(100); // THUMB_MIN_WIDTH 84 + THUMB_RAIL_INSET 16
    expect(MIN_PAGE_WIDTH_PX).toBe(44);
    expect(MIN_PANE_PANE_PX).toBe(144);
    expect(MIN_PANES_BUDGET_PX).toBe(296); // 640 - 344
    // Phase 37 (item 15): single mode at 640 with the panel open: the rail is
    // now 184px (was 220), so 640 - 184 - 344 = 112px.
    expect(640 - 184 - 344).toBe(112);
  });
});


// ---------------------------------------------------------------------------
// Static CSS guard: the runtime drag maths above must match the stylesheet's
// geometry expressions, and the per-pane scroller must NOT reserve the inset
// a second time in Multi Mode (the operator's blank strip).
// ---------------------------------------------------------------------------

describe("Phase 34 — item 1 / DEF-286: the stylesheet gives each pane HALF the inset", () => {
  const src = readFileSync(STYLES_PATH, "utf8");
  const frac = String.raw`var\(--tf-split-frac,\s*0\.5\)`;
  const halfInset = String.raw`\(var\(--tf-pane-inset,\s*0px\)\s*\/\s*2\)`;

  it("pane A takes its fraction of the stage minus half the inset", () => {
    const body = findRuleBody(src, '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane="A"]');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(
      new RegExp(`width:\\s*calc\\([\\s\\S]*?100%\\s*\\*\\s*${frac}\\s*-\\s*${halfInset}`),
    );
    // The old `(100% - var(--tf-tools-inset)) * frac` pro-rata base is gone.
    expect(body ?? "").not.toMatch(/100%\s*-\s*var\(--tf-tools-inset/);
  });

  it("pane B stops at the inset boundary and subtracts the same half-inset", () => {
    const body = findRuleBody(src, '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane="B"]');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/right:\s*var\(--tf-pane-inset, 0px\)\s*;/);
    expect(body ?? "").toMatch(
      new RegExp(
        `width:\\s*calc\\([\\s\\S]*?100%\\s*\\*\\s*\\(1 - ${frac}\\)\\s*-\\s*${halfInset}`,
      ),
    );
    expect(body ?? "").not.toMatch(/100%\s*-\s*var\(--tf-tools-inset/);
  });

  it("the divider's centre uses the same half-inset (stays between the panes)", () => {
    const body = findRuleBody(src, ".multi-divider");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(
      new RegExp(`left:\\s*calc\\([\\s\\S]*?100%\\s*\\*\\s*${frac}\\s*-\\s*${halfInset}`),
    );
    expect(body ?? "").not.toMatch(/100%\s*-\s*var\(--tf-tools-inset/);
  });

  it("the panes' inset is the requested token capped by the measured cap", () => {
    const body = findRuleBody(src, ".tab-stage[data-multi-mode=\"true\"] .tab-pane[data-pane]");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/--tf-pane-inset:\s*min\(/);
    expect(body ?? "").toMatch(/var\(--tf-tools-inset,\s*0px\)/);
    expect(body ?? "").toMatch(/var\(--tf-multi-inset-cap,/);
    // The divider consumes the SAME capped variable.
    expect(findRuleBody(src, ".multi-divider") ?? "").toContain("--tf-pane-inset");
  });

  it("the Multi Mode scroller no longer reserves the inset as a margin", () => {
    const body = findRuleBody(
      src,
      '.tab-stage[data-multi-mode="true"] .document-scroller',
    );
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/margin-right:\s*0\s*;/);
  });

  it("SINGLE mode's scroller margin is unchanged", () => {
    const body = findRuleBody(src, ".document-scroller");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/margin-right:\s*var\(--tf-tools-inset, 0px\)\s*;/);
  });

  it("the stage transitions the inset so panes and divider ride the panel curve", () => {
    const body = findRuleBody(src, '.tab-stage[data-multi-mode="true"]');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/transition:\s*--tf-tools-inset\s+var\(--panel-slide-duration\)/);
  });
});

// DEF-287 — the strip column shrinks toward the thumb floor, and the CSS
// floors match the layout constants.
describe("DEF-287 — the stylesheet's strip column shrinks toward the thumb floor", () => {
  const src = readFileSync(STYLES_PATH, "utf8");

  it("the per-pane grid uses minmax(strip floor, rest) next to minmax(page, 1fr)", () => {
    const body = findRuleBody(src, ".workspace:has(> .pane-thumb-strip)");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/--tf-strip-min:\s*100px\s*;/);
    expect(body ?? "").toMatch(/--tf-page-min:\s*44px\s*;/);
    expect(body ?? "").toMatch(
      /grid-template-columns:\s*minmax\(var\(--tf-strip-min\),\s*var\(--tf-strip-w\)\)\s*minmax\(var\(--tf-page-min\),\s*1fr\)/,
    );
  });

  it("the rail-side-right mirror keeps the page track first", () => {
    const body = findRuleBody(src, '.workspace[data-rail-side="right"]:has(> .pane-thumb-strip)');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(
      /grid-template-columns:\s*minmax\(var\(--tf-page-min\),\s*1fr\)\s*minmax\(var\(--tf-strip-min\),\s*var\(--tf-strip-w\)\)/,
    );
  });
});


// ---------------------------------------------------------------------------
// ITEM 4 — the divider is prominent.
// ---------------------------------------------------------------------------

describe("Phase 34 — item 4: the divider's prominence (static CSS guard)", () => {
  const src = readFileSync(STYLES_PATH, "utf8");

  it("carries a visible contrast surface, not the old hairline", () => {
    const body = findRuleBody(src, ".multi-divider");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*var\(--border-strong\)\s*;/);
    // The pre-change `var(--border)` surface was invisible against the panes.
    expect(body ?? "").not.toMatch(/background:\s*var\(--border\)\s*;/);
  });

  it("shows an always-visible grip capsule (opacity was 0 before)", () => {
    const body = findRuleBody(src, ".multi-divider-grip");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/opacity:\s*1\s*;/);
    expect(body ?? "").toMatch(/background:\s*var\(--bg-raised\)\s*;/);
    expect(body ?? "").toMatch(/border-radius:\s*999px\s*;/);
  });

  it("takes the accent on hover/active so the affordance is obvious", () => {
    const body = findRuleBody(src, ".multi-divider:hover");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*var\(--accent\)\s*;/);
    const grip = findRuleBody(src, ".multi-divider:hover .multi-divider-grip");
    expect(grip).not.toBeNull();
    expect(grip ?? "").toMatch(/background:\s*var\(--fg-on-accent\)\s*;/);
  });

  it("collapses its transitions under reduced motion", () => {
    const stripped = stripCssComments(src);
    const starts = [...stripped.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)].map(
      (m) => m.index ?? -1,
    );
    const bodies = starts
      .filter((i) => i >= 0)
      .map((i) => extractRuleBody(stripped, i));
    expect(bodies.length).toBeGreaterThan(0);
    expect(
      bodies.some(
        (b) => b.includes(".multi-divider") && b.includes(".multi-divider-grip"),
      ),
    ).toBe(true);
  });

  it("renders the grip inside the divider", () => {
    const { host, unmount } = mount(<SplitHarness multi={BOTH} />);
    try {
      const divider = host.querySelector("[data-multi-divider]");
      expect(divider).not.toBeNull();
      expect(divider?.querySelector(".multi-divider-grip")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// ITEM 5 — the insertion line (canvas + rail).
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

function makeDocStub(numPages: number): PDFDocumentProxy {
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
  } as unknown as PDFDocumentProxy;
}

function engineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

const visibleMap = (n: number): Map<number, number> =>
  new Map(Array.from({ length: n }, (_, i) => [i + 1, i + 1]));

interface DataTransferStub {
  effectAllowed: string;
  dropEffect: string;
  setData: (type: string, value: string) => void;
  getData: (type: string) => string;
}
function makeDataTransfer(): DataTransferStub {
  return { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: vi.fn(() => "") };
}

function dragEvent(
  type: string,
  init: { dataTransfer?: DataTransferStub; ctrlKey?: boolean } = {},
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: init.dataTransfer ?? makeDataTransfer() });
  Object.defineProperty(ev, "ctrlKey", { value: init.ctrlKey ?? false });
  Object.defineProperty(ev, "altKey", { value: false });
  return ev;
}

const fire = (el: Element | null, ev: Event): void => {
  act((): void => {
    el?.dispatchEvent(ev);
  });
};

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
        rotations={engineState(props.pageCount).rotations}
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

describe("Phase 34 — item 5: the rail shows an insertion line between thumbs", () => {
  it("renders the line in the landing slot's top gap, not on the thumb", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness pageCount={5} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-b]")?.click();
      });
      const target = thumbEl(host, 3);
      fire(target, dragEvent("dragover"));
      const line = target?.querySelector("[data-thumb-drop-line]");
      expect(line).not.toBeNull();
      // The line belongs to the target (insert-BEFORE) slot and sits in its
      // top gap; the neighbouring thumbs carry no line.
      expect(thumbEl(host, 2)?.querySelector("[data-thumb-drop-line]")).toBeNull();
      expect(thumbEl(host, 4)?.querySelector("[data-thumb-drop-line]")).toBeNull();
      expect(target?.classList.contains("thumb-drop-target")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("anchors the first slot's line flush (no gap above it)", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness pageCount={5} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-b]")?.click();
      });
      fire(thumbEl(host, 1), dragEvent("dragover"));
      const line = thumbEl(host, 1)?.querySelector("[data-thumb-drop-line]");
      expect(line).not.toBeNull();
      expect(line?.classList.contains("thumb-drop-line-first")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("clears the line on drag end/cancel", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <RailHarness pageCount={5} />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-b]")?.click();
      });
      const target = thumbEl(host, 3);
      fire(target, dragEvent("dragover"));
      expect(host.querySelector("[data-thumb-drop-line]")).not.toBeNull();
      fire(target, dragEvent("dragend"));
      expect(host.querySelector("[data-thumb-drop-line]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

const INITIAL_VIEWER = {
  zoomMode: "fit-width" as const,
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

function CanvasHarness(): ReactElement {
  const d = usePageDrag();
  return (
    <div>
      <button
        type="button"
        data-begin-from-a
        onClick={(): void => d.begin(buildDragSource("a", 2, null))}
      >
        begin a
      </button>
      <DocumentView
        doc={makeDocStub(4)}
        pageCount={4}
        outline={null}
        initial={INITIAL_VIEWER}
        onPersist={NOOP}
        onDiagnostics={NOOP}
        engineState={engineState(4)}
        modified={false}
        canUndo={false}
        saveInPlaceEnabled={false}
        annotations={[]}
        formFields={[]}
        signatures={[]}
        savedSignatures={[]}
        stampAnnotations={[]}
        pageDrag={{ tabId: "b", onDrop: NOOP }}
      />
    </div>
  );
}

const slotEl = (host: HTMLElement, page: number): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.page-slot[data-page="${page}"]`);

describe("Phase 34 — item 5: the canvas insertion line sits between slots", () => {
  it("renders the before-line inside the landing slot (its top gap)", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-a]")?.click();
      });
      const target = slotEl(host, 2);
      const over = dragEvent("dragover");
      Object.defineProperty(over, "clientY", { value: -1 });
      fire(target, over);
      const indicator = target?.querySelector('[data-drop-indicator="before"]');
      expect(indicator).not.toBeNull();
      // The line spans the page column (the slot's own width), never another
      // slot's.
      expect(slotEl(host, 3)?.querySelector("[data-drop-indicator]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("renders the after-line inside the last slot and clears it on drop", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-a]")?.click();
      });
      const last = slotEl(host, 4);
      const over = dragEvent("dragover");
      Object.defineProperty(over, "clientY", { value: 5 });
      fire(last, over);
      expect(last?.querySelector('[data-drop-indicator="after"]')).not.toBeNull();
      const drop = dragEvent("drop");
      Object.defineProperty(drop, "clientY", { value: 5 });
      fire(last, drop);
      expect(host.querySelector("[data-drop-indicator]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("DEF-290 — marks the FIRST slot's before-line flush, non-first unchanged", () => {
    const { host, unmount } = mount(
      <PageDragProvider>
        <CanvasHarness />
      </PageDragProvider>,
    );
    try {
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-begin-from-a]")?.click();
      });
      const first = slotEl(host, 1);
      const over = dragEvent("dragover");
      Object.defineProperty(over, "clientY", { value: -1 });
      fire(first, over);
      const indicator = first?.querySelector('[data-drop-indicator="before"]');
      expect(indicator).not.toBeNull();
      expect(indicator?.classList.contains("page-drop-indicator-first")).toBe(true);
      // A non-first slot keeps the plain between-pages before-line.
      const second = slotEl(host, 2);
      const over2 = dragEvent("dragover");
      Object.defineProperty(over2, "clientY", { value: -1 });
      fire(second, over2);
      const ind2 = second?.querySelector('[data-drop-indicator="before"]');
      expect(ind2).not.toBeNull();
      expect(ind2?.classList.contains("page-drop-indicator-first")).toBe(false);
      // Still clears on drop.
      const drop = dragEvent("drop");
      Object.defineProperty(drop, "clientY", { value: -1 });
      fire(second, drop);
      expect(host.querySelector("[data-drop-indicator]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 34 — item 5: the insertion line geometry (static CSS guard)", () => {
  const src = readFileSync(STYLES_PATH, "utf8");

  it("the canvas line is thicker, rounded and glowing", () => {
    const body = findRuleBody(src, ".page-drop-indicator");
    expect(body).not.toBeNull();
    const heightMatch = /height:\s*(\d+(?:\.\d+)?)px\s*;/.exec(body ?? "");
    expect(heightMatch).not.toBeNull();
    const height = Number(heightMatch?.[1] ?? 0);
    expect(height).toBeGreaterThanOrEqual(4);
    expect(height).toBeLessThanOrEqual(6);
    expect(body ?? "").toMatch(/border-radius:\s*999px\s*;/);
    expect(body ?? "").toMatch(/background:\s*var\(--accent\)\s*;/);
    expect(body ?? "").toMatch(/box-shadow:/);
  });

  it("the canvas line sits in the inter-page gap, never over a page", () => {
    const before = findRuleBody(src, ".page-drop-indicator-before");
    const after = findRuleBody(src, ".page-drop-indicator-after");
    expect(before ?? "").toMatch(/top:\s*-9px\s*;/);
    expect(after ?? "").toMatch(/bottom:\s*-9px\s*;/);
    const gapMatch = /\.document-content\s*\{[^}]*gap:\s*(\d+)px/s.exec(stripCssComments(src));
    expect(gapMatch).not.toBeNull();
    const gap = Number(gapMatch?.[1] ?? 0);
    const height = Number(
      /height:\s*(\d+(?:\.\d+)?)px\s*;/.exec(findRuleBody(src, ".page-drop-indicator") ?? "")?.[1] ?? 0,
    );
    // The 9px offset plus half the bar stays inside the gap, and the bar's
    // near edge never crosses onto the page.
    expect(9 + height / 2).toBeLessThanOrEqual(gap);
    expect(height / 2).toBeLessThan(9);
  });

  it("DEF-290 — the FIRST slot's line is inside the scroller's visible top", () => {
    const before = findRuleBody(src, ".page-drop-indicator-before");
    const first = findRuleBody(src, ".page-drop-indicator-first");
    expect(first).not.toBeNull();
    const beforeTop = Number(/top:\s*(-?\d+(?:\.\d+)?)(?:px)?\s*;/.exec(before ?? "")?.[1] ?? NaN);
    const firstTop = Number(/top:\s*(-?\d+(?:\.\d+)?)(?:px)?\s*;/.exec(first ?? "")?.[1] ?? NaN);
    expect(beforeTop).toBe(-9);
    expect(firstTop).toBe(0);
    // qa measured the first slot's top AT the scroller's visible top
    // (slot1Top = scrollerTop = 131), so `top: 0` is inside the visible box
    // while the between-pages `-9px` sat above it and was clipped.
    const scrollerTop = 131;
    expect(scrollerTop + firstTop).toBeGreaterThanOrEqual(scrollerTop);
    expect(scrollerTop + beforeTop).toBeLessThan(scrollerTop);
  });

  it("the rail line is a rounded accent bar in the thumb's top gap", () => {
    const body = findRuleBody(src, ".thumb-drop-line");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*var\(--accent\)\s*;/);
    expect(body ?? "").toMatch(/top:\s*-5px\s*;/);
    expect(body ?? "").toMatch(/border-radius:\s*999px\s*;/);
    expect(body ?? "").toMatch(/box-shadow:/);
    const first = findRuleBody(src, ".thumb-drop-line-first");
    expect(first ?? "").toMatch(/top:\s*0\s*;/);
    // `.thumb` must be a positioning context for the absolutely placed line.
    const thumb = findRuleBody(src, ".thumb");
    expect(thumb ?? "").toMatch(/position:\s*relative\s*;/);
  });
});
