// @vitest-environment jsdom
//
// DEF-135/136 — the engine converts text boxes to an engine-side
// registry (addTextBox / moveTextBox / deleteTextBox +
// EngineState.textBoxes). This pins the renderer's placement-toolbar
// half of the integration: a SELECTED committed box shows a toolbar
// (mirroring the image placement toolbar) with Delete (route through
// the host's engine.deleteTextBox) + Edit (reopens the inline editor
// with the box's committed content).
//
// Contract:
//   1. A selected committed box renders `[data-edit-box-toolbar]`
//      with Edit and Delete actions.
//   2. Delete fires `onDeleteTextBox(id)`.
//   3. Edit reopens the inline editor pre-filled with the box's
//      committed text/style/background, carrying the box id.
//   4. A toolbar-button press does NOT start a drag-to-create on the
//      page behind it (the bar stops the pointerdown), and the click
//      still completes (AGENTS.md cross-bubbling rule).
//   5. The toolbar is hidden while the inline editor is open.
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

function mountBoxTool(initial: EditState): {
  host: HTMLElement;
  state: () => EditState;
  onDeleteTextBox: ReturnType<typeof vi.fn>;
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
  const onDeleteTextBox = vi.fn();
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
          onDeleteTextBox,
        }),
      );
    });
  };
  render();
  return {
    host,
    state: (): EditState => lastState,
    onDeleteTextBox,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function selectedBoxTool(initial: Partial<EditState> = {}): EditState {
  return {
    ...initialEditState,
    tool: "box",
    selectedTextBox: "tb-1",
    textBoxes: [makeTextBox()],
    ...initial,
  };
}

describe("DEF-135/136 — committed text box placement toolbar", () => {
  it("renders Edit + Delete actions for a selected box", () => {
    const { host, unmount } = mountBoxTool(selectedBoxTool());
    try {
      const bar = host.querySelector("[data-edit-box-toolbar]");
      expect(bar).not.toBeNull();
      expect(host.querySelector("[data-edit-box-action='edit']")).not.toBeNull();
      expect(host.querySelector("[data-edit-box-action='delete']")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("Delete routes the box id through onDeleteTextBox", () => {
    const { host, onDeleteTextBox, unmount } = mountBoxTool(selectedBoxTool());
    try {
      const del = host.querySelector<HTMLButtonElement>("[data-edit-box-action='delete']");
      expect(del).not.toBeNull();
      if (del === null) return;
      act((): void => {
        del.click();
      });
      expect(onDeleteTextBox).toHaveBeenCalledTimes(1);
      expect(onDeleteTextBox.mock.calls[0]?.[0]).toBe("tb-1");
    } finally {
      unmount();
    }
  });

  it("Edit reopens the inline editor pre-filled with the box's committed content", async () => {
    const { host, unmount } = mountBoxTool(selectedBoxTool());
    try {
      const edit = host.querySelector<HTMLButtonElement>("[data-edit-box-action='edit']");
      expect(edit).not.toBeNull();
      if (edit === null) return;
      act((): void => {
        edit.click();
      });
      const editor = host.querySelector("[data-edit-editor='edit']");
      expect(editor, "editor opens in edit mode for a committed box").not.toBeNull();
      const textarea = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
      expect(textarea?.value).toBe("Committed box");
      // The toolbar hides while the editor is open (no overlap).
      // Phase C — the toolbar exits through AnimatePresence; settle
      // its exit frame before asserting no stale DOM.
      await act(async (): Promise<void> => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(host.querySelector("[data-edit-box-toolbar]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("a toolbar-button press does not start a drag-to-create and the click completes (no swallow)", () => {
    const { host, onDeleteTextBox, unmount } = mountBoxTool(selectedBoxTool());
    try {
      const del = host.querySelector<HTMLButtonElement>("[data-edit-box-action='delete']");
      expect(del).not.toBeNull();
      if (del === null) return;
      // Full press chain on the button: the layer must NOT see the
      // pointerdown (no new drag-to-create preview appears) and the
      // click must still fire.
      act((): void => {
        del.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 110, clientY: 150, pointerId: 1, button: 0 }));
      });
      act((): void => {
        del.click();
      });
      expect(onDeleteTextBox).toHaveBeenCalledTimes(1);
      expect(host.querySelector(".edit-box-preview"), "no drag-to-create preview").toBeNull();
      expect(host.querySelector("[data-edit-textarea]"), "no editor opened").toBeNull();
    } finally {
      unmount();
    }
  });

  it("the toolbar anchors below the box and carries the box id", () => {
    const { host, unmount } = mountBoxTool(selectedBoxTool());
    try {
      const bar = host.querySelector<HTMLElement>("[data-edit-box-toolbar]");
      expect(bar).not.toBeNull();
      if (bar === null) return;
      expect(bar.dataset.editBoxId).toBe("tb-1");
      const top = Number.parseFloat(bar.style.top);
      // Box bottom = 140pt; bar floats 4pt below it.
      expect(top).toBeCloseTo(144);
    } finally {
      unmount();
    }
  });
});