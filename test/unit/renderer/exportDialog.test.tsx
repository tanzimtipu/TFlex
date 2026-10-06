// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ExportDialog,
  DEFAULT_EXPORT_IMAGE_DPI,
  DEFAULT_EXPORT_IMAGE_FORMAT,
  EXPORT_IMAGE_FORMATS,
  clampExportImageDpi,
} from "../../../src/renderer/components/ExportDialog";
import type { ExportImageFormat, ExportPageEntry } from "../../../src/shared/types";
import { contiguousPageRuns } from "../../../src/renderer/components/exportConfig";

// jsdom has no canvas backend; the dialog's per-page rasterize step is stubbed
// so the confirm flow can be exercised without pdf.js / canvas. `isEngineNativeFormat`
// is read during render (the TIFF radio label), so the mock must provide it too.
vi.mock("../../../src/renderer/pdf/rasterize", () => ({
  rasterizePageToBlob: async (): Promise<{ blob: Blob; width: number; height: number }> => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    return { blob: new Blob([bytes], { type: "image/png" }), width: 612, height: 792 };
  },
  isEngineNativeFormat: (): boolean => false,
}));

/**
 * Phase 9 — Export-Pages dialog rendering tests.
 *
 * The dialog's contract:
 *   - Renders the page range input, format radios, DPI input, and
 *     confirm button.
 *   - Page range validation: invalid -> confirm disabled.
 *   - Format change surfaces via onFormatChange.
 *   - DPI clamps to [72, 600] on every change.
 *   - Confirm is disabled while running; Cancel button surfaces
 *     mid-export and aborts.
 *   - Esc / backdrop / close button fire onClose (when not running).
 *
 * The actual rasterization + download flow is covered by the e2e
 * harness; jsdom can't run pdf.js so we never invoke the engine
 * callback in unit tests.
 */

interface RenderArgs {
  totalPages?: number;
  initialFormat?: ExportImageFormat;
  initialDpi?: number;
  runExport?: (
    payload: { range?: [number, number]; format: ExportImageFormat; dpi: number },
  ) => Promise<ExportPageEntry[] | { error: string }>;
  onConfirm?: (c: {
    range: number[];
    format: ExportImageFormat;
    dpi: number;
    entries: ExportPageEntry[];
  }) => void;
  onFormatChange?: (f: ExportImageFormat) => void;
  onDpiChange?: (d: number) => void;
  onClose?: () => void;
  sourceName?: string;
}

function renderDialog(args: RenderArgs = {}): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <ExportDialog
        open={true}
        totalPages={args.totalPages ?? 5}
        initialFormat={args.initialFormat ?? DEFAULT_EXPORT_IMAGE_FORMAT}
        initialDpi={args.initialDpi ?? DEFAULT_EXPORT_IMAGE_DPI}
        onFormatChange={args.onFormatChange}
        onDpiChange={args.onDpiChange}
        runExport={args.runExport ?? (async (): Promise<ExportPageEntry[]> => [])}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
        sourceName={args.sourceName ?? "report.pdf"}
        onClose={args.onClose ?? ((): void => undefined)}
      />,
    );
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("ExportDialog — render contract", () => {
  it("renders page range, format radios, DPI input, and confirm", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-export-range]")).not.toBeNull();
    // Three format radios now: PNG, JPEG, TIFF (Phase 9+).
    expect(
      container.querySelectorAll<HTMLInputElement>('input[name="export-format"]'),
    ).toHaveLength(3);
    expect(container.querySelector("[data-export-dpi]")).not.toBeNull();
    expect(container.querySelector("[data-export-confirm]")).not.toBeNull();
    cleanup();
  });

  it("seeds range from totalPages on open", () => {
    const { container, cleanup } = renderDialog({ totalPages: 12 });
    const range = container.querySelector<HTMLInputElement>(
      "[data-export-range]",
    );
    expect(range?.value).toBe("1-12");
    cleanup();
  });

  it("seeds format radios from initialFormat", () => {
    const { container, cleanup } = renderDialog({ initialFormat: "jpeg" });
    const jpeg = container.querySelector<HTMLInputElement>(
      "[data-export-format='jpeg']",
    );
    expect(jpeg?.checked).toBe(true);
    cleanup();
  });

  it("seeds DPI input from initialDpi", () => {
    const { container, cleanup } = renderDialog({ initialDpi: 300 });
    const dpi = container.querySelector<HTMLInputElement>("[data-export-dpi]");
    expect(dpi?.value).toBe("300");
    cleanup();
  });

  it("renders nothing when open=false", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <ExportDialog
          open={false}
          totalPages={5}
          initialFormat={DEFAULT_EXPORT_IMAGE_FORMAT}
          initialDpi={DEFAULT_EXPORT_IMAGE_DPI}
          runExport={async (): Promise<ExportPageEntry[]> => []}
          onConfirm={(): void => undefined}
          sourceName="report.pdf"
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector("[data-export-dialog]")).toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

describe("ExportDialog — format radios", () => {
  it("fires onFormatChange when the user picks JPEG", () => {
    const onFormatChange = vi.fn();
    const { container, cleanup } = renderDialog({ onFormatChange });
    const jpeg = container.querySelector<HTMLInputElement>(
      "[data-export-format='jpeg']",
    );
    expect(jpeg).not.toBeNull();
    if (jpeg === null) return cleanup();
    act((): void => {
      jpeg.click();
    });
    expect(jpeg.checked).toBe(true);
    expect(onFormatChange).toHaveBeenCalledWith("jpeg");
    cleanup();
  });

  it("every option in EXPORT_IMAGE_FORMATS has a radio", () => {
    const { container, cleanup } = renderDialog();
    for (const f of EXPORT_IMAGE_FORMATS) {
      expect(
        container.querySelector<HTMLInputElement>(
          `[data-export-format="${f}"]`,
        ),
      ).not.toBeNull();
    }
    cleanup();
  });
});

