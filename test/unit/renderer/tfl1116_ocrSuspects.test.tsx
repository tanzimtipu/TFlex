// @vitest-environment jsdom
//
// TFL-1116 C12 (R18 + R19) — the OCR suspects review surface.
//
// R18: page grouping + count badge, stable word / confidence columns, a visible
// selected row, a truthful navigation-only label, and navigation that carries
// the engine's REAL page + word bounds (not a guessed target).
// R19: a large suspect list mounts a bounded window, not every row.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OcrSuspectsPanel } from "../../../src/renderer/components/OcrSuspectsPanel";
import { OCR_SUSPECT_WINDOW_THRESHOLD } from "../../../src/renderer/components/ocrSuspectsModel";
import type { OcrSuspect } from "../../../src/shared/types";

interface RenderArgs {
  suspects?: OcrSuspect[];
  hasRun?: boolean;
  onNavigate?: (suspect: OcrSuspect) => void;
  onClose?: () => void;
  layout?: "bar" | "inspector";
}

function renderPanel(args: RenderArgs = {}): {
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(
      <OcrSuspectsPanel
        suspects={args.suspects ?? []}
        hasRun={args.hasRun ?? true}
        onNavigate={args.onNavigate ?? ((): void => undefined)}
        onClose={args.onClose ?? ((): void => undefined)}
        layout={args.layout ?? "inspector"}
      />,
    );
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function makeSuspect(
  page: number,
  word: string,
  confidence: number,
  rect: OcrSuspect["rect"] = { x: 0, y: 0, width: 50, height: 12 },
): OcrSuspect {
  return { word, page, confidence, rect };
}

describe("TFL-1116 R18 — OCR suspects review hierarchy", () => {
  it("groups by page in ascending order and shows the document count badge", () => {
    const suspects = [
      makeSuspect(3, "occured", 40),
      makeSuspect(1, "gud", 50),
      makeSuspect(1, "thx", 30),
      makeSuspect(2, "mispelled", 45),
    ];
    const { container, cleanup } = renderPanel({ suspects });
    const pages = Array.from(
      container.querySelectorAll<HTMLElement>("[data-ocr-suspects-page]"),
    ).map((p) => Number.parseInt(p.dataset.ocrSuspectsPage ?? "0", 10));
    expect(pages).toEqual([1, 2, 3]);
    const badge = container.querySelector<HTMLElement>("[data-ocr-suspect-count]");
    expect(badge).not.toBeNull();
    expect(badge?.dataset.ocrSuspectCount).toBe("4");
    expect(badge?.textContent).toContain("4");
    expect(badge?.textContent).toContain("low-confidence words");
    cleanup();
  });

  it("renders stable Word / Confidence columns with the word and percentage aligned", () => {
    const suspects = [makeSuspect(1, "hello", 45)];
    const { container, cleanup } = renderPanel({ suspects });
    const columns = container.querySelector<HTMLElement>("[data-ocr-suspects-columns]");
    expect(columns).not.toBeNull();
    expect(columns?.textContent).toContain("Word");
    expect(columns?.textContent).toContain("Confidence");
    const word = container.querySelector(".ocr-suspects-word");
    const label = container.querySelector(".ocr-suspects-confidence-label");
    expect(word?.textContent).toBe("hello");
    expect(label?.textContent).toBe("45%");
    cleanup();
  });

  it("labels the surface navigation-only (no correction the engine cannot honour)", () => {
    const { container, cleanup } = renderPanel({ suspects: [makeSuspect(1, "x", 30)] });
    const note = container.querySelector<HTMLElement>("[data-ocr-suspects-navigation-only]");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("Navigation only");
    cleanup();
  });

  it("keeps the navigated-to row visibly selected after a click", () => {
    const suspects = [
      makeSuspect(1, "first", 30),
      makeSuspect(1, "second", 35),
      makeSuspect(2, "third", 40),
    ];
    const onNavigate = vi.fn();
    const { container, cleanup } = renderPanel({ suspects, onNavigate });
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-ocr-suspect-word="second"]',
    );
    expect(btn).not.toBeNull();
    if (btn === null) return cleanup();
    act((): void => {
      btn.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    const selected = container.querySelectorAll('[data-ocr-suspect-selected="true"]');
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toContain("second");
    expect(selected[0].className).toContain("ocr-suspects-entry-selected");
    cleanup();
  });

  it("navigates with the suspect's REAL page and word bounds", () => {
    const suspect = makeSuspect(3, "target", 25, { x: 10, y: 20, width: 30, height: 12 });
    const onNavigate = vi.fn();
    const { container, cleanup } = renderPanel({ suspects: [suspect], onNavigate });
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-ocr-suspect-word="target"]',
    );
    expect(btn).not.toBeNull();
    if (btn === null) return cleanup();
    expect(btn.dataset.ocrSuspectPage).toBe("3");
    expect(btn.dataset.ocrSuspectBounds).toBe("10,20,30,12");
    act((): void => {
      btn.click();
    });
    expect(onNavigate).toHaveBeenCalledWith(suspect);
    cleanup();
  });
});

describe("TFL-1116 R19 — bounded rendering", () => {
  it("mounts a window (not every row) for a large suspect list", () => {
    const total = OCR_SUSPECT_WINDOW_THRESHOLD * 5;
    const suspects = Array.from({ length: total }, (_, i) =>
      makeSuspect(1, `word${i}`, 30 + (i % 40)),
    );
    const { container, cleanup } = renderPanel({ suspects });
    const windowEl = container.querySelector<HTMLElement>("[data-ocr-suspects-window]");
    expect(windowEl).not.toBeNull();
    expect(windowEl?.getAttribute("role")).toBe("listbox");
    const mounted = container.querySelectorAll("[data-ocr-suspect-word]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(60);
    expect(mounted).toBeLessThan(total);
    // Page grouping survives the window.
    expect(container.querySelectorAll("[data-ocr-suspects-page]").length).toBeGreaterThan(0);
    cleanup();
  });

  it("keeps the grouped, all-mount DOM for a small list", () => {
    const suspects = [makeSuspect(1, "only", 30), makeSuspect(2, "two", 30)];
    const { container, cleanup } = renderPanel({ suspects });
    expect(container.querySelector("[data-ocr-suspects-window]")).toBeNull();
    expect(container.querySelectorAll("[data-ocr-suspect-word]").length).toBe(2);
    cleanup();
  });
});
