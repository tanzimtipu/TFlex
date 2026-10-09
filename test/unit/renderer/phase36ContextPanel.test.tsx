// @vitest-environment jsdom
//
// Phase 36 (chunk 2) — the PAGES ContextPanel.
//
// The panel is the PAGES stage's left panel, mounted alongside the unchanged
// rail behind the temporary dev flag. These tests pin the operator's #1
// requirement — the stack shows LIVE-RENDERED page previews (real miniature
// canvases, never placeholders) that track engine state — plus the new
// chrome: the hover verbs, the right-click menu and the collapsible outline
// section, including the AGENTS cross-bubbling rules (a verb click must not
// jump, select or start a drag, and must not swallow anything else).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ContextPanel,
  buildPageMenuItems,
  clampMenuPosition,
} from "../../../src/renderer/components/ContextPanel";
import { THUMB_WIDTH } from "../../../src/renderer/components/thumbGeometry";
import type { OutlineEditorConfig, RailTab } from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";
import { ok } from "../../../src/shared/result";
import type { OutlineNode } from "../../../src/renderer/pdf/pdfjs";

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
}

function makeDocStub(numPages: number, pageNumberBase = 1): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        // `pageNumberBase` lets a test flip which source page a slot renders
        // so the data-source-page plumbing is observable.
        pageNumber: n + pageNumberBase - 1,
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number; rotation?: number }): {
          width: number;
          height: number;
        } => ({ width: 612, height: 792 }),
        render: (_args: unknown): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(
  pageCount: number,
  overrides: Partial<EngineState> = {},
): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
    ...overrides,
  };
}

const OUTLINE: OutlineNode[] = [
  { title: "Chapter 1", dest: [2], children: [] },
  { title: "Chapter 2", dest: [4], children: [{ title: "Section", dest: [5], children: [] }] },
];

interface FakeCtx {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

const ctxByCanvas = new Map<HTMLCanvasElement, FakeCtx>();

/** Canvases that received a real blit (a painted preview, not a placeholder). */
function paintedCanvases(): HTMLCanvasElement[] {
  return [...ctxByCanvas.entries()]
    .filter(([canvas, ctx]) => canvas.width > 0 && ctx.drawImage.mock.calls.length > 0)
    .map(([canvas]) => canvas);
}

interface PanelHandlers {
  onJump?: (page: number) => void;
  onOp?: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onMerge?: () => void;
onExtractPages?: (page: number) => void;
  onInsertBlank?: (page: number) => void;
  onReplacePages?: (page: number) => void;
  onDeletePage?: (page: number) => void;
  onRemoveBlankPages?: () => void;
  /** Phase 111 (chunk B) — the host-owned batch selection set. */
  pageSelection?: readonly number[] | null;
  onPageSelectionChange?: ((pages: number[]) => void) | null;
}

interface PanelOptions extends PanelHandlers {
  pageCount?: number;
  currentPage?: number;
  engineState?: EngineState;
  outline?: OutlineNode[] | null;
  outlineEditor?: OutlineEditorConfig | null;
  doc?: PDFDocumentProxy;
  railTab?: RailTab;
  onRailTabChange?: (tab: RailTab) => void;
}

function renderPanel(
  options: PanelOptions = {},
): { host: HTMLElement; rerender: (next: PanelOptions) => void; unmount: () => void } {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const draw = (current: PanelOptions): void => {
    const pageCount = current.pageCount ?? 3;
    act((): void => {
      root.render(
        <ContextPanel
          doc={current.doc ?? makeDocStub(pageCount)}
          currentPage={current.currentPage ?? 1}
          defaultWidthPt={612}
          defaultHeightPt={792}
          pageSizes={null}
          engineState={current.engineState ?? makeEngineState(pageCount)}
          proxyVisibleOrder={false}
          canUndo={false}
          onOp={current.onOp}
          onDelete={current.onDelete}
          onReorder={current.onReorder}
          onUndo={(): void => undefined}
          onJump={current.onJump ?? ((): void => undefined)}
          outline={current.outline === undefined ? null : current.outline}
          outlineEditor={current.outlineEditor ?? null}
          railTab={current.railTab}
          onRailTabChange={current.onRailTabChange}
          onMerge={current.onMerge}
          onExtractPages={current.onExtractPages}
          onInsertBlank={current.onInsertBlank}
onReplacePages={current.onReplacePages}
          onDeletePage={current.onDeletePage}
          onRemoveBlankPages={current.onRemoveBlankPages}
          pageSelection={current.pageSelection === undefined ? null : current.pageSelection}
          onPageSelectionChange={current.onPageSelectionChange ?? null}
        />,
      );
    });
  };

  draw(options);
  return {
    host,
    rerender: (next: PanelOptions): void => draw(next),
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Let the thumb render effects (async getPage + render promise) settle. */
async function flushRenders(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async (): Promise<void> => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

/** Dispatch a pointerdown on `target`, bubbling so the thumb's React
 *  handler sees it with the right event target (the cross-bubbling guard
 *  reads `event.target.closest('.thumb-more, .thumb-checkbox')`). */
function pointerDownOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
  });
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** A drag event carrying the minimal dataTransfer the rail's handlers touch. */
function dragEventOn(
  target: Element,
  type: "dragstart" | "dragover" | "drop",
  init: { effectAllowed?: string; dropEffect?: string } = {},
): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      effectAllowed: init.effectAllowed ?? "",
      dropEffect: init.dropEffect ?? "",
      setData: vi.fn(),
      getData: vi.fn(),
    },
  });
  act((): void => {
    target.dispatchEvent(event);
  });
}

