// @vitest-environment jsdom
//
// Phase 37 (chunk 5, items 4 / 8 / 9 / 15 / 16 / 18 / 19) - the Stage Rail and
// the thumbnail panels.
//
// The chunk's contract:
//   4. the panel's collapse/expand chevron FLIPS with the state;
//   8. the Stage Rail is hidden on the welcome screen, present with a doc;
//   9. the placement audit - no rail control/label touches the window edge;
//   15. the "Pages - N" title is gone and the panel is narrower;
//   16. the Outline is flush at the panel bottom behind an item-22 divider;
//   18. the Multi Mode strips are narrower (still fitting their thumbs);
//   19. each strip offers the SAME options as the single-mode panel -
//       hover verbs, the six-item right-click menu, multi-select and drag.
//
// jsdom has no layout engine, so the geometry/placement claims are pinned
// against the real stylesheet (the established static-CSS-guard pattern) and
// the runtime claims are exercised through the actual components.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import { PaneThumbStrip } from "../../../src/renderer/components/PaneThumbStrip";
import { isStageRailVisible } from "../../../src/renderer/components/StageRail";
import { THUMB_FIT_INSET_PX, THUMB_RAIL_INSET_PX, THUMB_WIDTH, computeThumbWidth } from "../../../src/renderer/components/thumbGeometry";
import { STRIP_REST_PX } from "../../../src/renderer/components/multiPaneLayout";
import { STRIP_WIDTH_PX } from "../../../src/renderer/components/PaneThumbStrip";
import { PageDragProvider } from "../../../src/renderer/state/PageDragContext";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { OutlineNode } from "../../../src/renderer/pdf/pdfjs";

const ELLIPSIS = "\u2026";

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
  if (g.IntersectionObserver === undefined) {
    class Noop {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = Noop;
  }
  if (g.ResizeObserver === undefined) {
    class Noop {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = Noop;
  }
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function mount(element: React.ReactElement): { host: HTMLElement; unmount: () => void } {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function clickOn(target: Element, init: MouseEventInit = {}): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  });
}

function dragEventOn(target: Element, type: "dragstart" | "dragover" | "drop"): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
      types: [],
    },
  });
  act((): void => {
    target.dispatchEvent(event);
  });
}

const thumb = (host: HTMLElement, page: number): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`.thumb-item[data-page="${page}"]`);
  if (el === null) throw new Error(`no thumb for page ${page}`);
  return el;
};

// ---------------------------------------------------------------------------
// Static CSS parsing (jsdom cannot apply styles.css).
// ---------------------------------------------------------------------------

