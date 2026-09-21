// @vitest-environment jsdom
//
// Phase 29 — DEF-262 (multi-line annotation textbox / callout shrunk to the
// 4pt floor), DEF-265 (list prefixes + super/subscript baked-only live) and
// DEF-264 (the sticky-note label ignored every style control).
//
// These tests read the LIVE overlay's per-line DOM and computed inline styles
// and compare the layout with an INDEPENDENT greedy wrap of the engine's
// documented rule (wrap at the indented content width minus the list-prefix
// reserve, line step = size * lineHeight), so the live mirror is pinned to the
// baked layout, not merely to itself.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import { annotationToWire } from "../../../src/renderer/engine/engineClient";
import { grownAnnTextRect, layoutAnnTextBox } from "../../../src/renderer/annotations/annTextLayout";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";
import type { AnnTextStyle } from "../../../src/shared/types";

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };
const LONG = "The quick brown fox jumps over the lazy dog and keeps running far away";

/** The deterministic jsdom measure fallback (`measureTextWidthCss`). */
const width = (t: string, s: number): number => t.length * s * 0.55;

/** An INDEPENDENT greedy wrap of the engine's documented rule. */
function bakedWrap(
  text: string,
  sizePt: number,
  contentWidthPt: number,
  indentPt: number,
  prefixReservePt: number,
  charSpacingPt: number,
): string[] {
  const m = (t: string): number => width(t, sizePt) + charSpacingPt * Math.max(0, t.length - 1);
  const max = Math.max(1, contentWidthPt - indentPt - prefixReservePt);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const candidate = line.length === 0 ? word : `${line} ${word}`;
      if (m(candidate) <= max) line = candidate;
      else {
        if (line.length > 0) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function textboxAnn(
  style: AnnTextStyle | undefined,
  text = LONG,
  widthPt = 90,
  heightPt = 40,
): Annotation {
  return {
    id: "textbox-1",
    kind: "textbox",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect: { x: 100, y: 100, width: widthPt, height: heightPt },
    text,
    ...(style === undefined ? {} : { style }),
  };
}

function noteAnn(style: AnnTextStyle | undefined, text = LONG): Annotation {
  return {
    id: "note-1",
    kind: "note",
    page: 1,
    color: "yellow",
    createdAt: "2026-01-01T00:00:00.000Z",
    at: { x: 100, y: 120 },
    text,
    ...(style === undefined ? {} : { style }),
  };
}

function mount(a: Annotation): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      createElement(AnnotationOverlay, {
        page: 1,
        widthPt: 612,
        heightPt: 792,
        cssScale: 1,
        annotations: [a],
        tool: SELECT_TOOL,
        flashId: null,
        getTextItems: (): never[] => [],
        onCreate: (): void => undefined,
      }),
    );
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function linesOf(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>("[data-ann-text-line]"));
}
function prefixesOf(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".ann-text-prefix")).map(
    (el) => el.textContent ?? "",
  );
}
function lineTextsOf(host: HTMLElement): string[] {
  // The band span wraps the optional prefix + the line text; strip the
  // prefix so the assertion reads the wrapped line itself.
  return Array.from(host.querySelectorAll<HTMLElement>(".ann-text-content")).map(
    (el) => (el.textContent ?? "").replace(/^(?:\u2022 |\d+\. )/, ""),
  );
}