const thumbs = (host: HTMLElement): HTMLElement[] =>
  [...host.querySelectorAll<HTMLElement>(".thumb-item")];

const thumb = (host: HTMLElement, page: number): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`.thumb-item[data-page="${page}"]`);
  if (el === null) throw new Error(`no thumb for page ${page}`);
  return el;
};

/** Phase 111 (chunk B) — the card footer's per-page More control. */
const cardMore = (host: HTMLElement, page: number): HTMLElement => {
  const el = host.querySelector<HTMLElement>(
    `.thumb-item[data-page="${page}"] [data-thumb-more]`,
  );
  if (el === null) throw new Error(`no More control on page ${page}`);
  return el;
};

/** Open a card's More menu. */
function openCardMore(host: HTMLElement, page: number): void {
  clickOn(cardMore(host, page));
}

const menuItem = (host: HTMLElement, id: string): HTMLButtonElement => {
  const el = host.querySelector<HTMLButtonElement>(`[data-menu-item="${id}"]`);
  if (el === null) throw new Error(`no menu item ${id}`);
  return el;
};

function openMenu(host: HTMLElement, page: number, x = 120, y = 90): void {
  act((): void => {
    thumb(host, page).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  });
}

beforeEach((): void => {
  ctxByCanvas.clear();
  // jsdom reports clientHeight 0 everywhere, which collapses the rail's
  // geometry-based visible range and leaves every thumb unmounted. A fixed
  // viewport height mounts the first slots so the paint path really runs.
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      let existing = ctxByCanvas.get(this);
      if (existing === undefined) {
        existing = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
        ctxByCanvas.set(this, existing);
      }
      return existing as unknown as CanvasRenderingContext2D;
    },
  );
});

afterEach((): void => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.restoreAllMocks();
});

