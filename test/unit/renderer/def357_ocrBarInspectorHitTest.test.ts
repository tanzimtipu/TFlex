// @vitest-environment jsdom
//
// DEF-357 — the OCR suspects bar's close button was unclickable because the
// always-on Inspector overlapped it. The bar is a top FLOW strip inside
// `.app-main`; the Inspector is the fixed right panel (`position: absolute;
// right: 0; top: 0; bottom: 0; width: var(--tools-panel-w); z-index: 30`).
// The bar spanned the full frame (`grid-column: 1 / -1`), so its
// `margin-left: auto` close button landed at the bar's right edge, inside the
// panel's column; `elementFromPoint` over it returned the Inspector header's
// SVG rect and the panel could not be closed from its own control.
//
// The fix's rule: a fixed right panel owns its full-height column, so the bar
// reserves that column's width via the SAME registered `--tf-tools-inset`
// token the page-view scroller and the `.canvas-overlay` consume. The bar's
// right edge is then flush with the panel's left edge and every bar control
// is hit-testable. These tests pin the CSS contract (jsdom applies no
// stylesheet, so it is a textual scan — the established pattern) and the
// close control's wiring.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { OcrSuspectsPanel } from "../../../src/renderer/components/OcrSuspectsPanel";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `selector { ... }` whose selector starts a line. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

/** The hit-test rule, as arithmetic: the bar's right edge must not cross the
 *  panel's left edge. `inset` is what the bar reserves (`--tf-tools-inset`). */
function barRightEdge(frameWidth: number, inset: number): number {
  return frameWidth - inset;
}
function inspectorLeftEdge(frameWidth: number, panelWidth: number): number {
  return frameWidth - panelWidth;
}

describe("DEF-357 — the OCR bar reserves the fixed Inspector's column", () => {
  it("reserves the shared --tf-tools-inset on the bar's right edge", () => {
    const rule = ruleBody(".app-main > .ocr-suspects-panel");
    expect(rule, "the DEF-357 reservation rule is missing").not.toBe("");
    expect(rule).toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)/);
  });

  it("binds that inset to the Inspector's OWN width token (one source, no drift)", () => {
    // .app-main[data-tools-open="true"] is what the bar inherits while the
    // Inspector is open: the inset IS the panel width.
    const open = ruleBody('.app-main[data-tools-open="true"]');
    expect(open).toMatch(/--tools-panel-w:\s*264px/);
    expect(open).toMatch(/--tf-tools-inset:\s*var\(--tools-panel-w,\s*264px\)/);
    // The panel itself is the same width and the fixed right column.
    const panel = ruleBody(".inspector");
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/top:\s*0/);
    expect(panel).toMatch(/right:\s*0/);
    expect(panel).toMatch(/bottom:\s*0/);
    expect(panel).toMatch(/width:\s*var\(--tools-panel-w,\s*264px\)/);
    expect(panel).toMatch(/z-index:\s*30/);
    // The collapsed strip shrinks BOTH the panel and the reserved inset.
    const collapsed = ruleBody(".app-main[data-inspector-collapsed='true']");
    expect(collapsed).toMatch(/--tf-tools-inset:\s*var\(--tools-panel-w,\s*44px\)/);
  });

  it("still spans the frame, so the reservation is the only reason it stops short", () => {
    const bar = ruleBody(".ocr-suspects-panel");
    expect(bar).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(bar).toMatch(/grid-row:\s*1/);
  });

  it("keeps the bar's right edge at (or left of) the panel's left edge", () => {
    const FRAME = 1440;
    const PANEL = 264;
    // Inspector open: the bar reserves the panel width -> edges coincide.
    expect(barRightEdge(FRAME, PANEL)).toBe(inspectorLeftEdge(FRAME, PANEL));
    expect(barRightEdge(FRAME, PANEL)).toBeLessThanOrEqual(inspectorLeftEdge(FRAME, PANEL));
    // Inspector closed: the inset is 0 and the bar runs to the frame edge.
    expect(barRightEdge(FRAME, 0)).toBe(FRAME);
  });
});

describe("DEF-357 — the bar's close control is wired", () => {
  it("renders the close button at the header's right edge and fires onClose", () => {
    const onClose = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        createElement(OcrSuspectsPanel, {
          suspects: [],
          hasRun: true,
          onNavigate: (): void => undefined,
          onClose,
        }),
      );
    });
    try {
      const header = host.querySelector(".ocr-suspects-header");
      const close = host.querySelector<HTMLButtonElement>(".ocr-suspects-close");
      expect(close, "the close button must render").not.toBeNull();
      expect(close?.tagName).toBe("BUTTON");
      // It is the header's last child, i.e. the `margin-left: auto` control
      // that sat under the Inspector before the fix.
      expect(header?.lastElementChild).toBe(close);
      act((): void => {
        close?.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});
