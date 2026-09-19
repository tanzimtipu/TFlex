// @vitest-environment jsdom
//
// DEF-127 / DEF-127b — committed text boxes: selecting a box
// reopens the inline editor, and dragging the box moves the
// registry rect AND re-bakes the baked text through
// onCommitTextBoxMove (the host's engine.editImage mask-and-draw).
// The old behavior dragged only an empty blue `.edit-box` surface —
// the baked text stayed put and the decoupled rect persisted across
// edit-mode re-entry (phantom boxes).
//
// Contract:
//   1. The box surface mirrors its baked content (text + white
//      fill) so a drag visibly carries the whole box.
//   2. A click (no movement) on a committed box reopens the same
//      inline editor pre-filled with the box's text.
//   3. Committing the reopened editor round-trips the new text
//      back into the registry (no stale text on the next re-open).
//   4. A drag (movement) commits the re-bake: onCommitTextBoxMove
//      fires with oldRect (start) / newRect (current registry
//      rect) / text / style / background / id.
//   5. A resize drag commits the same way with the resized rect.
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

/** Phase 20 — the inline editor is a TfBar inside an AnimatePresence, so
 *  its DOM removal completes after the exit animation. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

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
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
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

function releaseOnLayer(host: HTMLElement, x: number, y: number): void {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  expect(layer).not.toBeNull();
  if (layer === null) return;
  act((): void => {
    layer.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });
}

/** DEF-153 — a committed box's edit toolbox opens on DOUBLE click
 *  (single click selects it + shows the Confirm/Edit/Delete bar). */
function dblClickBox(host: HTMLElement, x: number, y: number): void {
  const box = host.querySelector<HTMLElement>(".edit-box");
  expect(box).not.toBeNull();
  if (box === null) return;
  act((): void => {
    box.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
  });
}

describe("DEF-127 — committed text box surfaces mirror their baked content", () => {
  it("renders the white fill + the text mirror inside the .edit-box surface", () => {
    const { host, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox({ background: "white" })],
    });
    try {
      const mirror = host.querySelector<HTMLElement>("[data-edit-box-text-mirror]");
      expect(mirror).not.toBeNull();
      expect(mirror?.textContent).toBe("Committed box");
      // White-background boxes render the fill (baked white rect).
      expect(host.querySelector(".edit-box-fill")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("'none'-background boxes skip the fill (transparent mirror)", () => {
    const { host, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox({ background: "none" })],
    });
    try {
      expect(host.querySelector(".edit-box-fill")).toBeNull();
      expect(host.querySelector("[data-edit-box-text-mirror]")?.textContent).toBe("Committed box");
    } finally {
      unmount();
    }
  });
});

describe("DEF-127 — selecting a committed box reopens the inline editor", () => {
  it("a click (no drag) SELECTS the box (Confirm/Edit/Delete bar); double-click opens the editor pre-filled with the box's text", () => {
    const { host, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()],
    });
    try {
      pressBox(host, 120, 120);
      releaseOnLayer(host, 120, 120);
      // DEF-153 — the single click selects + makes movable; the edit
      // toolbox opens on double click.
      expect(host.querySelector("[data-edit-box-toolbar]"), "single click shows the action bar").not.toBeNull();
      expect(host.querySelector("[data-edit-editor='edit']"), "single click must NOT open the editor").toBeNull();
      dblClickBox(host, 120, 120);
      expect(host.querySelector("[data-edit-editor='edit']")).not.toBeNull();
      const textarea = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
      expect(textarea?.value).toBe("Committed box");
    } finally {
      unmount();
    }
  });

  it("committing the reopened editor round-trips the new text into the registry", async () => {
    const { host, state, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()],
    });
    try {
      pressBox(host, 120, 120);
      releaseOnLayer(host, 120, 120);
      dblClickBox(host, 120, 120);
      const textarea = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
      expect(textarea).not.toBeNull();
      if (textarea === null) return;
      // Native-setter + input event to drive the controlled textarea.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      act((): void => {
        setter?.call(textarea, "Edited text");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const commitBtn = host.querySelector<HTMLButtonElement>(".edit-inline-btn-commit");
      expect(commitBtn).not.toBeNull();
      if (commitBtn === null) return;
      act((): void => {
        commitBtn.click();
      });
      expect(state().textBoxes[0]?.text).toBe("Edited text");
      // The editor closed after commit (its TfBar exit runs first).
      await settleMotion();
      expect(host.querySelector("[data-edit-textarea]")).toBeNull();
    } finally {
      unmount();
    }
  });
});

