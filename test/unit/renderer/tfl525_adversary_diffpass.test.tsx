// @vitest-environment jsdom
//
// TFL-695 adversary diff-pass probe over the TFL-525 Edit Text / Add Text
// commit / cancel / hover change set. Adversary-authored probe (not a product
// test). Drives the real EditOverlay component with a host that mirrors
// DocumentView's run-session protocol: target-clear commit (Confirm) and the
// Inspector Text field's blur commit (run switch / dock tool switch) flip the
// token; the Escape/disarm abort is an explicit discard (DEF-540).
import { describe, expect, it, vi, type Mock } from "vitest";
import { act, useState, useRef, type ReactElement } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import type { EditTextTarget } from "../../../src/renderer/edit/EditOverlay";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";
import { initialEditState, type EditAction, type EditTextStyle } from "../../../src/renderer/edit/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
type CommitTextEditFn = (args: {
  rect: Rect;
  newText: string;
  style: EditTextStyle;
  oldRect?: Rect;
  page: number;
}) => void | Promise<void>;

const RUN_GEOM: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };
const RUN2_GEOM: TextItemGeom = { x: 400, y: 300, width: 120, height: 20, text: "Second run" };
const NOOP = (): void => undefined;

interface RunHarness {
  host: HTMLElement;
  onCommitTextEdit: Mock<CommitTextEditFn>;
  onDiscardTextEdit: Mock<() => void>;
  setLive: (text: string | null) => void;
  setTool: (tool: "text" | "off") => void;
  /** Models DocumentView.commitTextSession on the Inspector Text field's
   *  blur: commits the live run while its target is still selected. A run
   *  switch (canvas mousedown) and a dock tool switch both blur the field
   *  BEFORE the new selection lands, so A's edit commits at A's rect. */
  commitLiveSession: () => void;
  /** Models DocumentView.discardTextSession — the explicit Escape/disarm
   *  abort (CTO ruling 2026-10-04, DEF-540). Clears the live session with
   *  no engine op and no undo entry. */
  discardLiveSession: () => void;
  discardCount: () => number;
  dispatchedActions: EditAction[];
  latestTarget: EditTextTarget | null;
  unmount: () => void;
}

/** Host that mirrors DocumentView's run-session protocol. The target-clear
 *  effect commits a live run (Confirm path); `commitLiveSession` models the
 *  Inspector Text field's blur (a run switch / dock tool switch, which lands
 *  the commit while the OLD run is still the target); `discardLiveSession`
 *  models the explicit Escape/disarm discard. Everything else is the bare
 *  EditOverlay contract. */