describe("DEF-262 — a multi-line annotation grows and renders at the requested size", () => {
  it("the live box height is the independently-computed wrapped block at 18pt", () => {
    const { host, cleanup } = mount(textboxAnn({ size: 18 }));
    try {
      const box = host.querySelector<HTMLElement>(".ann-textbox");
      if (box === null) throw new Error("textbox not found");
      // Textbox content width = 90 - 2*(5 padding + 1 border) = 78.
      const expectedLines = bakedWrap(LONG, 18, 78, 0, 0, 0);
      const expectedHeight = expectedLines.length * 18 * 1.35 + 12;
      expect(expectedLines.length).toBeGreaterThan(1);
      expect(Number.parseFloat(box.style.fontSize)).toBe(18);
      expect(box.style.height).toBe(`${expectedHeight}px`);
      expect(linesOf(host)).toHaveLength(expectedLines.length);
      expect(lineTextsOf(host)).toEqual(expectedLines);
    } finally {
      cleanup();
    }
  });

  it("the persisted rect is the same grown height (the commit path's rule)", () => {
    const rect = { x: 100, y: 100, width: 90, height: 40 };
    const grown = grownAnnTextRect({
      kind: "textbox",
      rect,
      text: LONG,
      style: { size: 18 },
      maxHeightPt: 686,
      measure: width,
    });
    const expectedLines = bakedWrap(LONG, 18, 78, 0, 0, 0);
    expect(grown?.height).toBe(expectedLines.length * 18 * 1.35 + 12);
    // A single short line in a box that already fits stays untouched.
    expect(
      grownAnnTextRect({
        kind: "textbox",
        rect: { ...rect, width: 320, height: 120 },
        text: "SHORT",
        style: { size: 18 },
        maxHeightPt: 686,
        measure: width,
      }),
    ).toBeNull();
  });

  it("never grows past the page bound (clamped fallback shrinks instead)", () => {
    const layout = layoutAnnTextBox({
      text: LONG,
      style: { size: 18 },
      boxWidthPt: 90,
      boxHeightPt: 40,
      insetPt: 6,
      maxHeightPt: 60,
      measure: width,
    });
    expect(layout.heightPt).toBeLessThanOrEqual(60);
    expect(layout.fontSizePt).toBeLessThan(18);
    expect(layout.fontSizePt).toBeGreaterThanOrEqual(4);
  });
});

describe("DEF-265 — list prefixes and super/subscript render live, per line", () => {
  it("number prefixes increment across every wrapped line", () => {
    const { host, cleanup } = mount(textboxAnn({ list: "number" }, "alpha\nbeta\ngamma"));
    try {
      expect(prefixesOf(host)).toEqual(["1. ", "2. ", "3. "]);
      expect(lineTextsOf(host)).toEqual(["alpha", "beta", "gamma"]);
    } finally {
      cleanup();
    }
  });

  it("bullet prefixes render and super/subscript offsets the baseline", () => {
    const { host, cleanup } = mount(textboxAnn({ list: "bullet", baselineShift: 6 }, "alpha\nbeta"));
    try {
      expect(prefixesOf(host)).toEqual(["\u2022 ", "\u2022 "]);
      const bands = Array.from(host.querySelectorAll<HTMLElement>(".ann-text-content"));
      expect(bands).toHaveLength(2);
      expect(bands[0]?.style.verticalAlign).toBe("6px");
    } finally {
      cleanup();
    }
  });

  it("subscript shifts the baseline the other way", () => {
    const { host, cleanup } = mount(textboxAnn({ baselineShift: -6 }, "alpha\nbeta"));
    try {
      const bands = Array.from(host.querySelectorAll<HTMLElement>(".ann-text-content"));
      expect(bands[0]?.style.verticalAlign).toBe("-6px");
    } finally {
      cleanup();
    }
  });
});

describe("DEF-265 — the live per-line layout equals the baked layout (composed style)", () => {
  it("wrap points, indent and the number-prefix reserve match the engine rule", () => {
    const style: AnnTextStyle = {
      size: 16,
      lineHeight: 1.5,
      list: "number",
      indent: 12,
      charSpacing: 1,
      align: "center",
      underline: true,
      highlight: { r: 1, g: 1, b: 0 },
    };
    const { host, cleanup } = mount(textboxAnn(style, LONG, 220));
    try {
      // Engine rule: number reserves the widest plausible "999. " prefix.
      const reserve = width("999. ", 16) + 1 * 4; // charSpacing counts glyphs-1
      const expected = bakedWrap(LONG, 16, 208, 12, reserve, 1);
      expect(lineTextsOf(host)).toEqual(expected);
      expect(linesOf(host)).toHaveLength(expected.length);
      // Per-line emission: indent width, centred alignment, underline band.
      const line = linesOf(host)[0];
      if (line === undefined) throw new Error("no line");
      expect(Number.parseFloat(line.style.width)).toBeCloseTo(220 - 12 - 12, 5);
      expect(line.style.textAlign).toBe("center");
      expect(line.style.textDecoration).toBe("underline");
      const band = host.querySelector<HTMLElement>(".ann-text-content");
      expect(band?.style.background).toBe("rgb(255, 255, 0)");
    } finally {
      cleanup();
    }
  });

  it("justify leaves the last line un-stretched", () => {
    const { host, cleanup } = mount(textboxAnn({ align: "justify" }, "alpha\nbeta"));
    try {
      const lines = linesOf(host);
      expect(lines[0]?.style.textAlignLast).toBe("justify");
      expect(lines[1]?.style.textAlignLast).toBe("left");
    } finally {
      cleanup();
    }
  });
});

