// @vitest-environment jsdom
//
// Phase 51 feature F — the seven edit-text operator complaints (items 6, 7,
// 12, 13, 14, 15, 16). One focused test per item, asserting the observable
// behaviour rather than an implementation detail:
//   6  selecting a run ARMS the Inspector Text field (the report the host
//      turns into the focusToken);
//   7  the selection LOOKS selected, the drag moves the TEXT (not just the
//      blue box) and Confirm creates no duplicate;
//   12 the on-canvas editor and the Inspector field share ONE session;
//   13 a format applied after a move composes on the MOVED geometry;
//   14 nothing selected -> no formatting control reads active;
//   15 a second move leaves no residual copy at the first position;
//   16 super/subscript paints the text once (the cover follows the shift).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditOverlay, type EditTextTarget } from "../../../src/renderer/edit/EditOverlay";
import { initialEditState, type EditState } from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";
import { defaultTextStyleValues, textPanelValuesForSelection } from "../../../src/renderer/edit/textStyle";
import type { EditTextStyle } from "../../../src/renderer/edit/model";

const RUN: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };

const stubCapture = function (this: Element): void {
  void this;
};
const stubRelease = function (this: Element): void {
  void this;
};

interface Harness {
  host: HTMLElement;
  root: Root;
  onCommitTextEdit: ReturnType<typeof vi.fn>;
  onTextTargetChange: ReturnType<typeof vi.fn>;
  onTextInput: ReturnType<typeof vi.fn>;
  onDiscardTextEdit: ReturnType<typeof vi.fn>;
  items: TextItemGeom[];
  style: EditTextStyle;
  rerender: () => void;
  unmount: () => void;
}

function mount(): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = stubCapture;
  Element.prototype.releasePointerCapture = stubRelease;
  const root = createRoot(host);
  const onCommitTextEdit = vi.fn();
  const onTextTargetChange = vi.fn();
  const onTextInput = vi.fn();
  const onDiscardTextEdit = vi.fn();
  const items: TextItemGeom[] = [{ ...RUN }];
  const state: EditState = { ...initialEditState, tool: "text" };
  const style: EditTextStyle = { font: "Helvetica", size: 20, color: { r: 0, g: 0, b: 0 } };
  const h: Harness = {
    host,
    root,
    onCommitTextEdit,
    onTextTargetChange,
    onTextInput,
    onDiscardTextEdit,
    items,
    style,
    rerender: (): void => undefined,
    unmount: (): void => undefined,
  };
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page: 1,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: "text",
          getTextItems: (): TextItemGeom[] => h.items,
          edit: state,
          dispatch: (): void => undefined,
          pickImage: async (): Promise<null> => null,
          defaultFont: "Helvetica",
          onCommitTextEdit,
          onCommitTextBox: (): void => undefined,
          onCommitImageEdit: (): void => undefined,
          onCommitTextBoxMove: (): void => undefined,
          textStyle: h.style,
          onTextTargetChange,
          onTextInput,
          onTextInputCommit: (): void => undefined,
          onDiscardTextEdit,
          textLive: null,
          textCommitToken: 0,
        }),
      );
    });
  };
  h.rerender = render;
  h.unmount = (): void => {
    act((): void => {
      root.unmount();
    });
    host.remove();
  };
  render();
  return h;
}

function layerOf(host: HTMLElement): HTMLElement {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("edit layer not found");
  return layer;
}

function pointer(el: HTMLElement, type: string, x: number, y: number, button = 0): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function selectRun(host: HTMLElement, x = 150, y = 110): void {
  pointer(layerOf(host), "pointerdown", x, y);
}

function dblclick(el: HTMLElement): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
}

function clickAction(host: HTMLElement, selector: string): void {
  const btn = host.querySelector<HTMLButtonElement>(selector);
  if (btn === null) throw new Error(`${selector} not found`);
  act((): void => {
    btn.click();
  });
}

function dragConfirm(host: HTMLElement, dx: number, dy: number, ox = 150, oy = 110): void {
  pointer(layerOf(host), "pointermove", ox + dx, oy + dy);
  pointer(layerOf(host), "pointerup", ox + dx, oy + dy);
  clickAction(host, '[data-content-action="textrun-confirm"]');
}

function px(el: HTMLElement, prop: string): number {
  return Number.parseFloat(el.style.getPropertyValue(prop));
}

