// @vitest-environment jsdom
//
// TFL-525 F — the three Edit Text / Add Text session commit/discard defects
// the TFL-525 bug-hunt sweep filed, fixed in one bounded change:
//
//   DEF-537 (HIGH, regression from e5bf019) — a plain Confirm on an edited
//     text RUN silently lost the edit: the Confirm handler cleared the
//     overlay `textTarget` before the host's commit token flipped, so the
//     token effect read a null target. The run commit must fire exactly once.
//   DEF-538 (MEDIUM) — a whitespace-only Add Text box commit reached the
//     engine (addTextBox). It must discard: no engine op, no box.
//   DEF-539 (MEDIUM) — Escape on a live Add Text box baked the abandoned
//     draft. It must discard through the Cancel path.
//   DEF-540 (MEDIUM) — Escape on a live Edit-Text RUN session reached the
//     discard only by ACCIDENT (the commit-token effect read a cleared
//     target). Escape must explicitly discard: no commit, document
//     unmodified (CTO ruling: Escape = keyboard abort).
//   DEF-541 (MEDIUM) — a whitespace-only run Confirm reached the engine and
//     masked the run. It must discard: no engine op, document unmodified.
//
// Renderer only; the real DocumentView + EditOverlay session path runs.
import { describe, expect, it, vi, type Mock } from "vitest";
import { act, useRef, useState, type ReactElement } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { DocDiagnostics } from "../../../src/renderer/components/DocumentView";
import type { InspectorTextSelection } from "../../../src/renderer/components/Inspector";
import { EditOverlay, type EditTextTarget } from "../../../src/renderer/edit/EditOverlay";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";
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

// Phase 117 gave the box action bar a fit gate: a page-view anchor smaller than
// the minimum (or with no side clear of the viewport) suppresses the floating
// bar. jsdom reports clientWidth/Height 0, collapsing the fit scale to its 50px
// floor and starving the gate; give the scroller a real viewport as a window
// would (the TFL-1116 harness) so the Confirm bar is reachable.
const hostProto = window.HTMLElement.prototype as unknown as {
  clientHeight?: number;
  clientWidth?: number;
  scrollTo?: (o: { top: number; behavior?: ScrollBehavior }) => void;
};
Object.defineProperty(hostProto, "clientHeight", { configurable: true, get: (): number => 800 });
Object.defineProperty(hostProto, "clientWidth", { configurable: true, get: (): number => 1200 });
if (typeof hostProto.scrollTo !== "function") {
  hostProto.scrollTo = function (this: Element, o: { top: number; behavior?: ScrollBehavior }): void {
    void this;
    void o;
  };
}

// DEF-540/541 — the real DocumentView's PageView renders each page through a
// 2D canvas context before it snapshots the text items. jsdom's getContext
// returns null, so the render effect bailed BEFORE `textItemsRef` was set and
// the run was never hit-testable. A minimal 2D context keeps the async render
// chain alive (only fillStyle / fillRect / drawImage are used before the text
// snapshot; the pdf.js render task itself is stubbed on the doc proxy).
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
  ): unknown {
    return {
      canvas: this,
      fillStyle: "#000000",
      font: "10px sans-serif",
      drawImage: (): void => undefined,
      fillRect: (): void => undefined,
      clearRect: (): void => undefined,
      // pdf.js's TextLayer measures a font to derive its ascent ratio; a
      // truthy fontBoundingBoxAscent keeps it off the pixel-scan fallback.
      measureText: (): { fontBoundingBoxAscent: number; fontBoundingBoxDescent: number } => ({
        fontBoundingBoxAscent: 0.8,
        fontBoundingBoxDescent: 0.2,
      }),
    };
  } as unknown as HTMLCanvasElement["getContext"];
}

/** A one-page stub whose text layer yields a single run at page points
 *  (100, 100) size 200x20 (PDF transform[5] = pageHeight - y - height). */
