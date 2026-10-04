// @vitest-environment jsdom
//
// TFL-686 (TFL-525 A) — Cancel truly cancels in the Edit Text / Add Text
// flows. Renderer only.
//
// The operator report (TFL-384): pressing Cancel on the edit action bar left
// the edit committed. Root cause: the action-bar buttons did not preserve the
// Inspector Text field's focus, so a mousedown on Cancel blurred the field
// first — the blur fired the host's `commitTextSession` (an engine op) and
// the Cancel click then found no live session left to discard.
//
// These tests mount the real DocumentView (same harness shape as
// def257_textBoxRehydrate) so the whole overlay -> host session path runs.
//
//   - a BRAND-NEW Add Text box typed into then Cancelled is removed from the
//     renderer registry and fires NO addTextBox engine op;
//   - an EXISTING Add Text box edited then Cancelled is restored to the
//     session original and fires NO engine op;
//   - an existing text run edited then Cancelled never calls
//     `onCommitTextEdit`.
import { describe, expect, it, vi, type Mock } from "vitest";
import { act, useState, type ReactElement } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import { isEditTextActionBarTarget } from "../../../src/renderer/components/DocumentView";
import type { InspectorTextSelection } from "../../../src/renderer/components/Inspector";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { TextBoxModel } from "../../../src/shared/types";
import {
  editReducer,
  initialEditState,
  type EditAction,
  type EditState,
  type EditTextStyle,
} from "../../../src/renderer/edit/model";
import type { TextBoxStylePatch } from "../../../src/shared/types";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}
Element.prototype.setPointerCapture = function (this: Element): void {
  void this;
};
Element.prototype.releasePointerCapture = function (this: Element): void {
  void this;
};

/** A one-page stub whose text layer yields a single run at page points
 *  (100, 100) size 200x20 (PDF transform[5] = pageHeight - y - height). */
function makeDocStub(numPages: number, withRun = false): PDFDocumentProxy {
  const textContent = withRun
    ? {
        items: [
          { str: "Source run", transform: [1, 0, 0, 1, 100, 672], width: 200, height: 20 },
        ],
        styles: {},
      }
    : { items: [], styles: {} };
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (args: { scale: number }): unknown => ({
          width: 612 * (args.scale ?? 1),
          height: 792 * (args.scale ?? 1),
          scale: args.scale ?? 1,
          rotation: 0,
          rawDims: {
            pageWidth: 612,
            pageHeight: 792,
            pageX: 0,
            pageY: 0,
            rotation: 0,
          },
        }),
        getTextContent: async (): Promise<unknown> => textContent,
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeBox(overrides: Partial<TextBoxModel> = {}): TextBoxModel {
  return {
    id: "box-1",
    page: 1,
    rect: { x: 100, y: 100, width: 180, height: 40 },
    text: "EXISTING",
    font: "Helvetica",
    size: 12,
    color: "#000000",
    background: "white",
    ...overrides,
  };
}

function makeEngineState(pageCount: number, textBoxes?: TextBoxModel[]): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
    ...(textBoxes === undefined ? {} : { textBoxes }),
  };
}

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

const NOOP = (): void => undefined;
type Rect = { x: number; y: number; width: number; height: number };
type CommitTextEditFn = (args: {
  rect: Rect;
  newText: string;
  style: EditTextStyle;
  oldRect?: Rect;
  page: number;
}) => void | Promise<void>;
type CommitTextBoxFn = (args: {
  rect: Rect;
  text: string;
  style: EditTextStyle;
  background: "white" | "none";
  page: number;
}) => void;
type TextPatchFn = (id: string, patch: TextBoxStylePatch) => void;

interface HostApi {
  state: EditState;
  latestTextSelection: InspectorTextSelection | null;
  commitTextBox: Mock<CommitTextBoxFn>;
  commitTextEdit: Mock<CommitTextEditFn>;
  textPatch: Mock<TextPatchFn>;
}

interface HostProps {
  open: boolean;
  boxes: TextBoxModel[] | undefined;
  withRun: boolean;
  tool: EditState["tool"];
  api: HostApi;
}

