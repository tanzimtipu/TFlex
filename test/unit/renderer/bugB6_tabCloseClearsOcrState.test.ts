// @vitest-environment jsdom
//
// B6 — tab close clears the per-tab OCR suspects list + OCR run
// flag.
//
// History: the previous closeTab / performCloseTab body reset
// every App-level armed / dialog flag but NOT the per-tab OCR
// maps (`ocrSuspectsByTab` / `ocrRunByTab`). The maps become
// inert once the tab id disappears, but a future refactor that
// re-uses a tab id (or the same maps across tabs) could surface
// stale "OCR has run on this doc" markers against a brand-new
// document. We pin the wiring: performCloseTab prunes both maps
// for the closing tab id and also drops the `ocrSuspectsOpen`
// flag if it was open against that tab.
//
// We exercise the wiring by reading App.tsx and asserting the
// closeTab body calls the three setters (`setOcrSuspectsByTab`,
// `setOcrRunByTab`, `setOcrSuspectsOpen`) with a `prev` updater
// form that drops the closing tab id.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const appPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "App.tsx",
);
const appSource = fs.readFileSync(appPath, "utf8");

describe("B6 — tab close clears per-tab OCR state", () => {
  it("performCloseTab prunes the ocrSuspectsByTab entry for the closing tab id", () => {
    const match = appSource.match(
      /const performCloseTab = useCallback\([\s\S]*?^  \}, \[\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // The body must include a setOcrSuspectsByTab call site
    // (the updater form) that deletes the closing tab id.
    expect(body).toMatch(
      /setOcrSuspectsByTab\([\s\S]*?delete next\[id\][\s\S]*?\)/,
    );
  });

  it("performCloseTab prunes the ocrRunByTab entry for the closing tab id", () => {
    const match = appSource.match(
      /const performCloseTab = useCallback\([\s\S]*?^  \}, \[\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(
      /setOcrRunByTab\([\s\S]*?delete next\[id\][\s\S]*?\)/,
    );
  });

  it("performCloseTab clears the ocrSuspectsOpen flag if the panel was open", () => {
    const match = appSource.match(
      /const performCloseTab = useCallback\([\s\S]*?^  \}, \[\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/setOcrSuspectsOpen\(false\)/);
  });

  it("performCloseTab also drops deletePageOpen + pending-close prompt state", () => {
    // B6 — these were silently missed in the previous fix
    // sweep. Closing a tab with the DeletePage dialog open would
    // leave a zombie modal against the next tab; closing a tab
    // with the save prompt still mid-flight would lock the UI
    // into a "Save" dialog with no tab behind it. Both are
    // reset by performCloseTab.
    const match = appSource.match(
      /const performCloseTab = useCallback\([\s\S]*?^  \}, \[\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/setDeletePageOpen\(false\)/);
    expect(body).toMatch(/setPendingCloseTabId\(null\)/);
    expect(body).toMatch(/setPendingCloseError\(null\)/);
    expect(body).toMatch(/setPendingCloseSaving\(false\)/);
  });
});