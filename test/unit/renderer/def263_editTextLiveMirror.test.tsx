// @vitest-environment jsdom
//
// DEF-263 / DEF-266 — the Edit-mode text-box live mirror and the edited-RUN
// preview must render the FULL style set live: font, size, colour, character
// spacing (already) PLUS bold, italic, underline, super/subscript, highlight,
// alignment, the STORED line-height, list prefixes and indent. Before the fix
// nine-plus controls were visible no-ops until save+reopen, and a style click
// after typing committed and deselected the run so styles could not compose.
//
// These tests read the mirror's COMPUTED styles (not just "a handler fired")
// and assert the per-line layout (alignment, line step, underline/highlight per
// line, list prefixes with an incrementing counter, indent on every line,
// justify excluding the last line).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import { TextPropertiesPanel, isTextPanelFocusTarget } from "../../../src/renderer/edit/TextPropertiesPanel";
import {
  editReducer,
  initialEditState,
  type EditState,
  type EditTextStyle,
  type TextBoxPlacement,
} from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";
import {
  applyPatchToValues,
  defaultTextStyleValues,
  editTextStyleFromValues,
} from "../../../src/renderer/edit/textStyle";
import { useState, type ReactElement } from "react";

const BASE_STYLE: EditTextStyle = {
  font: "Helvetica",
  size: 12,
  color: { r: 0, g: 0, b: 0 },
};

const MULTILINE = "The quick brown fox jumps over the lazy dog";

function makeBox(style: EditTextStyle, rect = { x: 100, y: 100, width: 140, height: 400 }): TextBoxPlacement {
  return { id: "tb-live", page: 1, rect, text: MULTILINE, style, background: "none" };
}

function css(el: Element): CSSStyleDeclaration {
  return window.getComputedStyle(el as HTMLElement);
}

function mountBox(box: TextBoxPlacement): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  const root = createRoot(host);
  const state: EditState = { ...initialEditState, tool: "box", textBoxes: [box] };
  act((): void => {
    root.render(
      createElement(EditOverlay, {
        page: 1,
        pageWidthPt: 612,
        pageHeightPt: 792,
        cssScale: 1,
        tool: "box",
        getTextItems: (): TextItemGeom[] => [],
        edit: state,
        dispatch: (a): void => {
          void editReducer(state, a);
        },
        pickImage: async (): Promise<null> => null,
        defaultFont: "Helvetica",
        onCommitTextEdit: (): void => undefined,
        onCommitTextBox: (): void => undefined,
        onCommitImageEdit: (): void => undefined,
        onCommitTextBoxMove: (): void => undefined,
      }),
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function mirrorOf(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>("[data-edit-box-text-mirror]");
  if (el === null) throw new Error("box mirror not found");
  return el;
}

function linesOf(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-edit-box-line]"));
}

function bandsOf(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".edit-box-line-band"));
}

function prefixesOf(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".edit-box-line-prefix")).map(
    (el) => el.textContent ?? "",
  );
}
interface ControlCase {
  name: string;
  style: EditTextStyle;
  assert: (host: HTMLElement) => void;
}

/** The 13 text-properties controls whose live effect DEF-263 measured as
 *  no-ops. Each entry renders the mirror with the control applied and asserts
 *  its COMPUTED style, so a handler that fires without painting cannot pass. */
