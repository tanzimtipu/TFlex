// @vitest-environment jsdom
//
// Phase 111 (chunk B) — the PAGES navigator's page cards.
//
// The over-preview hover verbs are gone. Each page is now a card that HUGS its
// preview (uniform 7px inset) with an overlay bar on the preview's bottom edge:
// a real checkbox + label on the left, a current-page eye icon, and a 32px More
// button on the right. The current page also carries a violet leading marker,
// distinct from the batch selection (checkbox + tint). These tests pin:
//   (a) the footer controls and the retired [data-thumb-verbs] cluster's absence,
//   (b) the checkbox toggling the host set WITHOUT navigating,
//   (c) current vs selected rendering distinct markers,
//   (d) the per-card More menu's three commands and their handlers,
//   (e) the panel More menu (Combine + separated destructive Remove blank),
//   (f) the "N selected" summary + Clear for N = 1 and N > 1,
//   (g) the two-column grid at content width >= 360px and one column below.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

const STYLES = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
);

interface PanelOptions {
  pageCount?: number;
  currentPage?: number;
  pageSelection?: readonly number[] | null;
  onPageSelectionChange?: ((pages: number[]) => void) | null;
  onJump?: (page: number) => void;
  onOp?: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }) => void;
  onExtractPages?: (page: number) => void;
  onDelete?: (pages: number[]) => void;
  onMerge?: () => void;
  onRemoveBlankPages?: () => void;
}

interface Rendered {
  host: HTMLElement;
  rerender: (next: PanelOptions) => void;
  unmount: () => void;
}

function renderPanel(options: PanelOptions = {}): Rendered {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const draw = (current: PanelOptions): void => {
    const pageCount = current.pageCount ?? 3;
    act((): void => {
      root.render(
        <ContextPanel
          stage="pages"
          doc={makeDocStub(pageCount)}
          currentPage={current.currentPage ?? 1}
          defaultWidthPt={612}
          defaultHeightPt={792}
          engineState={makeEngineState(pageCount)}
          canUndo={false}
          onJump={current.onJump ?? ((): void => undefined)}
          outline={null}
          pageSelection={current.pageSelection === undefined ? null : current.pageSelection}
          onPageSelectionChange={current.onPageSelectionChange ?? null}
          onOp={current.onOp}
          onExtractPages={current.onExtractPages}
          onDelete={current.onDelete}
          onMerge={current.onMerge}
          onRemoveBlankPages={current.onRemoveBlankPages}
        />,
      );
    });
  };

  draw(options);
  return {
    host,
    rerender: (next: PanelOptions): void => draw(next),
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function thumb(host: HTMLElement, page: number): HTMLElement {
  const el = host.querySelector<HTMLElement>(`.thumb-item[data-page="${page}"]`);
  if (el === null) throw new Error(`no thumb for page ${page}`);
  return el;
}

function clickOn(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

beforeEach((): void => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((): CanvasRenderingContext2D =>
      ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D),
  );
});

afterEach((): void => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  vi.restoreAllMocks();
});