/** The tab host: owns the edit mirror in React state (as App does). */
function Host(props: HostProps): ReactElement {
  const [editState, setEditState] = useState<EditState>(() => ({
    ...initialEditState,
    tool: props.tool,
  }));
  props.api.state = editState;
  const edit = props.open
    ? {
        state: editState,
        onAction: (action: EditAction): void => {
          setEditState((prev) => editReducer(prev, action));
        },
        defaultFont: "Helvetica" as const,
        pickImage: async (): Promise<null> => null,
        onCommitTextEdit: props.api.commitTextEdit,
        onCommitTextBox: props.api.commitTextBox,
        onCommitImageEdit: NOOP,
        onCommitTextBoxMove: NOOP,
        onDeleteTextBox: NOOP,
        onTextPatch: props.api.textPatch,
      }
    : null;
  return createElement(DocumentView, {
    doc: makeDocStub(1, props.withRun),
    pageCount: 1,
    outline: null,
    initial: INITIAL_VIEWER,
    onPersist: NOOP,
    onDiagnostics: (_d: DocDiagnostics): void => undefined,
    engineState: makeEngineState(1, props.boxes),
    modified: false,
    canUndo: false,
    saveInPlaceEnabled: false,
    annotations: [],
    formFields: [],
    signatures: [],
    savedSignatures: [],
    stampAnnotations: [],
    editModeOpen: props.open,
    onEditModeToggle: NOOP,
    edit,
    onTextSelectionChange: (selection): void => {
      props.api.latestTextSelection = selection;
    },
  });
}

interface Harness {
  host: HTMLElement;
  api: HostApi;
  render: (next: { open?: boolean; boxes?: TextBoxModel[] | undefined }) => Promise<void>;
  unmount: () => void;
}

