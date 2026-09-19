// @vitest-environment jsdom
//
// B4 — sticky note floating selector: Confirm / Cancel / Delete
// buttons above the note (Sign-like). Icon and textarea are
// co-located in the same wrapper so they read as one floating
// unit. The Delete button is a third explicit affordance (in
// addition to Cancel) so the user has the same vocabulary as
// every other one-shot tool.
//
// We exercise the AnnotationOverlay in isolation with the note
// tool armed, simulate a page click to open the editor, type
// into the textarea, and assert:
//   1. The editor renders three buttons: Confirm / Cancel /
//      Delete.
//   2. Confirm commits the annotation (calls onCreate).
//   3. Cancel drops the editor without saving.
//   4. Delete drops the editor without saving.
//   5. The icon is rendered inside the editor wrapper (same
//      parent as the textarea) — co-located.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the note editor is a TfBar inside an AnimatePresence, so
 *  its DOM removal completes after the exit animation. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

function mountOverlay(args: {
  onCreate?: (a: Annotation) => void;
  tool: AnnotationToolState;
}): {
  host: HTMLElement;
  onCreate: ReturnType<typeof vi.fn>;
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
  const onCreate = vi.fn(args.onCreate ?? ((): void => undefined));
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={[]}
        tool={args.tool}
        flashId={null}
        getTextItems={(): TextItemGeom[] => []}
        onCreate={onCreate}
      />,
    );
  });
  return {
    host,
    onCreate,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function clickOnLayer(host: HTMLElement, x: number, y: number): void {
  const layer = host.querySelector("[data-annotation-layer='1']") as HTMLElement | null;
  if (layer === null) throw new Error("layer not found");
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
  });
}

describe("B4 — sticky note floating selector (Confirm / Cancel / Delete)", () => {
  it("renders all three action buttons (Confirm / Cancel / Delete)", () => {
    const { host, cleanup } = mountOverlay({
      tool: { tool: "note", color: "#2563eb", penWidth: 2 },
    });
    try {
      clickOnLayer(host, 100, 100);
      const confirm = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='note-confirm']",
      );
      const cancel = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='note-cancel']",
      );
      const del = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='note-delete']",
      );
      expect(confirm).not.toBeNull();
      expect(cancel).not.toBeNull();
      expect(del).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("Confirm commits the annotation (calls onCreate)", () => {
    const { host, onCreate, cleanup } = mountOverlay({
      tool: { tool: "note", color: "#2563eb", penWidth: 2 },
    });
    try {
      clickOnLayer(host, 100, 100);
      const textarea = host.querySelector<HTMLTextAreaElement>(
        "[data-annotation-editor='note'] textarea",
      );
      if (textarea === null) throw new Error("textarea not found");
      act((): void => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(textarea, "Hello note");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const confirm = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='note-confirm']",
      );
      if (confirm === null) throw new Error("confirm not found");
      act((): void => {
        confirm.click();
      });
      expect(onCreate).toHaveBeenCalledTimes(1);
      const created = onCreate.mock.calls[0]?.[0] as Annotation | undefined;
      expect(created?.kind).toBe("note");
      expect((created as { text?: string })?.text).toBe("Hello note");
    } finally {
      cleanup();
    }
  });

  it("Cancel drops the editor without saving", async () => {
    const { host, onCreate, cleanup } = mountOverlay({
      tool: { tool: "note", color: "#2563eb", penWidth: 2 },
    });
    try {
      clickOnLayer(host, 100, 100);
      const cancel = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='note-cancel']",
      );
      if (cancel === null) throw new Error("cancel not found");
      act((): void => {
        cancel.click();
      });
      // Editor unmounted; no annotation created.
      await settleMotion();
      expect(host.querySelector("[data-annotation-editor='note']")).toBeNull();
      expect(onCreate).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("Delete drops the editor without saving", async () => {
    const { host, onCreate, cleanup } = mountOverlay({
      tool: { tool: "note", color: "#2563eb", penWidth: 2 },
    });
    try {
      clickOnLayer(host, 100, 100);
      const del = host.querySelector<HTMLButtonElement>(
        "[data-annotation-action='note-delete']",
      );
      if (del === null) throw new Error("delete not found");
      act((): void => {
        del.click();
      });
      await settleMotion();
      expect(host.querySelector("[data-annotation-editor='note']")).toBeNull();
      expect(onCreate).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("the icon and textarea are co-located in the same wrapper (ann-note-editor-row)", () => {
    const { host, cleanup } = mountOverlay({
      tool: { tool: "note", color: "#2563eb", penWidth: 2 },
    });
    try {
      clickOnLayer(host, 100, 100);
      // The editor wrapper is .ann-note-editor; the icon and
      // textarea are children of the same .ann-note-editor-row
      // flex container.
      const wrapper = host.querySelector<HTMLElement>(".ann-note-editor");
      expect(wrapper).not.toBeNull();
      const row = wrapper?.querySelector(".ann-note-editor-row");
      expect(row).not.toBeNull();
      // Icon: an SVG inside .ann-note-editor-icon.
      const icon = row?.querySelector(".ann-note-editor-icon");
      expect(icon).not.toBeNull();
      // Textarea inside the same row.
      const ta = row?.querySelector("textarea");
      expect(ta).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});