describe("Phase 111 chunk B — the page card footer", () => {
  it("renders a checkbox, a label and a 32px More button, and drops the over-preview verbs", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      const card = thumb(host, 1);
      // The retired inline verb cluster is GONE.
      expect(card.querySelector("[data-thumb-verbs]")).toBeNull();
      expect(card.querySelector("[data-thumb-verb]")).toBeNull();
      // The footer: checkbox + label on the left, More on the right.
      const box = card.querySelector("[data-thumb-checkbox]");
      expect(box?.tagName).toBe("INPUT");
      expect(box?.getAttribute("type")).toBe("checkbox");
      expect(card.querySelector(".thumb-label")?.textContent).toBe("1");
      const more = card.querySelector("[data-thumb-more]");
      expect(more).not.toBeNull();
      expect(more?.classList.contains("thumb-more")).toBe(true);
      // The 32px target, enlarged to 44px under coarse pointers, is CSS-owned.
      expect(STYLES).toMatch(/\.thumb-more\s*\{[^}]*width:\s*32px/);
      expect(STYLES).toMatch(
        /@media \(pointer: coarse\)\s*\{[\s\S]*?\.thumb-more\s*\{[^}]*width:\s*44px/,
      );
    } finally {
      unmount();
    }
  });

  it("toggles the host set on a checkbox change without navigating", () => {
    const onPageSelectionChange = vi.fn();
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({
      pageCount: 3,
      pageSelection: [],
      onPageSelectionChange,
      onJump,
    });
    try {
      const box = thumb(host, 2).querySelector<HTMLInputElement>("[data-thumb-checkbox]");
      expect(box).not.toBeNull();
      clickOn(box as HTMLInputElement);
      expect(onPageSelectionChange).toHaveBeenCalledTimes(1);
      expect(onPageSelectionChange).toHaveBeenCalledWith([2]);
      // The checkbox must NOT bubble into the card's navigate click.
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("shows a removed page dropping out of the set (checkbox uncheck)", () => {
    const onPageSelectionChange = vi.fn();
    const { host, unmount } = renderPanel({
      pageCount: 3,
      pageSelection: [2],
      onPageSelectionChange,
    });
    try {
      const box = thumb(host, 2).querySelector<HTMLInputElement>("[data-thumb-checkbox]");
      expect(box?.checked).toBe(true);
      clickOn(box as HTMLInputElement);
      expect(onPageSelectionChange).toHaveBeenCalledWith([]);
    } finally {
      unmount();
    }
  });

  it("renders current and selected as DISTINCT markers", () => {
    const noop = (): void => undefined;
    const { host, unmount } = renderPanel({
      pageCount: 3,
      currentPage: 2,
      pageSelection: [3],
      onPageSelectionChange: noop,
    });
    try {
      const current = thumb(host, 2);
      expect(current.classList.contains("thumb-current")).toBe(true);
      expect(current.querySelector("[data-thumb-current-marker]")).not.toBeNull();
      // TFL-1465 — the current row shows an eye ICON, not the old "Viewing" text.
      const viewing = current.querySelector("[data-thumb-viewing]");
      expect(viewing).not.toBeNull();
      expect(viewing?.querySelector("svg")).not.toBeNull();
      expect(viewing?.textContent).not.toContain("Viewing");
      expect(viewing?.getAttribute("aria-label")).toBe("Currently viewing");
      expect(
        current.querySelector<HTMLInputElement>("[data-thumb-checkbox]")?.checked,
      ).toBe(false);
      expect(current.classList.contains("thumb-selected")).toBe(false);

      const selected = thumb(host, 3);
      expect(selected.classList.contains("thumb-selected")).toBe(true);
      expect(selected.querySelector<HTMLInputElement>("[data-thumb-checkbox]")?.checked).toBe(true);
      expect(selected.querySelector("[data-thumb-current-marker]")).toBeNull();
      expect(selected.querySelector("[data-thumb-viewing]")).toBeNull();

      // A page can be BOTH current and selected.
      const both = renderPanel({
        pageCount: 3,
        currentPage: 2,
        pageSelection: [2],
        onPageSelectionChange: noop,
      });
      try {
        const card = thumb(both.host, 2);
        expect(card.querySelector("[data-thumb-current-marker]")).not.toBeNull();
        expect(card.classList.contains("thumb-selected")).toBe(true);
      } finally {
        both.unmount();
      }
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 chunk B — the per-card More menu", () => {
  function openCardMore(host: HTMLElement, page: number): void {
    const more = thumb(host, page).querySelector<HTMLButtonElement>("[data-thumb-more]");
    if (more === null) throw new Error(`no More button on page ${page}`);
    clickOn(more);
  }

  it("offers Rotate CW / Extract this page / Delete this page", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      openCardMore(host, 2);
      const labels = [...host.querySelectorAll("[data-menu-item]")].map((el) => ({
        id: el.getAttribute("data-menu-item"),
        text: el.textContent,
      }));
      expect(labels.map((l) => l.id)).toEqual(["rotate-cw", "extract", "delete"]);
      expect(labels.find((l) => l.id === "rotate-cw")?.text).toContain("Rotate CW");
      expect(labels.find((l) => l.id === "extract")?.text).toContain("Extract this page");
      expect(labels.find((l) => l.id === "delete")?.text).toContain("Delete this page");
      // Delete is separated and danger-styled.
      const del = host.querySelector('[data-menu-item="delete"]');
      expect(del?.classList.contains("context-menu-item-danger")).toBe(true);
      expect(del?.getAttribute("data-menu-variant")).toBe("danger");
    } finally {
      unmount();
    }
  });

  it("runs the matching handler for each command on the card's own page", () => {
    const onOp = vi.fn();
    const onExtractPages = vi.fn();
    const onDelete = vi.fn();
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 4, onOp, onExtractPages, onDelete, onJump });
    try {
      openCardMore(host, 2);
      clickOn(host.querySelector('[data-menu-item="rotate-cw"]') as HTMLElement);
      expect(onOp).toHaveBeenCalledWith({ kind: "rotate", page: 2, dir: "cw" });

      openCardMore(host, 3);
      clickOn(host.querySelector('[data-menu-item="extract"]') as HTMLElement);
      expect(onExtractPages).toHaveBeenCalledWith(3);

      openCardMore(host, 4);
      clickOn(host.querySelector('[data-menu-item="delete"]') as HTMLElement);
      expect(onDelete).toHaveBeenCalledWith([4]);

      // Opening a card menu never navigates.
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});

describe("Phase 124 — the panel header tool buttons", () => {
  it("renders Combine and Remove blank pages as direct header buttons", () => {
    const onMerge = vi.fn();
    const onRemoveBlankPages = vi.fn();
    const { host, unmount } = renderPanel({ pageCount: 3, onMerge, onRemoveBlankPages });
    try {
      const combine = host.querySelector<HTMLButtonElement>("[data-context-panel-combine]");
      const blank = host.querySelector<HTMLButtonElement>("[data-blank-scan-open]");
      expect(combine).not.toBeNull();
      expect(blank).not.toBeNull();
      expect(combine?.getAttribute("aria-label")).toBe("Combine with another PDF");
      expect(blank?.getAttribute("aria-label")).toBe("Remove blank pages");

      clickOn(combine as HTMLElement);
      expect(onMerge).toHaveBeenCalledTimes(1);

      clickOn(blank as HTMLElement);
      expect(onRemoveBlankPages).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("omits Combine and Remove blank pages when the host does not wire them", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      expect(host.querySelector("[data-context-panel-combine]")).toBeNull();
      expect(host.querySelector("[data-blank-scan-open]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 chunk B — the selection summary", () => {
  it('shows "N selected" with a Clear control for N = 1 and N > 1', () => {
    const one = renderPanel({ pageCount: 4, pageSelection: [2] });
    try {
      const section = one.host.querySelector("[data-context-panel-selection]");
      expect(section).not.toBeNull();
      expect(
        section?.querySelector("[data-context-panel-selection-count]")?.textContent,
      ).toContain("1 selected");
    } finally {
      one.unmount();
    }

    const many = renderPanel({ pageCount: 4, pageSelection: [2, 3, 4] });
    try {
      expect(
        many.host.querySelector("[data-context-panel-selection-count]")?.textContent,
      ).toContain("3 selected");
      expect(
        many.host.querySelector("[data-context-panel-selection-range]")?.textContent,
      ).toContain("Pages 2-4");
    } finally {
      many.unmount();
    }

    const none = renderPanel({ pageCount: 4, pageSelection: [] });
    try {
      expect(none.host.querySelector("[data-context-panel-selection]")).toBeNull();
    } finally {
      none.unmount();
    }
  });

  it("clears through the host path without navigating", () => {
    const onPageSelectionChange = vi.fn();
    const onJump = vi.fn();
    const { host, unmount } = renderPanel({
      pageCount: 4,
      pageSelection: [2, 3],
      onPageSelectionChange,
      onJump,
    });
    try {
      const clear = host.querySelector<HTMLButtonElement>("[data-context-panel-selection-clear]");
      expect(clear).not.toBeNull();
      clickOn(clear as HTMLButtonElement);
      expect(onPageSelectionChange).toHaveBeenCalledWith([]);
      expect(onJump).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});

describe("Phase 111 chunk B — the two-column card grid", () => {
  function mockWidth(width: number): void {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => width,
    });
  }

  it("applies two columns at content width >= 360px and one column below", () => {
    mockWidth(400);
    const wide = renderPanel({ pageCount: 4 });
    try {
      const inner = wide.host.querySelector(".thumb-scroller-inner");
      expect(inner?.classList.contains("thumb-scroller-inner--two-col")).toBe(true);
      expect(inner?.getAttribute("data-thumb-columns")).toBe("2");
    } finally {
      wide.unmount();
    }

    mockWidth(300);
    const narrow = renderPanel({ pageCount: 4 });
    try {
      const inner = narrow.host.querySelector(".thumb-scroller-inner");
      expect(inner?.classList.contains("thumb-scroller-inner--two-col")).toBe(false);
      expect(inner?.getAttribute("data-thumb-columns")).toBe("1");
    } finally {
      narrow.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 111 (chunk G / DEF-612) — the CURRENT page card must be NEUTRAL.
//
// The current-vs-selected DOM state is already separate (test above). The paint
// was the defect: `.thumb-current` still carried the shared 0.10 selected wash
// (`--accent-selected`) plus the 1.5px accent ring, i.e. the SAME treatment as
// `.thumb-selected`, so a user could not tell the two apart. This is a static
// CSS guard reading the source (like bug014_saveIconAccent) so the selected
// treatment can never be re-applied to the current card unnoticed.

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") return extractRuleBody(stripped, idx);
    from = idx + selector.length;
  }
}

describe("Phase 111 (chunk G / DEF-612) — the current card is neutral", () => {
  it(".thumb-current paints no selected wash and no accent ring", () => {
    const body = findRuleBody(STYLES, ".thumb-current");
    expect(body).not.toBeNull();
    expect(body ?? "").not.toMatch(/--accent-selected/);
    expect(body ?? "").not.toMatch(/background\s*:\s*var\(--accent/);
    expect(body ?? "").not.toMatch(/box-shadow/);
    expect(body ?? "").not.toMatch(/var\(--accent\)/);
  });

  it("frosted declares no .thumb-current override that re-adds the selection wash", () => {
    // DEF-612 also lived in the frosted override (`--glass-selected-bg` wash +
    // two accent rings); current is neutral in every theme now.
    const frosted = findRuleBody(STYLES, ':root[data-theme="frosted"] .thumb-current');
    expect(frosted).toBeNull();
  });

  it("keeps the current-only leading marker and eye indicator as the sole affordances", () => {
    expect(STYLES).toMatch(/\.thumb-current-marker\s*\{[^}]*background:\s*var\(--accent\)/);
    expect(STYLES).toMatch(/\.thumb-viewing\s*\{[^}]*color:\s*var\(--accent\)/);
  });
});

// ---------------------------------------------------------------------------
// TFL-1465 — the page card HUGS its preview (uniform inset), the controls sit on
// the preview's bottom edge as an overlay bar, and the current indicator is an
// eye icon (not the retired "Viewing" text).

describe("TFL-1465 — thumbnail card: uniform inset, bottom overlay, eye icon", () => {
  it("card mode hugs the preview with a .thumb-card class", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      expect(thumb(host, 1).classList.contains("thumb-card")).toBe(true);
    } finally {
      unmount();
    }
  });

  it("renders the controls in an overlay SIBLING of the preview button", () => {
    const { host, unmount } = renderPanel({ pageCount: 3 });
    try {
      const card = thumb(host, 1);
      const page = card.querySelector(".thumb-page");
      const overlay = card.querySelector("[data-thumb-overlay]");
      expect(page).not.toBeNull();
      expect(overlay).not.toBeNull();
      // The overlay is the preview button's sibling, never nested inside it.
      expect(page?.contains(overlay as Node)).toBe(false);
      // The row carries the checkbox, label and More on the preview bottom.
      expect(overlay?.querySelector("[data-thumb-checkbox]")).not.toBeNull();
      expect(overlay?.querySelector(".thumb-label")?.textContent).toBe("1");
      expect(overlay?.querySelector("[data-thumb-more]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("hugs via CSS (fit-content) and anchors the overlay to the preview bottom", () => {
    const cardBody = findRuleBody(STYLES, ".thumb.thumb-card");
    expect(cardBody).not.toBeNull();
    expect(cardBody ?? "").toMatch(/width:\s*fit-content/);

    const overlayBody = findRuleBody(STYLES, ".thumb-overlay");
    expect(overlayBody).not.toBeNull();
    expect(overlayBody ?? "").toMatch(/position:\s*absolute/);
    expect(overlayBody ?? "").toMatch(/bottom:\s*6px/);
  });
});