describe("ContextPanel — header (title removed + Combine)", () => {
  it("shows NO PAGES title and runs the EXISTING merge handler", () => {
    const onMerge = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onMerge });
    try {
      // Phase 37 (item 15) — the "Pages · N" title text is removed; the
      // header keeps the collapse control. Phase 124 moved Combine out of the
      // retired More menu and onto a direct header icon button.
      expect(host.querySelector(".glass-sidebar-title")).toBeNull();
      const combine = host.querySelector<HTMLButtonElement>("[data-context-panel-combine]");
      expect(combine).not.toBeNull();
      expect(combine?.getAttribute("aria-label")).toContain("Combine");
      clickOn(combine as HTMLButtonElement);
      expect(onMerge).toHaveBeenCalledTimes(1);
      // Phase 36 (chunk 6) — the dev badge is retired with the dev flag: the
      // panel is the real default left slot now and carries the re-homed
      // collapse control (the rail's `data-rail-collapse` hook).
      expect(host.querySelector("[data-context-panel-dev-badge]")).toBeNull();
      expect(host.querySelector("[data-rail-collapse]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("follows the engine's page count (deletes re-report it live)", () => {
    const { host, rerender, unmount } = renderPanel({ pageCount: 3 });
    try {
      // No title to drift; the stack is the live source of truth.
      expect(host.querySelector(".glass-sidebar-title")).toBeNull();
      expect(thumbs(host).map((t) => t.getAttribute("data-page"))).toEqual(["1", "2", "3"]);
      rerender({ pageCount: 2, engineState: makeEngineState(2) });
      expect(host.querySelector(".glass-sidebar-title")).toBeNull();
      expect(thumbs(host).map((t) => t.getAttribute("data-page"))).toEqual(["1", "2"]);
    } finally {
      unmount();
    }
  });
});

describe("ContextPanel — the live thumbnail stack (re-parented ThumbnailRail)", () => {
  it("renders the rail's own thumbnails, one per live page, with the current-page highlight", () => {
    const { host, unmount } = renderPanel({ pageCount: 4, currentPage: 3 });
    try {
      expect(thumbs(host).map((t) => t.getAttribute("data-page"))).toEqual(["1", "2", "3", "4"]);
      expect(host.querySelectorAll(".thumb-current").length).toBe(1);
      expect(host.querySelector(".thumb-current")?.getAttribute("data-page")).toBe("3");
      // Same component, same classes the rail/e2e already target.
      expect(host.querySelector(".thumb-scroller-inner")).not.toBeNull();
      expect(host.querySelector("[data-context-panel-thumbs]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("shows the designed empty state when the document has zero pages", () => {
    const { host, unmount } = renderPanel({ pageCount: 0 });
    try {
      expect(thumbs(host)).toHaveLength(0);
      const empty = host.querySelector("[data-context-panel-thumbs-empty]");
      expect(empty).not.toBeNull();
      expect(empty?.classList.contains("empty-state")).toBe(true);
      expect(empty?.querySelector(".empty-state-headline")?.textContent).toBe("No pages to show");
      expect(empty?.querySelector(".empty-state-mark")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("PAINTS real previews: non-zero backing store + a blit, never a placeholder", async () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      await flushRenders();
      const painted = paintedCanvases();
      expect(painted.length).toBeGreaterThan(0);
      for (const canvas of painted) {
        expect(canvas.classList.contains("thumb-canvas")).toBe(true);
        expect(host.contains(canvas)).toBe(true);
        // The wrap/blit geometry is today's rail geometry, unchanged.
        expect(canvas.style.width).toBe(`${THUMB_WIDTH}px`);
        expect(canvas.width).toBeGreaterThan(0);
        expect(canvas.height).toBeGreaterThan(0);
        // A painted thumb shows no shimmer placeholder.
        expect(canvas.closest(".thumb-item")?.querySelector(".thumb-placeholder")).toBeNull();
      }
    } finally {
      unmount();
    }
  });

  it("reflects engine state live: quarter-turn rotations and reorders", () => {
    const engineState = makeEngineState(3, {
      rotations: [0, 1, 0] as EngineState["rotations"],
      pageOrder: [1, 0, 2],
    });
    const { host, unmount } = renderPanel({ pageCount: 3, engineState });
    try {
      expect(thumb(host, 2).className).toContain("thumb-rot-90");
      // Visible slot 1 now renders source page 2 and vice versa.
      expect(thumb(host, 1).getAttribute("data-source-page")).toBe("2");
      expect(thumb(host, 2).getAttribute("data-source-page")).toBe("1");
      expect(thumb(host, 3).getAttribute("data-source-page")).toBe("3");
    } finally {
      unmount();
    }
  });

  it("jumps to the VISIBLE page on a thumb click (scroll sync contract)", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 5, onJump });
    try {
      clickOn(thumb(host, 4));
      expect(onJump).toHaveBeenCalledTimes(1);
      expect(onJump).toHaveBeenCalledWith(4);
    } finally {
      unmount();
    }
  });

  it("keeps the rail's own Ctrl/Shift-click selection (its action bar is retired)", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 5, onJump });
    try {
      act((): void => {
        thumb(host, 2).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }),
        );
      });
      expect(host.querySelector(".thumb-selected")?.getAttribute("data-page")).toBe("2");
      // Phase 40 (item 9) — the under-thumbnail rotate/delete bar is retired;
      // selection itself is unchanged.
      expect(host.querySelector("[data-rail-action-bar]")).toBeNull();
      // A modifier click selects; it does not navigate.
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});

