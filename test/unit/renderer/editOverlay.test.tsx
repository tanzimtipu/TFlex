// @vitest-environment jsdom
//
// DEF-061 — EditOverlay React error #310 ("Rendered fewer hooks than
// expected").
//
// The defect: `EditOverlay` declared the `hoverRect` `useState` and
// its pointermove `useEffect` AFTER the early `if (tool === "off")
// return null;` branch. When the parent flipped `tool` from
// `"text"` to `"off"` (or vice versa) between renders, React saw a
// different hook count for the two render trees and threw #310,
// killing the edit layer entirely.
//
// The fix: hoist both hooks above the early return. The component
// is now free to early-return without changing the hook count.
//
// These tests mount EditOverlay twice with different `tool` props
// to confirm React doesn't trip the hooks error. jsdom is a
// reasonable environment for this because the React hook rule
// fires during render reconciliation, not after the DOM mounts.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import { editReducer } from "../../../src/renderer/edit/model";
import type {
  EditAction,
  EditState,
  EditTool,
} from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

const EMPTY_STATE: EditState = {
  tool: "off",
  placements: [],
  selectedImage: null,
  selectedTextBox: null,
  textBoxes: [],
  pendingReplace: null,
  cropping: false,
};

function makeEditState(overrides: Partial<EditState> = {}): EditState {
  return { ...EMPTY_STATE, ...overrides };
}

interface HarnessProps {
  tool: EditTool;
  edit: EditState;
  pickImage: () => Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null>;
}

