// @vitest-environment jsdom
//
// Phase 66 (chunk 3) — annotation marking in Book View.
//
// Book View renders the EXISTING AnnotationToolbar as its one tool surface and
// hands each PageView the page's real annotations plus the app-level create /
// edit / delete handlers, so placing a highlight or ink commits to the SAME
// engine as DocumentView.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BookView } from "../../../src/renderer/components/BookView";
import type { Annotation } from "../../../src/renderer/annotations/model";

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
    PointerEvent?: unknown;
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
  if (g.PointerEvent === undefined) {
    g.PointerEvent = MouseEvent;
  }
  const proto = Element.prototype as unknown as { scrollTo?: unknown };
  if (proto.scrollTo === undefined) {
    proto.scrollTo = (): void => undefined;
  }
  const capture = Element.prototype as unknown as {
    setPointerCapture?: unknown;
    releasePointerCapture?: unknown;
  };
  if (capture.setPointerCapture === undefined) {
    capture.setPointerCapture = (): void => undefined;
  }
  if (capture.releasePointerCapture === undefined) {
    capture.releasePointerCapture = (): void => undefined;
  }
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

async function mount(node: ReturnType<typeof createElement>): Promise<{
  host: HTMLElement;
  cleanup: () => void;
}> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async (): Promise<void> => {
    root.render(node);
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const A1: Annotation = {
  id: "a1",
  page: 1,
  kind: "highlight",
  rects: [{ x: 10, y: 10, width: 40, height: 8 }],
  text: "hi",
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const A2: Annotation = {
  id: "a2",
  page: 2,
  kind: "highlight",
  rects: [{ x: 20, y: 20, width: 40, height: 8 }],
  text: "ho",
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function baseProps(annotations: Annotation[], onCreateAnnotation: (a: Annotation) => void) {
  return {
    doc: makeDocStub(3),
    pageCount: 3,
    title: "Novel.pdf",
    defaultLayout: "single" as const,
    onClose: (): void => undefined,
    annotations,
    onCreateAnnotation,
  };
}

function click(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
  type PointerCtor = new (
    type: string,
    init: MouseEventInit & { pointerId?: number },
  ) => Event;
  const ctor = (globalThis as unknown as { PointerEvent: PointerCtor }).PointerEvent;
  act((): void => {
    el.dispatchEvent(
      new ctor(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
      }),
    );
  });
}

describe("BookView — annotation marking (Phase 66 chunk 3)", () => {
  it("hosts the existing annotation toolbar with the highlight and ink tools", async () => {
    stubObservers();
    const view = await mount(createElement(BookView, baseProps([], (): void => undefined)));
    try {
      expect(view.host.querySelector("[data-annotation-toolbar]")).not.toBeNull();
      expect(view.host.querySelector('[data-tool="highlight"]')).not.toBeNull();
      expect(view.host.querySelector('[data-tool="ink"]')).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("arms the tool through the reducer when a tool button is clicked", async () => {
    stubObservers();
    const view = await mount(createElement(BookView, baseProps([], (): void => undefined)));
    try {
      const button = view.host.querySelector('[data-tool="highlight"]');
      click(button);
      expect(button?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      view.cleanup();
    }
  });

  it("renders a committed annotation on its own page layer only", async () => {
    stubObservers();
    const view = await mount(createElement(BookView, baseProps([A1], (): void => undefined)));
    try {
      const layer1 = view.host.querySelector('[data-annotation-layer="1"] [data-annotation-id="a1"]');
      expect(layer1).not.toBeNull();
      expect(
        view.host.querySelector('[data-annotation-layer="2"] [data-annotation-id="a1"]'),
      ).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("re-filters annotations when the page advances", async () => {
    stubObservers();
    const view = await mount(
      createElement(BookView, baseProps([A1, A2], (): void => undefined)),
    );
    try {
      expect(view.host.querySelector('[data-annotation-layer="1"]')).not.toBeNull();
      click(view.host.querySelector("[data-book-next]"));
      expect(
        view.host.querySelector('[data-annotation-layer="2"] [data-annotation-id="a2"]'),
      ).not.toBeNull();
      expect(view.host.querySelector('[data-annotation-layer="1"]')).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("hands the app-level create handler to PageView so an ink stroke commits", async () => {
    stubObservers();
    const onCreateAnnotation = vi.fn();
    const view = await mount(createElement(BookView, baseProps([], onCreateAnnotation)));
    try {
      click(view.host.querySelector('[data-tool="ink"]'));
      const layer = view.host.querySelector('[data-annotation-layer="1"]');
      if (layer === null) throw new Error("page 1 annotation layer did not mount");
      firePointer(layer, "pointerdown", 10, 10);
      firePointer(layer, "pointermove", 40, 40);
      firePointer(layer, "pointerup", 40, 40);
      expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
      const created = onCreateAnnotation.mock.calls[0]?.[0] as Annotation;
      expect(created.kind).toBe("ink");
      expect(created.page).toBe(1);
    } finally {
      view.cleanup();
    }
  });
});
