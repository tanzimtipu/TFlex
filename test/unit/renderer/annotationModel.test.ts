// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_HEX,
  applyPatch,
  annotationColorToCss,
  annotationToolReducer,
  countByKind,
  hasEditableText,
  initialAnnotationToolState,
  isMarkup,
  kindLabel,
  sortAnnotations,
  toggleTool,
  type Annotation,
  type AnnotationPatch,
} from "../../../src/renderer/annotations/model";
import { ANNOTATION_COLOR_NAMES } from "../../../src/shared/annotationColors";

const now = "2026-01-01T00:00:00.000Z";

function highlight(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "a",
    kind: "highlight",
    page: 1,
    color: "yellow",
    createdAt: now,
    rects: [{ x: 0, y: 0, width: 10, height: 10 }],
    text: "Hello",
    ...overrides,
  } as Annotation;
}

function note(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "b",
    kind: "note",
    page: 2,
    color: "yellow",
    createdAt: now,
    at: { x: 0, y: 0 },
    text: "Note text",
    ...overrides,
  } as Annotation;
}

describe("annotationToolReducer", () => {
  it("initial state has tool=select and a default color and pen width", () => {
    expect(initialAnnotationToolState.tool).toBe("select");
    // Phase 13 — REQUIREMENTS.md sets the single product accent to
    // the professional blue `#2563eb` (var(--accent)). The annotation
    // tool's default color is that same canonical hex so the swatch
    // + the highlight the user paints both read as "the product
    // accent" the moment the tool is armed. The earlier defaults
    // ("yellow" -> #eab308, then the Phase-2 muted-orange `#e07a2d`)
    // tracked the previous accent identities.
    expect(initialAnnotationToolState.color).toBe("#2563eb");
    expect(annotationColorToCss(initialAnnotationToolState.color)).toBe(
      "#2563eb",
    );
    expect(initialAnnotationToolState.penWidth).toBeGreaterThan(0);
  });

  it("set-tool replaces the tool exactly", () => {
    const next = annotationToolReducer(initialAnnotationToolState, {
      type: "set-tool",
      tool: "ink",
    });
    expect(next.tool).toBe("ink");
    expect(next.color).toBe(initialAnnotationToolState.color);
  });

  it("set-color replaces the color but keeps the tool and pen width", () => {
    const after = annotationToolReducer(
      { tool: "highlight", color: "yellow", penWidth: 3 },
      { type: "set-color", color: "red" },
    );
    expect(after).toEqual({ tool: "highlight", color: "red", penWidth: 3 });
  });

  it("set-pen-width ignores non-positive values", () => {
    const base = { tool: "ink" as const, color: "yellow" as const, penWidth: 3 };
    const same = annotationToolReducer(base, { type: "set-pen-width", width: 0 });
    expect(same).toEqual(base);
    const negative = annotationToolReducer(base, { type: "set-pen-width", width: -2 });
    expect(negative).toEqual(base);
  });

  it("set-pen-width replaces the width when positive", () => {
    const next = annotationToolReducer(
      { tool: "ink", color: "yellow", penWidth: 3 },
      { type: "set-pen-width", width: 5 },
    );
    expect(next.penWidth).toBe(5);
  });
});

describe("toggleTool", () => {
  it("clicking the active tool returns to select", () => {
    expect(toggleTool({ tool: "ink", color: "yellow", penWidth: 3 }, "ink")).toBe(
      "select",
    );
  });

  it("clicking a different tool activates it", () => {
    expect(toggleTool({ tool: "select", color: "yellow", penWidth: 3 }, "ink")).toBe(
      "ink",
    );
  });
});

describe("isMarkup / hasEditableText", () => {
  it("isMarkup matches highlight/underline/strikeout", () => {
    expect(isMarkup(highlight())).toBe(true);
    expect(
      isMarkup({
        id: "x",
        kind: "underline",
        page: 1,
        color: "yellow",
        createdAt: now,
        rects: [],
        text: "",
      }),
    ).toBe(true);
    expect(isMarkup(note())).toBe(false);
  });

  it("hasEditableText matches textbox and note", () => {
    expect(hasEditableText(note())).toBe(true);
    expect(hasEditableText(highlight())).toBe(false);
  });
});

describe("applyPatch", () => {
  it("returns the same object when patch is empty", () => {
    const a = highlight();
    const patch: AnnotationPatch = {};
    expect(applyPatch(a, patch)).toBe(a);
  });

  it("changes color when patch.color differs", () => {
    const a = highlight();
    const next = applyPatch(a, { color: "red" });
    expect(next.color).toBe("red");
    expect(next).not.toBe(a);
  });

  it("does not change color when patch.color is identical", () => {
    const a = highlight({ color: "red" });
    const next = applyPatch(a, { color: "red" });
    expect(next).toBe(a);
  });

  it("changes text on note / textbox / markup kinds", () => {
    const n = note({ text: "old" });
    const n2 = applyPatch(n, { text: "new" });
    if ("text" in n2) expect(n2.text).toBe("new");

    const h = highlight({ text: "old" });
    const h2 = applyPatch(h, { text: "new" });
    if ("text" in h2) expect(h2.text).toBe("new");
  });
});