describe("DEF-264 — the sticky-note label follows the style controls live", () => {
  it("renders font / size / weight / italic / underline / align / line-height / tracking", () => {
    const { host, cleanup } = mount(
      noteAnn({
        font: "Times",
        size: 18,
        bold: true,
        italic: true,
        underline: true,
        align: "center",
        lineHeight: 2,
        charSpacing: 6,
      }),
    );
    try {
      const label = host.querySelector<HTMLElement>(".ann-note-text");
      if (label === null) throw new Error("note label not found");
      expect(label.style.fontFamily).toContain("Times");
      expect(Number.parseFloat(label.style.fontSize)).toBe(18);
      expect(label.style.fontWeight).toBe("700");
      expect(label.style.fontStyle).toBe("italic");
      expect(label.style.textDecoration).toBe("underline");
      expect(label.style.textAlign).toBe("center");
      expect(label.style.lineHeight).toBe("2");
      expect(label.style.letterSpacing).toBe("6px");
    } finally {
      cleanup();
    }
  });

  it("renders list prefixes, indent, highlight and the super/subscript shift", () => {
    const { host, cleanup } = mount(
      noteAnn(
        {
          list: "number",
          indent: 10,
          baselineShift: 6,
          highlight: { r: 1, g: 1, b: 0 },
        },
        "alpha\nbeta",
      ),
    );
    try {
      expect(prefixesOf(host)).toEqual(["1. ", "2. "]);
      const label = host.querySelector<HTMLElement>(".ann-note-text");
      expect(Number.parseFloat(label?.style.paddingLeft ?? "0")).toBeGreaterThan(10);
      const band = host.querySelector<HTMLElement>(".ann-text-content");
      expect(band?.style.background).toBe("rgb(255, 255, 0)");
      expect(band?.style.verticalAlign).toBe("6px");
    } finally {
      cleanup();
    }
  });

  it("an unstyled note keeps the historic compact label defaults", () => {
    const { host, cleanup } = mount(noteAnn(undefined, "plain note"));
    try {
      const label = host.querySelector<HTMLElement>(".ann-note-text");
      if (label === null) throw new Error("note label not found");
      expect(Number.parseFloat(label.style.fontSize)).toBe(13);
      expect(label.style.lineHeight).toBe("1.4");
      expect(label.style.fontFamily).toBe("");
      expect(lineTextsOf(host)).toEqual(["plain note"]);
    } finally {
      cleanup();
    }
  });
});

describe("DEF-262 — the create wire shape keeps `text` authoritative", () => {
  it("strips a stale echoed `content` so it cannot shadow the new text", () => {
    // The engine's create path prefers `content` over `text`. An annotation
    // that came back through an IPC echo carries `content`; re-creating it
    // with new text must not let the stale content win.
    const echoed = {
      id: "tbx-echo",
      kind: "textbox",
      page: 1,
      color: "blue",
      createdAt: "2026-01-01T00:00:00.000Z",
      rect: { x: 10, y: 10, width: 90, height: 40 },
      text: "NEW TEXT",
      content: "",
    } as unknown as Annotation;
    const wire = annotationToWire(echoed) as unknown as { kind: string; text?: string; content?: unknown };
    expect(wire.kind).toBe("text-box");
    expect(wire.text).toBe("NEW TEXT");
    expect(wire.content).toBeUndefined();
  });
});
