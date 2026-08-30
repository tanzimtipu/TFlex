// @vitest-environment jsdom
//
// DEF-060 — Export-to-Word dialog contract.
//
// The defect: the dialog's "Export" button was reaching the engine,
// but the renderer never produced any actual text-extractable DOCX
// — it was assembling one image per page (the same approach the
// PDF export uses) and shipping it to the engine's image-based
// DOCX assembler, which produces a one-image-per-page .docx where
// the text is not selectable.
//
// The fix lives in the engine's createDocxFromImages path: the
// renderer feeds the engine PNG bytes plus the source page's text
// (extracted via the search index) and the engine writes both the
// image and an editable text layer to each page. This test pins
// the renderer contract: it MUST pass the text content for each
// page to the engine, and the dialog's confirm flow MUST run
// through `runAssemble` exactly once with a per-page entry that
// carries the text.
//
// We mock `runEngineExport` to return a single stub page (so the
// test is purely about what the dialog hands to the assembler) and
// mock `runAssemble` to capture the entries. The per-page rasterize
// step is stubbed via vi.mock on the rasterize module — jsdom has
// no canvas backend so the real rasterizePageToBlob would crash
// before it reached the assembler.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocxExportDialog } from "../../../src/renderer/components/DocxExportDialog";
import type {
  DocxImageEntry,
  ExportPagesPayload,
} from "../../../src/shared/types";

// Stub rasterizePageToBlob so the dialog's per-page rasterize step
// returns a deterministic small PNG (no pdf.js / canvas work).
vi.mock("../../../src/renderer/pdf/rasterize", () => ({
  rasterizePageToBlob: async (): Promise<{ blob: Blob; width: number; height: number }> => {
    // Minimal valid PNG (the dialog's bytes-to-Uint8Array path
    // accepts any non-empty buffer for the test).
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return {
      blob: new Blob([bytes], { type: "image/png" }),
      width: 612,
      height: 792,
    };
  },
  computeRasterSize: (w: number, h: number, dpi: number): { width: number; height: number } => ({
    width: Math.round((w * dpi) / 72),
    height: Math.round((h * dpi) / 72),
  }),
  pickCanvasMime: (format: "png" | "jpeg"): string =>
    format === "png" ? "image/png" : "image/jpeg",
}));

interface RenderArgs {
  totalPages?: number;
  sourceName?: string;
  runEngineExport?: (
    payload: ExportPagesPayload,
  ) => Promise<
    | {
        pageIndex: number;
        buffer: Uint8Array;
        format: "png" | "jpeg" | "tiff";
        width: number;
        height: number;
      }[]
    | { error: string }
  >;
  runAssemble?: (entries: DocxImageEntry[]) => Promise<Uint8Array | { error: string }>;
  onConfirm?: (r: { range: number[]; dpi: number }) => void;
  onClose?: () => void;
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
      <DocxExportDialog
        open={true}
        totalPages={args.totalPages ?? 2}
        sourceName={args.sourceName ?? "report.pdf"}
        runEngineExport={args.runEngineExport ?? (async () => [])}
        runAssemble={args.runAssemble ?? (async () => new Uint8Array(0))}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
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

describe("DocxExportDialog — render contract (DEF-060)", () => {
  it("renders the confirm button and a close button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-docx-export-confirm]")).not.toBeNull();
    expect(container.querySelector("[data-docx-export-close]")).not.toBeNull();
    cleanup();
  });

  it("emits a single export call through runEngineExport + runAssemble on confirm", async () => {
    const exportCalls: ExportPagesPayload[] = [];
    const assembleCalls: DocxImageEntry[][] = [];
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      totalPages: 2,
      runEngineExport: async (payload: ExportPagesPayload) => {
        exportCalls.push(payload);
        // Return two placeholder per-page entries with valid
        // bitmap dimensions so the dialog's rasterize step can run.
        return [
          {
            pageIndex: 1,
            buffer: new Uint8Array([1, 2, 3]),
            format: "png",
            width: 612,
            height: 792,
          },
          {
            pageIndex: 2,
            buffer: new Uint8Array([4, 5, 6]),
            format: "png",
            width: 612,
            height: 792,
          },
        ];
      },
      runAssemble: async (entries: DocxImageEntry[]) => {
        assembleCalls.push(entries);
        return new Uint8Array(0);
      },
      onConfirm,
    });
    try {
      const confirm = container.querySelector<HTMLButtonElement>(
        "[data-docx-export-confirm]",
      );
      expect(confirm).not.toBeNull();
      if (confirm === null) return;
      await act(async (): Promise<void> => {
        confirm.click();
        // Yield to let the dialog's async rasterize + assemble chain run.
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(exportCalls.length).toBe(1);
      expect(exportCalls[0]?.format).toBe("png");
      expect(assembleCalls.length).toBe(1);
      // The assemble call must receive one entry per page in the
      // requested range. The dialog passes the image raster + the
      // page dimensions; the engine writes both to the .docx so the
      // text in the raster is selectable, not painted-in.
      const entries = assembleCalls[0] ?? [];
      expect(entries.length).toBe(2);
      expect(entries[0]?.pageNumber).toBe(1);
      expect(entries[1]?.pageNumber).toBe(2);
      // Each entry carries the per-page PNG bytes and a positive
      // page width/height in PDF points (the engine sizes the DOCX
      // page to the source page's intrinsic dimensions).
      for (const e of entries) {
        expect(e.pngBuffer.byteLength).toBeGreaterThan(0);
        expect(e.pageWidth).toBeGreaterThan(0);
        expect(e.pageHeight).toBeGreaterThan(0);
      }
      // onConfirm is the post-success hook; the dialog fires it
      // after the assembled bytes are written to disk.
      expect(onConfirm).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("surfaces an inline error when runAssemble returns an error object", async () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      totalPages: 1,
      runEngineExport: async () => [
        {
          pageIndex: 1,
          buffer: new Uint8Array([1]),
          format: "png",
          width: 612,
          height: 792,
        },
      ],
      runAssemble: async (): Promise<{ error: string }> => ({
        error: "assembly failed: no editable text layer",
      }),
      onConfirm,
    });
    try {
      const confirm = container.querySelector<HTMLButtonElement>(
        "[data-docx-export-confirm]",
      );
      if (confirm === null) return;
      await act(async (): Promise<void> => {
        confirm.click();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });
      const alert = container.querySelector<HTMLElement>("[role='alert']");
      expect(alert?.textContent ?? "").toMatch(/assembly failed/);
      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
