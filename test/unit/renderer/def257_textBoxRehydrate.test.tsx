// @vitest-environment jsdom
//
// DEF-257 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a committed Edit-mode text box must keep its `.edit-box`
// surface after Edit mode is closed and re-opened.
//
// The renderer's mirror of the engine's text-box registry
// (`edit.state.textBoxes`) is what every page's EditOverlay draws its
// `.edit-box` surfaces from. App adopts the engine list on every state
// echo; DocumentView additionally rehydrates the mirror from
// `engineState.textBoxes` on the rising edge of `editModeOpen`, so a
// committed box that is only in the engine registry gets its surface
// back when Edit mode re-opens (and cannot be dropped by the
// abandoned-new-box cleanup, which now sees `isNew` cleared on commit).
//
// These tests mount the real DocumentView (same harness shape as
// bug4_escapeAndDisarm) and assert on the rendered `.edit-box` DOM.
import { describe, expect, it } from "vitest";
import { act, useState, type ReactElement } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { TextBoxModel } from "../../../src/shared/types";
import {
  editReducer,
  engineTextBoxesToPlacements,
  initialEditState,
  type EditAction,
  type EditState,
} from "../../../src/renderer/edit/model";
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
// jsdom has no pointer capture; the overlay calls it on pointerdown.
Element.prototype.setPointerCapture = function (this: Element): void {
  void this;
};
Element.prototype.releasePointerCapture = function (this: Element): void {
  void this;
};

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

