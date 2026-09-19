// @vitest-environment jsdom
//
// DEF-149 / DEF-150 — edit-content overlay text/box behavior.
//
// DEF-149(a): `engine.editTextRun` MASKS (never removes) the old run,
// so pdf.js getTextContent() returns BOTH the masked OLD text and the
// NEW text at the same rect. Re-clicking the edited run must open the
// editor with the NEW text — the run matching the NEWEST committed
// text for that (page, click-point) — never the first (old) item.
//
// DEF-149(b) / DEF-150: a floating editor (toolbox) drag is a WINDOW
// drag. Confirm must commit the CONTENT at the moved rect (anchor
// rect + drag offset / cssScale), not the original anchor; a
// re-opened COMMITTED box must route through the box-update path
// (registry mirror + engine.moveTextBox) — never the text-run
// editTextRun path that re-bakes a duplicate copy into the file
// (AGENTS.md guardrail #4 + DEF-150 document-safety).

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
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

/**
 * Mount the EditOverlay with a real local reducer (so box upserts
 * land in `state()`) and spies for the host commit handlers.
 */
function mountOverlay(initial: EditState, getTextItems: () => TextItemGeom[] = () => []): {
  host: HTMLElement;
  state: () => EditState;
  onCommitTextEdit: ReturnType<typeof vi.fn>;
  onCommitTextBox: ReturnType<typeof vi.fn>;
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
  const onCommitTextEdit = vi.fn();
  const onCommitTextBox = vi.fn();
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
          getTextItems,
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
        }),
      );
    });
  };
  render();
  return {
    host,
    state: (): EditState => lastState,
    onCommitTextEdit,
    onCommitTextBox,
    onCommitTextBoxMove,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
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

// DEF-153 — the text-run editor opens on DOUBLE click (single click
// selects the run + shows the Confirm/Edit/Delete bar). The
// window-level dblclick listener computes the run at the point.
function textDblClick(x: number, y: number): void {
  act((): void => {
    window.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
  });
}

// DEF-153 — a committed box's edit toolbox opens on DOUBLE click;
// single click selects it (Confirm / Edit / Delete bar).
function boxDblClick(box: HTMLElement, x: number, y: number): void {
  act((): void => {
    box.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
  });
}

function windowMove(x: number, y: number): void {
  act((): void => {
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function windowUp(x: number, y: number): void {
  act((): void => {
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}



/** jsdom does no layout — give the editor a rect that tracks its own
 *  inline style so useDragWindow's window-rect math sees a realistic
 *  surface (same technique as bugDEF140). */
function stubEditorRect(host: HTMLElement, width = 200, height = 180): HTMLElement {
  const editor = host.querySelector<HTMLElement>(".edit-inline-editor");
  if (editor === null) throw new Error("editor not found");
  editor.getBoundingClientRect = (): DOMRect => {
    const left = Number.parseFloat(editor.style.left) || 0;
    const top = Number.parseFloat(editor.style.top) || 0;
    return {
      left, top, width, height,
      right: left + width, bottom: top + height, x: left, y: top,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return editor;
}

function textarea(host: HTMLElement): HTMLTextAreaElement {
  const ta = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
  if (ta === null) throw new Error("textarea not found");
  return ta;
}

function typeText(host: HTMLElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(textarea(host), text);
    textarea(host).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function commitBtn(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>(".edit-inline-btn-commit");
  if (btn === null) throw new Error("commit button not found");
  return btn;
}

function clickCommit(host: HTMLElement): void {
  act((): void => {
    commitBtn(host).click();
  });
}

// ---------------------------------------------------------------------------
// DEF-149(a) — re-click on an edited run opens the NEW text

describe("DEF-149 — re-clicking an edited text run selects the NEW text", () => {
  const OLD = { x: 100, y: 100, width: 200, height: 30, text: "TFlex Technical Report" };
  const BODY = { x: 100, y: 150, width: 300, height: 20, text: "A study in PDF orchestration" };
  const NEW_RUN = { x: 100, y: 100, width: 200, height: 30, text: "NEW TITLE 123" };

  const TEXT_ITEMS: TextItemGeom[] = [OLD, BODY, NEW_RUN];
  const COMMITTED: EditState["committedTextRuns"] = [
    { page: 1, rect: { x: 100, y: 100, width: 200, height: 30 }, text: "NEW TITLE 123" },
  ];

  it("prefers the newest committed run's text over the masked old run (the DEF-149 repro)", () => {
    const { host, unmount } = mountOverlay({
      ...initialEditState,
      tool: "text",
      committedTextRuns: COMMITTED,
    }, () => TEXT_ITEMS);
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      // The click point is inside BOTH the old run and the engine's
      // new run (same rect, first/last in getTextItems). The fix must
      // match the committed "NEW TITLE 123", never the first (old) hit.
      pointerdown(layer, 120, 115);
      // DEF-153 — single click SELECTS the run (movable).
      const sel = host.querySelector<HTMLElement>("[data-textrun-selection]");
      expect(sel).not.toBeNull();
      expect(sel?.dataset.textrunText).toBe("NEW TITLE 123");
      // Double click opens the editor with the same (newest) text.
      textDblClick(120, 115);
      expect(textarea(host).value).toBe("NEW TITLE 123");
    } finally {
      unmount();
    }
  });

  it("an unedited run keeps the original first-hit behavior", () => {
    const { host, unmount } = mountOverlay({
      ...initialEditState,
      tool: "text",
      committedTextRuns: [],
    }, () => TEXT_ITEMS);
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      pointerdown(layer, 120, 115);
      const sel = host.querySelector<HTMLElement>("[data-textrun-selection]");
      expect(sel?.dataset.textrunText).toBe("TFlex Technical Report");
      textDblClick(120, 115);
      expect(textarea(host).value).toBe("TFlex Technical Report");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-149(b) — dragging the floating editor + confirm commits at the MOVED rect

describe("DEF-149 (b) — the toolbox drag offset moves the committed run", () => {
  const OLD = { x: 100, y: 100, width: 200, height: 30, text: "TFlex Technical Report" };
  const NEW_RUN = { x: 100, y: 100, width: 200, height: 30, text: "NEW TITLE 123" };
  const TEXT_ITEMS: TextItemGeom[] = [OLD, NEW_RUN];

  it("text-run commit lands at rect + offset/cssScale and records the moved run", () => {
    const { host, state, onCommitTextEdit, unmount } = mountOverlay({
      ...initialEditState,
      tool: "text",
    }, () => TEXT_ITEMS);
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      pointerdown(layer, 120, 115);
      textDblClick(120, 115);
      const editor = stubEditorRect(host);
      // Drag the toolbox chrome +200/+120 (same window-drag math as
      // bugDEF140: pointerdown on a label span, then window moves).
      const label = host.querySelector<HTMLElement>(".content-grip-inline");
      if (label === null) throw new Error("label not found");
      pointerdown(label, 100, 100);
      windowMove(300, 220);
      // The editor window followed the pointer.
      expect(editor.style.left).toBe("300px");
      expect(editor.style.top).toBe("220px");
      // DEF-150(b) — the confirm affordance appears after the move.
      expect(host.querySelector('[data-edit-confirm="true"]')).not.toBeNull();
      clickCommit(host);
      // The run is committed at the MOVED rect (anchor 100,100 at
      // cssScale 1 + offset 200,120) — never the stale anchor.
      expect(onCommitTextEdit).toHaveBeenCalledTimes(1);
      const call = onCommitTextEdit.mock.calls[0]?.[0];
      expect(call).toMatchObject({ newText: "TFlex Technical Report" });
      expect(call.rect).toEqual({ x: 300, y: 220, width: 200, height: 30 });
      // DEF-151 — a MOVE commit also carries the run's ORIGINAL rect
      // so the engine masks the old position and draws only at the
      // moved rect (no duplicate bake).
      expect(call.oldRect).toEqual({ x: 100, y: 100, width: 200, height: 30 });
      // The committed-run record tracks the moved rect + text so a
      // later re-click at the NEW position prefers this run.
      expect(state().committedTextRuns).toEqual([
        { page: 1, rect: { x: 300, y: 220, width: 200, height: 30 }, text: "TFlex Technical Report" },
      ]);
    } finally {
      unmount();
    }
  });

  it("DEF-151 — real sequence: drag the toolbox, RELEASE (pointerup), then a SEPARATE Confirm click still commits the MOVED rect, not the original (rect !== oldRect)", () => {
    const { host, onCommitTextEdit, unmount } = mountOverlay({
      ...initialEditState,
      tool: "text",
    }, () => TEXT_ITEMS);
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      pointerdown(layer, 120, 115);
      textDblClick(120, 115);
      stubEditorRect(host);
      const label = host.querySelector<HTMLElement>(".content-grip-inline");
      if (label === null) throw new Error("label not found");
      // Real drag: press chrome, move +200/+120, then RELEASE.
      pointerdown(label, 100, 100);
      windowMove(300, 220);
      const confirmShown = host.querySelector('[data-edit-confirm="true"]') !== null;
      expect(confirmShown, "the Confirm-move affordance must be visible after the drag").toBe(true);
      windowUp(300, 220); // user lets go of the mouse
      // The affordance must survive the release (the window stays moved).
      expect(host.querySelector('[data-edit-confirm="true"]')).not.toBeNull();
      // A SEPARATE, later click on Confirm — the release is a distinct
      // event, so the offset must survive until this commit reads it.
      clickCommit(host);
      expect(onCommitTextEdit).toHaveBeenCalledTimes(1);
      const call = onCommitTextEdit.mock.calls[0]?.[0];
      // The payload carries rect = MOVED (100,100 + 200,120 at cssScale 1)
      // AND oldRect = the ORIGINAL anchor — guardrail #4 (content moves
      // with the toolbox) is satisfied exactly.
      expect(call.rect).toEqual({ x: 300, y: 220, width: 200, height: 30 });
      expect(call.oldRect).toEqual({ x: 100, y: 100, width: 200, height: 30 });
      expect(JSON.stringify(call.rect)).not.toBe(JSON.stringify(call.oldRect));
    } finally {
      unmount();
    }
  });

  it("a plain in-place edit (no toolbox drag) commits WITHOUT oldRect", () => {
    const { host, onCommitTextEdit, unmount } = mountOverlay({
      ...initialEditState,
      tool: "text",
    }, () => TEXT_ITEMS);
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      pointerdown(layer, 120, 115);
      textDblClick(120, 115);
      stubEditorRect(host);
      // No drag -> the normal Apply label is in place (no move).
      expect(host.querySelector('[data-edit-confirm="true"]')).toBeNull();
      clickCommit(host);
      expect(onCommitTextEdit).toHaveBeenCalledTimes(1);
      const call = onCommitTextEdit.mock.calls[0]?.[0];
      // Unmoved: rect stays at the anchor and oldRect is absent.
      expect(call.rect).toEqual({ x: 100, y: 100, width: 200, height: 30 });
      expect(call.oldRect).toBeUndefined();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-150 — add-box toolbox move + confirm (no duplicate bake)

describe("DEF-150 — add-box toolbox move + confirm (no duplicate bake)", () => {
  const BOX: TextBoxPlacement = {
    id: "tb-1",
    page: 1,
    rect: { x: 100, y: 100, width: 180, height: 40 },
    text: "MOVE TEST 88",
    style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
    background: "white",
  };

  it("a single-click committed box SELECTS it (Confirm/Edit/Delete bar); double-click reopens the box editor pre-filled with the box text", () => {
    const { host, unmount } = mountOverlay({
      ...initialEditState,
      tool: "box",
      textBoxes: [BOX],
    });
    try {
      const box = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      if (box === null) throw new Error("box not found");
      pointerdown(box, 120, 120);
      pointerup(box, 120, 120);
      // DEF-153 — the single click SELECTS + makes movable (the bar
      // with Confirm / Edit / Delete); it must NOT open the editor.
      expect(host.querySelector('[data-edit-editor="edit"]')).toBeNull();
      const bar = host.querySelector("[data-edit-box-toolbar]");
      expect(bar, "selected box shows the action bar").not.toBeNull();
      expect(host.querySelector("[data-edit-box-action='confirm']"), "DEF-152 — bar carries Confirm").not.toBeNull();
      expect(host.querySelector("[data-edit-box-action='edit']")).not.toBeNull();
      expect(host.querySelector("[data-edit-box-action='delete']")).not.toBeNull();
      // Double click opens the edit toolbox.
      boxDblClick(box, 120, 120);
      expect(host.querySelector('[data-edit-editor="edit"]')).not.toBeNull();
      expect(textarea(host).value).toBe("MOVE TEST 88");
    } finally {
      unmount();
    }
  });

  it("drag +200/+120: the box mirror follows MID-DRAG, Confirm commits the moved rect via the BOX path (never the text-run path)", () => {
    const { host, onCommitTextBoxMove, onCommitTextEdit, unmount } = mountOverlay({
      ...initialEditState,
      tool: "box",
      textBoxes: [BOX],
    });
    try {
      const box = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      if (box === null) throw new Error("box not found");
      pointerdown(box, 120, 120);
      pointerup(box, 120, 120);
      boxDblClick(box, 120, 120);
      stubEditorRect(host);
      // No drag yet -> the normal Apply label is in place.
      expect(host.querySelector('[data-edit-confirm="true"]')).toBeNull();
      const label = host.querySelector<HTMLElement>(".content-grip-inline");
      if (label === null) throw new Error("label not found");
      pointerdown(label, 200, 200);
      windowMove(400, 320);
      // Window moved by +200/+120, Confirm is now visible (b).
      expect(host.querySelector('[data-edit-confirm="true"]')).not.toBeNull();
      // The box mirror follows the toolbox mid-drag: registry rect
      // (100,100) + offset (200,120) -> the surface sits at 300,220.
      const movedBox = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      expect(movedBox?.style.left).toBe("300px");
      expect(movedBox?.style.top).toBe("220px");
      clickCommit(host);
      // BOX path only: the registry move commits; the text-run path
      // that re-bakes a duplicate is never touched (DEF-150c).
      expect(onCommitTextEdit).not.toHaveBeenCalled();
      expect(onCommitTextBoxMove).toHaveBeenCalledTimes(1);
      const call = onCommitTextBoxMove.mock.calls[0]?.[0];
      expect(call.oldRect).toEqual({ x: 100, y: 100, width: 180, height: 40 });
      expect(call.newRect).toEqual({ x: 300, y: 220, width: 180, height: 40 });
      expect(call.text).toBe("MOVE TEST 88");
      expect(call.id).toBe(BOX.id);
    } finally {
      unmount();
    }
  });

  it("re-opening a committed box and confirming WITHOUT moving performs no engine write at all", () => {
    const { host, onCommitTextBoxMove, onCommitTextEdit, unmount } = mountOverlay({
      ...initialEditState,
      tool: "box",
      textBoxes: [BOX],
    });
    try {
      const box = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      if (box === null) throw new Error("box not found");
      pointerdown(box, 120, 120);
      pointerup(box, 120, 120);
      boxDblClick(box, 120, 120);
      // Keep the text; commit. No move -> NO engine call -> a Save
      // bakes exactly the single registry entry (exactly ONE copy).
      clickCommit(host);
      expect(onCommitTextEdit).not.toHaveBeenCalled();
      expect(onCommitTextBoxMove).not.toHaveBeenCalled();
      expect(host.querySelector(`[data-edit-box-id="${BOX.id}"]`)).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("committing a reopened box with EDITED text updates the local mirror but never the text-run path", () => {
    const { host, state, onCommitTextEdit, unmount } = mountOverlay({
      ...initialEditState,
      tool: "box",
      textBoxes: [BOX],
    });
    try {
      const box = host.querySelector<HTMLElement>(`.edit-box[data-edit-box-id="${BOX.id}"]`);
      if (box === null) throw new Error("box not found");
      pointerdown(box, 120, 120);
      pointerup(box, 120, 120);
      boxDblClick(box, 120, 120);
      typeText(host, "EDITED 99");
      clickCommit(host);
      // The live registry mirror adopts the new text; the text-run
      // edit path (the duplicate source) is never called.
      expect(state().textBoxes[0]?.text).toBe("EDITED 99");
      expect(onCommitTextEdit).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});