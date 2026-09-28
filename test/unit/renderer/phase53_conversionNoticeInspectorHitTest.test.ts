// @vitest-environment jsdom
//
// Phase 53 (feature I) / the DEF-357 defect class — the conversion card's
// dismiss control was unclickable in the running app because the always-on
// Inspector overlapped it. The card is a FLOW element at the top of the pane's
// document column, so its `margin-left: auto` dismiss control landed at the
// card's right edge, under the fixed right panel (`position: absolute;
// right: 0; top: 0; bottom: 0; width: var(--tools-panel-w); z-index: 30`).
// `elementFromPoint` over the button returned the Inspector's own interactive
// header control (`.inspector-collapse-toggle`), so the card could not be
// dismissed.
//
// The fix reserves the panel's column with the SAME registered
// `--tf-tools-inset` token the page-view scroller, `.canvas-overlay` and the
// OCR suspects bar (DEF-357) consume. The intercepting pixel is the
// Inspector's own LIVE interactive child, which must stay clickable, so the
// documented overlay-LAYER rule (`pointer-events: none` on the layer, `auto`
// on the action-bar child) cannot resolve it — the child still wins the hit
// test. The flow card yields the column instead. These tests pin the CSS
// contract (jsdom applies no stylesheet, so it is a textual scan — the
// established pattern) and the AGENTS.md cross-bubbling obligation.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ConversionNotice } from "../../../src/renderer/components/ConversionNotice";
import type { ConvertNoticeState } from "../../../src/renderer/state/convert";

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

/** The hit-test rule, as arithmetic: the card's right edge must not cross the
 *  panel's left edge. `inset` is what the card reserves (`--tf-tools-inset`). */
function cardRightEdge(frameWidth: number, inset: number): number {
  return frameWidth - inset;
}
function inspectorLeftEdge(frameWidth: number, panelWidth: number): number {
  return frameWidth - panelWidth;
}

const NOTICE: ConvertNoticeState = {
  sourceLabel: "HTML document",
  sourceFormat: "html",
  fidelity: "layout",
  warnings: [],
};

describe("phase 53 — the conversion card reserves the fixed Inspector's column", () => {
  it("reserves the shared --tf-tools-inset on the card's right edge", () => {
    const rule = ruleBody(".document-column > .conversion-notice");
    expect(rule, "the Phase 53 hit-test reservation rule is missing").not.toBe("");
    expect(rule).toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)/);
  });

  it("does not reserve the inset a second time in Multi Mode", () => {
    const rule = ruleBody(
      '.tab-stage[data-multi-mode="true"] .document-column > .conversion-notice',
    );
    expect(rule, "the Multi Mode reset is missing").not.toBe("");
    expect(rule).toMatch(/margin-right:\s*0/);
  });

  it("binds the reservation to the Inspector's OWN width token (one source)", () => {
    const open = ruleBody('.app-main[data-tools-open="true"]');
    expect(open).toMatch(/--tf-tools-inset:\s*var\(--tools-panel-w,\s*264px\)/);
    const panel = ruleBody(".inspector");
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/top:\s*0/);
    expect(panel).toMatch(/right:\s*0/);
    expect(panel).toMatch(/bottom:\s*0/);
    expect(panel).toMatch(/width:\s*var\(--tools-panel-w,\s*264px\)/);
    expect(panel).toMatch(/z-index:\s*30/);
  });

  it("keeps the card's right edge at (or left of) the panel's left edge", () => {
    const FRAME = 2560;
    const PANEL = 264;
    expect(cardRightEdge(FRAME, PANEL)).toBe(inspectorLeftEdge(FRAME, PANEL));
    expect(cardRightEdge(FRAME, PANEL)).toBeLessThanOrEqual(inspectorLeftEdge(FRAME, PANEL));
    // Inspector closed: the inset is 0 and the card runs to the frame edge.
    expect(cardRightEdge(FRAME, 0)).toBe(FRAME);
  });

  it("keeps the card a FLOW element (no portal, no absolute self-position)", () => {
    const card = ruleBody(".conversion-notice");
    expect(card).not.toMatch(/position:\s*absolute/);
    const source = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/ConversionNotice.tsx"),
      "utf8",
    );
    expect(source).not.toContain("createPortal");
  });
});

describe("phase 53 — the dismiss click is not swallowed (AGENTS.md cross-bubbling)", () => {
  function mount(children: ReturnType<typeof createElement>) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(children);
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

  it("the confirm-style dismiss button fires even with a document click listener", () => {
    const onDismiss = vi.fn();
    const docListener = vi.fn();
    document.addEventListener("click", docListener);
    const view = mount(createElement(ConversionNotice, { notice: NOTICE, onDismiss }));
    try {
      const card = view.host.querySelector(".conversion-notice");
      const dismiss = view.host.querySelector<HTMLButtonElement>(
        "[data-conversion-dismiss]",
      );
      expect(dismiss, "the dismiss button must render").not.toBeNull();
      expect(dismiss?.tagName).toBe("BUTTON");
      // It is the card's last child: the `margin-left: auto` control that sat
      // under the Inspector before the fix.
      expect(card?.lastElementChild).toBe(dismiss);
      act((): void => {
        dismiss?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      // The card must NOT stop propagation: the click still reaches document.
      expect(docListener).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("click", docListener);
      view.cleanup();
    }
  });

  it("a click on the card body still completes and does not dismiss", () => {
    const onDismiss = vi.fn();
    const docListener = vi.fn();
    document.addEventListener("click", docListener);
    const view = mount(createElement(ConversionNotice, { notice: NOTICE, onDismiss }));
    try {
      const body = view.host.querySelector(".conversion-notice-body");
      expect(body).not.toBeNull();
      act((): void => {
        body?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      // The click completes (bubbles to document) and nothing was swallowed.
      expect(docListener).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", docListener);
      view.cleanup();
    }
  });
});