describe("sortAnnotations", () => {
  it("sorts by page, then by createdAt, then by id", () => {
    const a = highlight({ id: "a", page: 2, createdAt: "2026-01-01T00:00:01.000Z" });
    const b = highlight({ id: "b", page: 1, createdAt: "2026-01-01T00:00:02.000Z" });
    const c = highlight({ id: "c", page: 1, createdAt: "2026-01-01T00:00:00.000Z" });
    const sorted = sortAnnotations([a, b, c]);
    expect(sorted.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input", () => {
    const a = highlight({ id: "a" });
    const b = highlight({ id: "b", page: 2 });
    const before = [a, b];
    sortAnnotations(before);
    expect(before).toEqual([a, b]);
  });
});

describe("countByKind", () => {
  it("counts each annotation kind in the input", () => {
    const list: Annotation[] = [
      highlight(),
      highlight({ id: "h2" }),
      note({ id: "n1" }),
      { id: "t1", kind: "textbox", page: 1, color: "blue", createdAt: now, rect: { x: 0, y: 0, width: 10, height: 10 }, text: "x" },
      { id: "i1", kind: "ink", page: 1, color: "red", createdAt: now, points: [{ x: 0, y: 0 }], width: 2 },
    ];
    const counts = countByKind(list);
    expect(counts.highlight).toBe(2);
    expect(counts.note).toBe(1);
    expect(counts.textbox).toBe(1);
    expect(counts.ink).toBe(1);
    expect(counts.underline).toBe(0);
  });
});

describe("kindLabel", () => {
  it("returns a friendly label for every annotation kind", () => {
    expect(kindLabel("highlight")).toBe("Highlight");
    expect(kindLabel("underline")).toBe("Underline");
    expect(kindLabel("strikeout")).toBe("Strikethrough");
    expect(kindLabel("ink")).toBe("Pen stroke");
    expect(kindLabel("textbox")).toBe("Text box");
    expect(kindLabel("rect")).toBe("Rectangle");
    expect(kindLabel("ellipse")).toBe("Ellipse");
    expect(kindLabel("arrow")).toBe("Arrow");
    expect(kindLabel("note")).toBe("Note");
  });

  it("the renderer's textbox kind stays 'textbox' (one word) — DEF-015", () => {
    // The renderer-side AnnotationKind keeps the one-word form "textbox"
    // for symmetry with every other kind. The shared IPC contract uses
    // the hyphenated "text-box" form; the engine client adapter
    // translates at the boundary (see engineClient tests). The model
    // here intentionally doesn't know about the wire shape.
    const a: Annotation = {
      id: "x",
      kind: "textbox",
      page: 1,
      color: "blue",
      createdAt: "2026-01-01T00:00:00.000Z",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      text: "hello",
    };
    expect(a.kind).toBe("textbox");
    expect(kindLabel(a.kind)).toBe("Text box");
  });
});

describe("Annotation colors", () => {
  it("ANNOTATION_COLORS mirrors the canonical shared palette, in order", () => {
    // DEF-260 — the renderer palette is the shared canonical list
    // (src/shared/annotationColors.ts), the same set the PDF engine
    // accepts. Order is the engine's historic order followed by the
    // DEF-260 additions (pink/teal/gray); it is the toolbar swatch
    // reading order, not a wire-compat contract — annotations
    // persisted as {color: 'red'} resolve to the same hex regardless
    // of position. Pinning identity with the shared list is the
    // anti-drift guard: a colour added on one side only fails here.
    expect(ANNOTATION_COLORS).toBe(ANNOTATION_COLOR_NAMES);
    expect(ANNOTATION_COLORS).toEqual([
      "yellow",
      "green",
      "blue",
      "red",
      "orange",
      "purple",
      "cyan",
      "magenta",
      "white",
      "pink",
      "teal",
      "gray",
    ]);
  });

  it("ANNOTATION_COLOR_HEX covers every name in ANNOTATION_COLORS", () => {
    // Belt-and-braces: a name added to ANNOTATION_COLORS without a
    // matching hex would surface as a `currentColor` fallback in
    // the overlay — the highlight would render transparent. This
    // guard pins a 1-to-1 mapping.
    for (const name of ANNOTATION_COLORS) {
      expect(ANNOTATION_COLOR_HEX[name]).toMatch(/^#[0-9a-f]{6}$/);
    }
    // DEF-260 — the three names the shared list added on the renderer
    // side must have a swatch, or the new picker cells render blank.
    expect(ANNOTATION_COLOR_HEX.cyan).toBe("#00ffff");
    expect(ANNOTATION_COLOR_HEX.magenta).toBe("#ff00ff");
    expect(ANNOTATION_COLOR_HEX.white).toBe("#ffffff");
  });
});
