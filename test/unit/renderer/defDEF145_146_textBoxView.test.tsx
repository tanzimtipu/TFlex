// @vitest-environment jsdom
// DEF-145 — dragging a committed Add-box leaves a transient stale text
// copy at the ORIGINAL rect until mouseup (the pdf.js proxy is only
// refreshed on the re-commit). The fix paints an opaque white eraser at
// the drag's START rect while the move is in flight, so the box (and its
// text) appear to move as a single unit with no residual text at the old
// spot.
//
// DEF-146 — the committed box mirror clipped its text to a couple of
// characters because it rendered the user's pt font at full size inside
// a small box with overflow:hidden. The fix auto-fits the mirror font
// (engine/rasterizer parity) so the full committed text stays readable.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import {
  editReducer,
  initialEditState,
  type EditState,
  type TextBoxPlacement,
} from "../../../src/renderer/edit/model";

function makeTextBox(overrides: Partial<TextBoxPlacement> = {}): TextBoxPlacement {
  return {
    id: "tb-1",
    page: 1,
    rect: { x: 100, y: 100, width: 140, height: 60 },
    text: "ARTIFACT CHECK 88",
    style: { font: "Helvetica", size: 38, color: { r: 0, g: 0, b: 0 } },
    background: "white",
    ...overrides,
  };
}

function mountBoxTool(initial: EditState = { ...initialEditState, tool: "box" }): {
  host: HTMLElement;
  state: () => EditState;
  onCommitTextBoxMove: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  Element.prototype.setPointerCapture = function (this: Element): void { void this; };
  Element.prototype.releasePointerCapture = function (this: Element): void { void this; };
  const root = createRoot(host);
  const onCommitTextBoxMove = vi.fn();
  let lastState: EditState = initial;
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: lastState.tool,
          getTextItems: (): never[] => [],
          edit: lastState,
          dispatch: (action): void => {
            lastState = editReducer(lastState, action);
            render();
          },
          pickImage: async (): Promise<null> => null,
          defaultFont: "Helvetica",
          onCommitTextEdit: (): void => undefined,
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove,
        }),
      );
    });
  };
  render();
  return {
    host,
    state: (): EditState => lastState,
    onCommitTextBoxMove,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function pressBox(host: HTMLElement, x: number, y: number): void {
  const box = host.querySelector<HTMLElement>(".edit-box");
  expect(box).not.toBeNull();
  if (box === null) return;
  act((): void => {
    box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function moveOnLayer(host: HTMLElement, x: number, y: number): void {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  expect(layer).not.toBeNull();
  if (layer === null) return;
  act((): void => {
    layer.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });
}

describe("DEF-145 — no stale text copy at the origin while dragging a committed box", () => {
  it("renders an opaque eraser at the drag's start rect during a move", () => {
    const { host, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()],
    });
    try {
      // Press inside the box (100..240 x 100..160) then drag +45/+30.
      pressBox(host, 120, 120);
      moveOnLayer(host, 165, 150);

      const eraser = host.querySelector<HTMLElement>("[data-edit-box-eraser]");
      expect(eraser, "eraser renders during a move drag").not.toBeNull();
      if (eraser === null) return;
      expect(eraser.style.left).toBe("100px");
      expect(eraser.style.top).toBe("100px");
      expect(eraser.style.width).toBe("140px");
      expect(eraser.style.height).toBe("60px");
      // Opaque white + pointer-transparent so it covers the baked copy
      // without intercepting the drag.
      expect(eraser.style.background).toBe("rgb(255, 255, 255)");
      expect(eraser.style.pointerEvents).toBe("none");
    } finally {
      unmount();
    }
  });

  it("does NOT render the eraser when no box is being moved", () => {
    const { host, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()],
    });
    try {
      expect(host.querySelector("[data-edit-box-eraser]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("DEF-146 — the committed box mirror auto-fits its text (no truncation)", () => {
  it("renders the mirror at a fitted font smaller than the oversized user font", () => {
    const { host, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()], // text 38pt in a 140x60 box
    });
    try {
      const mirror = host.querySelector<HTMLElement>("[data-edit-box-text-mirror]");
      expect(mirror).not.toBeNull();
      if (mirror === null) return;
      // Full text is present.
      expect(mirror.textContent).toBe("ARTIFACT CHECK 88");
      const fitted = Number.parseFloat(
        host.querySelector<HTMLElement>("[data-edit-box-id='tb-1']")
          ?.getAttribute("data-edit-box-font-size") ?? "NaN",
      );
      // The old value was 38 (user pt * scale); the fitted value must
      // be smaller so the full text fits and is readable.
      expect(Number.isFinite(fitted)).toBe(true);
      expect(fitted).toBeLessThan(38);
      expect(fitted).toBeGreaterThan(4);
    } finally {
      unmount();
    }
  });
});
