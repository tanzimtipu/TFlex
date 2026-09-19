// @vitest-environment jsdom
//
// Phase 20 chunk 3 — the migrated floating toolboxes keep their exit
// window SAFE:
//
//   1. after Confirm/Cancel the toolbox stays mounted for the TfBar exit
//      (AnimatePresence) instead of popping;
//   2. while exiting it carries `inert`, so the subtree is non-interactive
//      (a held Ctrl+Enter key-repeat cannot re-fire the stale commit
//      closure and duplicate the annotation) and leaves the accessibility
//      tree for the exit window;
//   3. it leaves the DOM once the exit completes.
//
// jsdom does not implement inert's interaction semantics, so the test
// pins the attribute (the contract the browser acts on) rather than the
// blocked event.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function mountOverlay(tool: AnnotationToolState): {
  host: HTMLElement;
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
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const root = createRoot(host);
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={[]}
        tool={tool}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={vi.fn() as (a: Annotation) => void}
        onFinishedOneShot={(): void => undefined}
      />,
    );
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickLayer(host: HTMLElement, x: number, y: number): void {
  const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
  if (layer === null) throw new Error("layer not found");
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }),
    );
  });
}

describe("Phase 20 chunk 3 — exiting toolboxes are inert and then unmount", () => {
  it("the textbox toolbox carries inert during its TfBar exit and unmounts after", async () => {
    const { host, cleanup } = mountOverlay({ tool: "textbox", color: "yellow", penWidth: 2 });
    try {
      clickLayer(host, 100, 100);
      const editor = host.querySelector<HTMLElement>("[data-annotation-editor='textbox']");
      expect(editor).not.toBeNull();
      // While present the toolbox is interactive (no inert).
      expect(editor?.hasAttribute("inert")).toBe(false);

      const cancel = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='textbox-cancel']",
      );
      if (cancel === null) throw new Error("Cancel not found");
      act((): void => {
        cancel.click();
      });

      // Exiting: still mounted, now inert (the keyboard-repeat guard).
      const exiting = host.querySelector<HTMLElement>("[data-annotation-editor='textbox']");
      expect(exiting, "the toolbox exits through AnimatePresence, not a pop").not.toBeNull();
      expect(exiting?.hasAttribute("inert"), "the exiting toolbox must be inert").toBe(true);

      await settleMotion();
      expect(host.querySelector("[data-annotation-editor='textbox']")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("the note editor carries inert during its TfBar exit and unmounts after", async () => {
    const { host, cleanup } = mountOverlay({ tool: "note", color: "yellow", penWidth: 2 });
    try {
      clickLayer(host, 140, 140);
      expect(host.querySelector("[data-annotation-editor='note']")).not.toBeNull();
      const cancel = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='note-cancel']",
      );
      if (cancel === null) throw new Error("Cancel not found");
      act((): void => {
        cancel.click();
      });
      const exiting = host.querySelector<HTMLElement>("[data-annotation-editor='note']");
      expect(exiting).not.toBeNull();
      expect(exiting?.hasAttribute("inert")).toBe(true);
      await settleMotion();
      expect(host.querySelector("[data-annotation-editor='note']")).toBeNull();
    } finally {
      cleanup();
    }
  });
});
