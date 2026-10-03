// @vitest-environment jsdom
//
// Phase 93 (TFL-515) - Book View page-turn smoothness contract.
//
// The page-turn must be flicker-free: the OUTGOING figure's already-painted
// PageView canvas is the turning front face (never a freshly mounted white
// PageView), the base spread stays on the outgoing index until the turn
// settles and commits the destination exactly once, rapid input coalesces to
// at most one queued step with never more than one leaf, and the instant
// (reduced-motion / animations-off) path mounts NO leaf at all.
//
// jsdom has no CSS engine or canvas paint, so the contract is asserted through
// the DOM the component renders: which `[data-book-page]` numbers are live,
// whether `[data-book-turn]` is mounted, and (for the reuse guarantee) that the
// turning front face's canvas is the SAME DOM node the outgoing page already
// had.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { BookView } from "../../../src/renderer/components/BookView";
import { setAnimationsEnabledPreference } from "../../../src/renderer/hooks/motionPolicy";
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

function turnCount(host: HTMLElement): number {
  return host.querySelectorAll("[data-book-turn]").length;
}

function stageTurning(host: HTMLElement): boolean {
  return (
    host
      .querySelector("[data-book-stage]")
      ?.getAttribute("data-book-turning") === "true"
  );
}

function click(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function nextFigure(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-book-page-side="right"]');
}

describe("BookView page turn - smoothness (Phase 93 / TFL-515)", () => {
  it("keeps the base spread on the outgoing index while the turn is mounted", async () => {
    const view = await mountBook(6, "double");
    try {
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);
      click(nextFigure(view.host));
      // The destination must NOT swap underneath the swing: the live
      // `[data-book-page]` numbers stay the outgoing spread until it settles.
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);
      expect(turnCount(view.host)).toBe(1);
      expect(stageTurning(view.host)).toBe(true);
    } finally {
      view.cleanup();
    }
  });

  it("commits the destination exactly once when the fallback clears", async () => {
    vi.useFakeTimers();
    const view = await mountBook(6, "double");
    try {
      click(nextFigure(view.host));
      expect(turnCount(view.host)).toBe(1);
      act((): void => {
        vi.advanceTimersByTime(450);
      });
      expect(pageNumbers(view.host)).toEqual(["3", "4"]);
      expect(turnCount(view.host)).toBe(0);
    } finally {
      view.cleanup();
      vi.useRealTimers();
    }
  });

  it("reuses the already-mounted outgoing canvas as the turning front face", async () => {
    const view = await mountBook(6, "double");
    try {
      const before =
        nextFigure(view.host)?.querySelector(".pdf-page-canvas") ?? null;
      expect(before).not.toBeNull();
      click(nextFigure(view.host));
      const leaf = view.host.querySelector("[data-book-turn]");
      expect(leaf).not.toBeNull();
      // The front face must be the SAME canvas node (no fresh PageView mount
      // that would repaint from white before pdf.js finishes).
      expect(leaf?.querySelector(".pdf-page-canvas")).toBe(before);
    } finally {
      view.cleanup();
    }
  });

  it("coalesces a second click to one queued step and one leaf", async () => {
    vi.useFakeTimers();
    const view = await mountBook(6, "double");
    try {
      click(nextFigure(view.host));
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);
      click(nextFigure(view.host));
      expect(turnCount(view.host)).toBe(1);
      expect(pageNumbers(view.host)).toEqual(["1", "2"]);

      act((): void => {
        vi.advanceTimersByTime(450);
      });
      // Exactly one coalesced step is held; the queued step starts a fresh
      // leaf rather than jumping two spreads in one commit.
      expect(pageNumbers(view.host)).toEqual(["3", "4"]);
      expect(turnCount(view.host)).toBe(1);

      act((): void => {
        vi.advanceTimersByTime(450);
      });
      expect(pageNumbers(view.host)).toEqual(["5", "6"]);
      expect(turnCount(view.host)).toBe(0);
    } finally {
      view.cleanup();
      vi.useRealTimers();
    }
  });

  it("never reports a turning stage while no leaf is mounted", async () => {
    vi.useFakeTimers();
    const view = await mountBook(6, "single");
    try {
      expect(turnCount(view.host)).toBe(0);
      expect(stageTurning(view.host)).toBe(false);
      click(view.host.querySelector("[data-book-page]"));
      expect(turnCount(view.host)).toBe(1);
      expect(stageTurning(view.host)).toBe(true);
      act((): void => {
        vi.advanceTimersByTime(450);
      });
      expect(turnCount(view.host)).toBe(0);
      expect(stageTurning(view.host)).toBe(false);
      expect(pageNumbers(view.host)).toEqual(["2"]);
    } finally {
      view.cleanup();
      vi.useRealTimers();
    }
  });
});

describe("BookView page turn - instant path (Phase 93 / TFL-515)", () => {
  it("commits synchronously with no leaf when animations are off", async () => {
    setAnimationsEnabledPreference(false);
    const view = await mountBook(6, "single");
    try {
      expect(pageNumbers(view.host)).toEqual(["1"]);
      click(view.host.querySelector("[data-book-page]"));
      expect(pageNumbers(view.host)).toEqual(["2"]);
      expect(turnCount(view.host)).toBe(0);
      expect(stageTurning(view.host)).toBe(false);
    } finally {
      view.cleanup();
      setAnimationsEnabledPreference(true);
    }
  });
});
