// @vitest-environment jsdom
//
// Phase 36 (chunk 3b) — the floating page + zoom pills.
//
// The command toolbar ROW is retired in SINGLE mode, so the pills are the new
// home for the page nav and the zoom/fit/pan controls. These tests pin the
// re-parented contract exactly: the same aria-labels the toolbar buttons
// carried, the page INPUT jump, the label-aware display, the zoom readout, the
// fit pressed state, pan mode, and the shared dock idle fade.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CanvasPills, type CanvasPillsProps } from "../../../src/renderer/components/CanvasPills";

function renderPills(options: Partial<CanvasPillsProps> = {}): {
  host: HTMLElement;
  rerender: (next: Partial<CanvasPillsProps>) => void;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let current: CanvasPillsProps = {
    page: 3,
    pageCount: 10,
    zoomPercent: 171,
    zoomMode: "manual",
    onJump: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onFitWidth: vi.fn(),
    onFitPage: vi.fn(),
    ...options,
  };
  const draw = (): void => {
    act((): void => {
      root.render(<CanvasPills {...current} />);
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

function byLabel(host: HTMLElement, label: string): HTMLButtonElement {
  const el = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (el === null) throw new Error(`no button labelled ${label}`);
  return el;
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("Phase 36 (chunk 3b) — the page pill", () => {
  it("renders the two pills with the page nav on the LEFT and zoom on the RIGHT", () => {
    const { host, unmount } = renderPills();
    try {
      expect(host.querySelector("[data-canvas-pills]")).not.toBeNull();
      expect(host.querySelector("[data-page-pill]")).not.toBeNull();
      expect(host.querySelector("[data-zoom-pill]")).not.toBeNull();
      // The page cluster is inside the page pill, the zoom cluster is not.
      expect(host.querySelector("[data-page-pill]")?.querySelector('[aria-label="Previous page"]')).not.toBeNull();
      expect(host.querySelector("[data-zoom-pill]")?.querySelector('[aria-label="Zoom out"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("keeps the toolbar's exact aria-labels", () => {
    const { host, unmount } = renderPills();
    try {
      for (const label of [
        "Previous page",
        "Current page",
        "Next page",
        "Zoom out",
        "Zoom in",
        "Fit width",
        "Fit page",
      ]) {
        expect(host.querySelector(`[aria-label="${label}"]`), label).not.toBeNull();
      }
      // The page number keeps its INPUT contract (aria-label on the input).
      expect(host.querySelector('input.page-input[aria-label="Current page"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("steps backward / forward through onJump", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPills({ onJump });
    try {
      clickOn(byLabel(host, "Previous page"));
      expect(onJump).toHaveBeenCalledWith("2");
      clickOn(byLabel(host, "Next page"));
      expect(onJump).toHaveBeenCalledWith("4");
    } finally {
      unmount();
    }
  });

  it("keeps the page number an INPUT: typing + Enter jumps, blur jumps", () => {
    const onJump = vi.fn();
    const { host, unmount } = renderPills({ onJump });
    try {
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Current page"]');
      expect(input).not.toBeNull();
      // React's controlled input needs the native value setter + an input event.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      act((): void => {
        if (input !== null && setter !== undefined) {
          setter.call(input, "7");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      act((): void => {
        input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      expect(onJump).toHaveBeenCalledWith("7");
      onJump.mockClear();
      act((): void => {
        // React's onBlur is delegated from `focusout` (blur itself does not
        // bubble), so the commit-on-blur path is driven through focusout.
        input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      expect(onJump).toHaveBeenCalledWith("7");
    } finally {
      unmount();
    }
  });

  it("shows the / total and the label-aware display when a page label exists", () => {
    const { host, rerender, unmount } = renderPills({ page: 4, pageCount: 10, pageLabel: "iv" });
    try {
      expect(host.querySelector(".page-total")?.textContent).toBe("/ 10");
      const hint = host.querySelector("[data-page-label]");
      expect(hint?.textContent).toBe("iv");
      expect(hint?.getAttribute("data-page-label")).toBe("iv");
      rerender({ pageLabel: null });
      expect(host.querySelector("[data-page-label]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("disables Prev on the first page and Next on the last", () => {
    const { host, rerender, unmount } = renderPills({ page: 1, pageCount: 3 });
    try {
      expect(byLabel(host, "Previous page").hasAttribute("disabled")).toBe(true);
      expect(byLabel(host, "Next page").hasAttribute("disabled")).toBe(false);
      rerender({ page: 3 });
      expect(byLabel(host, "Next page").hasAttribute("disabled")).toBe(true);
    } finally {
      unmount();
    }
  });
});

describe("Phase 36 (chunk 3b) — the zoom pill", () => {
  it("mirrors the existing zoom model in the percentage readout", () => {
    const { host, rerender, unmount } = renderPills({ zoomPercent: 171 });
    try {
      expect(host.querySelector(".zoom-percent")?.textContent).toBe("171%");
      rerender({ zoomPercent: 100 });
      expect(host.querySelector(".zoom-percent")?.textContent).toBe("100%");
    } finally {
      unmount();
    }
  });

  it("reuses the existing zoom / fit handlers", () => {
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();
    const onFitWidth = vi.fn();
    const onFitPage = vi.fn();
    const { host, unmount } = renderPills({ onZoomOut, onZoomIn, onFitWidth, onFitPage });
    try {
      clickOn(byLabel(host, "Zoom out"));
      clickOn(byLabel(host, "Zoom in"));
      clickOn(byLabel(host, "Fit width"));
      clickOn(byLabel(host, "Fit page"));
      expect(onZoomOut).toHaveBeenCalledTimes(1);
      expect(onZoomIn).toHaveBeenCalledTimes(1);
      expect(onFitWidth).toHaveBeenCalledTimes(1);
      expect(onFitPage).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("reflects the fit mode through aria-pressed", () => {
    const { host, rerender, unmount } = renderPills({ zoomMode: "fit-width" });
    try {
      expect(byLabel(host, "Fit width").getAttribute("aria-pressed")).toBe("true");
      expect(byLabel(host, "Fit page").getAttribute("aria-pressed")).toBe("false");
      rerender({ zoomMode: "fit-page" });
      expect(byLabel(host, "Fit width").getAttribute("aria-pressed")).toBe("false");
      expect(byLabel(host, "Fit page").getAttribute("aria-pressed")).toBe("true");
    } finally {
      unmount();
    }
  });

  it("gives pan mode its visible home: aria-label, pressed state and handler", () => {
    const onHandToggle = vi.fn();
    const { host, rerender, unmount } = renderPills({ onHandToggle, handActive: false });
    try {
      const hand = byLabel(host, "Pan mode");
      expect(hand.getAttribute("data-hand-toggle")).not.toBeNull();
      expect(hand.getAttribute("data-hand-active")).toBe("false");
      expect(hand.getAttribute("aria-pressed")).toBe("false");
      clickOn(hand);
      expect(onHandToggle).toHaveBeenCalledTimes(1);
      rerender({ handActive: true });
      expect(byLabel(host, "Pan mode").getAttribute("aria-pressed")).toBe("true");
      expect(byLabel(host, "Pan mode").getAttribute("data-hand-active")).toBe("true");
    } finally {
      unmount();
    }
  });
});

describe("Phase 36 (chunk 3b) — the pills share the dock's idle fade", () => {
  it("is active by default and fades with the dock's idle flag", () => {
    const { host, rerender, unmount } = renderPills();
    try {
      expect(host.querySelector("[data-canvas-pills]")?.getAttribute("data-canvas-pills-idle")).toBe("false");
      rerender({ idle: true });
      expect(host.querySelector("[data-canvas-pills]")?.getAttribute("data-canvas-pills-idle")).toBe("true");
      rerender({ idle: false });
      expect(host.querySelector("[data-canvas-pills]")?.getAttribute("data-canvas-pills-idle")).toBe("false");
    } finally {
      unmount();
    }
  });
});