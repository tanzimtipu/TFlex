// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Mock the OCR rasterization helper so the dialog can be exercised
// in jsdom without a real canvas backend. The mock returns one
// empty PNG per requested page; the dialog hands the result to the
// stubbed `runOcr`.
vi.mock("../../../src/renderer/pdf/ocrRasterize", () => ({
  rasterizePagesForOcr: async (args: {
    pages: number[];
    dpi: number;
    onProgress?: (page: number) => void;
  }): Promise<Array<{
    page: number;
    pngBytes: Uint8Array;
    dpi: number;
    widthPx: number;
    heightPx: number;
  }>> => {
    // Mirror the real helper: notify per completed render so the
    // dialog's rasterisation-phase bar updates are exercised.
    for (const p of args.pages) {
      args.onProgress?.(p);
    }
    return args.pages.map((p) => ({
      page: p,
      pngBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      dpi: args.dpi,
      widthPx: 100,
      heightPx: 100,
    }));
  },
}));

import { OcrDialog } from "../../../src/renderer/components/OcrDialog";
import type {
  OcrLanguage,
  OcrPageImage,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
} from "../../../src/shared/types";

/**
 * Phase 11 — OCR dialog rendering tests. These pin the dialog's
 * contract: language picker (allowlist), downsample slider
 * (72..600), scope selector (current / all), run button is wired
 * through runOcr, progress bar advances on engine progress events,
 * and onConfirm fires with the OCR result payload.
 */

interface RenderArgs {
  totalPages?: number;
  currentPage?: number;
  initialLanguage?: OcrLanguage;
  initialDownsample?: number;
  onLanguageChange?: (lang: OcrLanguage) => void;
  onDownsampleChange?: (dpi: number) => void;
  resolveActiveDoc?: () => unknown;
  subscribeOcrProgress?: (cb: (p: OcrProgress) => void) => () => void;
  runOcr?: (
    options: OcrRecognizeOptions,
  ) => Promise<{ ok: true; suspects: OcrSuspect[] } | { error: string }>;
  onConfirm?: (result: {
    language: OcrLanguage;
    downsample: number;
    scope: "currentPage" | "allPages";
    pages: number[];
    pageImages: OcrPageImage[];
    suspects: OcrSuspect[];
  }) => void;
  onClose?: () => void;
}

/** Synthetic pdf.js document proxy. The dialog calls getPage on
 *  it during the rasterize step, but vi.mock above replaces the
 *  rasterizer, so the proxy is only used for a numPages read. */
function fakeDocProxy(numPages: number): unknown {
  return {
    numPages,
    getPage: async (_n: number): Promise<unknown> => ({}),
    destroy: async (): Promise<unknown> => undefined,
  };
}

