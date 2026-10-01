// @vitest-environment jsdom
//
// Phase 66 (chunk 2) — Book View spread, centre crease, single/double toggle
// and the page-turn flip. The page-turn semantics mirror the existing comic
// view: step 2 in double, 1 in single, the last spread clamped to the final
// two pages, and the turning figure carries the transient flip class.
//
// jsdom has no CSS engine, so the flip is asserted through the class the
// component applies; the keyframe/token wiring lives in styles.css.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BookView } from "../../../src/renderer/components/BookView";
import type { ReadingDefaults } from "../../../src/shared/types";

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

async function mountBook(
  pageCount: number,
  defaultLayout: ReadingDefaults["comics"]["layout"],
): Promise<{ host: HTMLElement; cleanup: () => void }> {
  stubObservers();
  return mount(
    createElement(BookView, {
      doc: makeDocStub(pageCount),
      pageCount,
      title: "Novel.pdf",
      defaultLayout,
      onClose: (): void => undefined,
      annotations: [],
      onCreateAnnotation: (): void => undefined,
    }),
  );
}

function pageNumbers(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("[data-book-page]")).map(
    (el) => el.getAttribute("data-book-page") ?? "",
  );
}

function sides(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("[data-book-page]")).map(
    (el) => el.getAttribute("data-book-page-side") ?? "",
  );
}

describe("BookView spread — layout seeding (Phase 66 chunk 2)", () => {
  it("seeds a double spread with two sides and a centre crease", async () => {
    const view = await mountBook(6, "double");
    try {
      const pages = view.host.querySelectorAll("[data-book-page]");
      expect(pages).toHaveLength(2);
      expect(sides(view.host)).toEqual(["left", "right"]);
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);
      expect(view.host.querySelector("[data-book-crease]")).not.toBeNull();
      expect(
        view.host
          .querySelector("[data-book-stage]")
          ?.getAttribute("data-book-layout"),
      ).toBe("double");
    } finally {
      view.cleanup();
    }
  });

  it("seeds a single page with no crease", async () => {
    const view = await mountBook(6, "single");
    try {
      expect(view.host.querySelectorAll("[data-book-page]")).toHaveLength(1);
      expect(view.host.querySelector('[data-book-page-side="single"]')).not.toBeNull();
      expect(view.host.querySelector("[data-book-crease]")).toBeNull();
      expect(
        view.host
          .querySelector("[data-book-stage]")
          ?.getAttribute("data-book-layout"),
      ).toBe("single");
    } finally {
      view.cleanup();
    }
  });
});

describe("BookView toggle — single/double (Phase 66 chunk 2)", () => {
  it("exposes both toggles with the exact labels and follows the layout", async () => {
    const view = await mountBook(6, "single");
    try {
      const single = view.host.querySelector<HTMLButtonElement>(
        '[aria-label="Book single page"]',
      );
      const double = view.host.querySelector<HTMLButtonElement>(
        '[aria-label="Book double page"]',
      );
      expect(single).not.toBeNull();
      expect(double).not.toBeNull();
      expect(single?.getAttribute("data-book-single")).not.toBeNull();
      expect(double?.getAttribute("data-book-double")).not.toBeNull();
      expect(single?.getAttribute("aria-pressed")).toBe("true");
      expect(double?.getAttribute("aria-pressed")).toBe("false");

      act((): void => {
        double?.click();
      });
      expect(view.host.querySelectorAll("[data-book-page]")).toHaveLength(2);
      expect(view.host.querySelector("[data-book-crease]")).not.toBeNull();
      expect(
        view.host.querySelector('[data-book-double]')?.getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        view.host.querySelector('[data-book-single]')?.getAttribute("aria-pressed"),
      ).toBe("false");

      act((): void => {
        view.host.querySelector<HTMLButtonElement>("[data-book-single]")?.click();
      });
      expect(view.host.querySelectorAll("[data-book-page]")).toHaveLength(1);
      expect(view.host.querySelector("[data-book-crease]")).toBeNull();
      expect(
        view.host.querySelector('[data-book-single]')?.getAttribute("aria-pressed"),
      ).toBe("true");
    } finally {
      view.cleanup();
    }
  });
});

describe("BookView page turn — flip and step (Phase 66 chunk 2)", () => {
  it("advances and retreats a double spread by two pages", async () => {
    const view = await mountBook(6, "double");
    try {
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);
      act((): void => {
        view.host
          .querySelector<HTMLElement>('[data-book-page-side="right"]')
          ?.click();
      });
      expect(pageNumbers(view.host)).toEqual(["3", "4"]);
      act((): void => {
        view.host
          .querySelector<HTMLElement>('[data-book-page-side="left"]')
          ?.click();
      });
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);
    } finally {
      view.cleanup();
    }
  });

  it("clamps the last double spread to the final two pages", async () => {
    const view = await mountBook(6, "double");
    try {
      act((): void => {
        for (let i = 0; i < 5; i += 1) {
          view.host
            .querySelector<HTMLElement>('[data-book-page-side="right"]')
            ?.click();
        }
      });
      expect(pageNumbers(view.host)).toEqual(["5", "6"]);
    } finally {
      view.cleanup();
    }
  });
});

