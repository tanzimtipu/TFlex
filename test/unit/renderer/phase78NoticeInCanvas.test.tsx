// @vitest-environment jsdom
//
// Phase 78 (features A/B/C) — the open-triggered notice family
// (`ProtectionNotice` / `ConversionNotice` / `Pdf3dNotice`) must mount INSIDE
// the canvas-bound overlay (`[data-canvas-overlay]`), never as flow children
// of `.document-column`, and the Book View entry must keep its stable
// `data-book-view-open` / `aria-label="Book View"` hooks in the new canvas
// top-right cluster. jsdom applies no stylesheet, so the placement / morph
// contract is pinned with the established textual CSS scan, while the
// re-parenting plumbing is asserted against the rendered DOM (the
// `DocumentSurfaceColumn` -> `canvasNotices` prop path). The real canvas
// geometry is left to qa's e2e.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

// `DocumentSurfaceColumn` lives in App.tsx; stub the modules App's import
// graph would otherwise drag into jsdom (the same harness as
// readingView.test.tsx). The column itself touches none of them.
vi.mock("../../../src/renderer/components/DocumentView", () => ({
  DocumentView: (): unknown => null,
}));
vi.mock("../../../src/renderer/pdf/pdfjs", () => ({
  openPdfDocument: async (): Promise<unknown> => ({
    doc: {
      numPages: 1,
      getPage: async (): Promise<unknown> => ({}),
      destroy: async (): Promise<unknown> => undefined,
    },
  }),
  readOutline: async (): Promise<null> => null,
}));
vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: async (): Promise<unknown[]> => [],
}));

import { DocumentSurfaceColumn } from "../../../src/renderer/App";
import { ProtectionNotice } from "../../../src/renderer/components/ProtectionNotice";
import { ConversionNotice } from "../../../src/renderer/components/ConversionNotice";
import { Pdf3dNotice } from "../../../src/renderer/components/Pdf3dNotice";
import type {
  DocumentProtectionState,
  Pdf3dContent,
} from "../../../src/shared/types";
import type { ConvertNoticeState } from "../../../src/renderer/state/convert";
import { NOTICE_AUTO_COLLAPSE_MS } from "../../../src/renderer/hooks/useNoticeCollapse";
import { MOTION_DURATION } from "../../../src/renderer/hooks/motionTokens";
import { setAnimationsEnabledPreference } from "../../../src/renderer/hooks/motionPolicy";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const DOC_VIEW_SRC = readFileSync(
  resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
  "utf8",
);

/** The body of the first rule whose selector LIST contains `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*[^{}]*?${escaped}[^{}]*\\{([^}]*)\\}`, "s");
  return CSS.match(re)?.[1] ?? "";
}

const PROTECTION: DocumentProtectionState = {
  encrypted: true,
  v: 5,
  r: 6,
  cfm: "AESV3",
  algorithm: "AES-256",
  permissions: {
    print: false,
    highResPrint: false,
    copy: true,
    accessibleCopy: true,
    modify: false,
    comment: false,
    assemble: false,
    fillForms: true,
  },
};

const CONVERSION: ConvertNoticeState = {
  sourceLabel: "Text document",
  sourceFormat: "text",
  fidelity: "layout",
  warnings: [],
};

const PDF3D: readonly Pdf3dContent[] = [{ page: 2, name: "Turbine" }];

/** Stands in for the real DocumentView: it consumes the re-parenting prop and
 *  mounts the notice layer INSIDE a `[data-canvas-overlay]` element, which is
 *  exactly the DocumentView contract (`canvasNotices` rendered in
 *  `.canvas-overlay`). */
function StubDocument({
  canvasNotices,
}: {
  canvasNotices?: ReactNode;
}): ReactElement {
  return createElement(
    "div",
    { className: "stub-document", "data-canvas-overlay": true },
    canvasNotices,
  );
}

