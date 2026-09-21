// @vitest-environment jsdom
//
// Bugs 1 / 2 / 3 — the committed-annotation toolbox model:
//   - Bug 1: opening an edit toolbox (double-click / bar Edit)
//     disarms the annotation CREATION tool (onDisarmTool).
//   - Bug 2: confirming a move does NOT snap the content back to the
//     engine's original position while the edit echo round-trips — the draft
//     stays until the edited annotation (same id + geometry) lands in the
//     list.
//   - Bug 3: dragging the NOTE EDITOR toolbox moves the note WITH it
//     — Confirm commits the anchor shifted by the toolbox's drag
//     offset (one in-place `at` edit, DEF-267).
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import {
  applyPatch,
  type Annotation,
  type AnnotationPatch,
  type AnnotationToolState,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE_ANN: Annotation = {
  id: "note-1",
  kind: "note",
  page: 1,
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
  at: { x: 60, y: 300 },
  text: "note text",
};

const TEXTBOX_ANN: Annotation = {
  id: "tbx-1",
  kind: "textbox",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 200, y: 200, width: 160, height: 60 },
  text: "SOME BOX TEXT",
};

const NOTE_TOOL: AnnotationToolState = { tool: "note", color: "yellow", penWidth: 2 };
const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "yellow", penWidth: 2 };

function mountOverlay(args: {
  annotations?: Annotation[];
  onEditAnnotation?: (id: string, patch: { text?: string; color?: string }) => void;
  onDeleteAnnotation?: (id: string) => void;
  onCreate?: (a: Annotation) => void;
  onDisarmTool?: () => void;
  tool?: AnnotationToolState;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onEditAnnotation: ReturnType<typeof vi.fn>;
  onDeleteAnnotation: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
  onDisarmTool: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
  const root = createRoot(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const onEditAnnotation = vi.fn(args.onEditAnnotation ?? ((): void => undefined));
  const onDeleteAnnotation = vi.fn(args.onDeleteAnnotation ?? ((): void => undefined));
  const onCreate = vi.fn(args.onCreate ?? ((): void => undefined));
  const onDisarmTool = vi.fn(args.onDisarmTool ?? ((): void => undefined));
  const tool = args.tool ?? SELECT_TOOL;
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={args.annotations ?? []}
        tool={tool}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={onCreate}
        onFinishedOneShot={undefined}
        onEditAnnotation={onEditAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onDisarmTool={onDisarmTool}
      />,
    );
  });
  return {
    host,
    root,
    onEditAnnotation,
    onDeleteAnnotation,
    onCreate,
    onDisarmTool,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickEl(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}


function press(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function moveOn(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function releaseOn(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function barConfirm(host: HTMLElement): HTMLButtonElement {
  const btn = host.querySelector<HTMLButtonElement>("[data-content-action$='-confirm']");
  if (btn === null) throw new Error("Confirm button not found");
  return btn;
}

describe("Bug 1 / Phase 26 — clicking a text element disarms the armed creation tool", () => {
  it("clicking a committed textbox while the NOTE tool is armed calls onDisarmTool and opens NO in-canvas editor", () => {
    const { host, onDisarmTool, cleanup } = mountOverlay({
      annotations: [TEXTBOX_ANN],
      tool: NOTE_TOOL,
    });
    try {
      const tbx = host.querySelector<HTMLElement>("[data-annotation-id='tbx-1']");
      if (tbx === null) throw new Error("textbox not found");
      clickEl(tbx);
      // Phase 26 — no in-canvas editor exists; the click selects the
      // annotation and asks the host to focus the panel Text field.
      expect(host.querySelector("[data-annotation-editor]")).toBeNull();
      expect(onDisarmTool).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe("Bug 2 — confirming a move does not snap the content back to the original position", () => {
  it("after Confirm the note stays at the MOVED position while the edit echo is pending, then the echo clears the draft", () => {
    const { host, root, onEditAnnotation, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({
      annotations: [NOTE_ANN],
    });
    try {
      const icon = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
      if (icon === null || layer === null) throw new Error("note / layer not found");
      // Drag the note by (+30, +30) client px (cssScale 1). The move
      // commits on pointerup; the engine list still has the ORIGINAL note.
      press(icon, 65, 305);
      moveOn(layer, 95, 335);
      releaseOn(layer, 95, 335);
      clickEl(barConfirm(host));
      // DEF-267 — the move is ONE in-place edit of the note's `at` anchor.
      // The old delete + re-create (and the fresh selection event it fired)
      // is gone.
      expect(onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(onEditAnnotation.mock.calls[0]?.[0]).toBe("note-1");
      expect(onEditAnnotation.mock.calls[0]?.[1]).toEqual({ at: { x: 90, y: 330 } });
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
      // Bug 2 — the draft must KEEP the moved geometry until the edit
      // echo lands: the rendered note reads the draft override, so it shows
      // the MOVED position even though the annotations prop still holds the
      // original note.
      const rendered = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      if (rendered === null) throw new Error("note not rendered after confirm");
      expect(rendered.style.left).toBe("90px");
      expect(rendered.style.top).toBe("330px");
      // Simulate the engine echo: the in-place edit returns the SAME id with
      // the moved anchor. The draft clears and the note is STILL at the moved
      // position — no visual snap-back.
      const patch = onEditAnnotation.mock.calls[0]?.[1] as AnnotationPatch;
      const echoed = applyPatch(NOTE_ANN, patch);
      act((): void => {
        root.render(
          <AnnotationOverlay
            page={1}
            widthPt={612}
            heightPt={792}
            cssScale={1}
            annotations={[echoed]}
            tool={SELECT_TOOL}
            flashId={null}
            getTextItems={(): never[] => []}
            onCreate={onCreate as (a: Annotation) => void}
            onEditAnnotation={(): void => undefined}
            onDeleteAnnotation={onDeleteAnnotation as (id: string) => void}
            onDisarmTool={(): void => undefined}
          />,
        );
      });
      const after = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      if (after === null) throw new Error("note not rendered after echo");
      expect(after.style.left).toBe("90px");
      expect(after.style.top).toBe("330px");
    } finally {
      cleanup();
    }
  });
});

describe("Bug 3 — dragging the note moves it with the selection chrome", () => {
  it("Confirm after dragging the note icon commits it at the shifted anchor", () => {
    const { host, onEditAnnotation, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({
      annotations: [NOTE_ANN],
    });
    try {
      const icon = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
      if (icon === null || layer === null) throw new Error("note / layer not found");
      // Drag the icon by (+30, +30) client px (cssScale 1) — the same
      // page move the old toolbox drag performed, now driven from the
      // icon's own surface.
      press(icon, 65, 305);
      moveOn(layer, 95, 335);
      act((): void => {
        layer.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 95, clientY: 335 }));
      });
      const confirm = host.querySelector<HTMLButtonElement>("[data-content-action='ann-note-confirm']");
      if (confirm === null) throw new Error("note confirm not found");
      clickEl(confirm);
      // DEF-267 — commit = ONE in-place `at` edit at the shifted anchor.
      expect(onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(onEditAnnotation.mock.calls[0]?.[0]).toBe("note-1");
      expect(onEditAnnotation.mock.calls[0]?.[1]).toEqual({ at: { x: 90, y: 330 } });
      expect(onDeleteAnnotation).not.toHaveBeenCalled();
      expect(onCreate).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});
