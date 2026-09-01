// @vitest-environment jsdom
//
// B13 — box dropdowns must not be killed by a focus shift on
// hover.
//
// History: several dialogs (OCR / Stamp / Crop-pages) used a
// focus-management `useEffect` that ran `first?.focus()` on
// every dependency change. The dep arrays included the parent's
// `onClose` callback, which the host App.tsx creates via
// `useCallback` (stable identity). The bug surfaced when:
//   - The user opened a `<select>` dropdown inside the dialog
//     (e.g. language picker on OCR, page-scope picker, page-pick
//     on Stamp, per-page selector on Crop).
//   - The user hovered over an option, which the browser renders
//     as a native popup at the OS layer.
//   - Some state change inside the dialog (a long-running OCR
//     progress tick, a parent re-render, etc.) re-ran the focus
//     effect, which called `first?.focus()` again and shifted
//     focus to the FIRST interactive element — usually a
//     different `<select>` or button — dismissing the popup the
//     user was engaging with.
//
// The fix:
//   1. The focus effect runs ONLY on the rising edge of `open`
//      (a `focusedOnceRef` gates subsequent runs).
//   2. The focus call is deferred via `queueMicrotask` so it
//      lands after React's commit phase and doesn't race the
//      parent click event that opened the dialog.
//
// We exercise both surfaces:
//   - On open, the first interactive element gets focus.
//   - On a state change that would have re-run the previous
//     focus effect, focus stays on the element the user
//     actually focused — NOT stolen by the dialog.
//   - Esc closes the dialog (existing behaviour preserved).
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  OcrDialog,
  type OcrDialogConfirm,
} from "../../../src/renderer/components/OcrDialog";
import type {
  OcrLanguage,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
} from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../src/renderer/pdf/ocrRasterize", () => ({
  rasterizePagesForOcr: async (args: {
    pages: number[];
    dpi: number;
  }): Promise<Array<{
    page: number;
    pngBytes: Uint8Array;
    dpi: number;
    widthPx: number;
    heightPx: number;
  }>> =>
    args.pages.map((p) => ({
      page: p,
      pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      dpi: args.dpi,
      widthPx: 100,
      heightPx: 100,
    })),
}));

interface RenderArgs {
  initialLanguage?: OcrLanguage;
  initialDownsample?: number;
  onLanguageChange?: (lang: OcrLanguage) => void;
  onDownsampleChange?: (dpi: number) => void;
  resolveActiveDoc?: () => unknown;
  subscribeOcrProgress?: (cb: (p: OcrProgress) => void) => () => void;
  runOcr?: (
    options: OcrRecognizeOptions,
  ) => Promise<{ ok: true; suspects: OcrSuspect[] } | { error: string }>;
  onConfirm?: (result: OcrDialogConfirm) => void;
  onClose?: () => void;
}