function renderDialog(args: RenderArgs = {}): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const resolveActiveDoc = args.resolveActiveDoc ?? ((): unknown => fakeDocProxy(args.totalPages ?? 1));
  const subscribeOcrProgress =
    args.subscribeOcrProgress ??
    ((_cb: (p: OcrProgress) => void): (() => void) => (): void => undefined);
  const runOcr =
    args.runOcr ??
    (async (_options: OcrRecognizeOptions): Promise<{ ok: true; suspects: OcrSuspect[] }> => ({
      ok: true,
      suspects: [],
    }));
  act((): void => {
    root.render(
      <OcrDialog
        open={true}
        totalPages={args.totalPages ?? 3}
        currentPage={args.currentPage ?? 1}
        formFields={[]}
        initialLanguage={args.initialLanguage ?? 'eng'}
        initialDownsample={args.initialDownsample ?? 300}
        onLanguageChange={args.onLanguageChange}
        onDownsampleChange={args.onDownsampleChange}
        resolveActiveDoc={resolveActiveDoc as never}
        subscribeOcrProgress={subscribeOcrProgress}
        runOcr={runOcr}
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

/** Click a radio by its data attribute. React 19 listens at the
 *  root, so a bubbling `click` reaches the synthetic onChange. */
function clickRadio(container: HTMLElement, selector: string): void {
  const radio = container.querySelector<HTMLInputElement>(selector);
  expect(radio).not.toBeNull();
  if (radio === null) return;
  const label = radio.closest('label');
  expect(label).not.toBeNull();
  if (label === null) return;
  act((): void => {
    label.click();
  });
}

describe("OcrDialog — picker (Phase 11)", () => {
  it("renders the language picker with all allowlist entries", () => {
    const { container, cleanup } = renderDialog();
    const select = container.querySelector<HTMLSelectElement>('[data-ocr-language]');
    expect(select).not.toBeNull();
    if (select === null) return cleanup();
    const codes = Array.from(select.querySelectorAll<HTMLOptionElement>('option')).map(
      (o) => o.value,
    );
    expect(codes).toEqual([
      'eng',
      'deu',
      'fra',
      'spa',
      'ita',
      'por',
      'rus',
      'chi_sim',
      'jpn',
    ]);
    cleanup();
  });

  it("re-seeds the language picker from initialLanguage", () => {
    const { container, cleanup } = renderDialog({ initialLanguage: 'fra' });
    const select = container.querySelector<HTMLSelectElement>('[data-ocr-language]');
    expect(select?.value).toBe('fra');
    cleanup();
  });

  it("switches the language and fires onLanguageChange", () => {
    const onLanguageChange = vi.fn();
    const { container, cleanup } = renderDialog({ onLanguageChange });
    const select = container.querySelector<HTMLSelectElement>('[data-ocr-language]');
    expect(select).not.toBeNull();
    if (select === null) return cleanup();
    act((): void => {
      select.value = 'jpn';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('jpn');
    expect(onLanguageChange).toHaveBeenCalledWith('jpn');
    cleanup();
  });

  it("ignores language changes outside the allowlist (defensive)", () => {
    const onLanguageChange = vi.fn();
    const { container, cleanup } = renderDialog({ onLanguageChange });
    const select = container.querySelector<HTMLSelectElement>('[data-ocr-language]');
    expect(select).not.toBeNull();
    if (select === null) return cleanup();
    // Simulate the browser pushing a synthetic change event for
    // an unrecognised code: the dialog's change handler only
    // forwards recognised values.
    const unknown = document.createElement('option');
    unknown.value = 'klingon';
    unknown.textContent = 'klingon';
    select.appendChild(unknown);
    act((): void => {
      select.value = 'klingon';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onLanguageChange).not.toHaveBeenCalledWith('klingon');
    cleanup();
  });
});

describe("OcrDialog — DPI slider (Phase 11)", () => {
  it("renders the DPI slider with the persisted value", () => {
    const { container, cleanup } = renderDialog({ initialDownsample: 450 });
    const slider = container.querySelector<HTMLInputElement>('[data-ocr-dpi]');
    expect(slider).not.toBeNull();
    expect(slider?.value).toBe('450');
    cleanup();
  });

  it("clamps a sub-minimum value to 72", () => {
    const { container, cleanup } = renderDialog({ initialDownsample: 72 });
    const slider = container.querySelector<HTMLInputElement>('[data-ocr-dpi]');
    expect(slider).not.toBeNull();
    if (slider === null) return cleanup();
    // Set the slider to a value below the minimum and dispatch a
    // change event. The dialog clamps to 72 before re-rendering.
    act((): void => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(slider, '50');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(Number.parseInt(slider.value, 10)).toBe(72);
    cleanup();
  });

  it("fires onDownsampleChange on mouse up", () => {
    const onDownsampleChange = vi.fn();
    const { container, cleanup } = renderDialog({
      initialDownsample: 300,
      onDownsampleChange,
    });
    const slider = container.querySelector<HTMLInputElement>('[data-ocr-dpi]');
    expect(slider).not.toBeNull();
    if (slider === null) return cleanup();
    // Step 1: drive the controlled input to 450 via the native
    // setter (so React's onChange sees the new value).
    act((): void => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      nativeSetter?.call(slider, '450');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Step 2: fire the mouseup that the dialog uses to surface
    // the new DPI to the host.
    act((): void => {
      slider.dispatchEvent(new Event('mouseup', { bubbles: true }));
    });
    expect(onDownsampleChange).toHaveBeenCalledWith(450);
    cleanup();
  });
});

describe("OcrDialog — scope radios (Phase 11)", () => {
  it("renders both scope radios with 'allPages' as the default", () => {
    const { container, cleanup } = renderDialog();
    const radios = container.querySelectorAll<HTMLInputElement>('input[name="ocr-scope"]');
    expect(radios.length).toBe(2);
    const allPages = container.querySelector<HTMLInputElement>('[data-ocr-scope="allPages"]');
    const currentPage = container.querySelector<HTMLInputElement>('[data-ocr-scope="currentPage"]');
    expect(allPages?.checked).toBe(true);
    expect(currentPage?.checked).toBe(false);
    cleanup();
  });

  it("switches to currentPage when the user picks it", () => {
    const { container, cleanup } = renderDialog({ currentPage: 2 });
    clickRadio(container, '[data-ocr-scope="currentPage"]');
    const currentPage = container.querySelector<HTMLInputElement>('[data-ocr-scope="currentPage"]');
    expect(currentPage?.checked).toBe(true);
    cleanup();
  });
});

describe("OcrDialog — confirm / cancel (Phase 11)", () => {
  it("confirm click fires onConfirm with the resolved page list", async () => {
    const onConfirm = vi.fn();
    const runOcr = vi.fn(
      async (_options: OcrRecognizeOptions): Promise<{ ok: true; suspects: OcrSuspect[] }> => ({
        ok: true,
        suspects: [],
      }),
    );
    const { container, cleanup } = renderDialog({
      totalPages: 3,
      currentPage: 2,
      initialLanguage: 'deu',
      initialDownsample: 200,
      runOcr,
      onConfirm,
    });
    clickRadio(container, '[data-ocr-scope="currentPage"]');
    const confirm = container.querySelector<HTMLButtonElement>('[data-ocr-confirm]');
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      // Allow the rasterize mock + runOcr stub to settle through
      // multiple microtask hops. Two awaits is enough for the
      // current dialog body to flush its promise chain.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runOcr).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
    const arg = onConfirm.mock.calls[0]?.[0] as {
      language: string;
      downsample: number;
      scope: string;
      pages: number[];
    } | undefined;
    expect(arg?.language).toBe('deu');
    expect(arg?.downsample).toBe(200);
    expect(arg?.scope).toBe('currentPage');
    expect(arg?.pages).toEqual([2]);
    cleanup();
  });

  it("renders an engine-error message when runOcr rejects", async () => {
    const runOcr = vi.fn(
      async (): Promise<{ error: string }> => ({
        error: 'OCR service is not available in this build',
      }),
    );
    const { container, cleanup } = renderDialog({ runOcr });
    const confirm = container.querySelector<HTMLButtonElement>('[data-ocr-confirm]');
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const errorBox = container.querySelector<HTMLElement>('[data-ocr-error]');
    expect(errorBox).not.toBeNull();
    expect(errorBox?.textContent).toContain('OCR service is not available');
    cleanup();
  });

  it("onClose fires when the backdrop is clicked (idle)", () => {
    // B3/B6 — a genuine outside click includes the mousedown on the
    // backdrop; a bare click() alone no longer closes (a drag that
    // started elsewhere must not).
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const backdrop = container.querySelector<HTMLElement>('.modal-backdrop');
    expect(backdrop).not.toBeNull();
    if (backdrop === null) return cleanup();
    act((): void => {
      backdrop.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
    });
    act((): void => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });

  it("renders nothing when open=false", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <OcrDialog
          open={false}
          totalPages={1}
          currentPage={1}
          formFields={[]}
          initialLanguage={'eng'}
          initialDownsample={300}
          resolveActiveDoc={(): null => null}
          subscribeOcrProgress={(): (() => void) => (): void => undefined}
          runOcr={async (): Promise<{ ok: true; suspects: OcrSuspect[] }> => ({
            ok: true,
            suspects: [],
          })}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector('.modal-dialog')).toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

describe("OcrDialog — progress subscription (Phase 11)", () => {
  it("subscribes to engine progress while running and renders the bar", async () => {
    let captured: ((p: OcrProgress) => void) | null = null;
    const subscribe = (cb: (p: OcrProgress) => void): (() => void) => {
      captured = cb;
      return (): void => undefined;
    };
    // Block the runOcr promise until the test releases it, so we
    // can observe the dialog's `running` state mid-flight. The
    // test releases the gate after asserting on the progress
    // block, then awaits the cleanup.
    let release: (() => void) | null = null;
    const runOcr = vi.fn(
      async (): Promise<{ ok: true; suspects: OcrSuspect[] }> => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { ok: true, suspects: [] };
      },
    );
    const { container, cleanup } = renderDialog({ runOcr, subscribeOcrProgress: subscribe });
    const confirm = container.querySelector<HTMLButtonElement>('[data-ocr-confirm]');
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
    });
    expect(captured).not.toBeNull();
    if (captured === null) return cleanup();
    // Drive the engine progress callback so the dialog's
    // per-page state updates. The bar is rendered only while
    // `running`, which is true right now.
    act((): void => {
      captured!({
        docId: 'd',
        page: 1,
        totalPages: 1,
        phase: 'recognizing',
      });
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
    const progressBlock = container.querySelector<HTMLElement>('[data-ocr-progress]');
    expect(progressBlock).not.toBeNull();
    const fill = container.querySelector<HTMLElement>('[data-ocr-progress-fill]');
    expect(fill).not.toBeNull();
    // Release the runOcr gate so the dialog's onConfirm fires
    // and the test cleans up cleanly.
    await act(async (): Promise<void> => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    cleanup();
  });

  it("resets the bar to zero when recognition starts and refills from engine events", async () => {
    // Pins the fix for the bar sitting at 100% while tesseract runs:
    // the rasterisation step fills the bar to its top, then the
    // dialog resets the counter before the engine run begins, and
    // the engine's per-page events refill it page by page.
    let captured: ((p: OcrProgress) => void) | null = null;
    const subscribe = (cb: (p: OcrProgress) => void): (() => void) => {
      captured = cb;
      return (): void => undefined;
    };
    // Gate the engine run so we can observe the mid-run bar state.
    let release: (() => void) | null = null;
    const runOcr = vi.fn(
      async (): Promise<{ ok: true; suspects: OcrSuspect[] }> => {
        await new Promise<void>((r) => {
          release = r;
        });
        return { ok: true, suspects: [] };
      },
    );
    const { container, cleanup } = renderDialog({
      totalPages: 3,
      runOcr,
      subscribeOcrProgress: subscribe,
    });
    const confirm = container.querySelector<HTMLButtonElement>('[data-ocr-confirm]');
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(captured).not.toBeNull();
    if (captured === null) return cleanup();
    const fillWidth = ((): string | undefined => {
      const fill = container.querySelector<HTMLElement>('[data-ocr-progress-fill]');
      return fill?.style.width;
    })();
    const percentText = ((): string => {
      const el = container.querySelector<HTMLElement>('.ocr-progress-percent');
      return el?.textContent ?? '';
    })();
    // Rasterisation of all three pages filled the bar to 100%; once
    // the engine run has started the dialog must reset it to zero
    // instead of leaving a stuck full bar during recognition.
    expect(fillWidth).toBe('0%');
    expect(percentText).toBe('0%');
    // Engine events refill the bar: page 2 in progress -> 2/3.
    act((): void => {
      captured!({ docId: 'd', page: 2, totalPages: 3, phase: 'recognizing' });
    });
    expect(container.querySelector<HTMLElement>('[data-ocr-progress-fill]')?.style.width).toBe('67%');
    // A late 'writing' event for an earlier page must not regress
    // the bar.
    act((): void => {
      captured!({ docId: 'd', page: 1, totalPages: 3, phase: 'writing' });
    });
    expect(container.querySelector<HTMLElement>('[data-ocr-progress-fill]')?.style.width).toBe('67%');
    // The final page completes the bar.
    act((): void => {
      captured!({ docId: 'd', page: 3, totalPages: 3, phase: 'writing' });
    });
    expect(container.querySelector<HTMLElement>('[data-ocr-progress-fill]')?.style.width).toBe('100%');
    await act(async (): Promise<void> => {
      release?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    cleanup();
  });
});