describe("Phase 51 item 6 — selecting a run arms the Inspector Text field", () => {
  it("reports a RUN target up to the host (the focusToken source)", () => {
    const h = mount();
    try {
      h.onTextTargetChange.mockClear();
      selectRun(h.host);
      const last = h.onTextTargetChange.mock.calls.at(-1)?.[0] as EditTextTarget | null;
      expect(last, "the host receives the target it turns into a focus token").not.toBeNull();
      expect(last?.kind).toBe("run");
      expect(last?.text).toBe("Source run");
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 51 item 12 — the canvas editor shares the Inspector session", () => {
  it("opening the on-canvas editor calls the SAME host text input and shows one text", () => {
    const h = mount();
    try {
      selectRun(h.host);
      const surface = h.host.querySelector<HTMLElement>("[data-textrun-selection]");
      if (surface === null) throw new Error("run selection surface missing");
      dblclick(surface);
      const editor = h.host.querySelector<HTMLTextAreaElement>("[data-edit-run-editor]");
      expect(editor, "the on-canvas editor mounts").not.toBeNull();
      // The static preview is suppressed while editing: the text is painted once.
      expect(h.host.querySelector("[data-edit-run-preview]")).toBeNull();
      // A keystroke routes through the host's single session handler.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      act((): void => {
        setter?.call(editor, "Edited in canvas");
        editor?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(h.onTextInput).toHaveBeenCalledWith("Edited in canvas");
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 51 item 7 — selection look, drag moves the text, Confirm no duplicate", () => {
  it("the selected run carries a ranked, non-hover selection treatment", () => {
    const h = mount();
    try {
      selectRun(h.host);
      const surface = h.host.querySelector<HTMLElement>("[data-textrun-selection]");
      expect(surface).not.toBeNull();
      expect(surface?.classList.contains("edit-textrun-selection")).toBe(true);
      // The class must out-rank the opaque white eraser (which is painted after
      // it in DOM order) or the selection is invisible.
      const css = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
      const rule = css.slice(css.indexOf(".edit-textrun-selection {"));
      expect(rule.slice(0, rule.indexOf("}"))).toMatch(/z-index:\s*[1-9]/);
    } finally {
      h.unmount();
    }
  });

  it("a drag moves the text's preview with the blue box while the cover holds the old rect", () => {
    const h = mount();
    try {
      selectRun(h.host);
      const eraser = h.host.querySelector<HTMLElement>("[data-edit-box-eraser]");
      const preview = h.host.querySelector<HTMLElement>("[data-edit-run-preview]");
      expect(px(eraser as HTMLElement, "left")).toBe(100);
      pointer(layerOf(h.host), "pointermove", 200, 130);
      // The text itself follows the drag (was: only the blue box moved).
      expect(px(preview as HTMLElement, "left"), "the text preview follows the drag").toBe(150);
      expect(px(preview as HTMLElement, "top")).toBe(120);
      // The white cover stays over the OLD baked rect so no copy is exposed
      // at the original position while the move is unconfirmed.
      expect(px(eraser as HTMLElement, "left"), "the cover holds the old rect").toBe(100);
      expect(px(eraser as HTMLElement, "top")).toBe(100);
    } finally {
      h.unmount();
    }
  });

  it("Confirm commits the moved position with the original as oldRect and leaves no residual copy", async () => {
    const h = mount();
    try {
      selectRun(h.host);
      dragConfirm(h.host, 60, 30);
      expect(h.onCommitTextEdit).toHaveBeenCalledTimes(1);
      const args = h.onCommitTextEdit.mock.calls[0]?.[0] as {
        rect: { x: number; y: number };
        oldRect?: { x: number; y: number };
        newText: string;
      };
      expect(args.rect.x).toBe(160);
      expect(args.rect.y).toBe(130);
      expect(args.oldRect?.x, "the engine masks the ORIGINAL rect").toBe(100);
      expect(args.newText).toBe("Source run");
      // No duplicate: the eraser + preview (which painted the run at the OLD
      // rect) must unmount with the target. The void-callback commit releases
      // the pending cover on the next task (real hosts hold it until the
      // engine refresh resolves).
      await act(async (): Promise<void> => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(h.host.querySelector("[data-edit-run-preview]")).toBeNull();
      expect(h.host.querySelector("[data-edit-box-eraser]")).toBeNull();
      expect(h.host.querySelector("[data-textrun-selection]")).toBeNull();
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 51 item 13 — formatting after a move composes on the moved geometry", () => {
  it("a re-selection after Confirm reports the NEW rect (never the old one)", () => {
    const h = mount();
    try {
      selectRun(h.host);
      dragConfirm(h.host, 60, 30);
      // The engine + proxy have landed: the run now lives at the moved rect.
      h.items[0] = { x: 160, y: 130, width: 200, height: 20, text: "Source run" };
      h.onTextTargetChange.mockClear();
      selectRun(h.host, 200, 140);
      const last = h.onTextTargetChange.mock.calls.at(-1)?.[0] as EditTextTarget | null;
      expect(last?.kind).toBe("run");
      expect(last?.rect.x, "formatting composes on the moved rect").toBe(160);
      expect(last?.rect.y).toBe(130);
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 51 item 14 — nothing selected means no active formatting", () => {
  it("a stale pending run style is ignored once the run is deselected", () => {
    const defaults = defaultTextStyleValues("Helvetica");
    const pending = { ...defaults, bold: true, italic: true, baselineShift: 6 };
    // No run selected (runValues null) -> defaults, NOT the stale pending set.
    const resolved = textPanelValuesForSelection({
      selectedBoxStyle: null,
      runValues: null,
      pending,
      defaults,
    });
    expect(resolved.bold).toBe(false);
    expect(resolved.italic).toBe(false);
    expect(resolved.baselineShift).toBe(0);
    // And with a run actually selected the pending set still applies.
    const live = textPanelValuesForSelection({
      selectedBoxStyle: null,
      runValues: defaults,
      pending,
      defaults,
    });
    expect(live.bold).toBe(true);
    expect(live.baselineShift).toBe(6);
  });
});

describe("Phase 51 item 15 — a second move leaves no residual copy", () => {
  it("two move+Confirm cycles commit twice and leave no preview behind", async () => {
    const h = mount();
    try {
      selectRun(h.host);
      dragConfirm(h.host, 60, 30);
      h.items[0] = { x: 160, y: 130, width: 200, height: 20, text: "Source run" };
      h.rerender();
      selectRun(h.host, 200, 140);
      dragConfirm(h.host, 40, 20, 200, 140);
      expect(h.onCommitTextEdit).toHaveBeenCalledTimes(2);
      const second = h.onCommitTextEdit.mock.calls[1]?.[0] as { rect: { x: number } };
      expect(second.rect.x).toBe(200);
      await act(async (): Promise<void> => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(h.host.querySelector("[data-edit-run-preview]"), "no residual copy").toBeNull();
      expect(h.host.querySelector("[data-edit-box-eraser]")).toBeNull();
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 51 item 16 — super/subscript paints the text once", () => {
  it("the cover follows the baseline shift and only one preview renders", () => {
    const h = mount();
    try {
      h.style = { ...h.style, baselineShift: 6 };
      h.rerender();
      selectRun(h.host);
      const eraser = h.host.querySelector<HTMLElement>("[data-edit-box-eraser]");
      expect(px(eraser as HTMLElement, "top"), "the cover reaches the superscript").toBe(94);
      expect(h.host.querySelectorAll("[data-edit-run-preview]").length).toBe(1);
      expect(h.host.querySelectorAll("[data-edit-run-preview]").length, "no second copy").not.toBe(2);
    } finally {
      h.unmount();
    }
  });
});

describe("DEF-370 — selecting a run must not let the browser steal the Inspector focus", () => {
  function mouseDown(el: HTMLElement, x: number, y: number): MouseEvent {
    const ev = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    act((): void => {
      el.dispatchEvent(ev);
    });
    return ev;
  }

  it("suppresses the native mousedown focus steal on a run hit only", () => {
    const h = mount();
    try {
      // A press that selects a run suppresses the compat mousedown default —
      // this is the focus change that blurred the Inspector Text field.
      const onRun = mouseDown(layerOf(h.host), 150, 110);
      expect(onRun.defaultPrevented, "run press suppresses the native focus steal").toBe(true);

      // An empty-page press keeps native behaviour (blur + commit still happen).
      const onEmpty = mouseDown(layerOf(h.host), 500, 620);
      expect(onEmpty.defaultPrevented, "empty-page press keeps native focus").toBe(false);

      // An interactive control is never swallowed (AGENTS.md cross-bubbling rule).
      const btn = document.createElement("button");
      h.host.appendChild(btn);
      const onButton = mouseDown(btn, 150, 110);
      expect(onButton.defaultPrevented, "interactive control keeps its own focus").toBe(false);
    } finally {
      h.unmount();
    }
  });
});