describe("DEF-127/127b — dragging a committed box re-bakes the text with it", () => {
  it("a move drag parks a PENDING move; the bar's Confirm commits onCommitTextBoxMove with old/new rects + the box's content (DEF-152/155)", () => {
    const { host, onCommitTextBoxMove, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()],
    });
    try {
      pressBox(host, 120, 120);   // start at (120,120) inside 100..280 x 100..140
      moveOnLayer(host, 160, 140); // +40,+20
      releaseOnLayer(host, 160, 140);
      // DEF-152 — the move is NO LONGER implicit on pointerup: the
      // engine write waits for the bar's Confirm.
      expect(onCommitTextBoxMove).not.toHaveBeenCalled();
      // The Confirm/Edit/Delete bar is up (the box is selected +
      // movable) and the white eraser covers the OLD rect (DEF-155).
      const bar = host.querySelector<HTMLElement>("[data-edit-box-toolbar]");
      expect(bar, "selected/moved box shows the action bar").not.toBeNull();
      expect(host.querySelector("[data-edit-box-action='confirm']")).not.toBeNull();
      expect(host.querySelector("[data-edit-box-eraser]"), "eraser covers the old rect while pending").not.toBeNull();
      // Confirm commits the threaded position.
      const confirmBtn = host.querySelector<HTMLButtonElement>("[data-edit-box-action='confirm']");
      expect(confirmBtn).not.toBeNull();
      if (confirmBtn === null) return;
      act((): void => {
        confirmBtn.click();
      });
      expect(onCommitTextBoxMove).toHaveBeenCalledTimes(1);
      const call = onCommitTextBoxMove.mock.calls[0]?.[0];
      expect(call).toMatchObject({
        oldRect: { x: 100, y: 100, width: 180, height: 40 },
        newRect: { x: 140, y: 120, width: 180, height: 40 },
        text: "Committed box",
        background: "white",
        id: "tb-1",
      });
      expect(call.style).toEqual({ font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } });
      // No editor opens for a real drag (it's a move, not a click).
      expect(host.querySelector("[data-edit-textarea]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("a resize drag (corner handle) parks a pending move; the bar's Confirm commits with the resized rect", () => {
    const { host, onCommitTextBoxMove, unmount } = mountBoxTool({
      ...initialEditState,
      tool: "box",
      textBoxes: [makeTextBox()],
    });
    try {
      // Select the box first so the handles are painted.
      pressBox(host, 120, 120);
      expect(
        host.querySelector(".edit-box"),
        "box surface exists",
      ).not.toBeNull();
      const handle = host.querySelector<HTMLElement>("[data-edit-box-handle='se']");
      expect(handle, "selected box renders the SE corner handle").not.toBeNull();
      if (handle === null) return;
      act((): void => {
        handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 280, clientY: 140, pointerId: 1 }));
      });
      moveOnLayer(host, 320, 180);
      releaseOnLayer(host, 320, 180);
      // Pending — not committed at pointerup.
      expect(onCommitTextBoxMove).not.toHaveBeenCalled();
      const confirmBtn = host.querySelector<HTMLButtonElement>("[data-edit-box-action='confirm']");
      expect(confirmBtn, "Confirm button appears").not.toBeNull();
      if (confirmBtn === null) return;
      act((): void => {
        confirmBtn.click();
      });
      expect(onCommitTextBoxMove).toHaveBeenCalledTimes(1);
      const call = onCommitTextBoxMove.mock.calls[0]?.[0];
      expect(call.oldRect).toEqual({ x: 100, y: 100, width: 180, height: 40 });
      expect(call.newRect.width).toBe(220);
      expect(call.newRect.height).toBe(80);
      expect(call.id).toBe("tb-1");
    } finally {
      unmount();
    }
  });
});