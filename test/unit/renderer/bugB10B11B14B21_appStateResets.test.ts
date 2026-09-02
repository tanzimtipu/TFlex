// @vitest-environment node
//
// B10 / B11 / B14 / B21 — App-level state reset + wiring contract
// tests.
//
// B10 — the "+" new-tab affordance and tab switching must reset
// App-level tool state (armed Sign / Stamp, Edit mode, OCR
// suspects panel). Previously only `performCloseTab` cleared
// these, so a new tab inherited the previous tab's arming and the
// next page click spawned a signature instead of the annotation
// the user reached for.
//
// B11 — the Tools palette's Delete entry must open the SAME
// DeletePageDialog the toolbar uses (the previous wiring was a
// toast no-op: "Select a thumbnail in the left rail…").
//
// B14 — the OCR suspects panel must (a) render as a right-side
// rail (not at x:0 where it hid behind the annotation toolbar)
// and (b) never render against an empty / doc-less tab.
//
// B21 — the tools palette must close when the last tab closes
// (covered by bugB6's setter list) and the grid tiles must have
// proper sizing/spacing so labels never overlap.
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

describe("B10 — new-tab and tab-switch reset App-level tool state", () => {
  it("activateTab clears armedSignatureId / armedStamp / editModeOpen / ocrSuspectsOpen", async () => {
    const text = await readFile(APP_PATH, "utf8");
    const match = text.match(/const activateTab = useCallback\([\s\S]*?\},\s*\[\]\);/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toContain('dispatchTabs({ type: "activate", id })');
    for (const setter of [
      "setArmedSignatureId(null)",
      "setArmedStamp(null)",
      "setEditModeOpen(false)",
      "setOcrSuspectsOpen(false)",
    ]) {
      expect(body).toContain(setter);
    }
  });

  it("onNewEmptyTab clears the same tool state before the empty tab activates", async () => {
    const text = await readFile(APP_PATH, "utf8");
    const match = text.match(/const onNewEmptyTab = useCallback\([\s\S]*?\},\s*\[\]\);/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toContain("open-empty");
    for (const setter of [
      "setArmedSignatureId(null)",
      "setArmedStamp(null)",
      "setEditModeOpen(false)",
      "setOcrSuspectsOpen(false)",
    ]) {
      expect(body).toContain(setter);
    }
  });
});

describe("B11 — palette Delete opens the DeletePageDialog", () => {
  it("the Tools palette onDelete routes through onDeletePageClick (not a toast no-op)", async () => {
    const text = await readFile(APP_PATH, "utf8");
    const match = text.match(/onDelete=\{\(\):\s*void\s*=>\s*\{[\s\S]*?\}\}/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // The palette entry funnels into the same dialog the toolbar
    // uses.
    expect(body).toContain("onDeletePageClick()");
    // The old toast no-op is gone.
    expect(body).not.toContain("Select a thumbnail in the left rail");
  });
});

describe("B14 — OCR suspects panel placement and empty-tab guard", () => {
  it("the panel render guard requires a real active document (activeTab !== null)", async () => {
    const text = await readFile(APP_PATH, "utf8");
    // The previous guard checked activeTabIdRefLocal.current !==
    // null, which is true on empty tabs too (they have an id but
    // no openTabs entry). The guard must now key off the resolved
    // active tab object.
    expect(text).toMatch(/ocrSuspectsOpen\s*&&\s*activeTab\s*!==\s*null/);
  });

  it("the .ocr-suspects-panel CSS is a FLOW TOP BAR that reserves its own space (DEF-126)", async () => {
    const styles = await readFile(STYLES_PATH, "utf8");
    const rule = styles.match(/\.ocr-suspects-panel\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    if (rule === null) return;
    // DEF-126 — the panel is a flow element at the top of
    // `.app-main`'s flex column (order: -1) with a fixed height
    // (--ocr-bar-h). It RESERVES space instead of overlaying the
    // workspace, so it can never cover the thumbnail rail / the
    // toolbars / the Tools palette — the old absolute bar (B4) and
    // the old 280px right rail are both gone.
    expect(rule[0]).toMatch(/order:\s*-1\s*;/);
    expect(rule[0]).toMatch(/flex-shrink:\s*0\s*;/);
    expect(rule[0]).toMatch(/height:\s*var\(--ocr-bar-h/);
    expect(rule[0]).not.toMatch(/position:\s*absolute\s*;/);
    expect(rule[0]).not.toMatch(/z-index:\s*40\s*;/);
    expect(rule[0]).not.toMatch(/width:\s*280px\s*;/);
    // The shared height token exists (the palette downshift reads
    // it, see the :has rule below).
    expect(styles).toMatch(/--ocr-bar-h:\s*148px\s*;/);
  });

  it("the Tools palette shifts below the bar via the :has downshift (DEF-126: no overlap)", async () => {
    const styles = await readFile(STYLES_PATH, "utf8");
    const downshiftStart = styles.lastIndexOf(
      ".app-main:has(.ocr-suspects-panel) .tools-palette {",
    );
    expect(downshiftStart).toBeGreaterThan(-1);
    const rule = styles.slice(
      downshiftStart,
      styles.indexOf(".ocr-suspects-header"),
    );
    // With the bar open, the palette's top adds the bar's height so
    // it never overlaps the bar's right edge.
    expect(rule).toMatch(
      /top:\s*calc\(var\(--ocr-bar-h, 148px\)\s*\+\s*var\(--toolbar-h, 56px\)\)\s*;/,
    );
  });
});

describe("B21 — tools palette grid tiles are properly sized", () => {
  it("grid tiles use a consistent min-height instead of an overflow-prone square", async () => {
    const styles = await readFile(STYLES_PATH, "utf8");
    const rule = styles.match(/\.tools-palette-entry-grid\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    if (rule === null) return;
    expect(rule[0]).toMatch(/min-height:\s*72px\s*;/);
    // The old aspect-ratio square let the label overflow the tile
    // and bleed into the next row. (The comment mentions the old
    // declaration, so we assert the DECLARATION is gone, not the
    // word.)
    expect(rule[0]).not.toMatch(/aspect-ratio:\s*1\s*\/\s*1/);
  });

  it("grid rows reserve a consistent height and the grid label is ellipsized", async () => {
    const styles = await readFile(STYLES_PATH, "utf8");
    const bodyRule = styles.match(/\.tools-palette-body\s*\{[^}]*\}/);
    expect(bodyRule).not.toBeNull();
    if (bodyRule === null) return;
    expect(bodyRule[0]).toMatch(/grid-auto-rows:\s*minmax\(72px,\s*auto\)/);
    // The label ellipsis lives on the shared .tools-palette-entry-label
    // rule (the grid-specific rule inherits it); assert the shared
    // rule carries the ellipsis + overflow guard.
    const labelRule = styles.match(/\.tools-palette-entry-label\s*\{[^}]*\}/);
    expect(labelRule).not.toBeNull();
    if (labelRule === null) return;
    expect(labelRule[0]).toMatch(/text-overflow:\s*ellipsis\s*;/);
    expect(labelRule[0]).toMatch(/overflow:\s*hidden\s*;/);
  });
});