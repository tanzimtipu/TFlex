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
import type { EngineState } from "../../../src/renderer/engine/types";
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
}

interface PanelOptions extends PanelHandlers {
  pageCount?: number;
  currentPage?: number;
  engineState?: EngineState;
  outline?: OutlineNode[] | null;
  doc?: PDFDocumentProxy;
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
          onMerge={current.onMerge}
          onExtractPages={current.onExtractPages}
          onInsertBlank={current.onInsertBlank}
onReplacePages={current.onReplacePages}
          onDeletePage={current.onDeletePage}
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
 *  reads `event.target.closest('.thumb-verbs')`). */
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

/** The verbs are `role="button"` spans: the thumb stays the one real button
 *  per page (a nested <button> is invalid HTML). */
const verb = (host: HTMLElement, page: number, id: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(
    `.thumb-item[data-page="${page}"] [data-thumb-verb="${id}"]`,
  );
  if (el === null) throw new Error(`no ${id} verb on page ${page}`);
  return el;
};

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
      // header keeps the Combine entry and the collapse control.
      expect(host.querySelector(".glass-sidebar-title")).toBeNull();
      const combine = host.querySelector<HTMLButtonElement>("[data-context-panel-combine]");
      expect(combine).not.toBeNull();
      expect(combine?.textContent).toContain("Combine");
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

  it("keeps the rail's own Ctrl/Shift-click selection and its action bar", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 5, onJump });
    try {
      act((): void => {
        thumb(host, 2).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }),
        );
      });
      expect(host.querySelector(".thumb-selected")?.getAttribute("data-page")).toBe("2");
      expect(host.querySelector("[data-rail-action-bar]")).not.toBeNull();
      // A modifier click selects; it does not navigate.
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});

