// @vitest-environment jsdom
//
// TFL-1116 (C5b, R24) — page / range truthfulness.
//
// The page field and the visible range are SEPARATE. In a multi-page layout the
// jump input carries the FOCUSED page (one number, "7") and a distinct summary
// ("Visible 7-10") reports the group the viewport actually holds. A single-page
// layout shows no separate range. `pageReadoutLabel`'s own range math is the
// truthful source and stays untouched; `pageVisibleRangeLabel` extends its
// row-start by the fit rows (FOUR = 2 rows = 4 pages, TWO = 2 pages).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ViewStrip, type ViewStripProps } from "../../../src/renderer/components/ViewStrip";
import { CanvasPills, type CanvasPillsProps } from "../../../src/renderer/components/CanvasPills";
import {
  pageReadoutLabel,
  pageVisibleRangeLabel,
} from "../../../src/renderer/components/pageLayoutMode";

function renderStrip(options: Partial<ViewStripProps> = {}): {
  host: HTMLElement;
  rerender: (next: Partial<ViewStripProps>) => void;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let current: ViewStripProps = {
    page: 3,
    pageCount: 10,
    zoomPercent: 100,
    zoomMode: "fit-page",
    pageLayout: "one",
    onJump: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitWidth: vi.fn(),
    onFitPage: vi.fn(),
    onChangePageLayout: vi.fn(),
    ...options,
  };
  const draw = (): void => {
    act((): void => {
      root.render(createElement(ViewStrip, { ...current }));
    });
  };
  draw();
  return {
    host,
    rerender: (next): void => {
      current = { ...current, ...next };
      draw();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function renderPills(options: Partial<CanvasPillsProps> = {}): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      createElement(CanvasPills, {
        page: 3,
        pageCount: 10,
        zoomPercent: 100,
        zoomMode: "fit-page",
        onJump: vi.fn(),
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onFitWidth: vi.fn(),
        onFitPage: vi.fn(),
        ...options,
      }),
    );
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

function pageInput(host: HTMLElement): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>('input[aria-label="Current page"]');
  if (el === null) throw new Error("no page input");
  return el;
}

describe("TFL-1116 R24 — pageVisibleRangeLabel extends the truthful row range", () => {
  it("FOUR (2 columns, 2 fit rows) reports the 4-page group", () => {
    expect(pageVisibleRangeLabel(7, 2, 2, 20)).toBe("7-10");
    expect(pageVisibleRangeLabel(8, 2, 2, 20)).toBe("7-10");
    expect(pageVisibleRangeLabel(10, 2, 2, 20)).toBe("9-12");
  });

  it("TWO (2 columns, 1 fit row) matches the single-row readout", () => {
    expect(pageVisibleRangeLabel(7, 2, 1, 20)).toBe("7-8");
    expect(pageReadoutLabel(7, 2, 20)).toBe("7-8");
  });

  it("ONE and an incomplete last group collapse to a bare page", () => {
    expect(pageVisibleRangeLabel(7, 1, 1, 20)).toBe("7");
    expect(pageVisibleRangeLabel(5, 2, 2, 5)).toBe("5");
    expect(pageVisibleRangeLabel(4, 2, 2, 5)).toBe("3-5");
  });

  it("leaves pageReadoutLabel's own range math untouched", () => {
    expect(pageReadoutLabel(3, 2, 10)).toBe("3-4");
    expect(pageReadoutLabel(4, 2, 10)).toBe("3-4");
    expect(pageReadoutLabel(5, 2, 10)).toBe("5-6");
    expect(pageReadoutLabel(4, 1, 10)).toBe("4");
  });
});

describe("TFL-1116 R24 — the ViewStrip splits focused page from visible range", () => {
  it("shows the focused page in the jump field and a distinct range summary", () => {
    const { host, unmount } = renderStrip({
      page: 7,
      pageCount: 20,
      visibleRange: "7-10",
    });
    try {
      expect(pageInput(host).value).toBe("7");
      const summary = host.querySelector("[data-page-visible-range]");
      expect(summary).not.toBeNull();
      expect(summary?.getAttribute("data-page-visible-range")).toBe("7-10");
      expect(summary?.textContent).toBe("Visible 7-10");
    } finally {
      unmount();
    }
  });

  it("shows no separate range in a single-page layout", () => {
    const { host, unmount } = renderStrip({ page: 4, visibleRange: null });
    try {
      expect(pageInput(host).value).toBe("4");
      expect(host.querySelector("[data-page-visible-range]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("keeps the focused page in the field as the visible range changes", () => {
    const { host, rerender, unmount } = renderStrip({
      page: 7,
      pageCount: 20,
      visibleRange: "7-10",
    });
    try {
      expect(pageInput(host).value).toBe("7");
      rerender({ page: 9, visibleRange: "9-12" });
      expect(pageInput(host).value).toBe("9");
      expect(
        host.querySelector("[data-page-visible-range]")?.getAttribute("data-page-visible-range"),
      ).toBe("9-12");
    } finally {
      unmount();
    }
  });
});

describe("TFL-1116 R24 — CanvasPills mirrors the split", () => {
  it("renders the focused page plus the visible-range summary", () => {
    const { host, unmount } = renderPills({
      page: 7,
      pageCount: 20,
      visibleRange: "7-10",
    });
    try {
      expect(pageInput(host).value).toBe("7");
      expect(
        host.querySelector("[data-page-visible-range]")?.textContent,
      ).toBe("Visible 7-10");
    } finally {
      unmount();
    }
  });
});