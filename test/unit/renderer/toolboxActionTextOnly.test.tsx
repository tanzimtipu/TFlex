// @vitest-environment jsdom
//
// Floating-toolbox action buttons must be TEXT-ONLY (Cancel / Delete /
// Confirm and the other action words) — no X / Check / Trash icons,
// and no icon+label overlap in the commit control. Every floating
// toolbox shares the same `.toolbox-action-btn` style with the
// `--confirm` / `--cancel` / `--delete` variants so the actions look
// identical everywhere.
//
// The EDIT-EDITOR commit button is the primary regression: it used to
// render BOTH a `<Check>` icon AND a conditional `<span>Confirm</span>`,
// which overlapped when the window had been dragged. It must now render
// exactly one text node (Apply / Confirm) with no svg and no span.
//
// Also pins: the edit editor's new Delete button (only for a committed
// text box — routed through the overlay's onDeleteTextBox, never a
// silent no-op), and the signature action bar's text-only labels.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { EditInlineEditor } from "../../../src/renderer/edit/EditInlineEditor";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import {
  editReducer,
  initialEditState,
  type EditState,
  type TextBoxPlacement,
} from "../../../src/renderer/edit/model";
import { SignatureActionBar } from "../../../src/renderer/signatures/SignaturesOverlay";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

// ---------------------------------------------------------------------------
// EditInlineEditor — direct mount

function mountEditor(args?: {
  initialText?: string;
  mode?: "edit" | "box";
  onDelete?: () => void;
}): {
  host: HTMLElement;
  commit: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const commit = vi.fn();
  const cancel = vi.fn();
  function Harness(): ReactElement {
    return createElement(EditInlineEditor, {
      rect: { x: 50, y: 50, width: 200, height: 30 },
      cssScale: 1,
      initialText: args?.initialText ?? "Original",
      initialStyle: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
      mode: args?.mode ?? "edit",
      onCommit: commit,
      onCancel: cancel,
      onDelete: args?.onDelete,
    });
  }
  act((): void => {
    root.render(createElement(Harness));
  });
  return { host, commit, cancel };
}

function commitBtn(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>(".edit-inline-btn-commit");
  if (btn === null) throw new Error("commit button not found");
  return btn;
}

function cancelBtn(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>(".edit-inline-btn-cancel");
  if (btn === null) throw new Error("cancel button not found");
  return btn;
}

function deleteBtn(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>(".edit-inline-btn-delete");
  if (btn === null) throw new Error("delete button not found");
  return btn;
}

/** jsdom does no layout — give the editor a rect that tracks its own
 *  inline style so useDragWindow's window-rect math sees a realistic
 *  surface (same technique as bugDEF140). */
function stubEditorRect(host: HTMLElement): HTMLElement {
  const editor = host.querySelector<HTMLElement>(".edit-inline-editor");
  if (editor === null) throw new Error("editor not found");
  editor.getBoundingClientRect = (): DOMRect => {
    const left = Number.parseFloat(editor.style.left) || 0;
    const top = Number.parseFloat(editor.style.top) || 0;
    return {
      left,
      top,
      width: 200,
      height: 182,
      right: left + 200,
      bottom: top + 182,
      x: left,
      y: top,
      toJSON: (): Record<string, never> => ({}),
    } as DOMRect;
  };
  return editor;
}

