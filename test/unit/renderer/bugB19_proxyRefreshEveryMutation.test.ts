// @vitest-environment jsdom
//
// B19 — every engine mutation that touches the page stream
// triggers a `refreshDocProxyFor(tabId)` call so the renderer's
// `doc` proxy is rebuilt against the post-mutation bytes.
//
// History: the renderer held a single `PDFDocumentProxy`
// instance from open-time. Content-mutating ops (merge /
// replace / crop / insert / OCR / flatten / stamp) baked new
// bytes into the engine's pdfDoc, but the renderer's proxy
// stayed pinned to the pre-mutation bytes. Every PageView on
// the affected pages then continued to render at the un-mutated
// viewport, and annotations / forms / signatures stayed at
// their old positions until the user saved + reopened.
//
// The fix: each content-mutating handler (merge / replace /
// crop / insert / OCR / flatten / stamp / `applyEngineOp` for
// delete) calls `refreshDocProxyForRef.current(tabId)` AFTER
// the engine's success callback. Rotate / reorder don't
// mutate the page stream so they don't need a refresh — but
// the central `applyEngineOp` still calls the refresh after
// every op so any future op-kind that DOES mutate the stream
// automatically inherits the refresh.
//
// We exercise the wiring by reading App.tsx and asserting:
//   1. `applyEngineOp` calls `refreshFn(tabId)` after a
//      successful op (covers rotate / delete / reorder).
//   2. The refresh call sits AFTER `noteOpApplied` so a failed
//      op doesn't touch the renderer proxy.
//   3. The existing content-mutating handlers (merge / replace /
//      crop / insert / stamp / OCR / flatten) all still call
//      `refreshFn(tabId)` after success (regression guard for
//      the B14 / B16 / B17 / B18 fix).
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
  const re = new RegExp(
    `const ${name} = useCallback\\([\\s\\S]*?^  \\}, \\[[^\\]]*\\]\\);`,
    "m",
  );
  const m = appSource.match(re);
  if (m === null) return "";
  return m[0];
}

describe("B19 — proxy refresh after every engine mutation", () => {
  it("applyEngineOp refreshes the proxy after a successful op", () => {
    const body = findHandler("applyEngineOp");
    expect(body, "applyEngineOp handler exists").not.toBe("");
    // The body must read the forward-declared ref.
    expect(body).toMatch(/refreshDocProxyForRef\.current/);
    // The body must call the refresh function.
    expect(body).toMatch(/refreshFn\(tabId\)/);
    // The refresh call sits AFTER noteOpApplied (success branch).
    const noteOpIdx = body.indexOf("noteOpApplied(tabId, result.value)");
    const refreshIdx = body.indexOf("refreshFn(tabId)");
    expect(noteOpIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(noteOpIdx);
  });

  it("applyEngineOp does NOT refresh when the engine rejects the op", () => {
    // The refresh call sits inside the success branch (after
    // `noteOpApplied`). If the engine returns `result.ok ===
    // false` the function returns early with a toast and skips
    // both `noteOpApplied` and `refreshFn`. We assert by
    // checking the success path includes the refresh and the
    // failure path does not.
    const body = findHandler("applyEngineOp");
    expect(body).not.toBe("");
    // Failure branch: `if (!result.ok) { pushToast(...); return; }`.
    expect(body).toMatch(/if\s*\(\s*!result\.ok\s*\)/);
    const failureIdx = body.indexOf("if (!result.ok)");
    const refreshIdx = body.indexOf("refreshFn(tabId)");
    expect(failureIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(failureIdx);
  });

  it("rotate / delete / reorder all flow through applyEngineOp (one refresh site covers all)", () => {
    // The central useCallback fires for every op-kind. We assert
    // that `applyEngineOp` is the single refresh site for
    // rotate/delete/reorder (each handler just delegates to
    // applyEngineOp with the matching op).
    const body = findHandler("applyEngineOp");
    expect(body).not.toBe("");
    // The body calls `applyOp` (the engine entry point that
    // takes the EngineOp discriminated union).
    expect(body).toMatch(/engineRef\.current\.applyOp\(/);
  });

  it("B14 / B16 / B17 / B18 handlers still refresh (regression guard)", () => {
    for (const name of [
      "onConfirmMerge",
      "onReplacePagesConfirm",
      "onInsertPagesConfirm",
      "onCropPagesConfirm",
    ]) {
      const body = findHandler(name);
      expect(body, `${name} handler exists`).not.toBe("");
      expect(body, `${name} calls refresh`).toMatch(
        /refreshDocProxyForRef\.current/,
      );
      expect(body, `${name} calls refreshFn`).toMatch(/refreshFn\(activeId\)/);
    }
  });

  it("onPlaceStamp + onFlattenConfirm + onOcrConfirm still refresh", () => {
    // onPlaceStamp + onFlattenConfirm use the forward-declared
    // ref (read `refreshFn = refreshDocProxyForRef.current;
    // ...; refreshFn(activeId)`); onOcrConfirm reads the
    // `refreshDocProxyFor` useCallback directly because it sits
    // below the forward-declared ref in source order.
    expect(findHandler("onPlaceStamp")).toMatch(
      /refreshDocProxyForRef\.current/,
    );
    expect(findHandler("onFlattenConfirm")).toMatch(
      /refreshDocProxyForRef\.current/,
    );
    expect(findHandler("onOcrConfirm")).toMatch(/refreshDocProxyFor\(activeId\)/);
  });
});