function mountRunHost(): RunHarness {
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
  const api: RunHarness = {
    host,
    onCommitTextEdit: vi.fn<CommitTextEditFn>(),
    onDiscardTextEdit: vi.fn<() => void>(),
    setLive: NOOP,
    setTool: NOOP,
    commitLiveSession: NOOP,
    discardLiveSession: NOOP,
    discardCount: (): number => 0,
    dispatchedActions: [],
    latestTarget: null,
    unmount: NOOP,
  };
  const discardState = { count: 0 };
  function RunHost(): ReactElement {
    const [live, setLive] = useState<string | null>(null);
    const [token, setToken] = useState(0);
    const [tool, setTool] = useState<"text" | "off">("text");
    const prevTargetRef = useRef<EditTextTarget | null>(null);
    const liveRef = useRef<string | null>(null);
    liveRef.current = live;
    /** DocumentView.discardTextSession — the explicit abort path. Clears the
     *  live session so the target-change effect later commits nothing. */
    const discardLiveSession = (): void => {
      if (liveRef.current === null) return;
      discardState.count += 1;
      liveRef.current = null;
      setLive(null);
    };
    /** DocumentView.commitTextSession on the field blur — commits the live
     *  run while its current target is still selected. */
    const commitLiveSession = (): void => {
      if (liveRef.current === null) return;
      liveRef.current = null;
      setLive(null);
      setToken((n) => n + 1);
    };
    api.setLive = (text: string | null): void => setLive(text);
    api.setTool = (t: "text" | "off"): void => {
      // A programmatic tool-off with no field blur IS the Escape/disarm abort
      // (the real dock switch blurs the Inspector field first and commits —
      // covered by the e2e S4 path), so it must discard the live session.
      if (t === "off") discardLiveSession();
      setTool(t);
    };
    api.commitLiveSession = commitLiveSession;
    api.discardLiveSession = discardLiveSession;
    api.discardCount = (): number => discardState.count;
    const onTextTargetChange = (target: EditTextTarget | null): void => {
      const prev = prevTargetRef.current;
      prevTargetRef.current = target;
      api.latestTarget = target;
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
      tool,
      getTextItems: (): TextItemGeom[] => [RUN_GEOM, RUN2_GEOM],
      edit: { ...initialEditState, tool },
      dispatch: (action: EditAction): void => {
        api.dispatchedActions.push(action);
      },
      pickImage: async (): Promise<null> => null,
      defaultFont: "Helvetica",
      onCommitTextEdit: api.onCommitTextEdit,
      onCommitTextBox: (): void => undefined,
      onCommitImageEdit: (): void => undefined,
      onCommitTextBoxMove: (): void => undefined,
      onTextTargetChange,
      textLive: live,
      textCommitToken: token,
      onDiscardTextEdit: (): void => {
        api.onDiscardTextEdit();
        discardLiveSession();
      },
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
function runBarButton(h: RunHarness, action: string): HTMLElement {
  const btn = h.host.querySelector<HTMLElement>(`[data-content-action="textrun-${action}"]`);
  if (btn === null) throw new Error(`run ${action} button not found`);
  return btn;
}

/** Phase 117 chunk B — the run bar's Delete lives behind the separated
 *  More control; open it before the verb exists in the DOM. */
function openRunMore(h: RunHarness): void {
  const more = h.host.querySelector<HTMLElement>('[data-content-action="textrun-more"]');
  if (more === null) throw new Error("run more control not found");
  click(more);
}

/** Select the sole run, then feed it live session text as the panel does. */
function selectRunAndType(h: RunHarness, text: string): void {
  pointer(layerOf(h.host), "pointerdown", 150, 110);
  expect(h.host.querySelector("[data-textrun-selection]"), "run selected").not.toBeNull();
  act((): void => {
    h.setLive(text);
  });
}

/** Leave run A for run B: the canvas mousedown blurs the Inspector Text
 *  field, whose blur commits A's live session WHILE A is still the target
 *  (DocumentView.commitTextSession -> run branch bumps the token); the same
 *  click then selects B. This is the real run-switch path S2 exercises. */
function selectSecondRunAndType(h: RunHarness, text: string): void {
  act((): void => {
    h.commitLiveSession();
  });
  pointer(layerOf(h.host), "pointerdown", 450, 310);
  act((): void => {
    h.setLive(text);
  });
}

describe("TFL-695 run-session commit boundaries (real EditOverlay)", () => {
  it("A1 plain Confirm commits exactly once", () => {
    const h = mountRunHost();
    try {
      selectRunAndType(h, "Edited run");
      click(runBarButton(h, "confirm"));
      expect(h.onCommitTextEdit, "commit fired exactly once").toHaveBeenCalledTimes(1);
      expect(h.onCommitTextEdit.mock.calls[0]?.[0].newText).toBe("Edited run");
    } finally {
      h.unmount();
    }
  });

  it("A2 Cancel discards the run edit (no commit)", () => {
    const h = mountRunHost();
    try {
      selectRunAndType(h, "Edited run");
      click(runBarButton(h, "cancel"));
      expect(h.onCommitTextEdit, "Cancel did not commit the run").not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("A3 programmatic disarm (no field blur) explicitly discards the live run edit", () => {
    const h = mountRunHost();
    try {
      selectRunAndType(h, "Edited run");
      act((): void => {
        h.setTool("off");
      });
      expect(
        h.onCommitTextEdit,
        "disarm must not commit the live run edit (CTO ruling: Escape/disarm is an explicit discard)",
      ).not.toHaveBeenCalled();
      expect(
        h.discardCount(),
        "disarm must reach the explicit discard path (DEF-540), not discard by accident",
      ).toBe(1);
      expect(
        h.dispatchedActions.some((a) => a.type === "push-text-run-commit"),
        "a disarm discard must not push an undo entry",
      ).toBe(false);
    } finally {
      h.unmount();
    }
  });

  it("A5 whitespace-only run commit — does it dirty the document?", () => {
    const h = mountRunHost();
    try {
      selectRunAndType(h, "   ");
      click(runBarButton(h, "confirm"));
      expect(
        h.onCommitTextEdit.mock.calls.length,
        `whitespace-only run commit count (expected 0) = ${h.onCommitTextEdit.mock.calls.length}`,
      ).toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("A6 Delete masks the run with empty text", () => {
    const h = mountRunHost();
    try {
      selectRunAndType(h, "whatever");
      openRunMore(h);
      click(runBarButton(h, "delete"));
      expect(h.onCommitTextEdit, "Delete masks via an empty-text run commit").toHaveBeenCalledTimes(1);
      expect(h.onCommitTextEdit.mock.calls[0]?.[0].newText).toBe("");
    } finally {
      h.unmount();
    }
  });

  it("A7 Confirm then a later tool switch must not double-commit", () => {
    const h = mountRunHost();
    try {
      selectRunAndType(h, "Edited run");
      click(runBarButton(h, "confirm"));
      act((): void => {
        h.setTool("off");
      });
      expect(h.onCommitTextEdit, "no double commit").toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("A8 switching runs (A edited -> select B) — where does A's edit go?", () => {
    const h = mountRunHost();
    try {
      selectRunAndType(h, "A-edit");
      selectSecondRunAndType(h, "B-edit");
      const calls = h.onCommitTextEdit.mock.calls;
      expect(
        calls.length,
        `commit count after switching runs (contract: 1 for A at A's rect) = ${calls.length}`,
      ).toBe(1);
      if (calls.length > 0) {
        expect(calls[0]?.[0].newText, "committed A's text").toBe("A-edit");
        expect(calls[0]?.[0].rect.x, "committed at A's rect").toBe(100);
      }
      const bCalls = calls.filter((c) => c[0].newText === "B-edit");
      expect(bCalls.length, "B's text must not have been used for A's commit").toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("A9 two confirms on two runs — no stale parked target reuse", () => {
    const h = mountRunHost();
    try {
      selectRunAndType(h, "A-edit");
      click(runBarButton(h, "confirm"));
      selectSecondRunAndType(h, "B-edit");
      click(runBarButton(h, "confirm"));
      const calls = h.onCommitTextEdit.mock.calls;
      expect(calls.length, "exactly two commits").toBe(2);
      expect(calls[0]?.[0].newText).toBe("A-edit");
      expect(calls[0]?.[0].rect.x).toBe(100);
      expect(calls[1]?.[0].newText).toBe("B-edit");
      expect(calls[1]?.[0].rect.x).toBe(400);
    } finally {
      h.unmount();
    }
  });
});
