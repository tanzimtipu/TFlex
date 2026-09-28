// @vitest-environment jsdom
//
// Phase 52 follow-up (operator bug 2) — "moving the text still leaves behind
// empty blue boxes, they show up on mouse hover".
//
// The engine masks a MOVED run's old rect with a white rectangle but keeps
// the original text operators in the content stream, so pdf.js still returns
// the phantom item at the old spot after the proxy refresh. The text tool's
// hover hit-test then painted its dashed `.edit-text-hover` box over the now
// EMPTY old position. The commit now records the masked rect
// (`CommittedTextRun.maskedRect`) and the hit-test ignores it.
//
// Rules:
//   - after a move + Confirm, hovering the OLD position paints NO box;
//   - after moving twice, BOTH old positions are clean;
//   - hovering an UNMOVED run still paints the hover preview;
//   - no selection surface survives the commit.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import {
  editReducer,
  initialEditState,
  type EditAction,
  type EditState,
} from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

const RUN: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

interface Harness {
  host: HTMLElement;
  root: Root;
  items: TextItemGeom[];
  state: EditState;
  rerender: () => void;
  unmount: () => void;
}

function mount(): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
  const h: Harness = {
    host,
    root,
    items: [{ ...RUN }],
    state: { ...initialEditState, tool: "text" },
    rerender: (): void => undefined,
    unmount: (): void => undefined,
  };
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: "text",
          getTextItems: (): TextItemGeom[] => h.items,
          edit: h.state,
          dispatch: (action: EditAction): void => {
            h.state = editReducer(h.state, action);
            render();
          },
          pickImage: async (): Promise<null> => null,
          defaultFont: "Helvetica",
          onCommitTextEdit: vi.fn(),
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove: (): void => undefined,
          textStyle: { font: "Helvetica", size: 20, color: { r: 0, g: 0, b: 0 } },
          onTextTargetChange: (): void => undefined,
          onTextInput: (): void => undefined,
          onTextInputCommit: (): void => undefined,
          onDiscardTextEdit: (): void => undefined,
          textLive: null,
          textCommitToken: 0,
        }),
      );
    });
  };
  h.rerender = render;
  h.unmount = (): void => {
    act((): void => {
      root.unmount();
    });
    host.remove();
  };
  render();
  return h;
}

function layerOf(host: HTMLElement): HTMLElement {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("edit layer not found");
  return layer;
}

function pointer(el: HTMLElement, type: string, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function hover(host: HTMLElement, x: number, y: number): void {
  // The hover listener is at WINDOW level; a bubbling pointermove from the
  // layer reaches it exactly like a real one.
  pointer(layerOf(host), "pointermove", x, y);
}

function clickAction(host: HTMLElement, selector: string): void {
  const btn = host.querySelector<HTMLButtonElement>(selector);
  if (btn === null) throw new Error(`${selector} not found`);
  act((): void => {
    btn.click();
  });
}

/** Select a run, drag it by (dx,dy), then press the bar's Confirm. */
function moveAndConfirm(host: HTMLElement, ox: number, oy: number, dx: number, dy: number): void {
  pointer(layerOf(host), "pointerdown", ox, oy);
  pointer(layerOf(host), "pointermove", ox + dx, oy + dy);
  pointer(layerOf(host), "pointerup", ox + dx, oy + dy);
  clickAction(host, '[data-content-action="textrun-confirm"]');
}

function hoverBoxes(host: HTMLElement): number {
  return host.querySelectorAll(".edit-text-hover").length;
}

describe("Phase 52 bug 2 — no residual box after a move; nothing on hover", () => {
  it("after a move+Confirm the OLD position paints no box, the new one still hovers", () => {
    const h = mount();
    try {
      moveAndConfirm(h.host, 150, 110, 60, 30);
      // The commit cleared the selection surface.
      expect(h.host.querySelector("[data-textrun-selection]")).toBeNull();
      // The proxy refresh lands: pdf.js STILL returns the masked original at
      // the old rect alongside the engine-drawn copy at the new rect.
      h.items = [
        { x: 100, y: 100, width: 200, height: 20, text: "Source run" },
        { x: 160, y: 130, width: 200, height: 20, text: "Source run" },
      ];
      h.rerender();
      // Hover the empty OLD spot -> no phantom box.
      hover(h.host, 150, 110);
      expect(hoverBoxes(h.host), "no box on the empty old position").toBe(0);
      // Hover the moved run -> the normal hover preview still works.
      hover(h.host, 300, 140);
      expect(hoverBoxes(h.host), "hover preview on the moved run").toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("after moving twice, BOTH old positions are clean; the live preview still works", () => {
    const h = mount();
    try {
      moveAndConfirm(h.host, 150, 110, 60, 30);
      h.items = [
        { x: 100, y: 100, width: 200, height: 20, text: "Source run" },
        { x: 160, y: 130, width: 200, height: 20, text: "Source run" },
      ];
      h.rerender();
      // Re-select the moved run and move it again.
      moveAndConfirm(h.host, 200, 140, 40, 20);
      h.items = [
        { x: 100, y: 100, width: 200, height: 20, text: "Source run" },
        { x: 160, y: 130, width: 200, height: 20, text: "Source run" },
        { x: 200, y: 150, width: 200, height: 20, text: "Source run" },
      ];
      h.rerender();
      expect(h.state.committedTextRuns?.length, "two move commits recorded").toBe(2);
      // Both old positions are empty -> neither paints a box.
      hover(h.host, 150, 110);
      expect(hoverBoxes(h.host), "first old position clean").toBe(0);
      hover(h.host, 200, 140);
      expect(hoverBoxes(h.host), "second old position clean").toBe(0);
      // The live run at its final position still hovers.
      hover(h.host, 300, 160);
      expect(hoverBoxes(h.host), "the moved run still hovers").toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("a plain Confirm (no move) records no phantom and leaves the run hoverable", () => {
    const h = mount();
    try {
      // A plain select -> Confirm (no drag) commits nothing to the run list.
      pointer(layerOf(h.host), "pointerdown", 150, 110);
      clickAction(h.host, '[data-content-action="textrun-confirm"]');
      expect(h.state.committedTextRuns?.length ?? 0).toBe(0);
      // The untouched run still hovers normally.
      hover(h.host, 150, 110);
      expect(hoverBoxes(h.host)).toBe(1);
    } finally {
      h.unmount();
    }
  });
});