/** The engine's registry entry for the committed box (TextBoxModel). */
function makeBox(overrides: Partial<TextBoxModel> = {}): TextBoxModel {
  return {
    id: "box-1",
    page: 1,
    rect: { x: 100, y: 100, width: 180, height: 40 },
    text: "DEF257 BOX",
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
    // Absent when the doc has no boxes ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the shared contract the
    // rehydration guard must respect.
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

/** The harness's handle on the tab state App would own. */
interface HostApi {
  state: EditState;
  actions: EditAction[];
  /** Seed the renderer mirror directly (a renderer-local draft). */
  setMirror: (boxes: EditState["textBoxes"]) => void;
}

interface HostProps {
  open: boolean;
  boxes: TextBoxModel[] | undefined;
  api: HostApi;
}

/** The tab host: owns the edit mirror in React state (as App does), so
 *  every dispatch re-renders through React instead of a manual
 *  root.render (which raced the test's own renders). */
function Host(props: HostProps): ReactElement {
  const [editState, setEditState] = useState<EditState>(() => ({
    ...initialEditState,
    tool: "box",
  }));
  props.api.state = editState;
  props.api.setMirror = (boxes: EditState["textBoxes"]): void => {
    setEditState((prev) => ({ ...prev, textBoxes: boxes }));
  };
  const edit = props.open
    ? {
        state: editState,
        onAction: (action: EditAction): void => {
          props.api.actions.push(action);
          setEditState((prev) => editReducer(prev, action));
        },
        defaultFont: "Helvetica" as const,
        pickImage: async (): Promise<null> => null,
        onCommitTextEdit: NOOP,
        onCommitTextBox: NOOP,
        onCommitImageEdit: NOOP,
        onCommitTextBoxMove: NOOP,
        onDeleteTextBox: NOOP,
      }
    : null;
  return createElement(DocumentView, {
    doc: makeDocStub(2),
    pageCount: 2,
    outline: null,
    initial: INITIAL_VIEWER,
    onPersist: NOOP,
    onDiagnostics: (_d: DocDiagnostics): void => undefined,
    engineState: makeEngineState(2, props.boxes),
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
  });
}

interface Harness {
  host: HTMLElement;
  api: HostApi;
  /** Re-render with new host props (Edit mode open/closed, a fresh
   *  engine registry echo). */
  render: (next: { open?: boolean; boxes?: TextBoxModel[] | undefined }) => Promise<void>;
  openEdit: () => Promise<void>;
  closeEdit: () => Promise<void>;
  editBoxes: () => NodeListOf<Element>;
  unmount: () => void;
}

async function mountView(): Promise<Harness> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const api: HostApi = { state: { ...initialEditState, tool: "box" }, actions: [], setMirror: NOOP };
  let props: { open: boolean; boxes: TextBoxModel[] | undefined } = {
    open: false,
    boxes: undefined,
  };
  const render = async (next: {
    open?: boolean;
    boxes?: TextBoxModel[] | undefined;
  } = {}): Promise<void> => {
    props = { ...props, ...next };
    await act(async (): Promise<void> => {
      root.render(createElement(Host, { ...props, api }));
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
    openEdit: (): Promise<void> => render({ open: true }),
    closeEdit: (): Promise<void> => render({ open: false }),
    editBoxes: (): NodeListOf<Element> => host.querySelectorAll(".edit-box"),
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** Seed the renderer mirror (a renderer-local draft) through React. */
async function seedMirror(h: Harness, boxes: EditState["textBoxes"]): Promise<void> {
  await act(async (): Promise<void> => {
    h.api.setMirror(boxes);
    await Promise.resolve();
  });
}

describe("DEF-257 - opening Edit mode rehydrates the text-box mirror from the engine", () => {
  it("yields exactly one .edit-box surface for the engine's committed box", async () => {
    const h = await mountView();
    try {
      // The DEF-257 post-reopen state: the box is in the engine registry
      // but the renderer mirror is empty.
      await h.render({ open: true, boxes: [makeBox()] });
      expect(h.editBoxes().length).toBe(1);
      const surface = h.host.querySelector("[data-edit-box-id='box-1']");
      expect(surface, "the committed box has its surface back").not.toBeNull();
      expect(surface?.getAttribute("data-edit-box-text")).toBe("DEF257 BOX");
      expect(h.api.state.textBoxes.map((b) => b.id)).toEqual(["box-1"]);
    } finally {
      h.unmount();
    }
  });

  it("closing and re-opening Edit mode preserves the committed box's surface", async () => {
    const h = await mountView();
    try {
      await h.openEdit();
      await h.render({ boxes: [makeBox()] });
      expect(h.editBoxes().length).toBe(1);
      await h.closeEdit();
      // Edit mode closed: the overlay unmounts (no surface) but the
      // mirror must survive so the next open can draw it.
      expect(h.editBoxes().length).toBe(0);
      expect(h.api.state.textBoxes.map((b) => b.id)).toEqual(["box-1"]);
      await h.openEdit();
      expect(h.editBoxes().length).toBe(1);
      expect(h.host.querySelector("[data-edit-box-id='box-1']")).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("an unchanged registry on re-open creates no duplicate surface and dispatches nothing", async () => {
    const h = await mountView();
    try {
      await h.openEdit();
      await h.render({ boxes: [makeBox()] });
      expect(h.editBoxes().length).toBe(1);
      await h.closeEdit();
      // A fresh engine echo with the SAME content (new array identity).
      await h.render({ boxes: [makeBox()] });
      const before = h.api.actions.length;
      await h.openEdit();
      expect(h.editBoxes().length).toBe(1);
      expect(h.api.state.textBoxes.length).toBe(1);
      expect(
        h.api.actions.slice(before).filter((a) => a.type === "replace-text-boxes").length,
        "a same-content registry echo must not churn the mirror",
      ).toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("does not clobber a renderer-local draft when the engine registry is absent or empty", async () => {
    const h = await mountView();
    try {
      // A just-dragged, not-yet-committed box: renderer-local only, and
      // the engine reports no registry at all.
      await seedMirror(h, [
        {
          id: "draft-1",
          page: 1,
          rect: { x: 40, y: 40, width: 120, height: 36 },
          text: "typing",
          style: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
          background: "white",
        },
      ]);
      await h.openEdit();
      expect(h.api.state.textBoxes.map((b) => b.id)).toEqual(["draft-1"]);
      expect(h.host.querySelector("[data-edit-box-id='draft-1']")).not.toBeNull();
      // The engine also reports an EMPTY list (not just an absent key)
      // for a document with no boxes — the draft still survives.
      await h.closeEdit();
      await h.render({ boxes: [] });
      await h.openEdit();
      expect(h.api.state.textBoxes.map((b) => b.id)).toEqual(["draft-1"]);
      expect(h.host.querySelector("[data-edit-box-id='draft-1']")).not.toBeNull();
    } finally {
      h.unmount();
    }
  });
});

/** Dispatch a bubbling pointer event through act (state flushes first). */
function pointer(el: Element, type: string, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

/** Type into the panel's controlled textarea (native setter + input). */
function setTextarea(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("DEF-257 - a committed new box survives the abandoned-placement cleanup", () => {
  it("keeps the mirror and its .edit-box surface after commit + Edit-mode close/reopen", async () => {
    const h = await mountView();
    try {
      await h.openEdit();
      const layer = h.host.querySelector<HTMLElement>(".edit-layer");
      if (layer === null) throw new Error("edit layer not found");
      // A click on the empty page places a fresh (renderer-only) box.
      pointer(layer, "pointerdown", 2, 2);
      pointer(layer, "pointerup", 2, 2);
      const placed = h.api.state.textBoxes;
      expect(placed.length, "the drag placed one box").toBe(1);
      const id = placed[0]?.id ?? "";
      expect(id).not.toBe("");
      // The panel's Text field is the editor for the new box (Phase 26).
      const ta = h.host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
      if (ta === null) throw new Error("[data-txt-text] not found");
      expect(ta.disabled).toBe(false);
      setTextarea(ta, "DEF257 BOX");
      // Blur commits the session: the box reaches the engine (one op).
      act((): void => {
        ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
      // The engine registry stays ABSENT in this harness, so the
      // rehydration cannot mask a dropped mirror: only clearing `isNew`
      // on commit keeps the committed box in the renderer registry.
      await h.closeEdit();
      await h.openEdit();
      expect(h.api.state.textBoxes.map((b) => b.id)).toEqual([id]);
      expect(h.host.querySelector(`[data-edit-box-id='${id}']`)).not.toBeNull();
    } finally {
      h.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// The surface the rehydration produces must behave like any committed box:
// selectable (pointerdown selects it) and movable (the drag re-targets the
// registry rect). Same harness shape as DEF-152's box-move tests.

function mountBoxOverlay(): {
  host: HTMLElement;
  state: () => EditState;
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
  const root = createRoot(host);
  // The mirror App builds from `engineState.textBoxes` — the exact
  // conversion the DEF-257 rehydration dispatches.
  let lastState: EditState = {
    ...initialEditState,
    tool: "box",
    textBoxes: engineTextBoxesToPlacements([makeBox()], "Helvetica"),
  };
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: lastState.tool,
          getTextItems: (): TextItemGeom[] => [],
          edit: lastState,
          dispatch: (action: EditAction): void => {
            lastState = editReducer(lastState, action);
            render();
          },
          pickImage: async (): Promise<null> => null,
          defaultFont: "Helvetica",
          onCommitTextEdit: NOOP,
          onCommitTextBox: NOOP,
          onCommitImageEdit: NOOP,
          onCommitTextBoxMove: NOOP,
          onDeleteTextBox: NOOP,
        }),
      );
    });
  };
  render();
  return {
    host,
    state: (): EditState => lastState,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("DEF-257 - the rehydrated surface is selectable and movable", () => {
  it("selects on pointerdown and follows a drag", () => {
    const h = mountBoxOverlay();
    try {
      const surface = h.host.querySelector<HTMLElement>(".edit-box");
      expect(surface, "one surface for the engine registry's box").not.toBeNull();
      expect(h.host.querySelectorAll(".edit-box").length).toBe(1);
      expect(surface?.getAttribute("data-edit-box-id")).toBe("box-1");
      // Selectable: pressing the surface selects that box.
      if (surface === null) throw new Error("surface not found");
      pointer(surface, "pointerdown", 120, 120);
      expect(h.state().selectedTextBox).toBe("box-1");
      // Movable: the drag re-targets the registry rect (+40/+20).
      const layer = h.host.querySelector<HTMLElement>(".edit-layer");
      if (layer === null) throw new Error("layer not found");
      pointer(layer, "pointermove", 160, 140);
      pointer(layer, "pointerup", 160, 140);
      expect(h.state().textBoxes[0]?.rect).toEqual({ x: 140, y: 120, width: 180, height: 40 });
    } finally {
      h.unmount();
    }
  });
});

