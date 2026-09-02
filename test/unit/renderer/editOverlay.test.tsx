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
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
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