const CONTROL_CASES: ControlCase[] = [
  {
    name: "font family",
    style: { ...BASE_STYLE, font: "Times" },
    assert: (host) => expect(css(mirrorOf(host)).fontFamily, "font").toContain("Times"),
  },
  {
    name: "font size",
    style: { ...BASE_STYLE, size: 24 },
    assert: (host) => expect(css(mirrorOf(host)).fontSize, "size").toBe("24px"),
  },
  {
    name: "bold",
    style: { ...BASE_STYLE, bold: true },
    assert: (host) => expect(css(mirrorOf(host)).fontWeight, "bold").toBe("700"),
  },
  {
    name: "italic",
    style: { ...BASE_STYLE, italic: true },
    assert: (host) => expect(css(mirrorOf(host)).fontStyle, "italic").toBe("italic"),
  },
  {
    name: "underline",
    style: { ...BASE_STYLE, underline: true },
    assert: (host) =>
      expect(css(linesOf(host)[0] as Element).textDecoration, "underline").toBe("underline"),
  },
  {
    name: "colour",
    style: { ...BASE_STYLE, color: { r: 1, g: 0, b: 0 } },
    assert: (host) => expect(css(mirrorOf(host)).color, "colour").toBe("rgb(255, 0, 0)"),
  },
  {
    name: "highlight",
    style: { ...BASE_STYLE, highlight: { r: 1, g: 1, b: 0 } },
    assert: (host) =>
      expect(css(bandsOf(host)[0] as Element).backgroundColor, "highlight").toBe("rgb(255, 255, 0)"),
  },
  {
    name: "superscript",
    style: { ...BASE_STYLE, baselineShift: 6 },
    assert: (host) =>
      expect(css(bandsOf(host)[0] as Element).verticalAlign, "super").toBe("6px"),
  },
  {
    name: "subscript",
    style: { ...BASE_STYLE, baselineShift: -6 },
    assert: (host) =>
      expect(css(bandsOf(host)[0] as Element).verticalAlign, "sub").toBe("-6px"),
  },
  {
    name: "alignment (centre)",
    style: { ...BASE_STYLE, align: "center" },
    assert: (host) =>
      expect(css(linesOf(host)[0] as Element).textAlign, "align").toBe("center"),
  },
  {
    name: "line height 1.8",
    style: { ...BASE_STYLE, lineHeight: 1.8 },
    // 12px font * 1.8 = a 21.6px line step (the stored value, not the old 1.2).
    assert: (host) => expect(css(mirrorOf(host)).lineHeight, "lineHeight").toBe("21.6px"),
  },
  {
    name: "bullet list",
    style: { ...BASE_STYLE, list: "bullet" },
    assert: (host) => {
      expect(prefixesOf(host)[0], "bullet prefix").toBe("\u2022 ");
      expect(linesOf(host).length, "multi-line").toBeGreaterThan(1);
    },
  },
  {
    name: "numbered list",
    style: { ...BASE_STYLE, list: "number" },
    assert: (host) =>
      expect(prefixesOf(host), "numbered prefixes").toEqual(["1. ", "2. ", "3. "]),
  },
{
    name: "indent 24",
    style: { ...BASE_STYLE, indent: 24 },
    assert: (host) =>
      // 3px mirror padding + 24px stored indent.
      expect(css(mirrorOf(host)).paddingLeft, "indent").toBe("27px"),
  },
  {
    name: "character spacing 3",
    style: { ...BASE_STYLE, charSpacing: 3 },
    assert: (host) => expect(css(mirrorOf(host)).letterSpacing, "tracking").toBe("3px"),
  },
];

describe("DEF-263 � each control changes the LIVE box mirror's computed style", () => {
  it("renders all 15 control cases (13 distinct fields) with the expected computed values", () => {
    for (const c of CONTROL_CASES) {
      const m = mountBox(makeBox(c.style));
      try {
        c.assert(m.host);
      } finally {
        m.unmount();
      }
    }
    // 15 control cases = the 13 panel fields with bullet/number split and
    // super/sub split counted separately.
    expect(CONTROL_CASES.length).toBe(15);
  });

  it("applies default (unstyled) computed values when no style field is set", () => {
    const m = mountBox(makeBox(BASE_STYLE));
    try {
      const container = css(mirrorOf(m.host));
      expect(container.fontWeight).toBe("400");
      expect(container.fontStyle).toBe("normal");
      expect(container.lineHeight).toBe("14.4px"); // 12 * 1.2
      expect(linesOf(m.host)[0]?.style.textDecoration ?? "").not.toBe("underline");
      expect(prefixesOf(m.host)).toEqual([]);
    } finally {
      m.unmount();
    }
  });
});

