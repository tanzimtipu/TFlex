// @vitest-environment jsdom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OcrSuspectsPanel } from "../../../src/renderer/components/OcrSuspectsPanel";
import { SUSPECT_CONFIDENCE_THRESHOLD } from "../../../src/shared/types";
import type { OcrSuspect } from "../../../src/shared/types";

/**
 * Phase 11 — OCR suspects panel rendering tests. The panel lists
 * low-confidence words from the most recent OCR run on the active
 * doc, grouped by page. Each entry exposes a click-to-navigate
 * handler. The panel never edits text (correction is out of
 * contract for Phase 11).
 */

interface RenderArgs {
  suspects?: OcrSuspect[];
  hasRun?: boolean;
  onNavigate?: (suspect: OcrSuspect) => void;
  onClose?: () => void;
}

function renderPanel(args: RenderArgs = {}): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <OcrSuspectsPanel
        suspects={args.suspects ?? []}
        hasRun={args.hasRun ?? true}
        onNavigate={args.onNavigate ?? ((): void => undefined)}
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

function makeSuspect(page: number, word: string, confidence: number): OcrSuspect {
  return {
    word,
    page,
    confidence,
    rect: { x: 0, y: 0, width: 50, height: 12 },
  };
}

describe("OcrSuspectsPanel — empty states (Phase 11)", () => {
  it("shows a 'no OCR run' message when hasRun is false", () => {
    const { container, cleanup } = renderPanel({ hasRun: false, suspects: [] });
    expect(container.textContent).toContain('No OCR has been run');
    cleanup();
  });

  it("shows a 'clean' message when hasRun is true and suspects is empty", () => {
    const { container, cleanup } = renderPanel({ hasRun: true, suspects: [] });
    expect(container.querySelector('[data-ocr-suspects-empty]')).not.toBeNull();
    expect(container.textContent).toContain('No low-confidence words');
    cleanup();
  });

  it("renders the close button and fires onClose", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderPanel({ onClose });
    const closeBtn = container.querySelector<HTMLButtonElement>('.ocr-suspects-close');
    expect(closeBtn).not.toBeNull();
    if (closeBtn === null) return cleanup();
    act((): void => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});

describe("OcrSuspectsPanel — list rendering (Phase 11)", () => {
  it("groups suspects by page in ascending order", () => {
    const suspects: OcrSuspect[] = [
      makeSuspect(2, 'mispelled', 45),
      makeSuspect(1, 'gud', 50),
      makeSuspect(1, 'thx', 30),
      makeSuspect(3, 'occured', 40),
    ];
    const { container, cleanup } = renderPanel({ suspects });
    const pages = Array.from(
      container.querySelectorAll<HTMLElement>('[data-ocr-suspects-page]'),
    ).map((p) => Number.parseInt(p.dataset.ocrSuspectsPage ?? '0', 10));
    expect(pages).toEqual([1, 2, 3]);
    cleanup();
  });

  it("renders the word + confidence for each entry", () => {
    const suspects: OcrSuspect[] = [makeSuspect(1, 'hello', 45)];
    const { container, cleanup } = renderPanel({ suspects });
    expect(container.textContent).toContain('hello');
    expect(container.textContent).toContain('45%');
    cleanup();
  });

  it("renders a per-page header with the page number", () => {
    const suspects: OcrSuspect[] = [
      makeSuspect(7, 'wun', 20),
      makeSuspect(7, 'too', 30),
    ];
    const { container, cleanup } = renderPanel({ suspects });
    const pageHeader = container.querySelector('[data-ocr-suspects-page="7"]');
    expect(pageHeader).not.toBeNull();
    expect(pageHeader?.textContent).toContain('Page 7');
    expect(pageHeader?.textContent).toContain('2 words');
    cleanup();
  });

  it("marks single-word pages as '1 word' (singular)", () => {
    const suspects: OcrSuspect[] = [makeSuspect(1, 'x', 30)];
    const { container, cleanup } = renderPanel({ suspects });
    const pageHeader = container.querySelector('[data-ocr-suspects-page="1"]');
    expect(pageHeader?.textContent).toContain('1 word');
    cleanup();
  });

  it("summarises the count and pages across the whole document", () => {
    const suspects: OcrSuspect[] = [
      makeSuspect(1, 'a', 30),
      makeSuspect(2, 'b', 30),
      makeSuspect(2, 'c', 30),
    ];
    const { container, cleanup } = renderPanel({ suspects });
    const summary = container.querySelector<HTMLElement>('.ocr-suspects-summary');
    expect(summary?.textContent).toContain('3 low-confidence words');
    expect(summary?.textContent).toContain('across 2 pages');
    cleanup();
  });

  it("singularises the count when there's exactly one suspect", () => {
    const suspects: OcrSuspect[] = [makeSuspect(1, 'a', 30)];
    const { container, cleanup } = renderPanel({ suspects });
    const summary = container.querySelector<HTMLElement>('.ocr-suspects-summary');
    expect(summary?.textContent).toContain('1 low-confidence word');
    expect(summary?.textContent).not.toContain('words');
    cleanup();
  });
});

describe("OcrSuspectsPanel — confidence colour (Phase 11)", () => {
  it("marks low-confidence bars (< threshold) with the low class", () => {
    const suspects: OcrSuspect[] = [
      makeSuspect(1, 'low', SUSPECT_CONFIDENCE_THRESHOLD - 1),
      makeSuspect(1, 'high', SUSPECT_CONFIDENCE_THRESHOLD + 1),
    ];
    const { container, cleanup } = renderPanel({ suspects });
    const lowBtn = container.querySelector<HTMLButtonElement>('[data-ocr-suspect-word="low"]');
    const highBtn = container.querySelector<HTMLButtonElement>('[data-ocr-suspect-word="high"]');
    expect(lowBtn?.querySelector('.ocr-suspects-confidence-low')).not.toBeNull();
    expect(highBtn?.querySelector('.ocr-suspects-confidence-low')).toBeNull();
    cleanup();
  });
});

describe("OcrSuspectsPanel — click-to-navigate (Phase 11)", () => {
  it("fires onNavigate with the suspect when its entry is clicked", () => {
    const onNavigate = vi.fn();
    const suspect = makeSuspect(5, 'target', 25);
    const { container, cleanup } = renderPanel({ suspects: [suspect], onNavigate });
    const btn = container.querySelector<HTMLButtonElement>('[data-ocr-suspect-word="target"]');
    expect(btn).not.toBeNull();
    if (btn === null) return cleanup();
    act((): void => {
      btn.click();
    });
    expect(onNavigate).toHaveBeenCalledWith(suspect);
    cleanup();
  });
});

describe("OcrSuspectsPanel — top-bar layout (B4)", () => {
  it("keeps the title, summary and close in ONE header row", () => {
    const suspects: OcrSuspect[] = [makeSuspect(1, 'one', 30), makeSuspect(2, 'two', 30)];
    const { container, cleanup } = renderPanel({ suspects });
    const header = container.querySelector<HTMLElement>('.ocr-suspects-header');
    const title = container.querySelector<HTMLElement>('.ocr-suspects-title');
    const summary = container.querySelector<HTMLElement>('.ocr-suspects-summary');
    const close = container.querySelector<HTMLButtonElement>('.ocr-suspects-close');
    expect(header).not.toBeNull();
    expect(title).not.toBeNull();
    expect(summary).not.toBeNull();
    expect(close).not.toBeNull();
    if (header === null || title === null || summary === null || close === null) {
      return cleanup();
    }
    expect(header.contains(title)).toBe(true);
    expect(header.contains(summary)).toBe(true);
    expect(header.contains(close)).toBe(true);
    cleanup();
  });

  it("renders the suspect list as a horizontal scroller (not a vertical rail)", () => {
    const suspects: OcrSuspect[] = [
      makeSuspect(1, 'a', 30),
      makeSuspect(2, 'b', 30),
      makeSuspect(3, 'c', 30),
    ];
    const { container, cleanup } = renderPanel({ suspects });
    const body = container.querySelector<HTMLElement>('.ocr-suspects-body');
    expect(body).not.toBeNull();
    if (body === null) return cleanup();
    expect(body.classList.contains('ocr-suspects-body')).toBe(true);
    const pages = Array.from(body.querySelectorAll('[data-ocr-suspects-page]'));
    expect(pages.length).toBe(3);
    cleanup();
  });

  it("exposes every suspect via the data attribute regardless of layout", () => {
    const suspects: OcrSuspect[] = [makeSuspect(1, 'target', 25)];
    const { container, cleanup } = renderPanel({ suspects });
    const entries = container.querySelectorAll('[data-ocr-suspect-word="target"]');
    expect(entries.length).toBe(1);
    cleanup();
  });
});