async function mountView(withRun = false, tool: EditState["tool"] = "box"): Promise<Harness> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const api: HostApi = {
    state: { ...initialEditState, tool },
    latestTextSelection: null,
    commitTextBox: vi.fn<CommitTextBoxFn>(),
    commitTextEdit: vi.fn<CommitTextEditFn>(),
    textPatch: vi.fn<TextPatchFn>(),
  };
  let props = { open: false, boxes: undefined as TextBoxModel[] | undefined };
  const render = async (next: {
    open?: boolean;
    boxes?: TextBoxModel[] | undefined;
  } = {}): Promise<void> => {
    props = { ...props, ...next };
    await act(async (): Promise<void> => {
      root.render(createElement(Host, { ...props, withRun, tool, api }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  await render();
  return {
    host,
    api,
    render,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function pointer(el: Element, type: string, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function click(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function layerOf(host: HTMLElement): HTMLElement {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("edit layer not found");
  return layer;
}

describe("TFL-686 — Cancel on the Add Text (box) bar truly cancels", () => {
  it("a brand-new box typed into then Cancelled is removed and fires no engine op", async () => {
    const h = await mountView();
    try {
      await h.render({ open: true });
      const layer = layerOf(h.host);
      pointer(layer, "pointerdown", 2, 2);
      pointer(layer, "pointerup", 2, 2);
      const placed = h.api.state.textBoxes;
      expect(placed.length, "the drag placed one new box").toBe(1);
      const id = placed[0]?.id ?? "";
      expect(h.host.querySelector(`[data-edit-box-id='${id}']`)).not.toBeNull();

      const snap = h.api.latestTextSelection;
      if (snap === null) throw new Error("text surface not published");
      act((): void => {
        snap.onTextChange?.("NEW BOX TEXT");
      });
      expect(h.api.state.textBoxes[0]?.text).toBe("NEW BOX TEXT");

      const cancel = h.host.querySelector<HTMLElement>("[data-edit-box-action='cancel']");
      if (cancel === null) throw new Error("box Cancel button not found");
      // A real press on Cancel first BLURS the Inspector Text field, which
      // used to commit the session before the click. Simulate that exact
      // order: the bar button becomes the focus target.
      act((): void => {
        snap.onTextCommit?.(cancel);
      });
      click(cancel);

      expect(h.api.commitTextBox, "no addTextBox engine op").not.toHaveBeenCalled();
      expect(h.api.state.textBoxes.length, "the new box is gone").toBe(0);
      expect(h.host.querySelector(".edit-box"), "no residual .edit-box").toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("an existing box edited then Cancelled is restored and fires no engine op", async () => {
    const h = await mountView();
    try {
      await h.render({ open: true, boxes: [makeBox()] });
      const surface = h.host.querySelector<HTMLElement>(".edit-box");
      if (surface === null) throw new Error("existing box surface not found");
      // The overlay lays the box out at rect.x * cssScale; derive the view's
      // scale from that so the pointer lands inside the box in jsdom.
      const scale = Number.parseFloat(surface.style.left) / 100;
      expect(Number.isFinite(scale) && scale > 0).toBe(true);
      pointer(layerOf(h.host), "pointerdown", 120 * scale, 120 * scale);
      expect(h.api.state.selectedTextBox, "the box is selected").toBe("box-1");
      const snap = h.api.latestTextSelection;
      if (snap === null) throw new Error("text surface not published");
      act((): void => {
        snap.onTextChange?.("CHANGED");
      });
      expect(h.api.state.textBoxes[0]?.text).toBe("CHANGED");

      const cancel = h.host.querySelector<HTMLElement>("[data-edit-box-action='cancel']");
      if (cancel === null) throw new Error("box Cancel button not found");
      act((): void => {
        snap.onTextCommit?.(cancel);
      });
      click(cancel);

      expect(h.api.commitTextBox, "no engine op for an existing box").not.toHaveBeenCalled();
      expect(h.api.textPatch, "no updateTextBox engine op").not.toHaveBeenCalled();
      expect(h.api.state.textBoxes[0]?.text, "restored to the session original").toBe("EXISTING");
    } finally {
      h.unmount();
    }
  });

  it("blurring to a NON-bar target still commits (the guard is narrow)", async () => {
    const h = await mountView();
    try {
      await h.render({ open: true });
      const layer = layerOf(h.host);
      pointer(layer, "pointerdown", 2, 2);
      pointer(layer, "pointerup", 2, 2);
      const snap = h.api.latestTextSelection;
      if (snap === null) throw new Error("text surface not published");
      act((): void => {
        snap.onTextChange?.("COMMIT ME");
      });
      act((): void => {
        snap.onTextCommit?.(document.body);
      });
      expect(h.api.commitTextBox, "a normal blur still commits").toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });
});

describe("TFL-686 — Cancel on the text-run bar truly cancels", () => {
  it("an existing run edited then Cancelled never calls onCommitTextEdit", () => {
    const RUN_ITEM: TextItemGeom = {
      x: 100,
      y: 100,
      width: 200,
      height: 20,
      text: "Source run",
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onCommitTextEdit = vi.fn<CommitTextEditFn>();
    const onDiscardTextEdit = vi.fn<() => void>();
    const render = (live: string): void => {
      act((): void => {
        root.render(
          createElement(EditOverlay, {
            page: 1,
            pageWidthPt: 612,
            pageHeightPt: 792,
            cssScale: 1,
            tool: "text",
            getTextItems: (): TextItemGeom[] => [RUN_ITEM],
            edit: { ...initialEditState, tool: "text" },
            dispatch: (): void => undefined,
            pickImage: async (): Promise<null> => null,
            defaultFont: "Helvetica",
            onCommitTextEdit,
            onCommitTextBox: (): void => undefined,
            onCommitImageEdit: (): void => undefined,
            onCommitTextBoxMove: (): void => undefined,
            textLive: live,
            textCommitToken: 0,
            onDiscardTextEdit,
          }),
        );
      });
    };
    try {
      render("Source run");
      // Single click on the run selects it and opens the action bar.
      pointer(layerOf(host), "pointerdown", 150, 110);
      expect(host.querySelector("[data-textrun-selection]")).not.toBeNull();
      // The panel's live session text arrives.
      render("Edited run");
      const cancel = host.querySelector<HTMLElement>('[data-content-action="textrun-cancel"]');
      if (cancel === null) throw new Error("run Cancel button not found");
      click(cancel);
      expect(onDiscardTextEdit, "Cancel discards the live session").toHaveBeenCalled();
      expect(onCommitTextEdit, "the engine never saw the run edit").not.toHaveBeenCalled();
      expect(host.querySelector("[data-textrun-selection]"), "selection dismissed").toBeNull();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});

describe("TFL-686 — the blur guard is scoped to the EDIT-text action bars", () => {
  it("matches the run bar and the box toolbar, but not other bars or plain nodes", () => {
    const runBar = document.createElement("div");
    runBar.setAttribute("data-content-action-bar", "textrun");
    const runBtn = document.createElement("button");
    runBar.appendChild(runBtn);

    const boxBar = document.createElement("div");
    boxBar.setAttribute("data-edit-box-toolbar", "true");
    const boxBtn = document.createElement("button");
    boxBar.appendChild(boxBtn);

    const annBar = document.createElement("div");
    annBar.setAttribute("data-content-action-bar", "ann-textbox");
    const annBtn = document.createElement("button");
    annBar.appendChild(annBtn);

    expect(isEditTextActionBarTarget(runBtn)).toBe(true);
    expect(isEditTextActionBarTarget(runBar)).toBe(true);
    expect(isEditTextActionBarTarget(boxBtn)).toBe(true);
    expect(isEditTextActionBarTarget(boxBar)).toBe(true);
    expect(isEditTextActionBarTarget(annBtn), "annotation bars keep their blur semantics").toBe(false);
    expect(isEditTextActionBarTarget(document.body)).toBe(false);
    expect(isEditTextActionBarTarget(null)).toBe(false);
  });
});