describe("ContextPanel — the page card footer", () => {
  it("renders a checkbox + label + More and drops the over-preview verbs", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      for (const page of [1, 2, 3]) {
        const card = thumb(host, page);
        // The retired inline verb cluster is GONE.
        expect(card.querySelector("[data-thumb-verbs]")).toBeNull();
        expect(card.querySelector("[data-thumb-verb]")).toBeNull();
        // The footer: checkbox + label + More.
        expect(card.querySelector("[data-thumb-checkbox]")).not.toBeNull();
        expect(card.querySelector(".thumb-label")?.textContent).toBe(String(page));
        expect(card.querySelector("[data-thumb-more]")).not.toBeNull();
      }
      // The preview is a real button; the footer controls are its siblings.
      expect(thumb(host, 1).querySelector(".thumb-page")?.tagName).toBe("BUTTON");
    } finally {
      unmount();
    }
  });

  it("a checkbox change toggles the host set and never navigates", () => {
    const onPageSelectionChange = vi.fn();
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({
      pageCount: 3,
      pageSelection: [],
      onPageSelectionChange,
      onJump,
    });
    try {
      clickOn(thumb(host, 2).querySelector("[data-thumb-checkbox]") as Element);
      expect(onPageSelectionChange).toHaveBeenCalledWith([2]);
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("the More menu runs the EXISTING per-page handlers for its own page", () => {
    const onOp = vi.fn();
    const onExtractPages = vi.fn();
    const onDelete = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 4, onOp, onExtractPages, onDelete });
    try {
      openCardMore(host, 3);
      clickOn(menuItem(host, "rotate-cw"));
      expect(onOp).toHaveBeenCalledWith({ kind: "rotate", page: 3, dir: "cw" });
      openCardMore(host, 2);
      clickOn(menuItem(host, "extract"));
      expect(onExtractPages).toHaveBeenCalledWith(2);
      openCardMore(host, 4);
      clickOn(menuItem(host, "delete"));
      expect(onDelete).toHaveBeenCalledWith([4]);
    } finally {
      unmount();
    }
  });

  it("a press that starts on the More control never starts a page drag", () => {
    const onReorder = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onReorder });
    try {
      // Press on the lucide GLYPH (an SVGElement, not an HTMLElement) — the
      // real-world target — so the guard is proven for both node kinds.
      const glyph = cardMore(host, 2).querySelector("svg");
      expect(glyph).not.toBeNull();
      expect(glyph instanceof HTMLElement).toBe(false);
      pointerDownOn(glyph as Element);
      const t = thumb(host, 2);
      dragEventOn(t, "dragstart");
      expect(t.className).not.toContain("thumb-dragging");
      dragEventOn(thumb(host, 3), "drop", { dropEffect: "move" });
      expect(onReorder).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("keeps drag-reorder + its drop indicators intact when the press is on the thumb", () => {
    const onReorder = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onReorder });
    try {
      const from = thumb(host, 1);
      pointerDownOn(from);
      dragEventOn(from, "dragstart");
      expect(from.className).toContain("thumb-dragging");
      const target = thumb(host, 3);
      dragEventOn(target, "dragover");
      expect(target.className).toContain("thumb-drop-target");
      expect(target.querySelector("[data-thumb-drop-line]")).not.toBeNull();
      dragEventOn(target, "drop", { dropEffect: "move" });
      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder).toHaveBeenCalledWith(1, 2);
      expect(host.querySelector(".thumb-dragging")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("ContextPanel — the right-click menu", () => {
it("lists the SIX page verbs, in order (Renumber REMOVED — section 3A ruling 2)", () => {
    const { host, unmount } = renderPanel({ pageCount: 4 });
    try {
      expect(host.querySelector("[data-context-menu]")).toBeNull();
      openMenu(host, 2);
      const menu = host.querySelector("[data-context-menu]");
      expect(menu?.getAttribute("data-page")).toBe("2");
      expect(menu?.getAttribute("role")).toBe("menu");
      expect(
        [...host.querySelectorAll("[data-menu-item]")].map((el) => el.textContent),
      ).toEqual([
        "Rotate CW",
        "Rotate CCW",
        "Extract…",
        "Insert blank after",
        "Replace…",
        "Delete…",
      ]);
      // Renumber… has exactly ONE home: the Inspector's `Label · renumber…`.
      expect(host.querySelector('[data-menu-item="renumber"]')).toBeNull();
    } finally {
      unmount();
    }
  });

it("each item runs its own EXISTING handler with the menu's page", () => {
    const cases: Array<{ id: string; key: keyof PanelHandlers; expected: unknown }> = [
      { id: "rotate-cw", key: "onOp", expected: { kind: "rotate", page: 2, dir: "cw" } },
      { id: "rotate-ccw", key: "onOp", expected: { kind: "rotate", page: 2, dir: "ccw" } },
      { id: "extract", key: "onExtractPages", expected: 2 },
      { id: "insert-blank", key: "onInsertBlank", expected: 2 },
      { id: "replace", key: "onReplacePages", expected: 2 },
      { id: "delete", key: "onDeletePage", expected: 2 },
    ];
    for (const testCase of cases) {
      const spies: Record<string, ReturnType<typeof vi.fn>> = {
        onOp: vi.fn(),
        onDelete: vi.fn(),
        onExtractPages: vi.fn(),
        onInsertBlank: vi.fn(),
        onReplacePages: vi.fn(),
        onDeletePage: vi.fn(),
      };
      const { host, unmount } = renderPanel({
        pageCount: 3,
        onOp: spies.onOp as PanelHandlers["onOp"],
        onDelete: spies.onDelete as PanelHandlers["onDelete"],
        onExtractPages: spies.onExtractPages as PanelHandlers["onExtractPages"],
        onInsertBlank: spies.onInsertBlank as PanelHandlers["onInsertBlank"],
        onReplacePages: spies.onReplacePages as PanelHandlers["onReplacePages"],
        onDeletePage: spies.onDeletePage as PanelHandlers["onDeletePage"],
      });
      try {
        openMenu(host, 2);
        clickOn(menuItem(host, testCase.id));
        expect(spies[testCase.key]).toHaveBeenCalledTimes(1);
        expect(spies[testCase.key]).toHaveBeenCalledWith(testCase.expected);
        // Selecting an item closes the menu.
        expect(host.querySelector("[data-context-menu]")).toBeNull();
      } finally {
        unmount();
      }
    }
  });

  it("'Insert blank after' is an IMMEDIATE insert (onInsertBlank), not a dialog open", () => {
    // The menu verb maps straight to the immediate-insert handler; it never
    // touches the dialog-opener or the immediate per-page delete.
    const onInsertBlank = vi.fn();
    const onDeletePage = vi.fn();
    const onDelete = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onInsertBlank, onDeletePage, onDelete });
    try {
      openMenu(host, 3);
      clickOn(menuItem(host, "insert-blank"));
      expect(onInsertBlank).toHaveBeenCalledTimes(1);
      expect(onInsertBlank).toHaveBeenCalledWith(3);
      expect(onDeletePage).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("'Delete…' opens the delete-pages dialog handler, never an immediate delete", () => {
    const onDeletePage = vi.fn();
    const onDelete = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 4, onDeletePage, onDelete });
    try {
      openMenu(host, 4);
      clickOn(menuItem(host, "delete"));
      // The ellipsis promises a dialog: seed it with the clicked page.
      expect(onDeletePage).toHaveBeenCalledTimes(1);
      expect(onDeletePage).toHaveBeenCalledWith(4);
      // The immediate per-page delete path is NOT taken.
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("the card More's Delete stays an IMMEDIATE per-page delete (onDelete([page]))", () => {
    const onDelete = vi.fn();
    const onDeletePage = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 4, onDelete, onDeletePage });
    try {
      openCardMore(host, 3);
      clickOn(menuItem(host, "delete"));
      // The More Delete is a one-click delete, not the dialog.
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith([3]);
      expect(onDeletePage).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("dismisses on Esc", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      openMenu(host, 2);
      expect(host.querySelector("[data-context-menu]")).not.toBeNull();
      act((): void => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(host.querySelector("[data-context-menu]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("dismisses on an outside pointerdown WITHOUT swallowing it", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onJump });
    try {
      openMenu(host, 2);
      const target = thumb(host, 3);
      pointerDownOn(target);
      expect(host.querySelector("[data-context-menu]")).toBeNull();
      // The press still reached its own target: the thumb click still fires.
      clickOn(target);
      expect(onJump).toHaveBeenCalledWith(3);
    } finally {
      unmount();
    }
  });

  it("dismisses on scroll", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      openMenu(host, 2);
      const scroller = host.querySelector(".thumb-scroller-inner");
      expect(scroller).not.toBeNull();
      act((): void => {
        (scroller as Element).dispatchEvent(new Event("scroll"));
      });
      expect(host.querySelector("[data-context-menu]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("clamps the menu into the viewport and keeps a pointer anchor mid-window", () => {
    // Pure clamp math: mid-window keeps the pointer point.
    expect(clampMenuPosition(300, 200, 184, 212, 1200, 800)).toEqual({ left: 300, top: 200 });
    // Bottom-right edge: pulls the box inside the 8px gutter.
    expect(clampMenuPosition(1190, 790, 184, 212, 1200, 800)).toEqual({
      left: 1008,
      top: 580,
    });
    // Top-left edge: never above/left of the gutter.
    expect(clampMenuPosition(2, 1, 184, 212, 1200, 800)).toEqual({ left: 8, top: 8 });
    // Degenerate box larger than the viewport: gutter wins, no negative.
    expect(clampMenuPosition(600, 400, 2000, 2000, 1200, 800)).toEqual({ left: 8, top: 8 });
  });

it("keeps the SIX items in ONE data list (labels + wiring together)", () => {
    const page = 7;
    const handlers = {
      onRotateCw: vi.fn(),
      onRotateCcw: vi.fn(),
      onExtract: vi.fn(),
      onInsertBlank: vi.fn(),
      onReplace: vi.fn(),
      onDeletePage: vi.fn(),
    };
    const items = buildPageMenuItems(page, handlers);
    expect(items.map((i) => i.id)).toEqual([
      "rotate-cw",
      "rotate-ccw",
      "extract",
      "insert-blank",
      "replace",
      "delete",
    ]);
    expect(items.filter((i) => i.danger === true).map((i) => i.id)).toEqual(["delete"]);
    for (const item of items) item.run();
    for (const spy of Object.values(handlers)) {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(page);
    }
  });
});

describe("ContextPanel — the outline section", () => {
  it("re-parents the outline tree and navigates on a bookmark click", async () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE, railTab: "outline", onJump });
    try {
      expect(host.querySelector("[data-context-panel-outline]")).not.toBeNull();
      const links = [...host.querySelectorAll<HTMLButtonElement>(".outline-link")];
      expect(links.map((l) => l.textContent)).toEqual(["Chapter 1", "Chapter 2", "Section"]);
      // Same tree the rail's outline tab renders (nested depth preserved).
      expect(host.querySelectorAll(".outline-panel").length).toBe(1);
      clickOn(links[0]);
      await flushRenders();
      // dest [2] resolves to page 3 (pdf.js indices are 0-based).
      expect(onJump).toHaveBeenCalledWith(3);
    } finally {
      unmount();
    }
  });

  it("switches the navigator view from the host-owned railTab (no disclosure)", () => {
    const onRailTabChange = vi.fn();
    const { host, rerender, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE, onRailTabChange });
    try {
      // Default (undefined railTab) is the Pages view; no disclosure remains.
      expect(host.querySelector('[data-context-panel-view="pages"]')).not.toBeNull();
      expect(host.querySelector("[data-outline-toggle]")).toBeNull();
      expect(host.querySelectorAll(".thumb-item").length).toBe(8);
      // The panel's own Outline tab reports the choice to the host.
      clickOn(host.querySelector('[data-context-panel-view-tab="outline"]') as Element);
      expect(onRailTabChange).toHaveBeenLastCalledWith("outline");
      // When the host selects the Outline view, only the tree is mounted.
      rerender({ pageCount: 8, outline: OUTLINE, railTab: "outline", onRailTabChange });
      expect(host.querySelector('[data-context-panel-view="outline"]')).not.toBeNull();
      expect(host.querySelector("[data-context-panel-outline-body]")).not.toBeNull();
      expect(host.querySelectorAll(".thumb-item").length).toBe(0);
      // Back to Pages.
      rerender({ pageCount: 8, outline: OUTLINE, railTab: "thumbs", onRailTabChange });
      expect(host.querySelector('[data-context-panel-view="pages"]')).not.toBeNull();
      expect(host.querySelectorAll(".thumb-item").length).toBe(8);
    } finally {
      unmount();
    }
  });

  it("omits the outline section entirely when the document has none", () => {
    const { host, unmount } = renderPanel({ pageCount: 3, outline: null });
    try {
      expect(host.querySelector("[data-context-panel-outline]")).toBeNull();
      expect(host.querySelector("[data-outline-toggle]")).toBeNull();
      // The stack still renders.
      expect(host.querySelectorAll(".thumb-item").length).toBe(3);
    } finally {
      unmount();
    }
  });

  // DEF-492 — an outline-less document (catalog has no /Outlines) must still
  // expose the editable outline so the very first bookmark can be created.
  // The render gate keys on the editor config, not on a non-null tree.
  it("offers the add control when outline is null but an editor config is present (DEF-492)", () => {
    const editor: OutlineEditorConfig = {
      docId: "d",
      entries: [],
      visiblePageCount: 3,
      commit: async () => ok(makeEngineState(3)),
    };
    const editable = renderPanel({ pageCount: 3, outline: null, outlineEditor: editor, railTab: "outline" });
    try {
      expect(editable.host.querySelector("[data-context-panel-outline]")).not.toBeNull();
      expect(editable.host.querySelector("[data-outline-editable]")).not.toBeNull();
      expect(editable.host.querySelector("[data-outline-add]")).not.toBeNull();
    } finally {
      editable.unmount();
    }

    // View-only path: with no editor the Outline view shows the designed
    // "No bookmarks" empty state instead of fabricating a tree.
    const viewOnly = renderPanel({ pageCount: 3, outline: null, outlineEditor: null, railTab: "outline" });
    try {
      expect(viewOnly.host.querySelector("[data-context-panel-outline]")).not.toBeNull();
      expect(viewOnly.host.querySelector("[data-context-panel-outline-empty]")).not.toBeNull();
      expect(viewOnly.host.querySelector("[data-outline-add]")).toBeNull();
    } finally {
      viewOnly.unmount();
    }
  });

  // DEF-494 / Phase 111 (chunk C) — the retired inline toolbar is gone. The
  // outline's ONE add control is the header Add; the per-row verbs live in the
  // row More menu, so an empty tree exposes no inline verbs at all.
  it("shows ONLY the header add control with no inline verbs (DEF-494)", async () => {
    const commit = vi.fn(async () => ok(makeEngineState(3)));
    const editor: OutlineEditorConfig = {
      docId: "d",
      entries: [],
      visiblePageCount: 3,
      commit,
    };
    const { host, unmount } = renderPanel({
      pageCount: 3,
      outline: null,
      outlineEditor: editor,
      railTab: "outline",
    });
    try {
      expect(host.querySelector("[data-outline-toolbar]")).toBeNull();
      expect(host.querySelector(".outline-verbs")).toBeNull();
      const add = host.querySelector("[data-outline-add]");
      expect(add).not.toBeNull();
      expect(add?.closest(".outline-head")).not.toBeNull();
      expect(host.querySelector("[data-outline-rename]")).toBeNull();
      expect(host.querySelector("[data-outline-retarget]")).toBeNull();
      expect(host.querySelector("[data-outline-indent]")).toBeNull();
      expect(host.querySelector("[data-outline-outdent]")).toBeNull();
      expect(host.querySelector("[data-outline-delete]")).toBeNull();
      // The lone add control still creates the first row.
      clickOn(add as Element);
      await flushRenders();
      expect(commit).toHaveBeenCalledTimes(1);
      const payload = (commit.mock.calls[0] as unknown as [string, Array<{ title: string }>])[1];
      expect(payload.map((entry) => entry.title)).toEqual(["New bookmark"]);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-310 — the outline must stay CONTAINED in its section.
//
// `.outline-panel` is `position: absolute; inset: 0` (the rail's own rule; the
// rail's `.rail-content` is the positioned box that bounds it). The panel's
// section body used to be static, so the tree escaped to the nearest
// positioned ancestor (`.glass-sidebar-body`) and painted over thumbnail 1,
// over the OUTLINE toggle, and swallowed every pointer event in the panel
// body. These tests pin both halves of the fix: the DOM nests the absolute
// tree inside the bounded section body (jsdom), and styles.css gives that body
// the same positioning-context role `.rail-content` plays for the rail
// (textual scan — jsdom cannot apply styles.css; the established
// formsCssStacking / phase142Layout pattern).

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

function ruleBody(css: string, selector: string): string {
  const m = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  return m?.[1] ?? "";
}

describe("ContextPanel — DEF-310 outline containment", () => {
  it("nests the absolute outline tree inside the bounded view body", () => {
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE, railTab: "outline" });
    try {
      const view = host.querySelector("[data-context-panel-view='outline']");
      const body = host.querySelector("[data-context-panel-outline-body]");
      const panel = host.querySelector(".outline-panel");
      expect(view).not.toBeNull();
      expect(body).not.toBeNull();
      expect(panel).not.toBeNull();
      // The tree is a DIRECT child of the bounded body, which is the view's
      // content box — the box that bounds it.
      expect(body?.parentElement).toBe(view);
      expect(panel?.parentElement).toBe(body);
      // The thumbnails are not mounted in the Outline view at all.
      expect(host.querySelector("[data-context-panel-thumbs]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("mounts exactly ONE view at a time (Pages XOR Outline)", () => {
    const pages = renderPanel({ pageCount: 8, outline: OUTLINE });
    try {
      expect(pages.host.querySelector("[data-context-panel-view='pages']")).not.toBeNull();
      expect(pages.host.querySelector("[data-context-panel-view='outline']")).toBeNull();
    } finally {
      pages.unmount();
    }
    const outline = renderPanel({ pageCount: 8, outline: OUTLINE, railTab: "outline" });
    try {
      expect(outline.host.querySelector("[data-context-panel-view='outline']")).not.toBeNull();
      expect(outline.host.querySelector("[data-context-panel-view='pages']")).toBeNull();
    } finally {
      outline.unmount();
    }
  });

  it("keeps the thumbnails clickable in the Pages view (never drawn inside the Outline view)", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE, onJump });
    try {
      expect(thumbs(host).length).toBe(8);
      // The Outline view is not mounted while Pages is showing.
      expect(host.querySelector("[data-context-panel-view='outline']")).toBeNull();
      // The press reaches the thumbnail: the scroll-sync jump still fires.
      clickOn(thumb(host, 7));
      expect(onJump).toHaveBeenCalledWith(7);
    } finally {
      unmount();
    }
  });

  it("keeps the view selector outside the outline body (never covered by the tree)", () => {
    const onRailTabChange = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE, railTab: "outline", onRailTabChange });
    try {
      const body = host.querySelector("[data-context-panel-outline-body]");
      const tablist = host.querySelector("[data-context-panel-view-tabs]");
      expect(tablist).not.toBeNull();
      expect(body?.contains(tablist as Node)).toBe(false);
      // The selector is live above the tree: its Pages tab still reports.
      clickOn(host.querySelector('[data-context-panel-view-tab="pages"]') as Element);
      expect(onRailTabChange).toHaveBeenLastCalledWith("thumbs");
    } finally {
      unmount();
    }
  });

  it("styles.css makes the view body the positioning context the rail's .rail-content is", () => {
    const css = readStyles();
    // The rail is untouched: `.rail-content` still bounds the rail's own
    // absolute `.outline-panel` tab.
    expect(ruleBody(css, "\\.rail-content")).toMatch(/position:\s*relative/);
    // The Outline view body plays that same role.
    const body = ruleBody(css, "\\.context-panel-outline-body");
    expect(body).toMatch(/position:\s*relative/);
    // The body is a bounded box, not a scroller: `.outline-panel` scrolls
    // inside it and can never reach the selector or the tab strip.
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/overflow-y:\s*auto/);
    // Phase 111 (chunk A) — the view body fills the panel body; only ONE view
    // is mounted at a time.
    const view = ruleBody(css, "\\.context-panel-view-body");
    expect(view).toMatch(/flex:\s*1 1 auto/);
    expect(view).toMatch(/min-height:\s*0/);
    // The scoped tree rule only zeroes the bottom padding; the shared
    // `.outline-panel` rule still owns the absolute inset + internal scroll.
    const scopedPanel = ruleBody(css, "\\.context-panel-outline \\.outline-panel");
    expect(scopedPanel).toMatch(/padding-bottom:\s*0/);
    const outlinePanel = ruleBody(css, "\\.outline-panel");
    expect(outlinePanel).toMatch(/position:\s*absolute/);
    expect(outlinePanel).toMatch(/inset:\s*0/);
    expect(outlinePanel).toMatch(/overflow-y:\s*auto/);
  });
});