describe("ExportDialog — DPI clamp", () => {
  it("clamps below-range DPI on change", () => {
    const onDpiChange = vi.fn();
    const { container, cleanup } = renderDialog({ onDpiChange });
    const dpi = container.querySelector<HTMLInputElement>("[data-export-dpi]");
    expect(dpi).not.toBeNull();
    if (dpi === null) return cleanup();
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(dpi, "10");
      dpi.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dpi.value).toBe(clampExportImageDpi(10).toString());
    expect(onDpiChange).toHaveBeenLastCalledWith(72);
    cleanup();
  });

  it("clamps above-range DPI on change", () => {
    const onDpiChange = vi.fn();
    const { container, cleanup } = renderDialog({ onDpiChange });
    const dpi = container.querySelector<HTMLInputElement>("[data-export-dpi]");
    expect(dpi).not.toBeNull();
    if (dpi === null) return cleanup();
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(dpi, "1000");
      dpi.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dpi.value).toBe(clampExportImageDpi(1000).toString());
    expect(onDpiChange).toHaveBeenLastCalledWith(600);
    cleanup();
  });
});

describe("ExportDialog — close paths", () => {
  it("fires onClose when the backdrop is clicked (not running)", () => {
    // B3/B6 — mousedown must land on the backdrop too (a genuine
    // outside click, not a bare click()).
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const backdrop = container.querySelector<HTMLElement>(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    if (backdrop === null) return cleanup();
    act((): void => {
      backdrop.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    act((): void => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });

  it("fires onClose when the close button is clicked (not running)", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const close = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Close dialog']",
    );
    expect(close).not.toBeNull();
    if (close === null) return cleanup();
    act((): void => {
      close.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});

describe("clampExportImageDpi — boundary clamp", () => {
  it("clamps below 72 up to 72", () => {
    expect(clampExportImageDpi(0)).toBe(72);
    expect(clampExportImageDpi(50)).toBe(72);
    expect(clampExportImageDpi(71)).toBe(72);
  });
  it("clamps above 600 down to 600", () => {
    expect(clampExportImageDpi(601)).toBe(600);
    expect(clampExportImageDpi(5000)).toBe(600);
  });
  it("rounds fractional input", () => {
    expect(clampExportImageDpi(150.4)).toBe(150);
    expect(clampExportImageDpi(150.7)).toBe(151);
  });
  it("passes valid integers through", () => {
    expect(clampExportImageDpi(150)).toBe(150);
    expect(clampExportImageDpi(72)).toBe(72);
    expect(clampExportImageDpi(600)).toBe(600);
  });
});

// TFL-1000 (DEF-602 / ADV-232) — a non-contiguous parsed range must export
// exactly its pages, never the [first,last] span. The engine payload carries
// ONE continuous [start,end], so the dialog calls it once per contiguous run.
describe("contiguousPageRuns — splits a selection without widening it", () => {
  it("collapses a fully contiguous selection to one run", () => {
    expect(contiguousPageRuns([1, 2, 3])).toEqual([[1, 3]]);
  });
  it("splits gaps into discrete runs", () => {
    expect(contiguousPageRuns([1, 3, 5])).toEqual([[1, 1], [3, 3], [5, 5]]);
    expect(contiguousPageRuns([1, 2, 4, 5, 6])).toEqual([[1, 2], [4, 6]]);
    expect(contiguousPageRuns([2, 4, 6])).toEqual([[2, 2], [4, 4], [6, 6]]);
  });
  it("returns no runs for an empty selection", () => {
    expect(contiguousPageRuns([])).toEqual([]);
  });
});

describe("ExportDialog — DEF-602 non-contiguous ranges", () => {
  it("exports exactly the parsed pages, one engine call per contiguous run", async () => {
    const calls: Array<[number, number]> = [];
    const runExport = async (payload: {
      range?: [number, number];
      format: ExportImageFormat;
      dpi: number;
    }): Promise<ExportPageEntry[]> => {
      const range = payload.range as [number, number];
      calls.push(range);
      const out: ExportPageEntry[] = [];
      for (let p = range[0]; p <= range[1]; p += 1) {
        out.push({
          pageIndex: p,
          buffer: new Uint8Array([p]),
          format: payload.format,
          width: 1,
          height: 1,
        });
      }
      return out;
    };
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      totalPages: 5,
      runExport,
      onConfirm,
    });
    const rangeInput = container.querySelector<HTMLInputElement>("[data-export-range]");
    expect(rangeInput).not.toBeNull();
    if (rangeInput === null) return cleanup();
    await act(async (): Promise<void> => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(rangeInput, "1,3");
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(
      () => "blob:tfl1000",
    );
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
    try {
      await act(async (): Promise<void> => {
        container.querySelector<HTMLButtonElement>("[data-export-confirm]")?.click();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });
      // Two discrete runs, NOT the widening [1,3].
      expect(calls).toEqual([[1, 1], [3, 3]]);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      const result = onConfirm.mock.calls[0]?.[0] as {
        range: number[];
        entries: ExportPageEntry[];
      };
      expect(result.range).toEqual([1, 3]);
      expect(result.entries.map((e) => e.pageIndex)).toEqual([1, 3]);
    } finally {
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = realCreate;
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = realRevoke;
      cleanup();
    }
  });
});