describe("DEF-263 � multi-line (wrapped) box: per-line layout", () => {
  it("wraps to multiple lines and applies alignment to every line", () => {
    const m = mountBox(makeBox({ ...BASE_STYLE, align: "center" }));
    try {
      const lines = linesOf(m.host);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(css(line).textAlign).toBe("center");
      // Reconstructed text equals the source (wrap never drops words).
      expect(lines.map((l) => l.textContent).join(" ").replace(/\s+/g, " ").trim()).toBe(MULTILINE);
    } finally {
      m.unmount();
    }
  });

  it("line-height changes the rendered line step", () => {
    const tight = mountBox(makeBox({ ...BASE_STYLE, lineHeight: 1.2 }));
    let tightStep = "";
    try {
      tightStep = css(mirrorOf(tight.host)).lineHeight;
    } finally {
      tight.unmount();
    }
    const loose = mountBox(makeBox({ ...BASE_STYLE, lineHeight: 1.8 }));
    try {
      const looseStep = css(mirrorOf(loose.host)).lineHeight;
      expect(tightStep).toBe("14.4px");
      expect(looseStep).toBe("21.6px");
      expect(looseStep).not.toBe(tightStep);
    } finally {
      loose.unmount();
    }
  });

  it("underline and highlight apply on EVERY line", () => {
    const m = mountBox(
      makeBox({ ...BASE_STYLE, underline: true, highlight: { r: 0, g: 1, b: 0 } }),
    );
    try {
      const lines = linesOf(m.host);
      const bands = bandsOf(m.host);
      expect(lines.length).toBeGreaterThan(1);
      expect(bands.length).toBe(lines.length);
      for (const line of lines) expect(css(line).textDecoration).toBe("underline");
      for (const band of bands) expect(css(band).backgroundColor).toBe("rgb(0, 255, 0)");
    } finally {
      m.unmount();
    }
  });

  it("bullet prefixes appear on every line", () => {
    const m = mountBox(makeBox({ ...BASE_STYLE, list: "bullet" }));
    try {
      const prefixes = prefixesOf(m.host);
      const lines = linesOf(m.host);
      expect(prefixes.length).toBe(lines.length);
      for (const p of prefixes) expect(p).toBe("\u2022 ");
    } finally {
      m.unmount();
    }
  });

  it("numbered prefixes increment per line", () => {
    const m = mountBox(makeBox({ ...BASE_STYLE, list: "number" }));
    try {
      expect(prefixesOf(m.host)).toEqual(["1. ", "2. ", "3. "]);
    } finally {
      m.unmount();
    }
  });

it("indent shifts every line, not only the first", () => {
    const m = mountBox(makeBox({ ...BASE_STYLE, indent: 24 }));
    try {
      const lines = linesOf(m.host);
      expect(lines.length).toBeGreaterThan(1);
      // The block's padding-left is 3 (mirror padding) + 24 (indent), so
      // EVERY line starts at the indented content edge.
      expect(css(mirrorOf(m.host)).paddingLeft).toBe("27px");
      // The line width is the reduced content width (140 - 6 - 24 = 110).
      for (const line of lines) expect(css(line).width).toBe("110px");
    } finally {
      m.unmount();
    }
  });

  it("justify stretches every line EXCEPT the last", () => {
    const m = mountBox(makeBox({ ...BASE_STYLE, align: "justify" }));
    try {
      const lines = linesOf(m.host);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines.slice(0, -1)) expect(css(line).textAlign).toBe("justify");
      expect(css(lines[lines.length - 1] as Element).textAlign).toBe("left");
    } finally {
      m.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-266 � the run preview: full style set, and a style click after typing
// must NOT commit/deselect the run (so styles compose). This mini host mirrors
// the real DocumentView wiring: it owns the panel values + the run session,
// applies each patch through `applyPatchToValues`, and uses the product's
// `isTextPanelFocusTarget` guard to keep the session alive on a panel-focus
// blur.

const RUN_ITEM: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };

interface RunHostProps {
  onCommitTextEdit: (args: unknown) => void;
}

function RunHost(props: RunHostProps): ReactElement {
  const [values, setValues] = useState(() => defaultTextStyleValues("Helvetica"));
  const [live, setLive] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const editState: EditState = { ...initialEditState, tool: "text" };
  const commit = (relatedTarget?: EventTarget | null): void => {
    if (isTextPanelFocusTarget(relatedTarget)) return;
    setToken((n) => n + 1);
  };
  return (
    <div>
      <TextPropertiesPanel
        open
        values={values}
        defaults={defaultTextStyleValues("Helvetica")}
        mode="text"
        onPatch={(p): void => setValues((v) => applyPatchToValues(v, p))}
        text={live}
        onTextChange={(t): void => setLive(t)}
        onTextCommit={commit}
        focusToken={0}
      />
      <EditOverlay
        page={1}
        pageWidthPt={612}
        pageHeightPt={792}
        cssScale={1}
        tool="text"
        getTextItems={(): TextItemGeom[] => [RUN_ITEM]}
        edit={editState}
        dispatch={(): void => undefined}
        pickImage={async (): Promise<null> => null}
        defaultFont="Helvetica"
        onCommitTextEdit={props.onCommitTextEdit as never}
        onCommitTextBox={(): void => undefined}
        onCommitImageEdit={(): void => undefined}
        onCommitTextBoxMove={(): void => undefined}
        textStyle={editTextStyleFromValues(values)}
        textLive={live}
        textCommitToken={token}
      />
    </div>
  );
}

function mountRunHost(onCommitTextEdit: (args: unknown) => void): {
  host: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<RunHost onCommitTextEdit={onCommitTextEdit} />);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function selectRun(host: HTMLElement): void {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("edit layer not found");
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 150,
        clientY: 110,
        pointerId: 1,
      }),
    );
  });
}

