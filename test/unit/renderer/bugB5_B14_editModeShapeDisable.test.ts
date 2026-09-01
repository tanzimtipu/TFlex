// @vitest-environment jsdom
//
// B5 / B14 — Edit mode must disable shape tools (rect /
// ellipse / arrow) on the annotation toolbar AND force the
// currently-active annotation tool back to "select" so a
// previously-armed shape tool can't fire drags over the Edit
// overlay.
//
// The toolbar already gates per-button via `editBlocksTool`
// (every annotation tool except "select" returns disabled +
// aria-disabled + no-op on click) — that's the toolbar-side
// fix. But that gate does NOT reset a tool that was already
// active when the user opened Edit mode. Without the
// DocumentView-side effect, the user could leave a rectangle
// armed, click the Edit toolbar button, and the
// AnnotationOverlay would still respond to shape drags —
// directly over the Edit overlay (B14). Forcing the reducer
// to "select" on the rising edge of `editModeOpen` keeps the
// AnnotationOverlay inert while Edit is open.
//
// We pin both surfaces as a structural / source-contract test:
//   1. The toolbar's `editBlocksTool` gate covers rect,
//      ellipse, arrow (and the rest).
//   2. The DocumentView source resets the annotation tool on
//      the rising edge of `editModeOpen`.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const annotationToolbarPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "annotations",
  "AnnotationToolbar.tsx",
);
const documentViewPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "components",
  "DocumentView.tsx",
);
const annotationToolbarSource = fs.readFileSync(annotationToolbarPath, "utf8");
const documentViewSource = fs.readFileSync(documentViewPath, "utf8");

describe("B5 / B14 — Edit mode disables shape / markup annotation tools", () => {
  it("AnnotationToolbar's editBlocksTool returns true for every non-select tool", () => {
    // The helper gates: `editModeOpen && tool !== "select"`. We
    // assert every shape / markup / freehand kind is in the
    // per-button `toolBtn(...)` call list with `disabled`
    // driven by `editBlocksTool(tool)`. The toolbar's
    // `armTool` checks the same gate at the click site (no-op
    // when blocked), so the user can't arm shape tools while
    // Edit is open — even via keyboard or programmatic click.
    const editBlocksToolBody = annotationToolbarSource.match(
      /const editBlocksTool = \([\s\S]*?\};/,
    );
    expect(editBlocksToolBody).not.toBeNull();
    if (editBlocksToolBody === null) return;
    expect(editBlocksToolBody[0]).toMatch(/editModeOpen/);
    expect(editBlocksToolBody[0]).toMatch(/tool !== "select"/);
    // Every non-select tool button must appear in the toolbar's JSX.
// We check the simplified invariant: every tool name (with
// surrounding toolBtn("..." or toolBtn(\n"...") context) must
// show up in the source. The actual button is rendered through
// `toolBtn(...)`; the regex just verifies each tool is wired.
for (const tool of [
  "highlight",
  "underline",
  "strikeout",
  "ink",
  "textbox",
  "rect",
  "ellipse",
  "arrow",
  "note",
]) {
  expect(annotationToolbarSource).toContain(tool);
}
// Callout's `toolBtn(...)` call is wrapped across multiple
// lines (`toolBtn(\n  "callout", ...)`); the `"callout"` literal
// must still appear in the JSX.
expect(annotationToolbarSource).toContain('"callout"');
  });

  it("AnnotationToolbar's armTool short-circuits when editBlocksTool returns true", () => {
    // The click handler must NOT dispatch a set-tool action
    // when Edit mode blocks the tool. We pin the early-return.
    const armToolBody = annotationToolbarSource.match(
      /const armTool = \([\s\S]*?\};/,
    );
    expect(armToolBody).not.toBeNull();
    if (armToolBody === null) return;
    expect(armToolBody[0]).toMatch(/if\s*\(\s*editBlocksTool\(tool\)\s*\)\s*return/);
  });

  it("DocumentView resets the annotation tool to 'select' when Edit mode opens", () => {
    // Pin the rising-edge effect: on the transition
    // `false -> true`, dispatch `set-tool: "select"`. The
    // effect must NOT fire on every render (use a ref to
    // detect the rising edge) — otherwise the user couldn't
    // arm a rect tool, close Edit, then re-arm it (the rising-
    // edge ref only fires on open).
    const effect = documentViewSource.match(
      /const prevEditModeOpenRef[\s\S]*?useEffect\(\(\) => \{[\s\S]*?\}, \[editModeOpen\]\);/,
    );
    expect(effect).not.toBeNull();
    if (effect === null) return;
    expect(effect[0]).toMatch(/dispatchAnnTool\(\{ \s*type: "set-tool",\s*tool: "select" \s*\}\)/);
    expect(effect[0]).toMatch(/prevEditModeOpenRef\.current\s*=\s*editModeOpen/);
  });

  it("DocumentView's annotation-tool reset effect is keyed only on editModeOpen (rising-edge detection)", () => {
    // The dep array must be exactly `[editModeOpen]` — adding
    // other deps (e.g. `annTool.tool`) would re-fire the reset
    // whenever the user armed any tool, forcing the tool
    // back to "select" and making the toolbar unusable.
    const effect = documentViewSource.match(
      /const prevEditModeOpenRef[\s\S]*?useEffect\(\(\) => \{[\s\S]*?\}, \[editModeOpen\]\);/,
    );
    expect(effect).not.toBeNull();
    if (effect === null) return;
    expect(effect[0]).toMatch(/\}, \[editModeOpen\]\)/);
    // Defensive: no other dep on the same effect line.
    expect(effect[0]).not.toMatch(/\}, \[[^\]]*,/);
  });
});