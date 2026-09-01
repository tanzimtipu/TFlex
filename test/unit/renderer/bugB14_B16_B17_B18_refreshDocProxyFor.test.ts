// @vitest-environment node
// B14 / B16 / B17 / B18 — refreshDocProxyFor pattern. Each of
// these content-mutating host flows (merge, replace, insert
// blank / from-PDF, crop) bakes new bytes into the engine's
// pdfDoc. The renderer's `doc` proxy still points at the
// pre-mutation bytes; without a refresh, every PageView on the
// affected pages continues to render at the un-mutated viewport,
// and annotations / form fields / signatures stay at their old
// positions. The fix is a one-liner that calls
// `refreshDocProxyForRef.current(tabId)` AFTER the engine's
// success callback (the `noteOpApplied(tabId, res.value)`
// already updated the engine-state mirror).
//
// We pin the wiring by reading App.tsx. The test asserts that
// each onConfirm handler:
//   1. Calls the matching engine op.
//   2. On success, calls `refreshDocProxyForRef.current(tabId)`.
//   3. The refresh call sits AFTER the success branch (so a
//      failed op doesn't touch the renderer proxy).

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

function findHandler(name: string): string {
  // Find the useCallback for the named handler and extract its
  // body up to the closing `}, [<deps>]);` line.
  const re = new RegExp(
    `const ${name} = useCallback\\([\\s\\S]*?^  \\}, \\[[^\\]]*\\]\\);`,
    "m",
  );
  const m = appSource.match(re);
  if (m === null) return "";
  return m[0];
}

function expectRefresh(name: string): void {
  const body = findHandler(name);
  expect(body, `${name} handler exists`).not.toBe("");
  // The body must read the forward-declared ref.
  expect(body).toMatch(/refreshDocProxyForRef\.current/);
  // The body must call the refresh function.
  expect(body).toMatch(/refreshFn\(activeId\)/);
}

describe("refreshDocProxyFor wiring (B14 / B16 / B17 / B18)", () => {
  it("B14 — onConfirmMerge refreshes the proxy after a successful merge", () => {
    expectRefresh("onConfirmMerge");
    const body = findHandler("onConfirmMerge");
    // The merge engine op is engineRef.current.merge (or
    // aliased via `const engine = engineRef.current`).
    expect(body).toMatch(/(?:engineRef\.current|engine)\.merge\(/);
    // The refresh call sits AFTER noteOpApplied (success branch).
    const noteOpIdx = body.indexOf("noteOpApplied(activeId, result.value)");
    const refreshIdx = body.indexOf("refreshFn(activeId)");
    expect(noteOpIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(noteOpIdx);
  });

  it("B16 — onReplacePagesConfirm refreshes the proxy after a successful replace", () => {
    expectRefresh("onReplacePagesConfirm");
    const body = findHandler("onReplacePagesConfirm");
    // engineRef.current.replacePages is the engine entry point.
    expect(body).toMatch(/engineRef\.current\.replacePages/);
    const noteOpIdx = body.indexOf("noteOpApplied(activeId, res.value)");
    const refreshIdx = body.indexOf("refreshFn(activeId)");
    expect(noteOpIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(noteOpIdx);
  });

  it("B17 — onInsertPagesConfirm refreshes the proxy after a successful insert (blank + fromPdf)", () => {
    expectRefresh("onInsertPagesConfirm");
    const body = findHandler("onInsertPagesConfirm");
    // Both engine paths exist: insertBlankPage + insertFromPdf.
    expect(body).toMatch(/engineRef\.current\.insertBlankPage/);
    expect(body).toMatch(/engineRef\.current\.insertFromPdf/);
    // The refresh call covers BOTH paths.
    const refreshIdx = body.indexOf("refreshFn(activeId)");
    expect(refreshIdx).toBeGreaterThan(-1);
  });

  it("B18 — onCropPagesConfirm refreshes the proxy after a successful crop", () => {
    expectRefresh("onCropPagesConfirm");
    const body = findHandler("onCropPagesConfirm");
    // engineRef.current.cropPages is the engine entry point.
    expect(body).toMatch(/engineRef\.current\.cropPages/);
    const noteOpIdx = body.indexOf("noteOpApplied(activeId, res.value)");
    const refreshIdx = body.indexOf("refreshFn(activeId)");
    expect(noteOpIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(noteOpIdx);
  });
});
