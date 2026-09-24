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
// B11 — the Delete action must open the SAME DeletePageDialog the
// toolbar uses (the previous wiring was a toast no-op: "Select a
// thumbnail in the left rail…").
//
// Phase 36 (chunk 5) retired the Tools palette, and Phase 36 (chunk 7) replaced
// the shared Multi Mode toolbar row with the shared Action Dock, so this case is
// RE-POINTED at the Delete action's current canonical home: the PAGES Action
// Dock's `delete` verb (registry action `deletePages`), which App wires to the
// same `onDeletePageClick` dialog. The thumbnail verbs and the thumbnail
// right-click "Delete…" row reuse that same handler. The test's intent — Delete
// opens the real dialog, never a toast no-op — is unchanged.
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

describe("B11 — the Delete action opens the DeletePageDialog", () => {
  it("the PAGES dock's deletePages verb routes through onDeletePageClick (not a toast no-op)", async () => {
    const text = await readFile(APP_PATH, "utf8");
    // The dock's app-level map: the registry action `deletePages` calls the SAME
    // dialog opener the toolbar used. The engine-level `deletePages: (pages) =>`
    // handler is a different shape and does not match this anchor.
    const match = text.match(/deletePages:\s*\(\):\s*void\s*=>\s*onDeletePageClick\(\),/);
    expect(match).not.toBeNull();
    // The old palette toast no-op is gone.
    expect(text).not.toContain("Select a thumbnail in the left rail");
  });
});

describe("B14 — OCR suspects panel placement and empty-tab guard", () => {
  it("the panel render guard requires a real active document (activeTab != null)", async () => {
    const text = await readFile(APP_PATH, "utf8");
    // The previous guard checked activeTabIdRefLocal.current !==
    // null, which is true on empty tabs too (they have an id but
    // no openTabs entry). The guard must now key off the resolved
    // active tab object.
    //
    // DEF-299 - `openTabs[activeId]` is `undefined` (not `null`) on an empty
    // tab, so the old `activeTab !== null` form let the panel through. The
    // undefined-safe `!= null` covers both and is the form pinned here.
    expect(text).toMatch(/ocrSuspectsOpen\s*&&\s*activeTab\s*!=\s*null/);
    expect(text).not.toMatch(/ocrSuspectsOpen\s*&&\s*activeTab\s*!==\s*null/);
  });

  it("the .ocr-suspects-panel CSS is a FLOW TOP BAR that reserves its own space (DEF-126)", async () => {
    const styles = await readFile(STYLES_PATH, "utf8");
    // Phase 36 (chunk 5) added `.inspector .ocr-suspects-panel` (the Inspector's
    // inline re-parent override). Anchor to a line that STARTS with the
    // selector so this scans the bar's own rule, not the override.
    const rule = styles.match(/^\.ocr-suspects-panel\s*\{[^}]*\}/m);
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
    // it never overlaps the bar's right edge. Phase 19 retired the
    // second annotation row, so the sum is the bar + the single
    // CommandBar token.
    expect(rule).toMatch(
      /top:\s*calc\(\s*var\(--ocr-bar-h, 148px\)\s*\+\s*var\(--toolbar-h, 52px\)\s*\)\s*;/,
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