describe("ContextPanel — inline hover verbs", () => {
  it("renders three ghost icon verbs per thumbnail with aria-labels", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      for (const page of [1, 2, 3]) {
        const verbs = thumb(host, page).querySelectorAll("[data-thumb-verb]");
        expect(verbs.length).toBe(3);
        expect(
          [...verbs].map((v) => v.getAttribute("data-thumb-verb")),
        ).toEqual(["rotate-cw", "extract", "delete"]);
      }
      // Lucide icons (svg), never text glyphs: the label is on the button.
      expect(verb(host, 2, "rotate-cw").querySelector("svg")).not.toBeNull();
      expect(verb(host, 2, "rotate-cw").getAttribute("aria-label")).toBe(
        "Rotate page 2 clockwise",
      );
      expect(verb(host, 2, "extract").getAttribute("aria-label")).toBe("Extract page 2");
      expect(verb(host, 2, "delete").getAttribute("aria-label")).toBe("Delete page 2");
      expect(verb(host, 2, "extract").textContent).toBe("");
    } finally {
      unmount();
    }
  });

  it("are role=button spans (never a nested <button>) and activate on Enter", () => {
    const onOp = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onOp });
    try {
      const v = verb(host, 2, "rotate-cw");
      expect(v.tagName).toBe("SPAN");
      expect(v.getAttribute("role")).toBe("button");
      expect(v.getAttribute("tabindex")).toBe("0");
      // A <button> inside the thumb's own <button> is invalid HTML.
      expect(host.querySelector(".thumb-item button")).toBeNull();
      act((): void => {
        v.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });
      expect(onOp).toHaveBeenCalledWith({ kind: "rotate", page: 2, dir: "cw" });
      // Keyboard activation does not navigate either.
      expect(host.querySelector(".thumb-current")?.getAttribute("data-page")).toBe("1");
    } finally {
      unmount();
    }
  });

  it("runs the EXISTING rotate handler for the verb's own page", () => {
    const onOp = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 4, onOp });
    try {
      clickOn(verb(host, 3, "rotate-cw"));
      expect(onOp).toHaveBeenCalledTimes(1);
      expect(onOp).toHaveBeenCalledWith({ kind: "rotate", page: 3, dir: "cw" });
    } finally {
      unmount();
    }
  });

  it("runs the extract and delete handlers with the verb's own page", () => {
    const onExtractPages = vi.fn();
    const onDelete = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 4, onExtractPages, onDelete });
    try {
      clickOn(verb(host, 2, "extract"));
      expect(onExtractPages).toHaveBeenCalledWith(2);
      clickOn(verb(host, 4, "delete"));
      expect(onDelete).toHaveBeenCalledWith([4]);
    } finally {
      unmount();
    }
  });

  it("a verb click changes neither the page nor the selection (cross-bubbling guard)", () => {
    const onJump = vi.fn();
    const onOp = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onJump, onOp });
    try {
      clickOn(verb(host, 2, "rotate-cw"));
      expect(onOp).toHaveBeenCalledTimes(1);
      // The click did NOT bubble into the thumb's own handler.
      expect(onJump).not.toHaveBeenCalled();
      expect(host.querySelector(".thumb-selected")).toBeNull();
      expect(host.querySelector("[data-rail-action-bar]")).toBeNull();
      expect(host.querySelector(".thumb-current")?.getAttribute("data-page")).toBe("1");
    } finally {
      unmount();
    }
  });

  it("a press that starts on a verb never starts a page drag", () => {
    const onReorder = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onReorder });
    try {
      // Press on the lucide GLYPH (an SVGElement, not an HTMLElement) — the
      // real-world target — so the guard is proven for both node kinds.
      const glyph = verb(host, 2, "extract").querySelector("svg");
      expect(glyph).not.toBeNull();
      // The guard reads the ANCESTOR CHAIN via `Element.closest`, not
      // `instanceof HTMLElement` — an SVG glyph is not an HTMLElement, and
      // pressing exactly there is what a user does.
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

  it("the hover trash verb stays an IMMEDIATE per-page delete (onDelete([page]))", () => {
    const onDelete = vi.fn();
    const onDeletePage = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 4, onDelete, onDeletePage });
    try {
      clickOn(verb(host, 3, "delete"));
      // The verb is a one-click delete, not the dialog.
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
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE, onJump });
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

  it("toggles the section open and closed, keeping its own collapse state", () => {
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE });
    try {
      const toggle = host.querySelector<HTMLButtonElement>("[data-outline-toggle]");
      expect(toggle).not.toBeNull();
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelector("[data-context-panel-outline-body]")).not.toBeNull();
      clickOn(toggle as HTMLButtonElement);
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      expect(host.querySelector("[data-context-panel-outline-body]")).toBeNull();
      // The thumbnail stack stays mounted while the outline collapses.
      expect(host.querySelectorAll(".thumb-item").length).toBe(8);
      clickOn(toggle as HTMLButtonElement);
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelector("[data-context-panel-outline-body]")).not.toBeNull();
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
  it("nests the absolute outline tree inside the section body, never the stack", () => {
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE });
    try {
      const section = host.querySelector("[data-context-panel-outline]");
      const body = host.querySelector("[data-context-panel-outline-body]");
      const panel = host.querySelector(".outline-panel");
      const stack = host.querySelector("[data-context-panel-thumbs]");
      expect(section).not.toBeNull();
      expect(body).not.toBeNull();
      expect(panel).not.toBeNull();
      expect(stack).not.toBeNull();
      // The overlay is a DIRECT child of the bounded body, which is the
      // section's content box — the box that bounds it.
      expect(body?.parentElement).toBe(section);
      expect(panel?.parentElement).toBe(body);
      // Nothing in the outline tree is inside (or around) the thumbnail stack.
      expect(stack?.contains(panel as Node)).toBe(false);
      expect(panel?.contains(stack as Node)).toBe(false);
      expect(section?.contains(stack as Node)).toBe(false);
      expect(body?.contains(stack as Node)).toBe(false);
    } finally {
      unmount();
    }
  });

  it("orders the section AFTER the stack, so a bounded outline cannot paint over it", () => {
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE });
    try {
      const panelBody = host.querySelector(".context-panel-body");
      const stack = host.querySelector("[data-context-panel-thumbs]");
      const section = host.querySelector("[data-context-panel-outline]");
      const children = [...(panelBody?.children ?? [])];
      expect(children.indexOf(stack as Element)).toBeGreaterThanOrEqual(0);
      expect(children.indexOf(section as Element)).toBeGreaterThan(
        children.indexOf(stack as Element),
      );
    } finally {
      unmount();
    }
  });

  it("keeps every thumbnail outside the outline section and clickable", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE, onJump });
    try {
      const section = host.querySelector("[data-context-panel-outline]");
      expect(thumbs(host).length).toBe(8);
      for (const t of thumbs(host)) {
        expect(section?.contains(t)).toBe(false);
      }
      // The press reaches the thumbnail: the scroll-sync jump still fires.
      clickOn(thumb(host, 7));
      expect(onJump).toHaveBeenCalledWith(7);
    } finally {
      unmount();
    }
  });

  it("keeps the OUTLINE toggle outside the overlay and clickable both ways", () => {
    const { host, unmount } = renderPanel({ pageCount: 8, outline: OUTLINE });
    try {
      const toggle = host.querySelector<HTMLButtonElement>("[data-outline-toggle]");
      const section = host.querySelector("[data-context-panel-outline]");
      const body = host.querySelector("[data-context-panel-outline-body]");
      // The toggle is the section's own first child; the overlay lives inside
      // the body BELOW it, so the toggle can never be covered by the tree.
      expect(toggle?.parentElement).toBe(section);
      expect(body?.contains(toggle as Node)).toBe(false);
      clickOn(toggle as HTMLButtonElement);
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      clickOn(toggle as HTMLButtonElement);
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    } finally {
      unmount();
    }
  });

  it("styles.css makes the section body the positioning context the rail's .rail-content is", () => {
    const css = readStyles();
    // The rail is untouched: `.rail-content` still bounds the rail's own
    // absolute `.outline-panel` tab.
    expect(ruleBody(css, "\\.rail-content")).toMatch(/position:\s*relative/);
    // The panel's section body plays that same role.
    const body = ruleBody(css, "\\.context-panel-outline-body");
    expect(body).toMatch(/position:\s*relative/);
    // The body is a bounded box, not a scroller: `.outline-panel` scrolls
    // inside it and can never reach the thumbnails.
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/overflow-y:\s*auto/);
    // While the body is mounted the section has a definite height (the
    // `.rail-content` analogue: an auto-height parent would collapse the
    // absolute tree to a sliver).
    const sectionWithBody = ruleBody(
      css,
      "\\.context-panel-outline:has\\(\\.context-panel-outline-body\\)",
    );
    expect(sectionWithBody).toMatch(/height:\s*40%/);
    // `.outline-panel`'s own rule is unchanged — the rail depends on it.
    const outlinePanel = ruleBody(css, "\\.outline-panel");
    expect(outlinePanel).toMatch(/position:\s*absolute/);
    expect(outlinePanel).toMatch(/inset:\s*0/);
    expect(outlinePanel).toMatch(/overflow-y:\s*auto/);
  });
});
