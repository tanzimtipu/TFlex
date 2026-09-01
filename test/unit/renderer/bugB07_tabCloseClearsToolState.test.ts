// B7 — tab close clears tool state (annotation, edit, sign, crop).
//
// The previous behavior: clicking a tab's close button removed the
// tab from `openTabs` but left App-level tool state armed. The user
// would close a tab with the Sign tool active, open a different
// tab, and the "Sign tool active" pill would still be on the
// toolbar — armed against the wrong document. The fix is in
// `performCloseTab` (App.tsx), which is the unconditional close
// side-effects function that BOTH `closeTab` (no-prompt path:
// empty tab / unmodified doc) AND the B8 close-prompt path
// ("Save" / "Don't save" outcomes) call into. Every tool / arm
// state and every open dialog is reset there so a stale "Sign
// tool active" pill doesn't carry over to the next tab the user
// opens.
//
// Pin the performCloseTab wiring:
//   - Every App-level armed/tool state has a `set*(null)` (or
//     equivalent) call inside performCloseTab.
//   - Every dialog that targets the now-closed tab has a
//     `set*Open(false)` call inside performCloseTab.
//   - The cleanup runs even when no tab state existed (defensive
//     against a stale close during async init).
//
// We test these guarantees by reading the source. A direct render
// test of App.tsx is impractical (it boots the full app + pdfjs
// + persistence + IPC), so this is a structural / contract test.
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

describe("B7 — performCloseTab resets tool state", () => {
  it("performCloseTab resets armedSignatureId", () => {
    expect(appSource).toMatch(
      /const performCloseTab = useCallback\([\s\S]*?setArmedSignatureId\(null\)/,
    );
  });

  it("performCloseTab resets armedStamp (B10)", () => {
    expect(appSource).toMatch(
      /const performCloseTab = useCallback\([\s\S]*?setArmedStamp\(null\)/,
    );
  });

  it("performCloseTab closes the edit mode toggle", () => {
    // The implementation uses an editModeOpenRef so the value is
    // read synchronously without taking it as a dep.
    expect(appSource).toMatch(
      /const performCloseTab = useCallback\([\s\S]*?editModeOpenRef\.current[\s\S]*?setEditModeOpen\(false\)/,
    );
  });

  it("performCloseTab closes every tab-bound dialog", () => {
    // Find the performCloseTab body and assert each dialog setter fires.
    const match = appSource.match(/const performCloseTab[\s\S]*?^  \},\s*\[\]\);/m);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // Each dialog flag must be reset.
    for (const setter of [
      "setFlattenOpen(false)",
      "setOptimizeOpen(false)",
      "setAuditOpen(false)",
      "setSaveAsOpen(false)",
      "setOcrOpen(false)",
      "setCropPagesOpen(false)",
      "setStampOpen(false)",
      "setRenumberPagesOpen(false)",
      "setReplacePagesOpen(false)",
      "setInsertPagesOpen(false)",
      "setCreateOpen(false)",
      "setExportOpen(false)",
      "setTextExportOpen(false)",
      "setDocxExportOpen(false)",
      "setCommentExportOpen(false)",
      "setCommentImportOpen(false)",
    ]) {
      expect(body).toContain(setter);
    }
  });

  it("performCloseTab drops per-tab openTabs / engineUi / engine state", () => {
    const match = appSource.match(/const performCloseTab[\s\S]*?^  \},\s*\[\]\);/m);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // setOpenTabs drops the tab.
    expect(body).toMatch(/setOpenTabs[\s\S]*?delete next\[id\]/);
    // setEngineUi drops the tab.
    expect(body).toMatch(/setEngineUi[\s\S]*?_drop/);
    // stubRendererEngine.dispose fires.
    expect(body).toMatch(/stubRendererEngine\.dispose/);
    // dispatchTabs close fires.
    expect(body).toMatch(/dispatchTabs\(\{ type: "close"/);
  });
});
