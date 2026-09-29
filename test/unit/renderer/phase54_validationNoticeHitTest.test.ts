// @vitest-environment jsdom
//
// Phase 54 (features D + E) / the DEF-357 + DEF-377 defect class — the
// validation card's dismiss control would be unclickable in the running app if
// the always-on Inspector overlapped it. The card is a FLOW element at the top
// of the pane's document column, so its `margin-left: auto` dismiss control
// lands at the card's right edge, under the fixed right panel (`position:
// absolute; right: 0; top: 0; bottom: 0; width: var(--tools-panel-w);
// z-index: 30`). The card therefore reserves the panel's column with the SAME
// registered `--tf-tools-inset` token the scroller, `.canvas-overlay`, the OCR
// suspects bar and the conversion/protection cards consume; Multi Mode resets
// it because the pane widths already exclude that strip.
//
// These tests pin the CSS contract (jsdom applies no stylesheet, so it is a
// textual scan — the established pattern) and the AGENTS.md cross-bubbling
// obligation: a click on the dismiss control fires its handler AND still
// reaches a document-level listener.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ValidationNotice } from "../../../src/renderer/components/ValidationNotice";
import type { ValidationNoticeState } from "../../../src/renderer/state/validation";

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

const NOTICE: ValidationNoticeState = {
  variant: "report",
  report: {
    target: "pdfa-1b",
    standard: "pdfa",
    declared: "PDF/A-1b",
    conforms: true,
    violations: [],
  },
};

describe("phase 54 — the validation card reserves the fixed Inspector's column", () => {
  it("reserves the shared --tf-tools-inset on the card's right edge", () => {
    const rule = ruleBody(".document-column > .validation-notice");
    expect(rule, "the Phase 54 hit-test reservation rule is missing").not.toBe("");
    expect(rule).toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)/);
  });

  it("does not reserve the inset a second time in Multi Mode", () => {
    const rule = ruleBody(
      '.tab-stage[data-multi-mode="true"] .document-column > .validation-notice',
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
    expect(cardRightEdge(FRAME, 0)).toBe(FRAME);
  });

  it("keeps the card a FLOW element (no portal, no absolute self-position)", () => {
    const card = ruleBody(".validation-notice");
    expect(card, "the .validation-notice rule is missing").not.toBe("");
    expect(card).not.toMatch(/position:\s*absolute/);
    const source = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/ValidationNotice.tsx"),
      "utf8",
    );
    expect(source).not.toContain("createPortal");
  });

  it("uses the shared motion token for its mount animation", () => {
    const card = ruleBody(".validation-notice");
    expect(card).toMatch(/animation:\s*validation-notice-in\s+var\(--motion-duration-standard\)\s+var\(--motion-ease-enter\)/);
  });
});

describe("phase 54 — the dismiss click is not swallowed (AGENTS.md cross-bubbling)", () => {
  function mount(children: ReturnType<typeof createElement>) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(children);
    });
    return {
      host,
      cleanup(): void {
        act((): void => {
          root.unmount();
        });
        host.remove();
      },
    };
  }

  it("the dismiss button fires even with a document click listener", () => {
    const onDismiss = vi.fn();
    const docListener = vi.fn();
    document.addEventListener("click", docListener);
    const view = mount(createElement(ValidationNotice, { notice: NOTICE, onDismiss }));
    try {
      const card = view.host.querySelector(".validation-notice");
      const dismiss = view.host.querySelector<HTMLButtonElement>("[data-validation-dismiss]");
      expect(dismiss, "the dismiss button must render").not.toBeNull();
      expect(dismiss?.tagName).toBe("BUTTON");
      // It is the card's last child: the `margin-left: auto` control that would
      // sit under the Inspector without the reservation.
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

  it("omitting onDismiss renders no dismiss control", () => {
    const view = mount(createElement(ValidationNotice, { notice: NOTICE }));
    try {
      expect(view.host.querySelector("[data-validation-dismiss]")).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("a click on the card body still completes and does not dismiss", () => {
    const onDismiss = vi.fn();
    const docListener = vi.fn();
    document.addEventListener("click", docListener);
    const view = mount(createElement(ValidationNotice, { notice: NOTICE, onDismiss }));
    try {
      const body = view.host.querySelector(".validation-notice-body");
      expect(body).not.toBeNull();
      act((): void => {
        body?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(docListener).toHaveBeenCalledTimes(1);
      expect(onDismiss).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", docListener);
      view.cleanup();
    }
  });
});
