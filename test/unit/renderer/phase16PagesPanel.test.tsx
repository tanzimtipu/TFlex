// @vitest-environment jsdom
//
// Phase 16 — collapsible pages rail with the page-number ruler strip.
//
// Two contracts are pinned here:
//
//   1. pagesPanelReducer — the collapse state reducer owned by App.
//      `toggle` flips, `set` assigns, and `sync` (the settings echo)
//      applies ONLY a real boolean: an absent (undefined) or otherwise
//      invalid value leaves local state untouched, mirroring the
//      backend's preserve-if-valid normalizer so the renderer can
//      never hold a value the settings store would reject.
//
//   2. RulerStrip — the collapsed rail body: one numbered button per
//      page (`data-ruler-page`), the current page carrying
//      `rail-ruler-current`, and every number a click-to-jump target
//      that reports its page through onJump (the workspace follows).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  initialPagesPanelState,
  pagesPanelReducer,
  type PagesPanelAction,
  type PagesPanelState,
} from "../../../src/renderer/state/pagesPanel";
import { RulerStrip } from "../../../src/renderer/components/SideRail";

// jsdom doesn't ship IntersectionObserver or ResizeObserver; they are
// referenced by sibling components in the SideRail module. RulerStrip
// itself needs neither, but the stub keeps the import environment
// identical to the other rail tests.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    readonly root: unknown = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

// ---------------------------------------------------------------------------
// Reducer contract.

describe("pagesPanelReducer", () => {
  it("starts expanded (collapsed: false) — the documented default", () => {
    expect(initialPagesPanelState).toEqual({ collapsed: false });
  });

  it("toggle flips the state in both directions", () => {
    const expanded: PagesPanelState = { collapsed: false };
    expect(pagesPanelReducer(expanded, { type: "toggle" })).toEqual({ collapsed: true });
    const collapsed: PagesPanelState = { collapsed: true };
    expect(pagesPanelReducer(collapsed, { type: "toggle" })).toEqual({ collapsed: false });
  });

  it("set assigns an explicitly computed boolean (boot restore / toggle write)", () => {
    expect(pagesPanelReducer({ collapsed: false }, { type: "set", collapsed: true })).toEqual({
      collapsed: true,
    });
    expect(pagesPanelReducer({ collapsed: true }, { type: "set", collapsed: false })).toEqual({
      collapsed: false,
    });
  });

  it("sync applies a boolean settings echo", () => {
    expect(pagesPanelReducer({ collapsed: false }, { type: "sync", value: true })).toEqual({
      collapsed: true,
    });
    expect(pagesPanelReducer({ collapsed: true }, { type: "sync", value: false })).toEqual({
      collapsed: false,
    });
  });

  it("sync preserves local state when the echo field is absent (undefined)", () => {
    // Preserve-if-valid: a settings object that does not carry
    // pagesPanelCollapsed (or carries it as null/undefined) must NOT
    // clobber the local toggle state.
    const expanded: PagesPanelState = { collapsed: false };
    expect(pagesPanelReducer(expanded, { type: "sync", value: undefined })).toEqual({
      collapsed: false,
    });
    const collapsed: PagesPanelState = { collapsed: true };
    expect(pagesPanelReducer(collapsed, { type: "sync", value: undefined })).toEqual({
      collapsed: true,
    });
  });

  it("sync ignores a non-boolean echo value (defensive, matches the backend normalizer)", () => {
    // The IPC echo is typed boolean | undefined; a corrupted or
    // legacy value must be dropped exactly like the backend's
    // preserve-if-valid rule, not written into local state.
    const bogus = { type: "sync", value: "true" } as unknown as PagesPanelAction;
    expect(pagesPanelReducer({ collapsed: false }, bogus)).toEqual({ collapsed: false });
    const bogusNum = { type: "sync", value: 1 } as unknown as PagesPanelAction;
    expect(pagesPanelReducer({ collapsed: true }, bogusNum)).toEqual({ collapsed: true });
  });
});

