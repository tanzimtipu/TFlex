// @vitest-environment jsdom
//
// DEF-096 + Bug 3 — a committed sticky-note icon must be interactable
// AND double-clickable: double-click opens the note editor pre-filled
// with the note's existing text (view/edit), with Confirm routing an
// edit patch, Delete removing the note, and Cancel closing. A single
// click only SELECTS the note (the Confirm / Edit / Delete bar) —
// Bug 3 moved the "enter edit toolbox" gesture from single click to
// double click so every annotation kind shares the same model.
//
// Root cause traced: prior fixes only touched CSS (pointer-events:
// auto, z-index) and asserted the styles were PRESENT — but the
// committed `.ann-note` had no click handler at all, so a click
// that reached the icon was still a silent no-op. Additionally, the
// overlay's catch-all pointerdown treated a click on a committed
// note icon as a page-canvas click, opening a BLANK create editor
// on top of the existing note; the interactive-ancestor bail-out
// now includes `.ann-note` so the icon's own handler wins.
//
// Coverage (behavior):
//   1. Single click selects the note (bar shows, NO editor opens).
//   2. double-click opens ONE editor, pre-filled with the note's own
//      text (never a blank create editor).
//   3. Confirm applies the edited text via onEditAnnotation(id,
//      { text }).
//   4. Delete removes the note via onDeleteAnnotation(id).
//   5. Cancel closes without calling either.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the note editor is a TfBar inside an AnimatePresence, so
 *  its DOM removal completes after the exit animation. */

const COMMITTED_NOTE: Annotation = {
  id: "note-1",
  kind: "note",
  page: 1,
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
  at: { x: 100, y: 120 },
  text: "original note text",
};

function mountOverlay(args: {
  annotations?: Annotation[];
  onEditAnnotation?: (id: string, patch: { text?: string; color?: string }) => void;
  onDeleteAnnotation?: (id: string) => void;
  onCreate?: (a: Annotation) => void;
  tool?: AnnotationToolState;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onEditAnnotation: ReturnType<typeof vi.fn>;
  onDeleteAnnotation: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
  onTextFocusRequest: ReturnType<typeof vi.fn>;
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
  const onTextFocusRequest = vi.fn();
  const tool: AnnotationToolState = args.tool ?? {
    tool: "select",
    color: "yellow",
    penWidth: 2,
  };
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
        onTextFocusRequest={onTextFocusRequest}
      />,
    );
  });
  return {
    host,
    root,
    onEditAnnotation,
    onDeleteAnnotation,
    onCreate,
    onTextFocusRequest,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Fire the full double-click sequence the browser produces:
 *  two clicks followed by the dblclick event. */
function dblClick(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  });
}

describe("DEF-096 / Bug 3 / Phase 26 — committed note icon interaction", () => {
  it("a single click SELECTS the note (bar shows, no editor opens) and requests the panel text focus", () => {
    const { host, onCreate, onEditAnnotation, onTextFocusRequest, cleanup } = mountOverlay({
      annotations: [COMMITTED_NOTE],
    });
    try {
      const icon = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      if (icon === null) throw new Error("note icon not found");
      act((): void => {
        icon.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, clientX: 105, clientY: 125 }),
        );
      });
      act((): void => {
        icon.click();
      });
      // Phase 26 — no in-canvas editor exists at all.
      expect(host.querySelector("[data-annotation-editor]")).toBeNull();
      // It selects instead: the Confirm / Delete bar renders.
      expect(
        host.querySelector("[data-content-action-bar='ann-note']"),
      ).not.toBeNull();
      // The host is asked to focus the panel's Text field (the single
      // text-editing surface).
      expect(onTextFocusRequest).toHaveBeenCalledWith("note-1");
      expect(onCreate).not.toHaveBeenCalled();
      expect(onEditAnnotation).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("double-clicking the note opens NO editor (a double-click is just a click)", () => {
    const { host, cleanup } = mountOverlay({ annotations: [COMMITTED_NOTE] });
    try {
      const icon = host.querySelector<HTMLElement>("[data-annotation-id='note-1']");
      if (icon === null) throw new Error("note icon not found");
      dblClick(icon);
      expect(host.querySelector("[data-annotation-editor]")).toBeNull();
      expect(host.querySelector("textarea")).toBeNull();
      expect(host.querySelector("[data-content-action-bar='ann-note']")).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});
