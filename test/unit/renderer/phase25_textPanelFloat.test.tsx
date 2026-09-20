// @vitest-environment jsdom
// Phase 25 — the text-properties panel is a floating, header-less card.
//
// Pins:
//   1. the header / title are GONE; the only chrome is the shared
//      ContentGrip strip;
//   2. the useDragWindow wiring is live (a grip press moves the card and
//      the offset STAYS after release; a press on a control never starts
//      a move);
//   3. the host no longer drives a page-reflow column: DocumentView mounts
//      the panel inside .workspace-main, and styles.css has no --tf-text-w
//      grid track or @property (static source scan).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import { defaultTextStyleValues, type TextStyleValues } from "../../../src/renderer/edit/textStyle";

function base(): TextStyleValues {
  return defaultTextStyleValues("Helvetica");
}

function mount(): { host: HTMLElement; cleanup: () => void } {
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
  return {
    host: container,
    cleanup: (): void => {
      act((): void => root.unmount());
      container.remove();
    },
  };
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

describe("Phase 25 — header-less floating card", () => {
  it("renders no header / title; the ContentGrip strip is the only chrome", () => {
    const { host, cleanup } = mount();
    expect(host.querySelector(".text-props-header")).toBeNull();
    expect(host.querySelector(".text-props-title")).toBeNull();
    // The floating wrapper + the grip drag affordance.
    expect(host.querySelector("[data-text-panel-float]")).not.toBeNull();
    expect(host.querySelector("[data-text-panel-grip]")).not.toBeNull();
    expect(host.querySelector("[data-drag-grip='text-props']")).not.toBeNull();
    // The control surface + its stable hooks survive.
    expect(host.querySelector("[data-text-panel]")).not.toBeNull();
    expect(host.querySelector("[data-txt-font]")).not.toBeNull();
    expect(host.querySelector("[data-txt-bold]")).not.toBeNull();
    cleanup();
  });

  it("drags by its grip, holds the offset after release, and never drags from a control", () => {
    const { host, cleanup } = mount();
    const float = host.querySelector<HTMLElement>("[data-text-panel-float]");
    if (float === null) throw new Error("float wrapper not found");
    float.getBoundingClientRect = (): DOMRect => ({
      x: 40, y: 120, left: 40, top: 120, right: 288, bottom: 640, width: 248, height: 520,
      toJSON: () => ({}),
    });
    const grip = host.querySelector("[data-text-panel-grip]");
    if (grip === null) throw new Error("grip not found");

    // Grip press -> move -> release: the card follows and STAYS.
    firePointer(grip, "pointerdown", 60, 140);
    firePointer(window, "pointermove", 130, 200);
    firePointer(window, "pointerup", 130, 200);
    expect(float.style.transform).toContain("translate3d(70px, 60px, 0)");

    // A press on a control is that control's: no move starts.
    const bold = host.querySelector("[data-txt-bold]");
    if (bold === null) throw new Error("bold control not found");
    firePointer(bold, "pointerdown", 60, 140);
    firePointer(window, "pointermove", 260, 380);
    firePointer(window, "pointerup", 260, 380);
    expect(float.style.transform).toContain("translate3d(70px, 60px, 0)");
    cleanup();
  });
});

describe("Phase 25 — the page-reflow column is retired", () => {
  const STYLES = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
  const DOCVIEW = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
    "utf8",
  );
  const CLEAN = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");

  it("styles.css declares no --tf-text-w track, @property or open rule", () => {
    expect(CLEAN).not.toMatch(/@property\s+--tf-text-w/);
    expect(CLEAN).not.toMatch(/--tf-text-w\s*:/);
    expect(CLEAN).not.toMatch(/var\(--tf-text-w/);
    // The workspace grid is rail + page only.
    expect(CLEAN).toMatch(/grid-template-columns:\s*var\(--tf-rail-w\)\s+1fr/);
  });

  it("styles.css has no text-props header / title rules", () => {
    expect(CLEAN).not.toMatch(/\.text-props-header\s*\{/);
    expect(CLEAN).not.toMatch(/\.text-props-title\s*\{/);
  });

  it("DocumentView no longer writes a text-panel grid column", () => {
    // Strip comments: the retirement note may name the retired token.
    const docCode = DOCVIEW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(docCode).not.toMatch(/--tf-text-w/);
    // The mount lives inside the page-view area.
    const panelMount = docCode.indexOf("<TextPropertiesPanel");
    const mainOpen = docCode.indexOf('className="workspace-main"');
    expect(panelMount).toBeGreaterThan(-1);
    expect(mainOpen).toBeGreaterThan(-1);
    expect(panelMount).toBeGreaterThan(mainOpen);
  });
});