// ---------------------------------------------------------------------------
// RulerStrip (the collapsed rail body).

interface RulerMount {
  host: HTMLElement;
  unmount: () => void;
}

function mountRuler(pageCount: number, currentPage: number, onJump: (page: number) => void): RulerMount {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<RulerStrip pageCount={pageCount} currentPage={currentPage} onJump={onJump} />);
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

describe("RulerStrip — collapsed ruler body", () => {
  it("renders one numbered button per page with the data-ruler-page contract", () => {
    const { host, unmount } = mountRuler(5, 3, () => undefined);
    try {
      const strip = host.querySelector("[data-rail-ruler]");
      expect(strip, "the strip root must carry the e2e data-rail-ruler attribute").not.toBeNull();
      const buttons = host.querySelectorAll<HTMLElement>("button[data-ruler-page]");
      expect(buttons.length).toBe(5);
      const labels = Array.from(buttons).map((b) => Number(b.dataset.rulerPage));
      expect(labels).toEqual([1, 2, 3, 4, 5]);
      // Each button shows its page number (the strip is a numbers ladder).
      for (const b of Array.from(buttons)) {
        expect(b.textContent).toBe(String(Number(b.dataset.rulerPage)));
      }
    } finally {
      unmount();
    }
  });

  it("marks exactly the current page with rail-ruler-current", () => {
    const { host, unmount } = mountRuler(10, 4, () => undefined);
    try {
      const current = Array.from(
        host.querySelectorAll<HTMLElement>("button[data-ruler-page]"),
      ).filter((b) => b.classList.contains("rail-ruler-current"));
      expect(current.length).toBe(1);
      expect(Number(current[0].dataset.rulerPage)).toBe(4);
      // Every other number is unmarked.
      const page2 = host.querySelector<HTMLElement>('button[data-ruler-page="2"]');
      expect(page2?.classList.contains("rail-ruler-current")).toBe(false);
    } finally {
      unmount();
    }
  });

  it("follows currentPage on re-render", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = (currentPage: number): void => {
      act((): void => {
        root.render(<RulerStrip pageCount={6} currentPage={currentPage} onJump={() => undefined} />);
      });
    };
    render(2);
    try {
      expect(
        Number(
          host.querySelector<HTMLElement>(".rail-ruler-current")?.dataset.rulerPage ?? "0",
        ),
      ).toBe(2);
      render(5);
      expect(
        Number(
          host.querySelector<HTMLElement>(".rail-ruler-current")?.dataset.rulerPage ?? "0",
        ),
      ).toBe(5);
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });

  it("clicking a page number reports that page through onJump (workspace jump)", () => {
    const jumps: number[] = [];
    const { host, unmount } = mountRuler(5, 1, (page) => jumps.push(page));
    try {
      const target = host.querySelector<HTMLElement>('button[data-ruler-page="4"]');
      expect(target, "page-4 button must exist").not.toBeNull();
      act((): void => {
        target!.click();
      });
      expect(jumps).toEqual([4]);
      // A second click on a different page reports that page.
      act((): void => {
        host.querySelector<HTMLElement>('button[data-ruler-page="2"]')!.click();
      });
      expect(jumps).toEqual([4, 2]);
    } finally {
      unmount();
    }
  });

  it("clicking the current page still reports it (no dead click on the highlighted number)", () => {
    const jumps: number[] = [];
    const { host, unmount } = mountRuler(5, 3, (page) => jumps.push(page));
    try {
      const target = host.querySelector<HTMLElement>('button[data-ruler-page="3"]');
      expect(target, "the current page must stay a clickable button").not.toBeNull();
      expect(target!.classList.contains("rail-ruler-current")).toBe(true);
      act((): void => {
        target!.click();
      });
      expect(jumps).toEqual([3]);
    } finally {
      unmount();
    }
  });
});