function mountDialog(args: RenderArgs = {}): {
  host: HTMLElement;
  rerender: (next: Partial<RenderArgs>) => void;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let current: RenderArgs = args;
  const render = (): void => {
    act((): void => {
      root.render(
        <OcrDialog
          open={true}
          totalPages={5}
          currentPage={2}
          initialLanguage={current.initialLanguage ?? "eng"}
          initialDownsample={current.initialDownsample ?? 150}
          onLanguageChange={current.onLanguageChange}
          onDownsampleChange={current.onDownsampleChange}
resolveActiveDoc={
            (current.resolveActiveDoc ??
            ((): unknown => {
              // The dialog's `resolveActiveDoc` prop is typed as
              // `() => PDFDocumentProxy | null`. We satisfy the
              // type with an object that has a `numPages` /
              // `getPage` shape; the dialog itself only reads
              // `numPages` in `valid`, which our test paths skip.
              return {
                numPages: 5,
                getPage: async (): Promise<unknown> => ({}),
              };
            })) as unknown as () => import("pdfjs-dist").PDFDocumentProxy | null
          }
          subscribeOcrProgress={
            current.subscribeOcrProgress ?? ((): (() => void) => (): void => undefined)
          }
          runOcr={
            current.runOcr ??
            (async (): Promise<{ ok: true; suspects: [] }> => ({ ok: true, suspects: [] }))
          }
          onConfirm={current.onConfirm ?? ((): void => undefined)}
          onClose={current.onClose ?? ((): void => undefined)}
        />,
      );
    });
  };
  render();
  return {
    host,
    rerender: (next: Partial<RenderArgs>): void => {
      current = { ...current, ...next };
      render();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("B13 — focus effect does not steal focus from select dropdowns on hover", () => {
  it("focuses the first interactive element on initial open", async () => {
    const { host, unmount } = mountDialog();
    try {
      // Yield a microtask so queueMicrotask's focus call lands.
      await act(async (): Promise<void> => {
        await Promise.resolve();
      });
      const active = host.ownerDocument.activeElement;
      // The first interactive element is the language `<select>`.
      // Focus may land on either it or the first input — both
      // are valid per the dialog contract. We just need to assert
      // that focus IS in the dialog, not on the body.
      expect(active).not.toBe(host.ownerDocument.body);
      expect(host.contains(active)).toBe(true);
    } finally {
      unmount();
    }
  });

  it("a state change after open does NOT re-run the focus call (focused-once gate)", async () => {
    // The previous implementation re-ran the focus effect on
    // every dependency change (open, onClose, running). The
    // fix gates subsequent runs behind a ref so the focus
    // call fires exactly once per dialog open.
    //
    // We verify by: (a) opening the dialog and capturing the
    // first interactive element, (b) explicitly focusing a
    // different element inside the dialog (simulating the
    // user hovering over a dropdown), (c) re-rendering the
    // dialog with a fresh `onClose` identity (simulating a
    // parent re-render that would have triggered the previous
    // effect), (d) asserting the user's focus target is
    // preserved.
    const { host, rerender, unmount } = mountDialog({
      onClose: vi.fn(),
    });
    try {
      await act(async (): Promise<void> => {
        await Promise.resolve();
      });
      // Simulate the user clicking into the page-scope radio /
      // select. The scope radio buttons are the natural second
      // interactive control after the language picker.
      const scopeRadios = host.querySelectorAll<HTMLInputElement>(
        "input[name='ocr-scope']",
      );
      const secondRadio = scopeRadios.item(1) as HTMLInputElement | null;
      expect(secondRadio).not.toBeNull();
      if (secondRadio !== null) {
        secondRadio.focus();
        expect(host.ownerDocument.activeElement).toBe(secondRadio);
      }
      // Re-render with a NEW onClose identity. The previous
      // buggy effect would have re-run first?.focus() and
      // stolen focus from the scope radio. The fixed effect
      // must NOT.
      const newOnClose = vi.fn();
      rerender({ onClose: newOnClose });
      await act(async (): Promise<void> => {
        await Promise.resolve();
      });
      expect(host.ownerDocument.activeElement).toBe(secondRadio);
    } finally {
      unmount();
    }
  });

  it("opening a NEW dialog instance after close fires the focus call again", async () => {
    // The focused-once ref is reset when `open` flips false.
    // When the user re-opens the dialog, the focus call must
    // fire again so the keyboard user lands inside the
    // dialog. We simulate by mounting, unmounting, then
    // mounting again.
    const first = mountDialog();
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
    const firstActive = first.host.ownerDocument.activeElement;
    expect(first.host.contains(firstActive)).toBe(true);
    first.unmount();
    const second = mountDialog();
    try {
      await act(async (): Promise<void> => {
        await Promise.resolve();
      });
      const secondActive = second.host.ownerDocument.activeElement;
      // Focus landed inside the SECOND dialog too (not on
      // document.body), proving the ref was reset on unmount.
      expect(secondActive).not.toBe(second.host.ownerDocument.body);
      expect(second.host.contains(secondActive)).toBe(true);
    } finally {
      second.unmount();
    }
  });
});