// Phase 77 (chunk A) - the turning unit is ONE spine-hinged leaf with two
// faces: front = OUTGOING page, back = INCOMING page. jsdom has no CSS engine,
// so the leaf is asserted through the DOM contract the component renders while
// a turn is in flight.
describe("BookView page turn — spine-hinged leaf (Phase 77 chunk A)", () => {
  it("snapshots the outgoing/incoming pair on a next turn and advances the spread", async () => {
    const view = await mountBook(6, "double");
    try {
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);
      act((): void => {
        view.host
          .querySelector<HTMLElement>('[data-book-page-side="right"]')
          ?.click();
      });
      const leaf = view.host.querySelector(
        '[data-book-turn][data-book-turn-dir="next"]',
      );
      expect(leaf).not.toBeNull();
      expect(leaf?.querySelector('[data-book-turn-front="2"]')).not.toBeNull();
      expect(leaf?.querySelector('[data-book-turn-back="3"]')).not.toBeNull();
      expect(pageNumbers(view.host)).toEqual(["3", "4"]);
    } finally {
      view.cleanup();
    }
  });

  it("renders a prev leaf with the outgoing front 3 and incoming back 2", async () => {
    const view = await mountBook(6, "double");
    try {
      act((): void => {
        view.host
          .querySelector<HTMLElement>('[data-book-page-side="right"]')
          ?.click();
      });
      expect(pageNumbers(view.host)).toEqual(["3", "4"]);
      act((): void => {
        view.host
          .querySelector<HTMLElement>('[data-book-page-side="left"]')
          ?.click();
      });
      const leaf = view.host.querySelector(
        '[data-book-turn][data-book-turn-dir="prev"]',
      );
      expect(leaf).not.toBeNull();
      expect(leaf?.querySelector('[data-book-turn-front="3"]')).not.toBeNull();
      expect(leaf?.querySelector('[data-book-turn-back="2"]')).not.toBeNull();
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);
    } finally {
      view.cleanup();
    }
  });

  it("unmounts the turning leaf once the fallback clears", async () => {
    vi.useFakeTimers();
    const view = await mountBook(6, "double");
    try {
      act((): void => {
        view.host
          .querySelector<HTMLElement>('[data-book-page-side="right"]')
          ?.click();
      });
      expect(view.host.querySelector("[data-book-turn]")).not.toBeNull();
      act((): void => {
        vi.advanceTimersByTime(450);
      });
      expect(view.host.querySelector("[data-book-turn]")).toBeNull();
    } finally {
      view.cleanup();
      vi.useRealTimers();
    }
  });

  it("renders a next leaf in single mode and advances the page", async () => {
    const view = await mountBook(6, "single");
    try {
      expect(pageNumbers(view.host)).toEqual(["1"]);
      act((): void => {
        view.host.querySelector<HTMLElement>("[data-book-page]")?.click();
      });
      const leaf = view.host.querySelector(
        '[data-book-turn][data-book-turn-dir="next"]',
      );
      expect(leaf).not.toBeNull();
      expect(leaf?.querySelector('[data-book-turn-front="1"]')).not.toBeNull();
      expect(leaf?.querySelector('[data-book-turn-back="2"]')).not.toBeNull();
      expect(pageNumbers(view.host)).toEqual(["2"]);
    } finally {
      view.cleanup();
    }
  });
});

// Phase 77 (chunk B) — the spread-aware indicator and the one-shot
// single<->double relayout. jsdom has no CSS engine, so the relayout is
// asserted through the transient marker the component renders; the keyframe
// and token wiring lives in styles.css.
describe("BookView indicator + relayout (Phase 77 chunk B)", () => {
  it("labels a double spread with its page range and follows the turn", async () => {
    const view = await mountBook(6, "double");
    try {
      expect(view.host.querySelector("[data-book-progress]")?.textContent).toBe(
        "Page 1-2 of 6",
      );
      act((): void => {
        view.host
          .querySelector<HTMLElement>('[data-book-page-side="right"]')
          ?.click();
      });
      expect(view.host.querySelector("[data-book-progress]")?.textContent).toBe(
        "Page 3-4 of 6",
      );
    } finally {
      view.cleanup();
    }
  });

  it("collapses the redundant one-page range label in double mode (DEF-468)", async () => {
    const view = await mountBook(1, "double");
    try {
      expect(view.host.querySelector("[data-book-progress]")?.textContent).toBe(
        "Page 1 of 1",
      );
    } finally {
      view.cleanup();
    }
  });

  it("starts a one-shot relayout marker on the layout toggle and clears it", async () => {
    vi.useFakeTimers();
    const view = await mountBook(6, "single");
    try {
      act((): void => {
        view.host
          .querySelector<HTMLButtonElement>("[data-book-double]")
          ?.click();
      });
      expect(
        view.host.querySelector('[data-book-stage][data-book-relayout="true"]'),
      ).not.toBeNull();
      act((): void => {
        vi.advanceTimersByTime(450);
      });
      expect(view.host.querySelector('[data-book-relayout="true"]')).toBeNull();
    } finally {
      view.cleanup();
      vi.useRealTimers();
    }
  });
});
