// @vitest-environment jsdom
//
// B5 — committed text boxes must be selectable and movable in Edit
// mode (the "Add box" tool).
//
// The defect: `engine.addTextBox` bakes the box into the PDF and
// the renderer kept no registry, so the mouse couldn't drag a
// committed box.
//
// The fix: a per-tab text-box registry (`EditState.textBoxes`) the
// "box" tool renders as selectable `.edit-box` surfaces with corner
// handles. Pointerdown on a box body selects it and starts a move
// drag; pointermove dispatches `set-text-box-rect` so the surface
// re-draws at the new rect (mirroring the image-placement drag).
//
// These tests exercise the overlay's drag path end-to-end with a
// real reducer, so the dispatch → state → re-render loop is
// asserted:
//   1. The committed box renders as a `.edit-box` surface.
//   2. Pointerdown on the box selects it and starts a move drag.
//   3. Pointermove updates the box rect in the registry.
//   4. The surface re-renders at the moved position.
//   5. Pointerup ends the drag (renderer-local commit).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import {
  editReducer,
  initialEditState,
  type EditState,
  type TextBoxPlacement,
} from "../../../src/renderer/edit/model";

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

function makeTextBox(overrides: Partial<TextBoxPlacement> = {}): TextBoxPlacement {
  return {
    id: "tb-1",
    page: 1,
    rect: { x: 100, y: 100, width: 180, height: 40 },
    text: "Committed box",
    style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
    background: "white",
    ...overrides,
  };
}

function mountBoxTool(initial: EditState = { ...initialEditState, tool: "box" }): {
  host: HTMLElement;
  state: () => EditState;
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
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
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
          onCommitTextBoxMove: (): void => undefined,
        }),
      );
    });
  };
  render();
  return {
    host,
    state: (): EditState => lastState,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("B5 — committed text box selectable + movable (box tool)", () => {
  it("renders a committed box as a .edit-box surface at its rect", () => {
    const { host, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox({ rect: { x: 100, y: 100, width: 180, height: 40 } })],
    });
    try {
      const surface = host.querySelector<HTMLElement>(".edit-box");
      expect(surface).not.toBeNull();
      if (surface === null) return;
      expect(Number.parseFloat(surface.style.left)).toBe(100);
      expect(Number.parseFloat(surface.style.top)).toBe(100);
      expect(Number.parseFloat(surface.style.width)).toBe(180);
      expect(Number.parseFloat(surface.style.height)).toBe(40);
    } finally {
      unmount();
    }
  });

  it("pointerdown on a committed box selects it", () => {
    const { host, unmount, state } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()],
    });
    try {
      const surface = host.querySelector<HTMLElement>(".edit-box");
      expect(surface).not.toBeNull();
      if (surface === null) return;
      act((): void => {
        surface.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 120,
            clientY: 120,
            pointerId: 1,
          }),
        );
      });
      expect(state().selectedTextBox).toBe("tb-1");
      expect(surface.className).toContain("edit-box-selected");
      // Selecting the box must NOT open the drag-to-create preview.
      expect(host.querySelector(".edit-box-preview")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("dragging a committed box updates its rect and re-renders the surface (B5)", () => {
    const { host, unmount, state } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()],
    });
    try {
      const surface = host.querySelector<HTMLElement>(".edit-box");
      expect(surface).not.toBeNull();
      if (surface === null) return;
      // Press at (120,120) — inside the box (100..280 x 100..140).
      act((): void => {
        surface.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 120,
            clientY: 120,
            pointerId: 1,
          }),
        );
      });
      // The layer's own pointer handlers receive the move (the
      // pointer is captured to the layer).
      const layer = host.querySelector<HTMLElement>(".edit-layer");
      expect(layer).not.toBeNull();
      if (layer === null) return;
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 160,
            clientY: 140,
            pointerId: 1,
          }),
        );
      });
      // Rect moved by (40,20): 100+40, 100+20.
      expect(state().textBoxes[0]?.rect).toEqual({
        x: 140,
        y: 120,
        width: 180,
        height: 40,
      });
      // The surface re-rendered at the new position.
      const moved = host.querySelector<HTMLElement>(".edit-box");
      expect(moved).not.toBeNull();
      if (moved === null) return;
      expect(Number.parseFloat(moved.style.left)).toBe(140);
      expect(Number.parseFloat(moved.style.top)).toBe(120);
      // Release ends the drag (renderer-local commit; no engine
      // op exists for a baked box — see the B5 feasibility note).
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: 160,
            clientY: 140,
            pointerId: 1,
          }),
        );
      });
      expect(state().textBoxes[0]?.rect.x).toBe(140);
    } finally {
      unmount();
    }
  });

  it("the drag clamps the box inside the page", () => {
    const { host, unmount, state } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox({ rect: { x: 500, y: 500, width: 180, height: 40 } })],
    });
    try {
      const surface = host.querySelector<HTMLElement>(".edit-box");
      const layer = host.querySelector<HTMLElement>(".edit-layer");
      expect(surface).not.toBeNull();
      expect(layer).not.toBeNull();
      if (surface === null || layer === null) return;
      act((): void => {
        surface.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 520,
            clientY: 520,
            pointerId: 1,
          }),
        );
      });
      // Drag far past the page's right/bottom edge.
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 900,
            clientY: 900,
            pointerId: 1,
          }),
        );
      });
      const rect = state().textBoxes[0]?.rect;
      expect(rect).not.toBeNull();
      if (rect === undefined) return;
      expect(rect.x + rect.width).toBeLessThanOrEqual(612);
      expect(rect.y + rect.height).toBeLessThanOrEqual(792);
    } finally {
      unmount();
    }
  });
});