function mount(column: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(column);
  });
  return {
    host,
    root,
    cleanup(): void {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Flush the icon-first entrance hand-off under virtual time: frame one
 *  commits/paints the collapsed "i", frame two mounts the expanded box. Two
 *  `advanceTimersToNextFrame`s inside `act` mirror the double rAF exactly. */
function flushEnterFrames(): void {
  act((): void => {
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
  });
}

function renderColumn(): ReturnType<typeof mount> {
  return mount(
    createElement(DocumentSurfaceColumn, {
      document: createElement(StubDocument),
      sourceFormat: undefined,
      conversion: CONVERSION,
      validation: undefined,
      protection: PROTECTION,
      pdf3d: PDF3D,
      onDismissConversion: (): void => undefined,
      onDismissValidation: (): void => undefined,
      onDismissProtection: (): void => undefined,
      onOpenReadingView: (): void => undefined,
      onOpenComicView: (): void => undefined,
    }),
  );
}

describe("phase 78 — the notice family mounts inside the canvas overlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAnimationsEnabledPreference(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    setAnimationsEnabledPreference(true);
  });

  it("renders each expanded box inside [data-canvas-overlay], not in .document-column", () => {
    const view = renderColumn();
    try {
      flushEnterFrames();
      const overlay = view.host.querySelector("[data-canvas-overlay]");
      expect(overlay).not.toBeNull();
      for (const hook of [
        "[data-protection-notice]",
        "[data-conversion-notice]",
        "[data-pdf3d-notice]",
      ]) {
        const node = view.host.querySelector(hook);
        expect(node, hook).not.toBeNull();
        expect(
          overlay?.contains(node),
          `${hook} must be a descendant of data-canvas-overlay`,
        ).toBe(true);
        expect(
          view.host.querySelector(`.document-column > ${hook}`),
          `${hook} must not be a direct child of .document-column`,
        ).toBeNull();
      }
    } finally {
      view.cleanup();
    }
  });

  it("collapses each notice into its 'i' icon inside the overlay", () => {
    const view = renderColumn();
    try {
      flushEnterFrames();
      act((): void => {
        vi.advanceTimersByTime(NOTICE_AUTO_COLLAPSE_MS);
      });
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      const overlay = view.host.querySelector("[data-canvas-overlay]");
      for (const hook of [
        "[data-protection-icon]",
        "[data-conversion-icon]",
        "[data-pdf3d-icon]",
      ]) {
        const icon = view.host.querySelector(hook);
        expect(icon, hook).not.toBeNull();
        expect(
          overlay?.contains(icon),
          `${hook} must be a descendant of data-canvas-overlay`,
        ).toBe(true);
        expect(
          view.host.querySelector(`.document-column > ${hook}`),
        ).toBeNull();
      }
    } finally {
      view.cleanup();
    }
  });
});

describe("phase 78 — DocumentView renders the notice layer inside .canvas-overlay", () => {
  it("mounts canvasNotices in the canvas overlay and keeps the Book View hooks", () => {
    const layerStart = DOC_VIEW_SRC.indexOf('className="canvas-overlay"');
    const noticesAt = DOC_VIEW_SRC.indexOf("{canvasNotices}");
    expect(layerStart).toBeGreaterThan(-1);
    expect(noticesAt).toBeGreaterThan(layerStart);
    expect(DOC_VIEW_SRC).toContain('className="canvas-top-right"');
    expect(DOC_VIEW_SRC).toContain('className="canvas-notices"');
    expect(DOC_VIEW_SRC).toMatch(/data-book-view-open/);
    expect(DOC_VIEW_SRC).toMatch(/aria-label="Book View"/);
  });
});