function mountHarness(props: HarnessProps): {
  host: HTMLElement;
  rerender: (next: Partial<HarnessProps>) => void;
  unmount: () => void;
  errors: unknown[];
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const errors: unknown[] = [];

  // Capture errors thrown during render. React's #310 surfaces as
  // either an unhandled error in the root's commit phase or as a
  // warning to the console; we wrap render in a try/catch and also
  // patch console.error to detect React's "Warning: React has
  // detected a change in the order of Hooks called by Component"
  // diagnostic (which is what #310 actually emits in development
  // builds).
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]): void => {
    const first = args[0];
    if (typeof first === "string" && /Rendered (fewer|more) hooks/.test(first)) {
      errors.push(new Error(first));
    }
    originalConsoleError(...args);
  };

  const render = (merged: HarnessProps): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: merged.tool,
          getTextItems: (): TextItemGeom[] => [],
          edit: merged.edit,
          dispatch: (_a: EditAction): void => undefined,
          pickImage: merged.pickImage,
          defaultFont: "Helvetica",
          onCommitTextEdit: (): void => undefined,
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove: (): void => undefined,
        }),
      );
    });
  };

  const pickImage = (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> =>
    Promise.resolve(null);
  render({ ...props, pickImage: props.pickImage ?? pickImage });

  return {
    host,
    rerender: (next): void => {
      render({
        tool: next.tool ?? props.tool,
        edit: next.edit ?? props.edit,
        pickImage: next.pickImage ?? props.pickImage,
      });
    },
    unmount: (): void => {
      console.error = originalConsoleError;
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    errors,
  };
}

describe("EditOverlay — hook order is stable across tool transitions (DEF-061)", () => {
  it("renders the off state without throwing", () => {
    const { host, errors, unmount } = mountHarness({
      tool: "off",
      edit: makeEditState({ tool: "off" }),
      pickImage: (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> =>
        Promise.resolve(null),
    });
    try {
      // When tool is "off" the overlay returns null; the host stays
      // empty but no hook-order error should have fired.
      expect(host.children.length).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("flipping tool off -> on does not change the rendered hook count (no #310)", () => {
    const { host, rerender, errors, unmount } = mountHarness({
      tool: "off",
      edit: makeEditState({ tool: "off" }),
      pickImage: (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> =>
        Promise.resolve(null),
    });
    try {
      // Pre-fix: rendering with `tool === "off"` would short-circuit
      // before declaring the `hoverRect` useState. Switching to
      // `tool === "text"` adds one new useState + one new useEffect,
      // so React sees N+1 vs N hooks and throws #310.
      rerender({
        tool: "text",
        edit: makeEditState({ tool: "text" }),
      });
      // The text tool mounts the edit layer.
      const layer = host.querySelector(".edit-layer");
      expect(layer).not.toBeNull();
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("flipping tool on -> off does not change the rendered hook count (no #310)", () => {
    const { rerender, errors, unmount } = mountHarness({
      tool: "text",
      edit: makeEditState({ tool: "text" }),
      pickImage: (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> =>
        Promise.resolve(null),
    });
    try {
      rerender({
        tool: "off",
        edit: makeEditState({ tool: "off" }),
      });
      // No exception escaped the render and React didn't emit the
      // "Rendered fewer/more hooks" diagnostic.
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("the text tool renders the edit layer and registers the pointermove hook", () => {
    const { host, errors, unmount } = mountHarness({
      tool: "text",
      edit: makeEditState({ tool: "text" }),
      pickImage: (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> =>
        Promise.resolve(null),
    });
    try {
      const layer = host.querySelector(".edit-layer");
      expect(layer).not.toBeNull();
      expect(layer?.getAttribute("data-tool")).toBe("text");
      // The pointermove effect attaches a listener on `window`; we
      // can't introspect the listener list directly, but a no-throw
      // render + no diagnostics is the contract.
      expect(errors).toEqual([]);
    } finally {
      unmount();
    }
  });

  it("multiple consecutive tool flips never trip the hook-order check", () => {
    // This is the regression test that most closely matches the
    // production scenario: the user opens the Edit toolbar, picks
    // the text tool, picks the box tool, picks the image tool, and
    // finally closes the edit panel — four re-renders, each with a
    // different tool value, none of which may change the hook count.
    const { host, rerender, errors, unmount } = mountHarness({
      tool: "off",
      edit: makeEditState({ tool: "off" }),
      pickImage: (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> =>
        Promise.resolve(null),
    });
    try {
      const sequence: EditTool[] = ["text", "box", "image", "off", "text", "off"];
      for (const next of sequence) {
        rerender({ tool: next, edit: makeEditState({ tool: next }) });
      }
      expect(errors).toEqual([]);
      // Final state should be "off" — no layer rendered.
      expect(host.querySelector(".edit-layer")).toBeNull();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-223 — an image placement move/resize must commit the PRE-DRAG rect.
//
// The regression: the move and resize branches resolved the placement
// AFTER the live drag had already updated its rect, then compared the
// new rect against that same current rect (`rectsClose` was always
// true) and returned before calling `onCommitImageEdit`. The engine
// never received the op, so the saved file kept the image at the
// original rect. The fix parks `imageDrag.startRect` (captured at
// pointerdown) as `oldRect` and uses it for the no-op guard.
// ---------------------------------------------------------------------------

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_ID = "img-1";
const PRE_DRAG_RECT = { x: 100, y: 100, width: 200, height: 100 };

function makeImageState(overrides: Partial<EditState> = {}): EditState {
  return {
    tool: "image",
    placements: [
      {
        id: IMAGE_ID,
        page: 1,
        rect: { ...PRE_DRAG_RECT },
        bytes: PNG_BYTES,
        format: "png",
      },
    ],
    selectedImage: null,
    selectedTextBox: null,
    textBoxes: [],
    pendingReplace: null,
    cropping: false,
    ...overrides,
  };
}

interface ImageDragHarness {
  host: HTMLElement;
  getState: () => EditState;
  unmount: () => void;
}

/** Mirror of the bug010 image-tool harness, extended with a
 *  reducer-backed `dispatch` so the live drag actually updates
 *  `edit.placements` (the production parent owns that state). */
function mountImageDragHarness(
  onCommitImageEdit: ReturnType<typeof vi.fn>,
  initialState: EditState,
): ImageDragHarness {
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
  // jsdom lacks pointer capture and object-URL support; stub both so
  // the placement renders and the drag gesture completes.
  Element.prototype.setPointerCapture = function (this: Element): void {
    void this;
  };
  Element.prototype.releasePointerCapture = function (this: Element): void {
    void this;
  };
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = (): string => "blob:def-223-test";
  const root = createRoot(host);
  let lastState = initialState;
  const render = (): void => {
    root.render(
      createElement(EditOverlay, {
        page: 1,
        pageWidthPt: 612,
        pageHeightPt: 792,
        cssScale: 1,
        tool: lastState.tool,
        getTextItems: (): never[] => [],
        edit: lastState,
        dispatch: (action: EditAction): void => {
          lastState = editReducer(lastState, action);
          render();
        },
        pickImage: async (): Promise<null> => null,
        defaultFont: "Helvetica",
        onCommitTextEdit: (): void => undefined,
        onCommitTextBox: (): void => undefined,
        onCommitImageEdit: onCommitImageEdit as never,
        onCommitTextBoxMove: (): void => undefined,
      }),
    );
  };
  act((): void => {
    render();
  });
  return {
    host,
    getState: (): EditState => lastState,
    unmount: (): void => {
      URL.createObjectURL = originalCreateObjectURL;
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
  });
}

describe("DEF-223 — image placement move/resize commits the pre-drag rect", () => {
  it("a move drag commits op 'move' with oldRect = the pre-drag rect", () => {
    const onCommitImageEdit = vi.fn();
    const { host, getState, unmount } = mountImageDragHarness(
      onCommitImageEdit,
      makeImageState(),
    );
    try {
      const layer = host.querySelector(".edit-layer") as HTMLElement | null;
      expect(layer).not.toBeNull();
      if (layer === null) return;

      // pointerdown inside the placement body starts a move drag.
      act((): void => {
        layer.dispatchEvent(pointerEvent("pointerdown", 150, 150));
      });
      // pointermove +110/+90 updates the live rect.
      act((): void => {
        layer.dispatchEvent(pointerEvent("pointermove", 260, 240));
      });
      act((): void => {
        layer.dispatchEvent(pointerEvent("pointerup", 260, 240));
      });

      expect(onCommitImageEdit).toHaveBeenCalledTimes(1);
      expect(onCommitImageEdit.mock.calls[0]?.[0]).toMatchObject({
        op: "move",
        id: IMAGE_ID,
        oldRect: PRE_DRAG_RECT,
        newRect: { x: 210, y: 190, width: 200, height: 100 },
      });
      // The live overlay update is preserved (registry rect moved).
      expect(getState().placements[0]?.rect).toEqual({
        x: 210,
        y: 190,
        width: 200,
        height: 100,
      });
    } finally {
      unmount();
    }
  });

  it("a resize drag commits op 'resize' with oldRect = the pre-drag rect", () => {
    const onCommitImageEdit = vi.fn();
    const { host, unmount } = mountImageDragHarness(
      onCommitImageEdit,
      makeImageState({ selectedImage: { id: IMAGE_ID } }),
    );
    try {
      const layer = host.querySelector(".edit-layer") as HTMLElement | null;
      const handle = host.querySelector(
        ".edit-image-handle-se",
      ) as HTMLElement | null;
      expect(layer).not.toBeNull();
      expect(handle).not.toBeNull();
      if (layer === null || handle === null) return;

      // pointerdown on the SE corner handle starts a resize drag.
      act((): void => {
        handle.dispatchEvent(pointerEvent("pointerdown", 300, 200));
      });
      act((): void => {
        layer.dispatchEvent(pointerEvent("pointermove", 350, 240));
      });
      act((): void => {
        layer.dispatchEvent(pointerEvent("pointerup", 350, 240));
      });

      expect(onCommitImageEdit).toHaveBeenCalledTimes(1);
      expect(onCommitImageEdit.mock.calls[0]?.[0]).toMatchObject({
        op: "resize",
        id: IMAGE_ID,
        oldRect: PRE_DRAG_RECT,
        newRect: { x: 100, y: 100, width: 250, height: 140 },
      });
    } finally {
      unmount();
    }
  });

  it("a no-op move (within the rectsClose epsilon) commits nothing", () => {
    const onCommitImageEdit = vi.fn();
    const { host, unmount } = mountImageDragHarness(
      onCommitImageEdit,
      makeImageState(),
    );
    try {
      const layer = host.querySelector(".edit-layer") as HTMLElement | null;
      expect(layer).not.toBeNull();
      if (layer === null) return;

      act((): void => {
        layer.dispatchEvent(pointerEvent("pointerdown", 150, 150));
      });
      act((): void => {
        layer.dispatchEvent(pointerEvent("pointermove", 150.2, 150.2));
      });
      act((): void => {
        layer.dispatchEvent(pointerEvent("pointerup", 150.2, 150.2));
      });

      expect(onCommitImageEdit).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});
