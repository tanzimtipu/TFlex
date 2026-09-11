// @vitest-environment jsdom
//
// Bug 6 / Bug 4 / Bug 5 — App.tsx wiring for the stamp-edit and
// global-disarm behaviors. App.tsx is not mountable in a unit test
// (it bootstraps the whole workspace), so — following the repo's
// established source-contract pattern (bugB9 / bugB8c) — this pins
// the exact wiring a refactor could silently break:
//
//   Bug 6 stamps:
//     - onMoveStamp / onDeleteStamp / onRetypeStamp exist and call
//       `engine.editImage` with op "move" (the only stamp lever).
//     - delete uses the 1x1 white mask (WHITE_1X1_PNG_BYTES).
//     - retype re-rasterises the new stamp id (rasterizeStamp).
//     - every stamp mutation refreshes the pdf.js proxy afterwards.
//   Bug 4 Escape:
//     - the global keydown handler disarms armedSignatureId /
//       armedStamp and resets every tab's edit tool to "off".
//   Bug 1 Edit mode:
//     - setEditMode(true) cross-disarms the Sign / Stamp arms.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const appSrc = readFileSync(APP_PATH, "utf8");

function block(startMarker: string, endMarker: string): string {
  const start = appSrc.indexOf(startMarker);
  expect(start, `marker ${startMarker} present`).toBeGreaterThan(-1);
  const end = endMarker === "" ? appSrc.length : appSrc.indexOf(endMarker, start);
  return appSrc.slice(start, end === -1 ? appSrc.length : end);
}

describe("Bug 6 — App.tsx stamp mutation handlers", () => {
  it("onMoveStamp calls engine.editImage (op move) with the stamp's page / old rect, then refreshes the proxy", () => {
    const b = block("const onMoveStamp = useCallback", "const onDeleteStamp = useCallback");
    expect(b).toMatch(/editImage\(/);
    expect(b).toMatch(/op: "move"/);
    expect(b).toMatch(/oldRect: stamp\.rect/);
    expect(b).toMatch(/newRect: rect/);
    expect(b).toMatch(/imageBytes: stamp\.pngBytes/);
    expect(b).toMatch(/refreshFn\(tabId\)/);
    expect(b).toMatch(/noteOpApplied\(tabId, result\.value\)/);
  });

  it("onDeleteStamp masks the rect with the 1x1 white PNG and drops the mirror entry", () => {
    const b = block("const onDeleteStamp = useCallback", "const onRetypeStamp = useCallback");
    expect(b).toMatch(/op: "move"/);
    expect(b).toMatch(/imageBytes: WHITE_1X1_PNG_BYTES/);
    expect(b).toMatch(/filter\(\(s\) => s\.id !== id\)/);
    expect(b).toMatch(/refreshFn\(tabId\)/);
  });

  it("onRetypeStamp re-rasterises the new stamp id and re-bakes it at the same rect", () => {
    const b = block("const onRetypeStamp = useCallback", "const onCommentExportClick = useCallback");
    expect(b).toMatch(/rasterizeStamp\(stampId\)/);
    expect(b).toMatch(/op: "move"/);
    expect(b).toMatch(/stampId, pngBytes: png\.pngBytes/);
    expect(b).toMatch(/refreshFn\(tabId\)/);
  });

  it("the stamp handlers read the freshest mirror through placedStampsByTabRef", () => {
    expect(appSrc).toMatch(/placedStampsByTabRef\.current\[tabId\]/);
    expect(appSrc).toMatch(/const placedStampsByTabRef = useRef\(placedStampsByTab\)/);
  });
});

describe("Bug 4 — App.tsx global Escape disarm", () => {
  it("the global keydown handler clears armedSignatureId / armedStamp and disarms edit tools on plain Escape", () => {
    const b = block(
      "const onKey = (e: KeyboardEvent): void => {",
      "window.addEventListener(\"keydown\", onKey)",
    );
    expect(b).toMatch(/e\.key === "Escape"/);
    expect(b).toMatch(/armedSignatureIdRef\.current !== null/);
    expect(b).toMatch(/armedStampRef\.current !== null/);
    expect(b).toMatch(/disarmEditTools\(\)/);
    // The Escape branch must not fire for Ctrl+Escape / Alt+Escape.
    expect(b).toMatch(/!e\.ctrlKey && !e\.metaKey && !e\.altKey/);
  });

  it("disarmEditTools resets every tab's edit tool to off", () => {
    const b = block("const disarmEditTools = useCallback", "const setEditMode");
    expect(b).toMatch(/editReducer\(tab\.edit, \{ type: "set-tool", tool: "off" \}\)/);
  });
});

describe("Bug 1 — App.tsx Edit-mode cross-disarm", () => {
  it("setEditMode(true) clears the armed Stamp and Signature arms", () => {
    const b = block("const setEditMode = useCallback", "const disarmEditTools = useCallback");
    expect(b).toMatch(/setArmedSignatureId\(null\)/);
    expect(b).toMatch(/setArmedStamp\(null\)/);
    expect(b).toMatch(/if \(open\)/);
  });
});

describe("Bug 5 — undo/redo clear the placed-stamp mirror", () => {
  it("dropPlacedStamps removes the tab's mirror entries", () => {
    const b = block("const dropPlacedStamps = useCallback", "const onUndo = useCallback");
    expect(b).toMatch(/delete next\[tabId\]/);
    expect(b).toMatch(/list\.length === 0/);
  });
});