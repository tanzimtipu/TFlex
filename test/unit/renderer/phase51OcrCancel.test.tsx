// @vitest-environment jsdom
//
// Phase 51 (item 9 / feature G) — cancelling OCR must actually stop the run.
//
// Renderer contract under test: after Cancel the dialog leaves the running
// state IMMEDIATELY, the abort signal handed to `runOcr` is aborted, no
// late result is applied (`onConfirm` never fires), and the next Run starts
// from a clean controller. The main-process tesseract work itself is not
// abortable from the renderer (reported separately).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../../src/renderer/pdf/ocrRasterize", () => ({
  rasterizePagesForOcr: async (args: {
    pages: number[];
    onProgress?: (page: number) => void;
  }) => {
    for (const p of args.pages) args.onProgress?.(p);
    return args.pages.map((p) => ({
      page: p,
      pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      dpi: 300,
      widthPx: 100,
      heightPx: 100,
    }));
  },
}));

import { OcrDialog } from "../../../src/renderer/components/OcrDialog";
import type { OcrProgress } from "../../../src/shared/types";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderDialog(
  runOcr: (o: unknown, signal?: AbortSignal) => Promise<unknown>,
  cancelOcr?: () => void,
): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <OcrDialog
        open={true}
        totalPages={2}
        currentPage={1}
        formFields={[]}
        initialLanguage={"eng" as never}
        initialDownsample={300}
        resolveActiveDoc={(): never => ({ numPages: 2 }) as never}
        subscribeOcrProgress={
          (_cb: (p: OcrProgress) => void): (() => void) => (): void => undefined
        }
        runOcr={runOcr as never}
        cancelOcr={cancelOcr}
        onConfirm={(): void => undefined}
        onClose={(): void => undefined}
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

/** Click + flush the microtask queue so the run advances to the engine call. */
async function clickAndFlush(el: Element | null): Promise<void> {
  expect(el).not.toBeNull();
  await act(async (): Promise<void> => {
    (el as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Phase 51 item 9 — OCR cancel really stops the run", () => {
  it("leaves the running state, aborts the signal and discards the late result", async () => {
    const first = deferred<{ ok: true; suspects: never[] }>();
    const signals: (AbortSignal | undefined)[] = [];
    const onConfirm = vi.fn();
    const runOcr = vi.fn((_o: unknown, signal?: AbortSignal) => {
      signals.push(signal);
      return first.promise;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <OcrDialog
          open={true}
          totalPages={2}
          currentPage={1}
          formFields={[]}
          initialLanguage={"eng" as never}
          initialDownsample={300}
          resolveActiveDoc={(): never => ({ numPages: 2 }) as never}
          subscribeOcrProgress={(): (() => void) => (): void => undefined}
          runOcr={runOcr as never}
          onConfirm={onConfirm}
          onClose={(): void => undefined}
        />,
      );
    });

    await clickAndFlush(container.querySelector("[data-ocr-confirm]"));
    // Engine phase: running, cancel available.
    expect(container.querySelector("[data-ocr-cancel]")).not.toBeNull();
    expect(signals.length).toBe(1);

    await clickAndFlush(container.querySelector("[data-ocr-cancel]"));
    // The UI left the running state at once and reports the cancellation.
    expect(container.querySelector("[data-ocr-cancel]")).toBeNull();
    expect(container.querySelector("[data-ocr-cancelled]")).not.toBeNull();
    expect(signals[0]?.aborted).toBe(true);

    // The engine promise resolves LATE — no result may be applied.
    await act(async (): Promise<void> => {
      first.resolve({ ok: true, suspects: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.querySelector("[data-ocr-cancelled]")).not.toBeNull();

    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("starts a clean run afterwards", async () => {
    let call = 0;
    const runOcr = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Promise(() => undefined); // never resolves
      return { ok: true, suspects: [] };
    });
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog(runOcr as never);
    await clickAndFlush(container.querySelector("[data-ocr-confirm]"));
    await clickAndFlush(container.querySelector("[data-ocr-cancel]"));
    await clickAndFlush(container.querySelector("[data-ocr-confirm]"));
    expect(runOcr).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    cleanup();
  });

  it("calls the host cancel channel exactly once when the user cancels", async () => {
    const runOcr = vi.fn((): Promise<never> => new Promise(() => undefined));
    const cancelOcr = vi.fn();
    const { container, cleanup } = renderDialog(runOcr as never, cancelOcr);
    await clickAndFlush(container.querySelector("[data-ocr-confirm]"));
    await clickAndFlush(container.querySelector("[data-ocr-cancel]"));
    expect(cancelOcr).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("treats the engine's { cancelled: true } result as cancellation, not an error", async () => {
    // The defensive path: the engine confirms the cancellation without our
    // local signal being aborted. It must NOT surface an error toast, must
    // apply no result, and must show the truthful Cancelled notice.
    const runOcr = vi.fn(async () => ({ cancelled: true as const }));
    const onConfirm = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <OcrDialog
          open={true}
          totalPages={2}
          currentPage={1}
          formFields={[]}
          initialLanguage={"eng" as never}
          initialDownsample={300}
          resolveActiveDoc={(): never => ({ numPages: 2 }) as never}
          subscribeOcrProgress={(): (() => void) => (): void => undefined}
          runOcr={runOcr as never}
          onConfirm={onConfirm}
          onClose={(): void => undefined}
        />,
      );
    });
    await clickAndFlush(container.querySelector("[data-ocr-confirm]"));
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[data-ocr-error]")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(container.querySelector("[data-ocr-cancelled]")).not.toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});