function makeDocStub(numPages: number, withRun = false): PDFDocumentProxy {
  const textContent = withRun
    ? {
        items: [
          {
            str: "Source run",
            dir: "ltr",
            fontName: "f1",
            hasEOL: false,
            transform: [1, 0, 0, 1, 100, 672],
            width: 200,
            height: 20,
          },
        ],
        // pdf.js's TextLayer indexes `styles[item.fontName]`; a matching entry
        // keeps TextLayer.render() from rejecting (unhandled in jsdom).
        styles: {
          f1: { fontFamily: "sans-serif", ascent: 0.8, descent: 0.2, vertical: false },
        },
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

/** DEF-540/541 — a pinned 1:1 scale so the run hit-test in jsdom (no layout,
 *  so fit-width derives a tiny scale) lands on the stub run at (100,100). */
const MANUAL_VIEWER: PersistedViewer = {
  zoomMode: "manual",
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
  pushAction: (action: EditAction) => void;
}

interface HostProps {
  open: boolean;
  withRun: boolean;
  tool: EditState["tool"];
  api: HostApi;
  /** Overrides the fit-width default so a unit test can pin cssScale to 1
   *  (jsdom has no layout, so fit-width would derive a tiny scale and the run
   *  hit-test would miss). */
  initial?: PersistedViewer;
}

/** The tab host: owns the edit mirror in React state (as App does). */
function Host(props: HostProps): ReactElement {
  const [editState, setEditState] = useState<EditState>(() => ({
    ...initialEditState,
    tool: props.tool,
  }));
  props.api.state = editState;
  props.api.pushAction = (action: EditAction): void => {
    setEditState((prev) => editReducer(prev, action));
  };
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
    initial: props.initial ?? INITIAL_VIEWER,
    onPersist: NOOP,
    onDiagnostics: (_d: DocDiagnostics): void => undefined,
    engineState: makeEngineState(1),
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
  render: (next: { open?: boolean }) => Promise<void>;
  unmount: () => void;
}

async function mountView(
  withRun = false,
  tool: EditState["tool"] = "box",
  initial?: PersistedViewer,
): Promise<Harness> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const api: HostApi = {
    state: { ...initialEditState, tool },
    latestTextSelection: null,
    commitTextBox: vi.fn<CommitTextBoxFn>(),
    commitTextEdit: vi.fn<CommitTextEditFn>(),
    textPatch: vi.fn<TextPatchFn>(),
    pushAction: NOOP,
  };
  let props = { open: false };
  const render = async (next: { open?: boolean } = {}): Promise<void> => {
    props = { ...props, ...next };
    await act(async (): Promise<void> => {
      root.render(
        createElement(Host, {
          ...props,
          withRun,
          tool,
          api,
          ...(initial === undefined ? {} : { initial }),
        }),
      );
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

/** Drain the async render / text-load chain (getPage -> getTextContent) so a
 *  real DocumentView exposes its run to the EditOverlay before the hit-test. */
async function flushAsync(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  });
}

/** Select the stub run through the real DocumentView and pin the live session
 *  text the Inspector Text field would report. Returns the harness. */
async function selectRunAndPublishText(text: string): Promise<Harness> {
  const h = await mountView(true, "text", MANUAL_VIEWER);
  await h.render({ open: true });
  await flushAsync();
  const layer = layerOf(h.host);
  // The run only becomes hit-testable once the PageView's async text load has
  // populated `textItemsRef`; retry the click until the selection appears.
  for (let i = 0; i < 12; i += 1) {
    if (h.host.querySelector("[data-textrun-selection]") !== null) break;
    pointer(layer, "pointerdown", 150, 110);
    await flushAsync();
  }
  expect(
    h.host.querySelector("[data-textrun-selection]"),
    "the stub run is selected in the real DocumentView",
  ).not.toBeNull();
  const snap = h.api.latestTextSelection;
  if (snap === null) throw new Error("text surface not published");
  act((): void => {
    snap.onTextChange?.(text);
  });
  await flushAsync();
  return h;
}

const RUN_GEOM: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };

interface RunHostApi {
  host: HTMLElement;
  onCommitTextEdit: Mock<CommitTextEditFn>;
  onDiscardTextEdit: Mock<() => void>;
  setLive: (text: string | null) => void;
  latestTarget: EditTextTarget | null;
  unmount: () => void;
}

/** A minimal host that mirrors DocumentView's run-session protocol: it feeds
 *  the overlay `textLive` + `textCommitToken`, and — exactly like the host's
 *  target-change effect — bumps the token when a live RUN target clears. */
function mountRunHost(): RunHostApi {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const root = createRoot(host);
  const api: RunHostApi = {
    host,
    onCommitTextEdit: vi.fn<CommitTextEditFn>(),
    onDiscardTextEdit: vi.fn<() => void>(),
    setLive: NOOP,
    latestTarget: null,
    unmount: NOOP,
  };
  function RunHost(): ReactElement {
    const [live, setLive] = useState<string | null>(null);
    const [token, setToken] = useState(0);
    const prevTargetRef = useRef<EditTextTarget | null>(null);
    const liveRef = useRef<string | null>(null);
    liveRef.current = live;
    api.setLive = (text: string | null): void => setLive(text);
    const onTextTargetChange = (target: EditTextTarget | null): void => {
      const prev = prevTargetRef.current;
      prevTargetRef.current = target;
      api.latestTarget = target;
      // DocumentView's target-change effect commits a live run session and
      // bumps the token; `live` non-null is the session proxy here.
      if (target === null && prev !== null && prev.kind === "run" && liveRef.current !== null) {
        liveRef.current = null;
        setLive(null);
        setToken((n) => n + 1);
      }
    };
    return createElement(EditOverlay, {
      page: 1,
      pageWidthPt: 612,
      pageHeightPt: 792,
      cssScale: 1,
      tool: "text",
      getTextItems: (): TextItemGeom[] => [RUN_GEOM],
      edit: { ...initialEditState, tool: "text" },
      dispatch: (): void => undefined,
      pickImage: async (): Promise<null> => null,
      defaultFont: "Helvetica",
      onCommitTextEdit: api.onCommitTextEdit,
      onCommitTextBox: (): void => undefined,
      onCommitImageEdit: (): void => undefined,
      onCommitTextBoxMove: (): void => undefined,
      onTextTargetChange,
      textLive: live,
      textCommitToken: token,
      onDiscardTextEdit: api.onDiscardTextEdit,
    });
  }
  act((): void => {
    root.render(createElement(RunHost));
  });
  api.unmount = (): void => {
    act((): void => {
      root.unmount();
    });
    host.remove();
  };
  return api;
}

describe("DEF-537 — a plain Confirm on an edited run commits exactly once", () => {
  it("typing then clicking the run bar Confirm bakes the live text once", () => {
    const h = mountRunHost();
    try {
      // A click (no drag) selects the run and raises its Confirm bar.
      pointer(layerOf(h.host), "pointerdown", 150, 110);
      expect(
        h.host.querySelector("[data-textrun-selection]"),
        "the run is selected and its bar is up",
      ).not.toBeNull();

      // The Inspector session reports the live text up (as DocumentView does).
      act((): void => {
        h.setLive("Edited run");
      });

      const confirm = h.host.querySelector<HTMLElement>(
        '[data-content-action="textrun-confirm"]',
      );
      if (confirm === null) throw new Error("run Confirm button not found");
      click(confirm);

      expect(
        h.onCommitTextEdit,
        "the run commit fired exactly once (no silent loss, no double)",
      ).toHaveBeenCalledTimes(1);
      expect(h.onCommitTextEdit.mock.calls[0]?.[0].newText).toBe("Edited run");
    } finally {
      h.unmount();
    }
  });
});

describe("DEF-538 — a whitespace-only Add Text box commit discards", () => {
  it("spaces-only new box Confirm fires no addTextBox and leaves no box", async () => {
    const h = await mountView(false, "box");
    try {
      await h.render({ open: true });
      const layer = layerOf(h.host);
      pointer(layer, "pointerdown", 2, 2);
      pointer(layer, "pointerup", 2, 2);
      expect(h.api.state.textBoxes.length, "the drag placed one new box").toBe(1);

      const snap = h.api.latestTextSelection;
      if (snap === null) throw new Error("text surface not published");
      act((): void => {
        snap.onTextChange?.("   ");
      });
      expect(h.api.state.textBoxes[0]?.text).toBe("   ");

      const confirm = h.host.querySelector<HTMLElement>('[data-edit-box-action="confirm"]');
      if (confirm === null) throw new Error("box Confirm button not found");
      act((): void => {
        snap.onTextCommit?.(confirm);
      });
      click(confirm);

      expect(h.api.commitTextBox, "no addTextBox engine op").not.toHaveBeenCalled();
      expect(h.api.textPatch, "no updateTextBox engine op").not.toHaveBeenCalled();
      expect(h.api.state.textBoxes.length, "the whitespace box is gone").toBe(0);
      expect(h.host.querySelector(".edit-box"), "no residual .edit-box").toBeNull();
    } finally {
      h.unmount();
    }
  });
});

describe("DEF-539 — Escape on a live Add Text box discards, not bakes", () => {
  it("Escape abandons the draft before the disarm clears the target", async () => {
    const h = await mountView(false, "box");
    try {
      await h.render({ open: true });
      const layer = layerOf(h.host);
      pointer(layer, "pointerdown", 2, 2);
      pointer(layer, "pointerup", 2, 2);
      expect(h.api.state.textBoxes.length, "the drag placed one new box").toBe(1);

      const snap = h.api.latestTextSelection;
      if (snap === null) throw new Error("text surface not published");
      act((): void => {
        snap.onTextChange?.("MARKER");
      });
      expect(h.api.state.textBoxes[0]?.text).toBe("MARKER");

      // Real Escape: DocumentView discards the box session synchronously, then
      // App's global handler disarms the edit tool (clears the overlay target).
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      act((): void => {
        h.api.pushAction({ type: "set-tool", tool: "off" });
      });

      expect(
        h.api.commitTextBox,
        "the abandoned draft never reached the engine",
      ).not.toHaveBeenCalled();
      expect(h.api.textPatch, "no updateTextBox engine op").not.toHaveBeenCalled();
      expect(h.api.state.textBoxes.length, "the abandoned box is gone").toBe(0);
      expect(h.host.querySelector(".edit-box"), "no residual .edit-box").toBeNull();
    } finally {
      h.unmount();
    }
  });
});

describe("DEF-540 — Escape on a live Edit-Text RUN session explicitly discards", () => {
  it("Escape reverts the live run session and never reaches the engine", async () => {
    const h = await selectRunAndPublishText("Edited run");
    try {
      expect(
        h.api.latestTextSelection?.text,
        "the live run session text is published before Escape",
      ).toBe("Edited run");

      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      await flushAsync();

      // A DETERMINISTIC discard: the published session text reverts to the
      // run's committed text (the accidental path left it at "Edited run").
      expect(
        h.api.latestTextSelection?.text,
        "Escape discarded the run session",
      ).toBe("Source run");

      // App's global handler disarms the edit tool; the ensuing target clear
      // must not commit the aborted session.
      act((): void => {
        h.api.pushAction({ type: "set-tool", tool: "off" });
      });
      await flushAsync();

      expect(h.api.commitTextEdit, "Escape never reached the engine").not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });
});

describe("DEF-541 — a whitespace-only run Confirm discards (no engine op)", () => {
  it("spaces-only run Confirm fires no onCommitTextEdit", async () => {
    const h = await selectRunAndPublishText("   ");
    try {
      const confirm = h.host.querySelector<HTMLElement>(
        '[data-content-action="textrun-confirm"]',
      );
      if (confirm === null) throw new Error("run Confirm button not found");
      click(confirm);
      await flushAsync();

      expect(
        h.api.commitTextEdit,
        "a whitespace-only run commit never reached the engine",
      ).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });
});

describe("DEF-537 stays green — a run Confirm still commits exactly once", () => {
  it("edited run Confirm fires one onCommitTextEdit with the live text", async () => {
    const h = await selectRunAndPublishText("Edited run");
    try {
      const confirm = h.host.querySelector<HTMLElement>(
        '[data-content-action="textrun-confirm"]',
      );
      if (confirm === null) throw new Error("run Confirm button not found");
      click(confirm);
      await flushAsync();

      expect(h.api.commitTextEdit, "the run commit fired exactly once").toHaveBeenCalledTimes(1);
      expect(h.api.commitTextEdit.mock.calls[0]?.[0].newText).toBe("Edited run");
    } finally {
      h.unmount();
    }
  });
});
