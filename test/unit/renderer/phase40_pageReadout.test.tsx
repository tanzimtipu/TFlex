// @vitest-environment jsdom
//
// Phase 40 (item 9) follow-up — the layout-aware page readout.
//
// In a multi-column layout the page pill shows the row's page RANGE ("3-4")
// so an even-page jump reports the page it landed on, not just the row's
// first page. A single-column layout supplies no readout, so the input shows
// the bare page exactly as before. Focusing the input swaps the range back to
// the numeric page for editing / typing a jump.
//
// Without the change these fail: `pageReadout` does not exist and the input
// always shows the bare page.

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
    zoomPercent: 100,
    zoomMode: "fit-page",
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

function pageInput(host: HTMLElement): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>('input[aria-label="Current page"]');
  if (el === null) throw new Error("no page input");
  return el;
}

describe("Phase 40 (item 9) — the page pill readout in a grid layout", () => {
  it("shows the row's page range when a readout is supplied", () => {
    const { host, unmount } = renderPills({ page: 3, pageReadout: "3-4" });
    try {
      expect(pageInput(host).value).toBe("3-4");
    } finally {
      unmount();
    }
  });

  it("keeps the bare page when no readout is supplied (single column)", () => {
    const { host, unmount } = renderPills({ page: 4, pageReadout: null });
    try {
      expect(pageInput(host).value).toBe("4");
    } finally {
      unmount();
    }
  });

  it("updates the readout when the row changes", () => {
    const { host, rerender, unmount } = renderPills({ page: 3, pageCount: 10, pageReadout: "3-4" });
    try {
      expect(pageInput(host).value).toBe("3-4");
      rerender({ page: 5, pageReadout: "5-6" });
      expect(pageInput(host).value).toBe("5-6");
    } finally {
      unmount();
    }
  });

  it("focusing swaps the range back to the numeric page for editing", () => {
    const onJump = vi.fn();
    const { host, rerender, unmount } = renderPills({ page: 3, pageReadout: "3-4", onJump });
    try {
      const input = pageInput(host);
      act((): void => {
        // React's onFocus is delegated from `focusin` (focus itself does not
        // bubble), exactly like the onBlur/focusout commit path.
        input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
      expect(input.value).toBe("3");
      act((): void => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      expect(onJump).toHaveBeenCalledWith("3");
      // The typed value is retained so a following blur re-commits it (the
      // pre-change input contract), but the readout re-applies the moment the
      // page changes (a jump landing on page 4 must show the row's "3-4").
      expect(input.value).toBe("3");
      rerender({ page: 4, pageReadout: "3-4" });
      expect(input.value).toBe("3-4");
    } finally {
      unmount();
    }
  });
});