function pointerdown(el: HTMLElement, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function pointerup(el: HTMLElement, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function windowMove(x: number, y: number): void {
  act((): void => {
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function clickBtn(btn: HTMLButtonElement): void {
  act((): void => {
    btn.click();
  });
}

// ---------------------------------------------------------------------------
// EditInlineEditor — text-only action labels

describe("EditInlineEditor action bar — text-only labels, no icons, no overlap", () => {
  it("renders Cancel / Apply / Delete as plain text (no svg, no span, no overlap)", () => {
    const onDelete = vi.fn();
    const { host } = mountEditor({ mode: "box", onDelete });
    try {
      const actions = host.querySelector(".edit-inline-toolbar-actions");
      expect(actions).not.toBeNull();
      // No icon and no nested span anywhere in the action row.
      expect(host.querySelectorAll(".edit-inline-toolbar-actions svg").length).toBe(0);
      expect(host.querySelectorAll(".edit-inline-toolbar-actions span").length).toBe(0);

      expect(cancelBtn(host).textContent).toBe("Cancel");
      expect(commitBtn(host).textContent).toBe("Apply");
      expect(deleteBtn(host).textContent).toBe("Delete");

      // The commit button renders exactly ONE text label — no
      // icon + span pair underneath (the DEF overlap regression).
      expect(commitBtn(host).querySelectorAll("svg, span").length).toBe(0);

      // Shared toolbox style on every button.
      for (const btn of [
        cancelBtn(host),
        deleteBtn(host),
        commitBtn(host),
      ]) {
        expect(btn.classList.contains("toolbox-action-btn")).toBe(true);
      }
      expect(cancelBtn(host).classList.contains("toolbox-action-btn--cancel")).toBe(true);
      expect(deleteBtn(host).classList.contains("toolbox-action-btn--delete")).toBe(true);
      expect(commitBtn(host).classList.contains("toolbox-action-btn--confirm")).toBe(true);
    } finally {
      host.remove();
    }
  });

  it("clicking Cancel cancels; clicking Apply commits; clicking Delete deletes without committing", () => {
    const onDelete = vi.fn();
    const { host, commit, cancel } = mountEditor({
      mode: "box",
      initialText: "Hello World",
      onDelete,
    });
    try {
      clickBtn(cancelBtn(host));
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(onDelete).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();

      clickBtn(commitBtn(host));
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit.mock.calls[0]?.[0]).toBe("Hello World");

      clickBtn(deleteBtn(host));
      expect(onDelete).toHaveBeenCalledTimes(1);
      // Deleting must not route through the commit path.
      expect(commit).toHaveBeenCalledTimes(1);
    } finally {
      host.remove();
    }
  });

  it("renders NO Delete button for a text-run edit (nothing to delete)", () => {
    const { host } = mountEditor({ mode: "edit" });
    try {
      expect(host.querySelector(".edit-inline-btn-delete")).toBeNull();
      expect(cancelBtn(host).textContent).toBe("Cancel");
      expect(commitBtn(host).textContent).toBe("Apply");
    } finally {
      host.remove();
    }
  });

  it("after a toolbox drag the commit label switches to Confirm, still one text node (no overlap)", () => {
    const { host, commit } = mountEditor({ mode: "edit", initialText: "Drag me" });
    try {
      stubEditorRect(host);
      const label = host.querySelector<HTMLElement>(".edit-inline-field-font .edit-inline-label");
      if (label === null) throw new Error("label not found");
      expect(host.querySelector('[data-edit-confirm="true"]')).toBeNull();
      pointerdown(label, 100, 100);
      windowMove(300, 220);
      // The drag moved the window; the Confirm affordance is up.
      expect(host.querySelector('[data-edit-confirm="true"]')).not.toBeNull();
      const btn = commitBtn(host);
      expect(btn.textContent).toBe("Confirm");
      // Still exactly one text label — svg + span are gone.
      expect(btn.querySelectorAll("svg, span").length).toBe(0);
      // The Confirm label commits the moved content as before.
      clickBtn(btn);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit.mock.calls[0]?.[0]).toBe("Drag me");
      expect(commit.mock.calls[0]?.[3]).toEqual({ x: 200, y: 120 });
    } finally {
      host.remove();
    }
  });
});

// ---------------------------------------------------------------------------
// SignatureActionBar — shared text-only action buttons

describe("SignatureActionBar — text-only Confirm / Cancel / Delete with the shared style", () => {
  function mountBar(): {
    host: HTMLElement;
    confirm: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const confirm = vi.fn();
    const cancel = vi.fn();
    const del = vi.fn();
    function Harness(): ReactElement {
      return createElement(SignatureActionBar, {
        base: { x: 10, y: 10, width: 100, height: 30 },
        confirmTitle: "Confirm",
        cancelTitle: "Cancel",
        deleteTitle: "Delete",
        onConfirm: confirm,
        onCancel: cancel,
        onDelete: del,
      });
    }
    act((): void => {
      root.render(createElement(Harness));
    });
    return { host, confirm, cancel, del };
  }

  it("renders Confirm / Cancel / Delete with no icons and the toolbox classes", () => {
    const { host } = mountBar();
    try {
      const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-sig-action-bar] button"));
      expect(buttons.length).toBe(3);
      expect(buttons.map((b) => b.textContent)).toEqual(["Confirm", "Cancel", "Delete"]);
      expect(host.querySelectorAll("[data-sig-action-bar] svg").length).toBe(0);
      expect(host.querySelectorAll("[data-sig-action-bar] span").length).toBe(0);
      for (const b of buttons) {
        expect(b.classList.contains("toolbox-action-btn")).toBe(true);
        expect(b.getAttribute("style")).toContain("pointer-events");
      }
      expect(
        host.querySelector('[data-sig-action="confirm"]')?.classList.contains("toolbox-action-btn--confirm"),
      ).toBe(true);
      expect(
        host.querySelector('[data-sig-action="cancel"]')?.classList.contains("toolbox-action-btn--cancel"),
      ).toBe(true);
      expect(
        host.querySelector('[data-sig-action="delete"]')?.classList.contains("toolbox-action-btn--delete"),
      ).toBe(true);
    } finally {
      host.remove();
    }
  });

  it("each button stays clickable (not swallowed by the layer)",
    () => {
      const { host, confirm, cancel, del } = mountBar();
      try {
        const c = host.querySelector<HTMLButtonElement>('[data-sig-action="confirm"]');
        const x = host.querySelector<HTMLButtonElement>('[data-sig-action="cancel"]');
        const d = host.querySelector<HTMLButtonElement>('[data-sig-action="delete"]');
        if (c === null || x === null || d === null) throw new Error("bar buttons missing");
        clickBtn(c);
        clickBtn(x);
        clickBtn(d);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(del).toHaveBeenCalledTimes(1);
      } finally {
        host.remove();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// EditOverlay — the editor's Delete button routes through onDeleteTextBox

describe("EditOverlay — committed text box editor Delete routes through onDeleteTextBox", () => {
  const BOX: TextBoxPlacement = {
    id: "tb-1",
    page: 1,
    rect: { x: 100, y: 100, width: 180, height: 40 },
    text: "DELETE ME",
    style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
    background: "white",
  };

  function mountOverlay(): {
    host: HTMLElement;
    state: () => EditState;
    onDeleteTextBox: ReturnType<typeof vi.fn>;
    onCommitTextBox: ReturnType<typeof vi.fn>;
    onCommitTextBoxMove: ReturnType<typeof vi.fn>;
    onCommitTextEdit: ReturnType<typeof vi.fn>;
    unmount: () => void;
  } {
    const host = document.createElement("div");
    host.style.position = "absolute";
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
    const onDeleteTextBox = vi.fn();
    const onCommitTextBox = vi.fn();
    const onCommitTextBoxMove = vi.fn();
    const onCommitTextEdit = vi.fn();
    let lastState: EditState = { ...initialEditState, tool: "box", textBoxes: [BOX] };
    const render = (): void => {
      act((): void => {
        root.render(
          createElement(EditOverlay, {
            page: 1,
            pageWidthPt: 612,
            pageHeightPt: 792,
            cssScale: 1,
            tool: lastState.tool,
            getTextItems: (): TextItemGeom[] => [],
            edit: lastState,
            dispatch: (action): void => {
              lastState = editReducer(lastState, action);
              render();
            },
            pickImage: async (): Promise<null> => null,
            defaultFont: "Helvetica",
            onCommitTextEdit,
            onCommitTextBox,
            onCommitImageEdit: (): void => undefined,
            onCommitTextBoxMove,
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
      onCommitTextBox,
      onCommitTextBoxMove,
      onCommitTextEdit,
      unmount: (): void => {
        act((): void => {
          root.unmount();
        });
        host.remove();
      },
    };
  }

  it("a DOUBLE-CLICKED committed box reopens the editor WITH a Delete button; clicking it deletes the box and closes the editor without committing", () => {
    const { host, onDeleteTextBox, onCommitTextBox, onCommitTextBoxMove, onCommitTextEdit, unmount } = mountOverlay();
    try {
      const box = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      if (box === null) throw new Error("box not found");
      pointerdown(box, 120, 120);
      pointerup(box, 120, 120);
      // DEF-153 — the single click only selects (bar); double click
      // opens the edit toolbox.
      expect(host.querySelector('[data-edit-editor="edit"]'), "single click must not open the editor").toBeNull();
      act((): void => {
        box.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 120, clientY: 120 }));
      });
      // The committed box reopens as an editor pre-filled with its
      // committed text (the "edit" mode, same as DEF-150's flow)...
      expect(host.querySelector('[data-edit-editor="edit"]')).not.toBeNull();
      // ...and the Delete button appears (a committed box CAN be
      // deleted from the editor).
      const del = host.querySelector<HTMLButtonElement>(".edit-inline-btn-delete");
      expect(del).not.toBeNull();
      expect(del?.textContent).toBe("Delete");
      expect(host.querySelectorAll(".edit-inline-toolbar-actions svg").length).toBe(0);
      clickBtn(del as HTMLButtonElement);
      // Deletion closes the editor and routes through the host's
      // engine.deleteTextBox callback — never a commit path.
      expect(host.querySelector('[data-edit-editor="edit"]')).toBeNull();
      expect(onDeleteTextBox).toHaveBeenCalledTimes(1);
      expect(onDeleteTextBox.mock.calls[0]?.[0]).toBe(BOX.id);
      expect(onCommitTextBox).not.toHaveBeenCalled();
      expect(onCommitTextBoxMove).not.toHaveBeenCalled();
      expect(onCommitTextEdit).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("a NEWLY-dragged (uncommitted) box editor has NO Delete button (nothing to delete)", () => {
    const { host, onDeleteTextBox, unmount } = mountOverlay();
    try {
      // Drag out a new box: press + move + release creates an
      // uncommitted textTarget with empty text (no textBoxId).
      const layer = host.querySelector<HTMLElement>('[data-tool="box"]');
      if (layer === null) throw new Error("layer not found");
      pointerdown(layer, 200, 200);
      windowMove(300, 260);
      pointerup(layer, 300, 260);
      expect(host.querySelector('[data-edit-editor="box"]')).not.toBeNull();
      expect(host.querySelector(".edit-inline-btn-delete")).toBeNull();
      expect(onDeleteTextBox).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});