function typeIntoPanel(host: HTMLElement, text: string): void {
  const ta = host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
  if (ta === null) throw new Error("[data-txt-text] not found");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickControl(host: HTMLElement, selector: string): boolean {
  const btn = host.querySelector<HTMLButtonElement>(selector);
  if (btn === null) throw new Error(`${selector} not found`);
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act((): void => {
    btn.dispatchEvent(down);
  });
  act((): void => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return down.defaultPrevented;
}

function runPreview(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>("[data-edit-run-preview]");
}

function runLines(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-edit-run-line]"));
}

function blurTo(host: HTMLElement, target: EventTarget | null): void {
  const ta = host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
  if (ta === null) throw new Error("[data-txt-text] not found");
  act((): void => {
    ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: target as EventTarget }));
  });
}

describe("DEF-266 � the run preview renders the full style set", () => {
  it("applies bold, alignment, line-height, list prefixes and indent to the run preview", () => {
    const onCommit = vi.fn();
    const m = mountRunHost(onCommit);
    try {
      selectRun(m.host);
      typeIntoPanel(m.host, "Hello world");
      expect(runPreview(m.host), "preview mounts on first keystroke").not.toBeNull();

      expect(clickControl(m.host, "[data-txt-bold]"), "bold does not blur the field").toBe(true);
      expect(css(runPreview(m.host) as Element).fontWeight).toBe("700");

      clickControl(m.host, "[data-txt-align-center]");
      expect(css(runLines(m.host)[0] as Element).textAlign).toBe("center");

      clickControl(m.host, "[data-txt-line-height]");
      // The line-height input is a text field; set its value directly through
      // the panel's change handler.
      const lh = m.host.querySelector<HTMLInputElement>("[data-txt-line-height]");
      if (lh !== null) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        act((): void => {
          setter?.call(lh, "2");
          lh.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      expect(css(runPreview(m.host) as Element).lineHeight).toBe("24px");

      clickControl(m.host, "[data-txt-list-bullet]");
      expect(m.host.querySelectorAll(".edit-run-line-prefix")[0]?.textContent).toBe("\u2022 ");

clickControl(m.host, "[data-txt-indent-inc]");
      // Indent insets the block; every line runs through the indented content
      // width (200 - 12 = 188).
      expect(css(runPreview(m.host) as Element).paddingLeft).toBe("12px");
      for (const line of runLines(m.host)) expect(css(line).width).toBe("188px");

      // A style click never commits; the run stays selected.
      expect(onCommit).not.toHaveBeenCalled();
      expect(runPreview(m.host)).not.toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("renders explicit multi-line run text per line with incrementing numbers", () => {
    const onCommit = vi.fn();
    const m = mountRunHost(onCommit);
    try {
      selectRun(m.host);
      typeIntoPanel(m.host, "alpha\nbeta\ngamma");
      clickControl(m.host, "[data-txt-list-number]");
      const prefixes = Array.from(m.host.querySelectorAll(".edit-run-line-prefix")).map(
        (el) => el.textContent,
      );
      expect(prefixes).toEqual(["1. ", "2. ", "3. "]);
      expect(runLines(m.host).length).toBe(3);
    } finally {
      m.unmount();
    }
  });
});

describe("DEF-266 � a style click after typing composes on the run and does not deselect it", () => {
  it("keeps the run active through a panel-focus blur, then commits the composed style", () => {
    const onCommit = vi.fn();
    const m = mountRunHost(onCommit);
    try {
      selectRun(m.host);
      typeIntoPanel(m.host, "Compose me");
      clickControl(m.host, "[data-txt-bold]");

      // A blur whose focus target is INSIDE the panel must NOT commit.
      const boldBtn = m.host.querySelector("[data-txt-bold]");
      blurTo(m.host, boldBtn);
      expect(onCommit, "panel-focus blur keeps the session").not.toHaveBeenCalled();
      expect(runPreview(m.host), "run stays selected").not.toBeNull();

      // Composing continues after the non-committing blur.
      clickControl(m.host, "[data-txt-align-center]");
      expect(css(runLines(m.host)[0] as Element).textAlign).toBe("center");

      // Leaving the panel commits exactly once, with every composed field.
      blurTo(m.host, document.body);
      expect(onCommit).toHaveBeenCalledTimes(1);
      const payload = onCommit.mock.calls[0]?.[0] as { newText: string; style: EditTextStyle };
      expect(payload.newText).toBe("Compose me");
      expect(payload.style.bold).toBe(true);
      expect(payload.style.align).toBe("center");
      // The commit clears the target, so the preview is gone.
      expect(runPreview(m.host)).toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("isTextPanelFocusTarget reports panel controls and outside targets", () => {
    const onCommit = vi.fn();
    const m = mountRunHost(onCommit);
    try {
      const boldBtn = m.host.querySelector("[data-txt-bold]");
      expect(isTextPanelFocusTarget(boldBtn)).toBe(true);
      expect(isTextPanelFocusTarget(document.body)).toBe(false);
      expect(isTextPanelFocusTarget(null)).toBe(false);
    } finally {
      m.unmount();
    }
  });
});
