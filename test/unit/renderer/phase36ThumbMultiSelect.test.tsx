// @vitest-environment jsdom
//
// Phase 36 (chunk 3a) — the thumbnail MULTI-SELECT (the chunk-2 deferral).
//
// The PAGES ContextPanel's rail gains a host-owned SET: Ctrl/Cmd toggles,
// Shift extends from the anchor, a plain click navigates AND leaves that one
// page selected, and a click on empty panel space clears. The existing
// single-selection consumers (the rail's action bar, the drag wiring) must keep
// working, and every OTHER rail instance (SideRail, PaneThumbStrip) must keep
// its byte-for-byte legacy behaviour.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";

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

const thumb = (host: HTMLElement, page: number): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`.thumb-item[data-page="${page}"]`);
  if (el === null) throw new Error(`no thumb for page ${page}`);
  return el;
};

function clickThumb(target: Element, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
  act((): void => {
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ctrlKey: mods.ctrlKey === true,
        shiftKey: mods.shiftKey === true,
      }),
    );
  });
}

/** A stateful host: the SET lives outside the panel, exactly as DocumentView
 *  owns it (the ActionDock consumes the same array). */
function renderHarness(options: {
  pageCount?: number;
  onJump?: (page: number) => void;
  onChange?: (pages: number[]) => void;
  multi?: boolean;
}): { host: HTMLElement; selection: () => number[]; unmount: () => void } {
  stubObservers();
  const pageCount = options.pageCount ?? 5;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let latest: number[] = [];

  function Harness(): ReturnType<typeof ContextPanel> {
    const [sel, setSel] = useState<number[]>([]);
    latest = sel;
    return (
      <ContextPanel
        doc={makeDocStub(pageCount)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(pageCount)}
        proxyVisibleOrder={false}
        canUndo={false}
        onUndo={(): void => undefined}
        onJump={options.onJump ?? ((): void => undefined)}
        outline={null}
        {...(options.multi === true
          ? {
              pageSelection: sel,
              onPageSelectionChange: (next: number[]): void => {
                setSel(next);
                options.onChange?.(next);
              },
            }
          : {})}
      />
    );
  }

  act((): void => {
    root.render(<Harness />);
  });
  return {
    host,
    selection: (): number[] => latest,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const selectedPages = (host: HTMLElement): number[] =>
  [...host.querySelectorAll<HTMLElement>(".thumb-selected")].map((el) =>
    Number(el.getAttribute("data-page")),
  );

describe("Phase 36 — thumbnail multi-select (ContextPanel)", () => {
  it("Ctrl+click toggles a page in and out of the set", () => {
    const onChange = vi.fn();
    const h = renderHarness({ multi: true, onChange });
    try {
      clickThumb(thumb(h.host, 2), { ctrlKey: true });
      expect(h.selection()).toEqual([2]);
      clickThumb(thumb(h.host, 4), { ctrlKey: true });
      expect(h.selection()).toEqual([2, 4]);
      clickThumb(thumb(h.host, 2), { ctrlKey: true });
      expect(h.selection()).toEqual([4]);
      expect(onChange).toHaveBeenLastCalledWith([4]);
      // Both selected thumbs carry the rail's own selected class.
      expect(selectedPages(h.host)).toEqual([4]);
    } finally {
      h.unmount();
    }
  });

  it("Shift+click extends the inclusive range from the anchor", () => {
    const h = renderHarness({ multi: true });
    try {
      clickThumb(thumb(h.host, 2));
      expect(h.selection()).toEqual([2]);
      clickThumb(thumb(h.host, 4), { shiftKey: true });
      expect(h.selection()).toEqual([2, 3, 4]);
      expect(selectedPages(h.host)).toEqual([2, 3, 4]);
      // The anchor survives, so a later Shift click re-extends from page 2.
      clickThumb(thumb(h.host, 5), { shiftKey: true });
      expect(h.selection()).toEqual([2, 3, 4, 5]);
    } finally {
      h.unmount();
    }
  });

  it("a plain click navigates and leaves exactly that page selected", () => {
    const onJump = vi.fn();
    const h = renderHarness({ multi: true, onJump });
    try {
      clickThumb(thumb(h.host, 3));
      expect(onJump).toHaveBeenCalledWith(3);
      expect(h.selection()).toEqual([3]);
      // A single-page set still drives the rail's own action bar.
      expect(h.host.querySelector("[data-rail-action-bar]")).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("a click on empty panel space clears the set", () => {
    const onChange = vi.fn();
    const h = renderHarness({ multi: true, onChange });
    try {
      clickThumb(thumb(h.host, 2), { ctrlKey: true });
      expect(h.selection()).toEqual([2]);
      const scroller = h.host.querySelector<HTMLElement>(".thumb-scroller");
      expect(scroller).not.toBeNull();
      act((): void => {
        scroller?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(h.selection()).toEqual([]);
      expect(onChange).toHaveBeenLastCalledWith([]);
    } finally {
      h.unmount();
    }
  });

  it("reports the SET to the host on every gesture (the dock's input)", () => {
    const onChange = vi.fn();
    const h = renderHarness({ multi: true, onChange });
    try {
      clickThumb(thumb(h.host, 1), { ctrlKey: true });
      clickThumb(thumb(h.host, 3), { ctrlKey: true });
      expect(onChange.mock.calls.map((c) => c[0])).toEqual([[1], [1, 3]]);
    } finally {
      h.unmount();
    }
  });

  it("clearing via the rail's own action bar empties the host set", () => {
    const h = renderHarness({ multi: true });
    try {
      clickThumb(thumb(h.host, 2));
      const clear = h.host.querySelector<HTMLElement>('[data-rail-action-bar] button[aria-label="Clear selection"]');
      expect(clear).not.toBeNull();
      clickThumb(clear as Element);
      expect(h.selection()).toEqual([]);
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 36 — the legacy single-selection path is unchanged", () => {
  it("without the multi-select props a Ctrl/Shift click selects one page", () => {
    const h = renderHarness({ multi: false });
    try {
      clickThumb(thumb(h.host, 2), { shiftKey: true });
      expect(selectedPages(h.host)).toEqual([2]);
      expect(h.host.querySelector("[data-rail-action-bar]")).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("without the multi-select props a plain click only navigates (no selection)", () => {
    const onJump = vi.fn();
    const h = renderHarness({ multi: false, onJump });
    try {
      clickThumb(thumb(h.host, 3));
      expect(onJump).toHaveBeenCalledWith(3);
      expect(selectedPages(h.host)).toEqual([]);
      expect(h.host.querySelector("[data-rail-action-bar]")).toBeNull();
    } finally {
      h.unmount();
    }
  });
});
