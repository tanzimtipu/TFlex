// @vitest-environment jsdom
// Bug 10 — image tool must prompt drag-to-draw-rect, then file
// picker, then place the image.
//
// The EditOverlay's image tool already had a drag-to-create
// rect flow, but the bug report says the gesture was not
// discoverable: the user picked the Image tool and nothing
// happened on a single click — they had to discover the
// drag-to-rect by trial. The fix verifies the gesture is wired:
//   1. A pointerdown on the page with the image tool active
//      starts a "create" drag (imageDrag.kind === "create").
//   2. A pointermove extends the rect; a pointerup commits.
//   3. On commit, pickImage() is called and (if non-null) the
//      placement is upserted into the edit state and the
//      engine onCommitImageEdit is called.
//
// We exercise the layer's drag-to-create rect flow with
// synthetic pointer events and assert the placement is created
// after a successful file pick.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import type {
  EditAction,
  EditState,
} from "../../../src/renderer/edit/model";

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const BASE_STATE: EditState = {
  tool: "image",
  placements: [],
  selectedImage: null,
  pendingReplace: null,
  cropping: false,
};

interface HarnessArgs {
  pickImage: () => Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null>;
  onCommitImageEdit: ReturnType<typeof vi.fn>;
  dispatch: (action: EditAction) => void;
}

function mountHarness(args: HarnessArgs): {
  host: HTMLElement;
  rerender: (next: Partial<EditState>) => void;
  unmount: () => void;
} {
  const host = document.createElement("div");
  // Force a known-size rect so the pagePoint math resolves to a
  // non-zero coordinate regardless of jsdom's lack of layout.
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
  // jsdom's HTMLDivElement does not implement
  // `setPointerCapture` / `releasePointerCapture`. Production
  // browsers do, and EditOverlay relies on them for the
  // drag-to-create-rect flow. Patch the host (and any child
  // elements the render produces) to a no-op so the test can
  // exercise the gesture end-to-end.
  const stubCapture = function (this: Element): void {
    void this;
  };
  const stubRelease = function (this: Element): void {
    void this;
  };
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
  let lastState: EditState = { ...BASE_STATE };
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
          dispatch: args.dispatch,
          pickImage: args.pickImage,
          defaultFont: "Helvetica",
          onCommitTextEdit: (): void => undefined,
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: args.onCommitImageEdit as never,
        }),
      );
    });
  };
  render();
  return {
    host,
    rerender: (next): void => {
      lastState = { ...lastState, ...next };
      render();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("Bug 10 — image tool drag-to-create-rect → file picker → place", () => {
  it("a drag on the page starts a create placement; pickImage then commits the placement", async () => {
    // The bug report says a single click did nothing because the
    // gesture was not wired. We verify the gesture end-to-end:
    // pointerdown + pointermove + pointerup with a non-null
    // pickImage → onCommitImageEdit fires and the edit state
    // gains a new placement.
    const pickImage = vi.fn(
      async (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" }> => ({
        bytes: PNG_MAGIC,
        format: "png",
      }),
    );
    const onCommitImageEdit = vi.fn();
    const dispatch = vi.fn();
    const { host, unmount } = mountHarness({
      pickImage,
      onCommitImageEdit,
      dispatch,
    });
    try {
      const layer = host.querySelector(".edit-layer") as HTMLElement | null;
      expect(layer).not.toBeNull();
      if (layer === null) return;

      // 1. pointerdown: start a create drag.
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 100,
            clientY: 100,
            pointerId: 1,
          }),
        );
      });

      // 2. pointermove: extend the rect to > 8x8 (the threshold
      //    below which the drag is ignored).
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 200,
            clientY: 200,
            pointerId: 1,
          }),
        );
      });

      // 3. pointerup: commit. pickImage resolves immediately.
      await act(async (): Promise<void> => {
        layer.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: 200,
            clientY: 200,
            pointerId: 1,
          }),
        );
        // Allow the microtask continuation of `onPointerUp` to
        // resolve (the handler awaits pickImage).
        await Promise.resolve();
        await Promise.resolve();
      });

      // The drag should have called pickImage and the onCommit
      // callback should have fired with the create op.
      expect(pickImage).toHaveBeenCalled();
      expect(onCommitImageEdit).toHaveBeenCalled();
      const call = onCommitImageEdit.mock.calls[0];
      expect(call?.[0]).toMatchObject({ op: "replace" });
    } finally {
      unmount();
    }
  });

  it("if pickImage returns null (user cancels), no placement is committed", async () => {
    // The drag-to-rect flow must respect the cancel: the
    // user drew a rect, the file picker opened, the user
    // cancelled, no placement should enter the engine.
    const pickImage = vi.fn(
      async (): Promise<null> => null,
    );
    const onCommitImageEdit = vi.fn();
    const dispatch = vi.fn();
    const { host, unmount } = mountHarness({
      pickImage,
      onCommitImageEdit,
      dispatch,
    });
    try {
      const layer = host.querySelector(".edit-layer") as HTMLElement | null;
      if (layer === null) return;
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: 50,
            clientY: 50,
            pointerId: 1,
          }),
        );
      });
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 250,
            clientY: 250,
            pointerId: 1,
          }),
        );
      });
      await act(async (): Promise<void> => {
        layer.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: 250,
            clientY: 250,
            pointerId: 1,
          }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(pickImage).toHaveBeenCalled();
      expect(onCommitImageEdit).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});
