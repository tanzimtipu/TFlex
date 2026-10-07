// @vitest-environment jsdom
//
// TFL-1116 (C5b, R25) — Book View opens at the current reading location and
// carries the reached location back on close.
//
// The host passes the tab's stored `persisted.currentPage` as `initialPage`;
// BookView seeds its spread index from it (respecting the single/double layout
// mapping) instead of always starting at page 1. Closing reports the visible
// spread's first page through `onClose(finalPage)` so the DocumentView can
// restore that location.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BookView, type BookViewProps } from "../../../src/renderer/components/BookView";

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
  const proto = Element.prototype as unknown as { scrollTo?: unknown };
  if (proto.scrollTo === undefined) {
    proto.scrollTo = (): void => undefined;
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

async function mountBook(
  options: Partial<BookViewProps> & { pageCount: number },
): Promise<{ host: HTMLElement; cleanup: () => void }> {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async (): Promise<void> => {
    root.render(
      createElement(BookView, {
        doc: makeDocStub(options.pageCount),
        title: "Novel.pdf",
        defaultLayout: "single",
        onClose: (): void => undefined,
        annotations: [],
        onCreateAnnotation: (): void => undefined,
        ...options,
      }),
    );
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

function pageNumbers(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("[data-book-page]")).map(
    (el) => el.getAttribute("data-book-page") ?? "",
  );
}

function progress(host: HTMLElement): string {
  return host.querySelector("[data-book-progress]")?.textContent ?? "";
}

describe("TFL-1116 R25 — Book View seeds from the reading location", () => {
  it("opens a single layout at initialPage", async () => {
    const view = await mountBook({
      pageCount: 10,
      defaultLayout: "single",
      initialPage: 5,
    });
    try {
      expect(pageNumbers(view.host)).toEqual(["5"]);
      expect(progress(view.host)).toBe("Page 5 of 10");
    } finally {
      view.cleanup();
    }
  });

  it("opens a double layout on the spread starting at initialPage", async () => {
    const view = await mountBook({
      pageCount: 10,
      defaultLayout: "double",
      initialPage: 5,
    });
    try {
      expect(pageNumbers(view.host)).toEqual(["5", "6"]);
      expect(progress(view.host)).toBe("Page 5-6 of 10");
    } finally {
      view.cleanup();
    }
  });

  it("normalises a double layout to the spread's first page", async () => {
    const view = await mountBook({
      pageCount: 10,
      defaultLayout: "double",
      initialPage: 4,
    });
    try {
      expect(pageNumbers(view.host)).toEqual(["3", "4"]);
      expect(progress(view.host)).toBe("Page 3-4 of 10");
    } finally {
      view.cleanup();
    }
  });

  it("clamps an out-of-range or missing location", async () => {
    const high = await mountBook({
      pageCount: 10,
      defaultLayout: "double",
      initialPage: 99,
    });
    try {
      expect(pageNumbers(high.host)).toEqual(["9", "10"]);
    } finally {
      high.cleanup();
    }

    const missing = await mountBook({ pageCount: 10, defaultLayout: "single" });
    try {
      expect(pageNumbers(missing.host)).toEqual(["1"]);
      expect(progress(missing.host)).toBe("Page 1 of 10");
    } finally {
      missing.cleanup();
    }
  });
});

describe("TFL-1116 R25 — closing reports the reached page", () => {
  it("reports the page after a forward turn", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const view = await mountBook({
      pageCount: 10,
      defaultLayout: "single",
      initialPage: 3,
      onClose,
    });
    try {
      expect(pageNumbers(view.host)).toEqual(["3"]);
      act((): void => {
        view.host.querySelector<HTMLButtonElement>("[data-book-next]")?.click();
      });
      act((): void => {
        vi.advanceTimersByTime(450);
      });
      expect(pageNumbers(view.host)).toEqual(["4"]);
      act((): void => {
        view.host.querySelector<HTMLButtonElement>('[aria-label="Close book view"]')?.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledWith(4);
    } finally {
      view.cleanup();
      vi.useRealTimers();
    }
  });

  it("reports the reached spread's first page in a double layout", async () => {
    const onClose = vi.fn();
    const view = await mountBook({
      pageCount: 10,
      defaultLayout: "double",
      initialPage: 5,
      onClose,
    });
    try {
      act((): void => {
        view.host.querySelector<HTMLButtonElement>('[aria-label="Close book view"]')?.click();
      });
      expect(onClose).toHaveBeenCalledWith(5);
    } finally {
      view.cleanup();
    }
  });

  it("reports undefined for an empty document", async () => {
    const onClose = vi.fn();
    const view = await mountBook({ pageCount: 0, defaultLayout: "single", onClose });
    try {
      act((): void => {
        view.host.querySelector<HTMLButtonElement>('[aria-label="Close book view"]')?.click();
      });
      expect(onClose).toHaveBeenCalledWith(undefined);
    } finally {
      view.cleanup();
    }
  });
});

describe("TFL-1116 R25 (DEF-627) — any exit route carries the location", () => {
  it("reports the reached page on every turn through onLocationChange", async () => {
    vi.useFakeTimers();
    const onLocationChange = vi.fn();
    const view = await mountBook({
      pageCount: 10,
      defaultLayout: "single",
      initialPage: 3,
      onLocationChange,
    });
    try {
      // The seed page is reported on mount, so a never-turned exit still
      // persists what the reader opened at.
      expect(onLocationChange).toHaveBeenLastCalledWith(3);
      act((): void => {
        view.host.querySelector<HTMLButtonElement>("[data-book-next]")?.click();
      });
      act((): void => {
        vi.advanceTimersByTime(450);
      });
      expect(pageNumbers(view.host)).toEqual(["4"]);
      expect(onLocationChange).toHaveBeenLastCalledWith(4);
    } finally {
      view.cleanup();
      vi.useRealTimers();
    }
  });

  it("reports the reached page on unmount WITHOUT the Close button (tab-switch exit)", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onLocationChange = vi.fn();
    const view = await mountBook({
      pageCount: 10,
      defaultLayout: "single",
      initialPage: 5,
      onClose,
      onLocationChange,
    });
    act((): void => {
      view.host.querySelector<HTMLButtonElement>("[data-book-next]")?.click();
    });
    act((): void => {
      vi.advanceTimersByTime(450);
    });
    expect(pageNumbers(view.host)).toEqual(["6"]);
    // Unmount only — the header Close button is never pressed.
    onLocationChange.mockClear();
    view.cleanup();
    expect(onClose).not.toHaveBeenCalled();
    expect(onLocationChange).toHaveBeenCalledWith(6);
    vi.useRealTimers();
  });

  it("a tab-switch exit and return preserves the reading location", async () => {
    vi.useFakeTimers();
    const onLocationChange = vi.fn();
    const first = await mountBook({
      pageCount: 10,
      defaultLayout: "single",
      initialPage: 5,
      onLocationChange,
    });
    act((): void => {
      first.host.querySelector<HTMLButtonElement>("[data-book-next]")?.click();
    });
    act((): void => {
      vi.advanceTimersByTime(450);
    });
    expect(pageNumbers(first.host)).toEqual(["6"]);
    first.cleanup();
    const reported = onLocationChange.mock.calls.at(-1)?.[0];
    expect(reported).toBe(6);
    // "Return": re-seed from the reported location, as the host does from the
    // persisted viewer; Book View opens where it was left.
    const second = await mountBook({
      pageCount: 10,
      defaultLayout: "single",
      initialPage: reported as number,
    });
    try {
      expect(pageNumbers(second.host)).toEqual(["6"]);
    } finally {
      second.cleanup();
      vi.useRealTimers();
    }
  });
});