// @vitest-environment jsdom
// DEF-256 — at 640px the Tools palette covered the FLOATING text-properties
// card (font + colour controls unreachable), a regression of the DEF-241
// coexistence contract after the Phase-25 float conversion.
//
// Contract pinned here:
//   1. styles.css reserves a LEFT SLOT for the open card (--tf-text-slot =
//      card width + left inset + gutter) and the palette + its floating
//      badge cap their left edge at that slot's right edge; the palette's
//      320px floor yields only in this coexistence case. The Phase-14 base
//      sizing rules stay intact (the DEF-241 retirement pins still hold).
//   2. the card's drag clamp mirrors the same edge: its right edge stops at
//      the open palette's left edge minus the shared gutter, and the clamp
//      never inverts (no jump) when the free area is narrower than the card.
//   3. with the palette CLOSED the clamp is inert — the card keeps its full
//      pre-DEF-256 range and its stored offset.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  TEXT_PANEL_PALETTE_GAP,
  TextPropertiesPanel,
} from "../../../src/renderer/edit/TextPropertiesPanel";
import { defaultTextStyleValues, type TextStyleValues } from "../../../src/renderer/edit/textStyle";

const STYLES = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
const CLEAN = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");
const FLOAT_SELECTOR = ".app-main:has(.tab-pane[aria-hidden=\"false\"] .text-props-panel)";

function base(): TextStyleValues {
  return defaultTextStyleValues("Helvetica");
}

function firePointer(
  el: Element | Window,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
      }),
    );
  });
}

interface Mounted {
  host: HTMLElement;
  float: HTMLElement;
  grip: Element;
  cleanup: () => void;
}

const mounted: Mounted[] = [];

function mountCard(floatLeft = 40, floatWidth = 248): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(TextPropertiesPanel, {
        open: true,
        values: base(),
        defaults: base(),
        onPatch: (): void => undefined,
      }),
    );
  });
  const float = container.querySelector<HTMLElement>("[data-text-panel-float]");
  const grip = container.querySelector("[data-text-panel-grip]");
  if (float === null || grip === null) throw new Error("card not mounted");
  float.getBoundingClientRect = (): DOMRect => ({
    x: floatLeft,
    y: 120,
    left: floatLeft,
    top: 120,
    right: floatLeft + floatWidth,
    bottom: 640,
    width: floatWidth,
    height: 520,
    toJSON: () => ({}),
  });
  const m: Mounted = {
    host: container,
    float,
    grip,
    cleanup: (): void => {
      act((): void => root.unmount());
      container.remove();
    },
  };
  mounted.push(m);
  return m;
}

/** A stand-in for the mounted Tools palette with a fixed viewport rect. */
function stubPalette(left: number, width: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-tools-palette", "");
  el.getBoundingClientRect = (): DOMRect => ({
    x: left,
    y: 96,
    left,
    top: 96,
    right: left + width,
    bottom: 800,
    width,
    height: 704,
    toJSON: () => ({}),
  });
  document.body.appendChild(el);
  return el;
}

afterEach((): void => {
  while (mounted.length) (mounted.pop() as Mounted).cleanup();
  document.querySelectorAll("[data-tools-palette]").forEach((el) => el.remove());
});

describe("DEF-256 — styles.css reserves the card's left slot for the palette", () => {
  it("the coexistence rule caps the palette at the slot's right edge", () => {
    const rule = new RegExp(
      `${FLOAT_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` +
        `\\s*\\.tools-palette\\s*\\{[^}]*min-width:\\s*0[^}]*` +
        `max-width:\\s*calc\\(100%\\s*-\\s*var\\(--tf-rail-w[^)]*\\)[^)]*-\\s*var\\(--tf-text-slot`,
    );
    expect(CLEAN).toMatch(rule);
  });

  it("the reserved slot is derived from the card's width, inset and gutter", () => {
    const slot = /--tf-text-slot:\s*calc\(\s*var\(--text-panel-w,[^)]*\)\s*\+\s*var\(--text-panel-left,[^)]*\)\s*\+\s*var\(--text-panel-gap,[^)]*\)/;
    expect(CLEAN).toMatch(slot);
    expect(CLEAN).toMatch(/--text-panel-left:\s*12px/);
    expect(CLEAN).toMatch(new RegExp(`--text-panel-gap:\\s*${TEXT_PANEL_PALETTE_GAP}px`));
    expect(CLEAN).toMatch(/\.text-props-float\s*\{[^}]*left:\s*var\(--text-panel-left/);
    // The badge tab's width is a token, not a duplicated magic number.
    expect(CLEAN).toMatch(/\.tools-badge-tracker\s*\{[^}]*width:\s*var\(--tools-badge-w/);
  });

  it("the floating badge caps identically at the same edge", () => {
    const badge =
      `${FLOAT_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` +
      "\\s*\\.tools-badge-tracker-open\\s*\\{[^}]*right:\\s*min\\(";
    expect(CLEAN).toMatch(new RegExp(badge));
  });

  it("the Phase-25 base sizing + the DEF-241 retirement pins still hold", () => {
    // Base (unconditional) palette sizing untouched.
    expect(CLEAN).toMatch(
      /\.tools-palette\s*\{[^}]*min-width:\s*320px[^}]*max-width:\s*calc\(100vw\s*-\s*24px\)/,
    );
    // The coexistence rule is keyed off the mounted card, not the state marker.
    expect(CLEAN).not.toMatch(/data-text-panel-open[^{]*\.tools-palette/);
    // The retired DEF-241 token does not come back.
    expect(CLEAN).not.toMatch(/--tf-tools-clear\s*:/);
    // The base badge rule keeps its plain --tools-panel-w offset.
    const idx = CLEAN.indexOf(".tools-badge-tracker-open");
    const body = CLEAN.slice(CLEAN.indexOf("{", idx) + 1, CLEAN.indexOf("}", idx));
    expect(body).toMatch(/right:\s*var\(--tools-panel-w,\s*344px\)/);
    expect(body).not.toMatch(/min\(/);
  });
});

describe("DEF-256 — the card's drag clamp mirrors the palette's edge", () => {
  it("caps the card's right edge at the palette's left edge minus the gutter", () => {
    const m = mountCard();
    stubPalette(400, 344);
    // jsdom viewport is 1024 wide: without the avoid cap the card could reach
    // left 776; with the palette at 400 the cap is 400 - 248 - 8 = 144.
    firePointer(m.grip, "pointerdown", 60, 140);
    firePointer(window, "pointermove", 800, 200);
    firePointer(window, "pointerup", 800, 200);
    expect(m.float.style.transform).toContain("translate3d(104px,");
    expect(TEXT_PANEL_PALETTE_GAP).toBe(8);
  });

  it("never inverts the range: an unfittable free area pins to the clamp's left edge", () => {
    const m = mountCard();
    stubPalette(100, 900); // left edge left of the card's own position
    firePointer(m.grip, "pointerdown", 60, 140);
    firePointer(window, "pointermove", 700, 400);
    firePointer(window, "pointerup", 700, 400);
    expect(m.float.style.transform).toContain("translate3d(-40px,");
  });

  it("is inert with the palette closed: the stored offset and range are unchanged", () => {
    const m = mountCard();
    firePointer(m.grip, "pointerdown", 60, 140);
    firePointer(window, "pointermove", 300, 200);
    firePointer(window, "pointerup", 300, 200);
    expect(m.float.style.transform).toContain("translate3d(240px,");
  });
});