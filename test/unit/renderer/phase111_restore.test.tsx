// @vitest-environment jsdom
//
// Phase 111 (chunk D2a) — per-document navigator restore: the active rail view,
// the outline expansion set, and the list scroll anchors, all keyed by the
// stable engine doc id. The pure `navigatorState` helpers are pinned without a
// DOM; the outline behaviour is driven through the mounted OutlinePanel; the
// Pages anchor is asserted through the mounted rail (the slot-top / visible-
// range helpers are module-private, so the rail exercises them in place).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ok } from "../../../src/shared/result";
import type { OutlineEntry } from "../../../src/renderer/state/outlineEditor";
import {
  OutlinePanel,
  ThumbnailRail,
  type OutlineEditorConfig,
} from "../../../src/renderer/components/SideRail";
import type { EngineState } from "../../../src/renderer/engine/types";
import { recordRailTab, restoreRailTab } from "../../../src/renderer/state/navigatorState";

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

function makeDocStub(): PDFDocumentProxy {
  return {
    numPages: 10,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
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

function outlineTree(): OutlineEntry[] {
  return [
    { title: "Parent", page: 1, children: [{ title: "Child", page: 2, children: [] }] },
    { title: "Sibling", page: 3, children: [] },
  ];
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function row(host: HTMLElement, path: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-outline-row][data-outline-path="${path}"]`);
  if (el === null) throw new Error(`no outline row at ${path}`);
  return el;
}

function openMore(host: HTMLElement, path: string): void {
  const more = row(host, path).querySelector<HTMLElement>("[data-outline-more]");
  if (more === null) throw new Error(`no More on row ${path}`);
  clickOn(more);
}

function menu(host: HTMLElement): HTMLElement {
  // TFL-1083 (DEF-615) — the row More menu is portalled to `document.body`, so
  // it is no longer a descendant of the test host; query the whole document.
  const el = host.ownerDocument.querySelector<HTMLElement>("[data-outline-menu]");
  if (el === null) throw new Error("no open outline menu");
  return el;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach((): void => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Phase 111 chunk D2a — pure navigator state helpers", () => {
  it("restores the stored tab, else 'thumbs' for a null / unknown id", () => {
    expect(restoreRailTab({}, null)).toBe("thumbs");
    expect(restoreRailTab({ d1: "outline" }, "d1")).toBe("outline");
    expect(restoreRailTab({ d1: "outline" }, "d2")).toBe("thumbs");
  });

  it("records a tab per document without mutating the input map", () => {
    const empty: Record<string, "thumbs" | "outline" | "annotations"> = {};
    expect(recordRailTab(empty, null, "outline")).toBe(empty);
    const next = recordRailTab(empty, "d1", "outline");
    expect(next).toEqual({ d1: "outline" });
    expect(empty).toEqual({});
  });
});

interface OutlineHarness {
  host: HTMLElement;
  commit: ReturnType<typeof vi.fn>;
  render: (docId: string) => void;
  unmount: () => void;
}

function renderOutlinePanel(docId = "A"): OutlineHarness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const commit = vi.fn(async () => ok(makeEngineState(10)));
  const entries = outlineTree();
  const render = (nextDocId: string): void => {
    const config: OutlineEditorConfig = {
      docId: nextDocId,
      entries,
      visiblePageCount: 10,
      commit,
    };
    act((): void => {
      root.render(
        <OutlinePanel
          doc={makeDocStub()}
          outline={[]}
          onJump={(): void => undefined}
          editor={config}
        />,
      );
    });
  };
  render(docId);
  return {
    host,
    commit,
    render,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

describe("Phase 111 chunk D2a — outline expansion is per document", () => {
  it("does not leak a collapse from one document into another", () => {
    const h = renderOutlinePanel("A");
    try {
      const child = '[data-outline-path="0/0"]';
      expect(h.host.querySelector(child)).not.toBeNull();
      clickOn(row(h.host, "0").querySelector("button.outline-toggle") as Element);
      expect(h.host.querySelector(child)).toBeNull();
      // A different document opens with its own (empty) expansion set.
      h.render("B");
      expect(h.host.querySelector(child)).not.toBeNull();
      // Returning to A restores the collapse.
      h.render("A");
      expect(h.host.querySelector(child)).toBeNull();
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 111 chunk D2a — outline scroll anchor", () => {
  it("keeps the scroller anchor across a rename commit", async () => {
    const h = renderOutlinePanel("A");
    try {
      const scroller = h.host.querySelector<HTMLElement>("[data-outline-editable]");
      expect(scroller).not.toBeNull();
      const el = scroller as HTMLElement;
      const proto = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
      if (proto === undefined || proto.get === undefined || proto.set === undefined) {
        throw new Error("jsdom Element.scrollTop accessor is unavailable");
      }
      // Seed the anchor, then watch for the component's own restore write.
      el.scrollTop = 240;
      const writes: number[] = [];
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: (): number => proto.get?.call(el) as number,
        set: (value: number): void => {
          writes.push(value);
          proto.set?.call(el, value);
        },
      });
      openMore(h.host, "0");
      clickOn(menu(h.host).querySelector("[data-outline-rename]") as Element);
      const input = h.host.querySelector<HTMLInputElement>("[data-outline-rename-input]");
      expect(input).not.toBeNull();
      setInputValue(input as HTMLInputElement, "Renamed");
      act((): void => {
        (input as HTMLInputElement).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });
      await flush();
      expect(h.commit).toHaveBeenCalledTimes(1);
      expect(el.scrollTop).toBe(240);
      expect(writes).toContain(240);
    } finally {
      h.unmount();
    }
  });
});

interface RailHarness {
  host: HTMLElement;
  render: (pageCount: number) => void;
  unmount: () => void;
}

function renderRail(pageCount: number): RailHarness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (next: number): void => {
    const es = makeEngineState(next);
    const visibleToSource = new Map<number, number>();
    es.pageOrder.forEach((src, i) => visibleToSource.set(i + 1, src + 1));
    act((): void => {
      root.render(
        <ThumbnailRail
          doc={makeDocStub()}
          pageCount={next}
          currentPage={1}
          aspectRatio={792 / 612}
          rotations={es.rotations}
          visibleToSource={visibleToSource}
          proxyVisibleOrder={false}
          canUndo={false}
          onJump={(): void => undefined}
        />,
      );
    });
  };
  render(pageCount);
  return {
    host,
    render,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

describe("Phase 111 chunk D2a — Pages scroll anchor", () => {
  it("re-centres the pending committed reveal across a page-list mutation", () => {
    const h = renderRail(5);
    try {
      const scroller = h.host.querySelector<HTMLElement>(".thumb-scroller-inner");
      expect(scroller).not.toBeNull();
      const el = scroller as HTMLElement;
      const proto = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
      if (proto === undefined || proto.get === undefined || proto.set === undefined) {
        throw new Error("jsdom Element.scrollTop accessor is unavailable");
      }
      el.scrollTop = 320;
      const writes: number[] = [];
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: (): number => proto.get?.call(el) as number,
        set: (value: number): void => {
          writes.push(value);
          proto.set?.call(el, value);
        },
      });
      // TFL-1116 R04 — the rail seeds its last-seen reveal counter to -1, so
      // the mount counts as a COMMITTED jump: the viewed page's reveal stays
      // pending until an ordinary scroll-driven `currentPage` change spends it.
      // A page-list mutation is a later geometry change, so the rail re-centres
      // the still-pending committed page rather than stranding it off-screen.
      h.render(6);
      expect(h.host.querySelectorAll("[data-page]").length).toBeGreaterThan(0);
      expect(writes).toEqual([0]);
      expect(el.scrollTop).toBe(0);
    } finally {
      h.unmount();
    }
  });
});



