// @vitest-environment jsdom
//
// Bugs 1 / 2 / 3 — the committed-annotation toolbox model:
//   - Bug 1: opening an edit toolbox (double-click / bar Edit)
//     disarms the annotation CREATION tool (onDisarmTool).
//   - Bug 2: confirming a move does NOT snap the content back to the
//     engine's original position while the delete+recreate echo
//     round-trips — the draft stays until the recreated annotation
//     (same id + geometry) lands in the list.
//   - Bug 3: dragging the NOTE EDITOR toolbox moves the note WITH it
//     — Confirm commits the anchor shifted by the toolbox's drag
//     offset (delete + re-create at the moved position).
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
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

function dblClick(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
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

describe("Bug 1 — opening an edit toolbox disarms the armed creation tool", () => {
  it("double-clicking a committed textbox while the NOTE tool is armed calls onDisarmTool", () => {
    const { host, onDisarmTool, cleanup } = mountOverlay({
      annotations: [TEXTBOX_ANN],
      tool: NOTE_TOOL,
    });
    try {
      const tbx = host.querySelector<HTMLElement>("[data-annotation-id='tbx-1']");
      if (tbx === null) throw new Error("textbox not found");
      dblClick(tbx);
      // The text edit toolbox opens.
      expect(host.querySelector("[data-annotation-editor='edit-textbox']")).not.toBeNull();
      expect(onDisarmTool).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });
});

describe("Bug 2 — confirming a move does not snap the content back to the original position", () => {
  it("after Confirm the note stays at the MOVED position while the recreate echo is pending, then the echo clears the draft", () => {
    const { host, root, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({
      annotations: [NOTE_ANN],
    });
    try {
      const icon = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
      if (icon === null || layer === null) throw new Error("note / layer not found");
      // Drag the note by (+30, +30) client px (cssScale 1). This parks
      // a PENDING move; the engine list still has the ORIGINAL note.
      press(icon, 65, 305);
      moveOn(layer, 95, 335);
      releaseOn(layer, 95, 335);
      clickEl(barConfirm(host));
      // The delete + recreate were issued.
      expect(onDeleteAnnotation).toHaveBeenCalledWith("note-1");
      expect(onCreate).toHaveBeenCalledTimes(1);
      const created = onCreate.mock.calls[0]?.[0] as Annotation & { at: { x: number; y: number } };
      expect(created.at).toEqual({ x: 90, y: 330 });
      // Bug 2 — the draft must KEEP the moved geometry until the
      // recreate-echo lands: the rendered note reads the draft
      // override, so it shows the MOVED position even though the
      // annotations prop still holds the original note.
      const rendered = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      if (rendered === null) throw new Error("note not rendered after confirm");
      expect(rendered.style.left).toBe("90px");
      expect(rendered.style.top).toBe("330px");
      // Simulate the engine echo: the recreated annotation (same id +
      // moved geometry) arrives in the list. The draft clears and the
      // note is STILL at the moved position — no visual snap-back.
      act((): void => {
        root.render(
          <AnnotationOverlay
            page={1}
            widthPt={612}
            heightPt={792}
            cssScale={1}
            annotations={[created]}
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

describe("Bug 3 — dragging the note-edit toolbox moves the note with it", () => {
  it("Confirm after dragging the editor commits the note at the shifted anchor", () => {
    const { host, onDeleteAnnotation, onCreate, cleanup } = mountOverlay({
      annotations: [NOTE_ANN],
    });
    try {
      const icon = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      if (icon === null) throw new Error("note icon not found");
      dblClick(icon);
      const editor = host.querySelector<HTMLElement>("[data-annotation-editor='note']");
      if (editor === null) throw new Error("note editor not found");
      // Drag the editor WINDOW by its chrome (the grip is the first
      // child; a press on it starts the useDragWindow move) by
      // (+20, +10) client px.
      const grip = editor.querySelector<HTMLElement>("[data-drag-grip='note']");
      if (grip === null) throw new Error("note grip not found");
      press(grip, 200, 320);
      act((): void => {
        window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 220, clientY: 330 }));
      });
      act((): void => {
        window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      });
      const confirm = host.querySelector<HTMLButtonElement>("[data-annotation-action='note-confirm']");
      if (confirm === null) throw new Error("note confirm not found");
      clickEl(confirm);
      // Commit = delete + re-create at the shifted anchor.
      expect(onDeleteAnnotation).toHaveBeenCalledWith("note-1");
      const created = onCreate.mock.calls[0]?.[0] as Annotation & { at: { x: number; y: number } };
      expect(created.kind).toBe("note");
      expect(created.at).toEqual({ x: 80, y: 310 });
    } finally {
      cleanup();
    }
  });
});