const STYLES = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function ruleBody(selector: string): string {
  const m = new RegExp(
    `(?:^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "m",
  ).exec(STYLES);
  return m?.[1] ?? "";
}

function decl(block: string, prop: string): string | null {
  const m = new RegExp(
    `(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+)`,
    "m",
  ).exec(block);
  return m === null ? null : m[1].trim().replace(/\s+/g, " ");
}

function px(value: string | null): number {
  return Number.parseFloat((value ?? "").replace("px", ""));
}

const APP_MAIN = ruleBody(".app-main");
const STAGE_RAIL = ruleBody(".stage-rail");
const STAGE_RAIL_LABEL = ruleBody(".stage-rail-label");
const STAGE_RAIL_BTN = ruleBody(".stage-rail-btn");
const RAIL_W_PROPERTY = /@property\s+--tf-rail-w\s*\{([^}]*)\}/.exec(STYLES)?.[1] ?? "";
/** Phase 38 (feature B) — the rail's width and label-floor tokens. */
const STAGE_RAIL_W_TOKEN = Number.parseFloat(/--tf-stage-rail-w:\s*(\d+)px/.exec(STYLES)?.[1] ?? "NaN");
const LABEL_SIZE_TOKEN = Number.parseFloat(/--tf-label-size:\s*(\d+)px/.exec(STYLES)?.[1] ?? "NaN");
const OUTLINE = ruleBody(".context-panel-outline");
const OUTLINE_WITH_BODY = ruleBody(".context-panel-outline[data-outline-open='true']");
const PANEL_HEADER_ACTIONS = ruleBody(".context-panel-header .glass-sidebar-actions");
const PANEL_ACTIONS = ruleBody(".context-panel-actions");
const STRIP_WORKSPACE = ruleBody(".workspace:has(> .pane-thumb-strip)");
const HIDDEN_APP_MAIN = ruleBody('.app-main[data-stage-rail-hidden="true"]');
const HIDDEN_TAB_STAGE = ruleBody('.app-main[data-stage-rail-hidden="true"] .tab-stage');

beforeEach((): void => {
  // jsdom reports clientHeight 0 everywhere; a fixed height mounts the first
  // thumbnail slots so the rail's geometry range is non-empty.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
});

afterEach((): void => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Item 8 - the Stage Rail is a document surface.
// ---------------------------------------------------------------------------

describe("Phase 37 item 8 - the Stage Rail is hidden on the welcome screen", () => {
  it("keys the decision to the exact complement of the welcome condition", () => {
    expect(isStageRailVisible(0, false, false)).toBe(false);
    expect(isStageRailVisible(0, true, false)).toBe(false);
    expect(isStageRailVisible(0, true, true)).toBe(false);
    expect(isStageRailVisible(1, true, false)).toBe(false);
    expect(isStageRailVisible(1, true, true)).toBe(true);
    expect(isStageRailVisible(1, false, false)).toBe(true);
    expect(isStageRailVisible(2, false, true)).toBe(true);
  });

  it("App gates the rail render AND collapses its track from the same flag", () => {
    const appSrc = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");
    expect(appSrc).toContain("const stageRailVisible = isStageRailVisible(");
    expect(appSrc).toContain("const showWelcomeEffective = !stageRailVisible;");
    expect(appSrc).toContain("showWelcome={showWelcomeEffective}");
    expect(appSrc).toMatch(/\{stageRailVisible && \(\s*<StageRail/);
    expect(appSrc).toContain('data-stage-rail-hidden={stageRailVisible ? "false" : "true"}');
  });

  it("collapses the rail track and lets the stage span the frame when hidden", () => {
    expect(decl(HIDDEN_APP_MAIN, "grid-template-columns")).toBe("minmax(0, 1fr)");
    expect(decl(HIDDEN_TAB_STAGE, "grid-column")).toBe("1");
    expect(decl(APP_MAIN, "grid-template-columns")).toBe(
      "var(--tf-stage-rail-w, 72px) minmax(0, 1fr)",
    );
  });
});

// ---------------------------------------------------------------------------
// Item 4 - the chevron flips with the collapse state.
// ---------------------------------------------------------------------------

interface PanelHandle {
  host: HTMLElement;
  rerender: (collapsed: boolean) => void;
  unmount: () => void;
}

function renderCollapsePanel(initial: boolean): PanelHandle {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const pageCount = 3;
  const draw = (collapsed: boolean): void => {
    act((): void => {
      root.render(
        <ContextPanel
          doc={makeDocStub(pageCount)}
          currentPage={1}
          defaultWidthPt={612}
          defaultHeightPt={792}
          pageSizes={null}
          engineState={makeEngineState(pageCount)}
          proxyVisibleOrder={false}
          canUndo={false}
          onJump={(): void => undefined}
          outline={null}
          collapsed={collapsed}
          onToggleCollapsed={(): void => undefined}
        />,
      );
    });
  };
  draw(initial);
  return {
    host,
    rerender: draw,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

describe("Phase 37 item 4 - the collapse glyph flips", () => {
  it("expanded shows PanelLeftClose and collapsed shows PanelRightOpen, both directions", () => {
    const h = renderCollapsePanel(false);
    try {
      const btn = (): HTMLElement | null => h.host.querySelector("[data-rail-collapse]");
      expect(btn()?.getAttribute("data-collapse-direction")).toBe("collapse");
      expect(btn()?.getAttribute("title")).toBe("Collapse panel");
      expect(btn()?.querySelector("svg.lucide-panel-left-close")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-panel-right-open")).toBeNull();

      h.rerender(true);
      expect(btn()?.getAttribute("data-collapse-direction")).toBe("expand");
      expect(btn()?.getAttribute("title")).toBe("Expand panel");
      expect(btn()?.querySelector("svg.lucide-panel-right-open")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-panel-left-close")).toBeNull();

      h.rerender(false);
      expect(btn()?.querySelector("svg.lucide-panel-left-close")).not.toBeNull();
      expect(btn()?.querySelector("svg.lucide-panel-right-open")).toBeNull();
    } finally {
      h.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 9 - the placement audit (measured edge gaps).
// ---------------------------------------------------------------------------

describe("Phase 37 item 9 - no control or label touches the window/canvas edge", () => {
  it("insets the rail controls from the window edge (Settings included)", () => {
    const parts = (decl(STAGE_RAIL, "padding") ?? "").split(/\s+/);
    const inset = px(parts[1] ?? "");
    expect(inset).toBeGreaterThanOrEqual(3);
    // Phase 108 (Workspace Rail) — the rail consumes the --tf-stage-rail-w
    // token (72px) so the 12px label floor fits; no hardcoded 44px.
    expect(decl(STAGE_RAIL, "width")).toBe("var(--tf-stage-rail-w, 72px)");
    expect(STAGE_RAIL_W_TOKEN).toBe(72);
    expect(decl(STAGE_RAIL_BTN, "border-radius")).toBe("var(--tf-siderail-item-radius)");

    const contentBox = STAGE_RAIL_W_TOKEN - 2 * inset;
    const fontPx = LABEL_SIZE_TOKEN;
    // The interactive-label floor: no stage label below 12px.
    expect(fontPx).toBeGreaterThanOrEqual(12);
    expect(decl(STAGE_RAIL_LABEL, "text-transform")).toBeNull();
    // "Settings" (8 chars) at ~0.52em average TITLE-CASE advance.
    const labelPx = 8 * fontPx * 0.52;
    const labelGap = inset + Math.max(0, (contentBox - labelPx) / 2);
    expect(labelPx).toBeLessThanOrEqual(contentBox);
    expect(labelGap).toBeGreaterThanOrEqual(4);
  });

  it("gives the panel header, sections and thumbnail stack their own insets", () => {
    const header = ruleBody(".glass-sidebar-header");
    expect(decl(header, "padding")).toMatch(/0\s+var\(--space-standard\)/);
    expect(decl(PANEL_HEADER_ACTIONS, "flex")).toBe("1 1 auto");
    expect(decl(PANEL_ACTIONS, "flex")).toBe("1 1 auto");
    expect(decl(ruleBody(".context-panel-section"), "padding")).toMatch(
      /var\(--space-small\)\s+var\(--space-control\)/,
    );
    expect(decl(ruleBody(".thumb-scroller-inner"), "padding")).toMatch(/var\(--sp-2\)/);
  });
});

// ---------------------------------------------------------------------------
// Item 15 - the header title is gone and the panel is narrower.
// ---------------------------------------------------------------------------

describe("Phase 37 item 15 - no PAGES title, narrower panel", () => {
  it("narrows --tf-rail-w to 184px and the thumbnail geometry still fits", () => {
    expect(decl(RAIL_W_PROPERTY, "initial-value")).toBe("184px");
    const panelWidth = px(decl(RAIL_W_PROPERTY, "initial-value"));
    expect(THUMB_WIDTH + THUMB_RAIL_INSET_PX).toBeLessThanOrEqual(panelWidth);
    expect(panelWidth).toBeLessThan(220);
  });

  it("renders no title for PAGES but keeps the Combine entry + collapse control", () => {
    const { host, unmount } = mount(
      <ContextPanel
        doc={makeDocStub(3)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(3)}
        proxyVisibleOrder={false}
        canUndo={false}
        onJump={(): void => undefined}
        outline={null}
      />,
    );
    try {
      expect(host.querySelector(".glass-sidebar-title")).toBeNull();
      expect(host.querySelector("[data-context-panel-combine]")).not.toBeNull();
      expect(host.querySelector("[data-rail-collapse]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("keeps the EDIT / REVIEW / DELIVER word titles", () => {
    const { host, unmount } = mount(
      <ContextPanel
        stage="deliver"
        doc={makeDocStub(3)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(3)}
        proxyVisibleOrder={false}
        canUndo={false}
        onJump={(): void => undefined}
        outline={null}
      />,
    );
    try {
      expect(host.querySelector(".glass-sidebar-title")?.textContent).toBe("Deliver");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 16 - the Outline is flush at the panel bottom behind a divider.
// ---------------------------------------------------------------------------

const OUTLINE_NODES: OutlineNode[] = [{ title: "Chapter 1", dest: [1], children: [] }];

describe("Phase 37 item 16 - flush Outline with an item-22 separator", () => {
  it("uses the shared --divider token above the Outline section", () => {
    expect(decl(OUTLINE, "border-top")).toBe("1px solid var(--divider)");
  });

  it("caps the Outline section's share so a short outline hugs its content", () => {
    // Phase 59 (item 5 / DEF-419) — the share became an upper bound: a fixed
    // `height: 40%` reserved dead space under a short outline's last row.
    expect(decl(OUTLINE_WITH_BODY, "height")).toBe("auto");
    expect(decl(OUTLINE_WITH_BODY, "max-height")).toBe("40%");
    expect(decl(OUTLINE_WITH_BODY, "flex")).toBe("0 1 auto");
    expect(decl(ruleBody(".context-panel-thumbs"), "flex")).toBe("1 1 auto");
  });

  it("renders the Outline as the panel body's LAST child, after the thumbs", () => {
    const { host, unmount } = mount(
      <ContextPanel
        doc={makeDocStub(6)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(6)}
        proxyVisibleOrder={false}
        canUndo={false}
        onJump={(): void => undefined}
        outline={OUTLINE_NODES}
      />,
    );
    try {
      const body = host.querySelector(".context-panel-body");
      const section = host.querySelector("[data-context-panel-outline]");
      const stack = host.querySelector("[data-context-panel-thumbs]");
      expect(section).not.toBeNull();
      expect(body?.lastElementChild).toBe(section);
      expect(body?.firstElementChild).toBe(stack);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 18 - narrower Multi Mode strips that still fit their thumbs.
// ---------------------------------------------------------------------------

describe("Phase 37 item 18 - the Multi Mode strips are narrower", () => {
  it("drops the strip rest width to 150px while the single-mode panel is 184px", () => {
    expect(STRIP_REST_PX).toBe(150);
    expect(STRIP_WIDTH_PX).toBe(150);
    const panelWidth = px(decl(RAIL_W_PROPERTY, "initial-value"));
    expect(panelWidth).toBe(184);
    expect(STRIP_REST_PX).toBeLessThan(220);
    expect(STRIP_REST_PX).toBeLessThan(panelWidth);
  });

  it("keeps the strip's CSS rest + floor coherent with the constants", () => {
    expect(decl(STRIP_WORKSPACE, "--tf-strip-w")).toBe("150px");
    expect(decl(STRIP_WORKSPACE, "--tf-strip-min")).toBe("100px");
  });

  it("still fits the two-document thumbnail plus its chrome", () => {
    const thumbWidth = computeThumbWidth(STRIP_REST_PX, 2);
    expect(thumbWidth).toBe(89);
    expect(thumbWidth).toBeGreaterThanOrEqual(84);
    expect(thumbWidth + THUMB_FIT_INSET_PX).toBeLessThanOrEqual(STRIP_REST_PX);
    // DEF-347 - a single document in the 150px strip can NOT use the
    // single-mode 126px width: it caps to the strip's real content box, so
    // the preview stays inside its page row.
    const one = computeThumbWidth(STRIP_REST_PX, 1);
    expect(one).toBe(STRIP_REST_PX - THUMB_FIT_INSET_PX);
    expect(one).toBeLessThan(THUMB_WIDTH);
    expect(one + THUMB_FIT_INSET_PX).toBeLessThanOrEqual(STRIP_REST_PX);
  });
});

// ---------------------------------------------------------------------------
// Item 19 - the strips offer the SAME options as the single-mode panel.
// ---------------------------------------------------------------------------

interface StripHandlers {
  onOp?: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onExtractPages?: (page: number) => void;
  onInsertBlank?: (page: number) => void;
  onReplacePages?: (page: number) => void;
  onDeletePage?: (page: number) => void;
  onDrop?: (op: unknown) => void;
}

let latestSelection: number[] = [];

function StripHarness(props: {
  handlers: StripHandlers;
  withProvider?: boolean;
}): React.ReactElement {
  const [selection, setSelection] = useState<number[]>([]);
  latestSelection = selection;
  const strip = (
    <PaneThumbStrip
      pane="A"
      tabId="doc-a"
      title="Alpha.pdf"
      doc={makeDocStub(4)}
      pageCount={4}
      currentPage={1}
      defaultWidthPt={612}
      defaultHeightPt={792}
      pageSizes={null}
      engineState={makeEngineState(4)}
      proxyVisibleOrder={false}
      canUndo={false}
      onOp={props.handlers.onOp}
      onDelete={props.handlers.onDelete}
      onReorder={props.handlers.onReorder}
      onUndo={(): void => undefined}
      onJump={(): void => undefined}
      onFocusPane={(): void => undefined}
      documentCount={2}
      crossDoc={{ tabId: "doc-a", onDrop: props.handlers.onDrop ?? ((): void => undefined) }}
      onExtractPages={props.handlers.onExtractPages}
      onInsertBlank={props.handlers.onInsertBlank}
      onReplacePages={props.handlers.onReplacePages}
      onDeletePage={props.handlers.onDeletePage}
      pageSelection={selection}
      onPageSelectionChange={setSelection}
    />
  );
  return props.withProvider === true ? <PageDragProvider>{strip}</PageDragProvider> : strip;
}

function renderStrip(
  handlers: StripHandlers = {},
  withProvider = false,
): { host: HTMLElement; selection: () => number[]; unmount: () => void } {
  latestSelection = [];
  const m = mount(<StripHarness handlers={handlers} withProvider={withProvider} />);
  return { host: m.host, selection: (): number[] => latestSelection, unmount: m.unmount };
}

function contextMenuOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 80 }),
    );
  });
}

describe("Phase 37 item 19 - strip parity with the single-mode panel", () => {
  it("renders the SAME three inline hover verbs per thumbnail", () => {
    const { host, unmount } = renderStrip();
    try {
      for (const page of [1, 2, 3, 4]) {
        const verbs = [...thumb(host, page).querySelectorAll("[data-thumb-verb]")];
        expect(verbs.map((v) => v.getAttribute("data-thumb-verb"))).toEqual([
          "rotate-cw",
          "extract",
          "delete",
        ]);
        expect(thumb(host, page).querySelector(".thumb-verbs")).not.toBeNull();
      }
    } finally {
      unmount();
    }
  });

  it("runs the strip's own handlers from the verbs", () => {
    const onOp = vi.fn();
    const onExtractPages = vi.fn();
    const onDelete = vi.fn();
    const { host, unmount } = renderStrip({ onOp, onExtractPages, onDelete });
    try {
      clickOn(thumb(host, 2).querySelector("[data-thumb-verb='rotate-cw']") as Element);
      expect(onOp).toHaveBeenCalledWith({ kind: "rotate", page: 2, dir: "cw" });
      clickOn(thumb(host, 3).querySelector("[data-thumb-verb='extract']") as Element);
      expect(onExtractPages).toHaveBeenCalledWith(3);
      clickOn(thumb(host, 4).querySelector("[data-thumb-verb='delete']") as Element);
      expect(onDelete).toHaveBeenCalledWith([4]);
    } finally {
      unmount();
    }
  });

  it("offers the SAME six-item right-click menu as the panel", () => {
    const handlers: StripHandlers = {
      onOp: vi.fn(),
      onExtractPages: vi.fn(),
      onInsertBlank: vi.fn(),
      onReplacePages: vi.fn(),
      onDeletePage: vi.fn(),
    };
    const { host, unmount } = renderStrip(handlers);
    try {
      contextMenuOn(thumb(host, 2));
      const menu = host.querySelector("[data-context-menu]");
      expect(menu?.getAttribute("data-page")).toBe("2");
      expect([...host.querySelectorAll("[data-menu-item]")].map((el) => el.textContent)).toEqual([
        "Rotate CW",
        "Rotate CCW",
        `Extract${ELLIPSIS}`,
        "Insert blank after",
        `Replace${ELLIPSIS}`,
        `Delete${ELLIPSIS}`,
      ]);
      clickOn(host.querySelector("[data-menu-item='rotate-cw']") as Element);
      expect(handlers.onOp).toHaveBeenCalledWith({ kind: "rotate", page: 2, dir: "cw" });
      contextMenuOn(thumb(host, 3));
      clickOn(host.querySelector("[data-menu-item='insert-blank']") as Element);
      expect(handlers.onInsertBlank).toHaveBeenCalledWith(3);
      contextMenuOn(thumb(host, 4));
      clickOn(host.querySelector("[data-menu-item='delete']") as Element);
      expect(handlers.onDeletePage).toHaveBeenCalledWith(4);
    } finally {
      unmount();
    }
  });

  it("supports the SAME multi-select gestures (Ctrl toggles, Shift extends)", () => {
    const { host, selection, unmount } = renderStrip();
    try {
      clickOn(thumb(host, 1));
      expect(selection()).toEqual([1]);
      clickOn(thumb(host, 3), { ctrlKey: true });
      expect(selection()).toEqual([1, 3]);
      // Ctrl-click moves the anchor to the toggled page; Shift extends from it.
      clickOn(thumb(host, 4), { shiftKey: true });
      expect(selection()).toEqual([3, 4]);
      expect(host.querySelectorAll(".thumb-selected").length).toBe(2);
    } finally {
      unmount();
    }
  });

  it("keeps drag-reorder at parity (intra-document path)", () => {
    const onReorder = vi.fn();
    const { host, unmount } = renderStrip({ onReorder });
    try {
      dragEventOn(thumb(host, 1), "dragstart");
      expect(thumb(host, 1).className).toContain("thumb-dragging");
      dragEventOn(thumb(host, 3), "dragover");
      dragEventOn(thumb(host, 3), "drop");
      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder).toHaveBeenCalledWith(1, 2);
    } finally {
      unmount();
    }
  });

  it("keeps the Phase 32 cross-document drag path live on the strip", () => {
    const onDrop = vi.fn();
    const { host, unmount } = renderStrip({ onDrop }, true);
    try {
      dragEventOn(thumb(host, 1), "dragstart");
      dragEventOn(thumb(host, 3), "dragover");
      dragEventOn(thumb(host, 3), "drop");
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop.mock.calls[0][0]).toMatchObject({
        mode: "move",
        fromTabId: "doc-a",
        toTabId: "doc-a",
        atIndex: 2,
      });
    } finally {
      unmount();
    }
  });
});