describe("phase 78 — the in-canvas placement CSS contract", () => {
  it("anchors the cluster at the canvas top-right and keeps it pointer-inert", () => {
    const cluster = ruleBody(".canvas-top-right");
    expect(cluster).toMatch(/position:\s*absolute/);
    expect(cluster).toMatch(/right:\s*12px/);
    expect(cluster).toMatch(/top:\s*calc\(var\(--tf-chrome-y,\s*0px\)\s*\+\s*12px\)/);
    expect(cluster).toMatch(/pointer-events:\s*none/);
    expect(cluster).toMatch(/gap:\s*8px/);
  });

  it("flows Book View and the page-layout control inside the cluster", () => {
    expect(ruleBody(".canvas-top-right .canvas-book-view")).toMatch(
      /position:\s*static/,
    );
    expect(ruleBody(".canvas-top-right .canvas-page-layout")).toMatch(
      /position:\s*static/,
    );
    expect(ruleBody(".canvas-book-view")).not.toMatch(/left:\s*12px/);
  });

  it("renders the expanded box as a translucent rounded surface inside the canvas", () => {
    const box = ruleBody(".canvas-top-right .protection-notice");
    expect(box).toMatch(/position:\s*static/);
    expect(box).toMatch(/flex:\s*0 0 100%/);
    expect(box).toMatch(/border-radius:\s*var\(--radius-3\)/);
    expect(box).toMatch(/background:\s*var\(--bg-elevated\)/);
    expect(box).toMatch(/backdrop-filter:\s*var\(--glass-blur\)/);
    expect(box).toMatch(/pointer-events:\s*auto/);
    expect(
      ruleBody(".canvas-notices .protection-notice-collapsed-toggle"),
    ).toMatch(/pointer-events:\s*auto/);
  });

  it("stacks concurrent expanded boxes as wrapped full-width rows (DEF-464)", () => {
    // Overlap is structurally impossible: the cluster wraps and every box is
    // a full-width (flex-basis 100%) item, so each expanded box occupies its
    // own line below the control row, separated by the cluster's 8px gap.
    const cluster = ruleBody(".canvas-top-right");
    expect(cluster).toMatch(/flex-wrap:\s*wrap/);
    expect(cluster).toMatch(/gap:\s*8px/);
    for (const notice of [
      ".canvas-top-right .protection-notice",
      ".canvas-top-right .conversion-notice",
      ".canvas-top-right .pdf3d-notice",
    ]) {
      const box = ruleBody(notice);
      expect(box, notice).toMatch(/position:\s*static/);
      expect(box, notice).toMatch(/flex:\s*0 0 100%/);
    }
    // The holder and each region dissolve, so the boxes are DIRECT flex items
    // of the wrapping cluster rather than nested on one line.
    expect(ruleBody(".canvas-notices")).toMatch(/display:\s*contents/);
    expect(ruleBody(".canvas-notices .protection-notice-region")).toMatch(
      /display:\s*contents/,
    );
  });

  it("bounds the expanded box to the canvas and scrolls its overflow (DEF-466)", () => {
    // A long message must never paint past the canvas bottom. The box caps its
    // height against the `.canvas-overlay` size container (`100cqh`, resolved
    // against the REAL canvas, not the window) and scrolls the overflow, so
    // every line stays reachable. `align-items: flex-start` is what keeps a body
    // taller than the bounded box scrollable from its FIRST line rather than
    // overflowing both edges and hiding the top.
    expect(ruleBody(".canvas-overlay")).toMatch(/container-type:\s*size/);
    for (const notice of [
      ".canvas-top-right .protection-notice",
      ".canvas-top-right .conversion-notice",
      ".canvas-top-right .pdf3d-notice",
    ]) {
      const box = ruleBody(notice);
      expect(box, notice).toMatch(/max-height:\s*calc\(100cqh/);
      expect(box, notice).toMatch(/overflow:\s*auto/);
      expect(box, notice).toMatch(/align-items:\s*flex-start/);
    }
  });

  it("plays a token-based enter morph from the icon origin", () => {
    // The morph rides the existing notice-in keyframe (same name, so the
    // computed animationName stays stable) redefined to scale from the icon.
    for (const name of [
      "protection-notice-in",
      "conversion-notice-in",
      "pdf3d-notice-in",
    ]) {
      const body = CSS.match(
        new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`),
      )?.[1];
      expect(body, name).toMatch(/scale\(var\(--motion-scale-enter\)\)/);
      expect(body, name).toMatch(/opacity:\s*1/);
    }
    // The base box keeps the token-based enter animation declaration...
    expect(CSS).toMatch(
      /\.protection-notice\s*\{[^}]*animation:\s*protection-notice-in var\(--motion-duration-standard\) var\(--motion-ease-enter\)/s,
    );
    // ...and the in-canvas box morphs from its top-right (icon) origin.
    expect(ruleBody(".canvas-top-right .protection-notice")).toMatch(
      /transform-origin:\s*top right/,
    );
  });
});

describe("phase 78 — DEF-465 icon-first enter morph", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAnimationsEnabledPreference(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    setAnimationsEnabledPreference(true);
  });

  it("renders the collapsed 'i' in the INITIAL render, before the box commits", () => {
    // A server render runs no effects, so it IS the first committed frame:
    // the enter leg must show the glyph before the hook commits `expanded`.
    const protection = renderToStaticMarkup(
      createElement(ProtectionNotice, { protection: PROTECTION }),
    );
    expect(protection).toContain("data-protection-icon");
    expect(protection).not.toContain('class="protection-notice"');

    const conversion = renderToStaticMarkup(
      createElement(ConversionNotice, { notice: CONVERSION }),
    );
    expect(conversion).toContain("data-conversion-icon");
    expect(conversion).not.toContain('class="conversion-notice"');

    const pdf3d = renderToStaticMarkup(
      createElement(Pdf3dNotice, { entries: PDF3D }),
    );
    expect(pdf3d).toContain("data-pdf3d-icon");
    expect(pdf3d).not.toContain('class="pdf3d-notice"');
  });

  it("paints the 'i' first, then mounts the box only after the double-rAF hand-off", () => {
    const view = renderColumn();
    try {
      // First committed frame: the collapsed "i" is painted for all three,
      // and NOT ONE expanded box has mounted yet.
      for (const hook of [
        "[data-protection-icon]",
        "[data-conversion-icon]",
        "[data-pdf3d-icon]",
      ]) {
        expect(view.host.querySelector(hook), hook).not.toBeNull();
      }
      for (const hook of [
        "[data-protection-notice]",
        "[data-conversion-notice]",
        "[data-pdf3d-notice]",
      ]) {
        expect(view.host.querySelector(hook), hook).toBeNull();
      }
      // A SINGLE frame is not enough: the second rAF is what guarantees the
      // icon frame was painted before the box mounts (DEF-465).
      act((): void => {
        vi.advanceTimersToNextFrame();
      });
      for (const hook of [
        "[data-protection-notice]",
        "[data-conversion-notice]",
        "[data-pdf3d-notice]",
      ]) {
        expect(view.host.querySelector(hook), hook).toBeNull();
      }
      // Second frame: the box mounts (the morph plays from the icon origin)
      // and the "i" is swapped out.
      act((): void => {
        vi.advanceTimersToNextFrame();
      });
      for (const hook of [
        "[data-protection-notice]",
        "[data-conversion-notice]",
        "[data-pdf3d-notice]",
      ]) {
        expect(view.host.querySelector(hook), hook).not.toBeNull();
      }
      for (const hook of [
        "[data-protection-icon]",
        "[data-conversion-icon]",
        "[data-pdf3d-icon]",
      ]) {
        expect(view.host.querySelector(hook), hook).toBeNull();
      }
    } finally {
      view.cleanup();
    }
  });

  it("skips the icon leg on the instant path (reduced motion / Animations OFF)", () => {
    setAnimationsEnabledPreference(false);
    const markup = renderToStaticMarkup(
      createElement(ConversionNotice, { notice: CONVERSION }),
    );
    expect(markup).not.toContain("data-conversion-icon");
    expect(markup).toContain("data-conversion-notice");
  });
});
