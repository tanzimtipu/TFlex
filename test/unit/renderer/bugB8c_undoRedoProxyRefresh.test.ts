// B8c — undo/redo must refresh the renderer's pdf.js document proxy.
//
// The defect: `App.onUndo` / `App.onRedo` updated the engine UI
// mirror (`setEngineUiFor`) after a successful undo/redo but never
// called `refreshDocProxyFor`, so the pdf.js `doc` proxy kept
// painting the PRE-undo bytes — the visible page stayed stale after
// undo/redo of page-mutating ops (crop, delete, reorder, rotate,
// OCR, …).
//
// App.tsx is not mountable in a unit test (it bootstraps the whole
// workspace), so this pins the source contract: both callbacks must
// read `refreshDocProxyForRef.current` and invoke it after the state
// dispatch, exactly like every other state-returning op
// (DEF-062's forward-declared-ref pattern).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const appSrc = readFileSync(APP_PATH, "utf8");

function undoBlock(): string {
  const start = appSrc.indexOf("const onUndo = useCallback");
  const end = appSrc.indexOf("const onRedo = useCallback");
  return appSrc.slice(start, end);
}

function redoBlock(): string {
  const start = appSrc.indexOf("const onRedo = useCallback");
  return appSrc.slice(start, start + 2500);
}

describe("B8c — undo/redo refresh the pdf.js proxy", () => {
  it("onUndo reads and invokes refreshDocProxyForRef after the state dispatch", () => {
    const block = undoBlock();
    // The refresh must happen INSIDE the undo success handler, after
    // the engine state is mirrored.
    const refreshCall = block.indexOf("refreshFn(tabId)");
    const dispatch = block.indexOf("setEngineUiFor(tabId, {");
    const afterUndoHander =
      block.indexOf("engineRef.current.undo(open.session.engineDocId)");
    expect(afterUndoHander).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    expect(refreshCall).toBeGreaterThan(dispatch);
    // It reads through the forward-declared ref, not a direct dep.
    expect(block).toMatch(/const refreshFn = refreshDocProxyForRef\.current/);
  });

  it("onRedo reads and invokes refreshDocProxyForRef after the state dispatch", () => {
    const block = redoBlock();
    const refreshCall = block.indexOf("refreshFn(tabId)");
    const dispatch = block.indexOf("setEngineUiFor(tabId, {");
    expect(dispatch).toBeGreaterThan(-1);
    expect(refreshCall).toBeGreaterThan(dispatch);
    expect(block).toMatch(/const refreshFn = refreshDocProxyForRef\.current/);
  });

  it("both callbacks keep the ref-reading pattern (no direct useCallback dep)", () => {
    // The DEP list must not include a `refreshDocProxyFor` closure
    // dependency — the whole point of the ref is to avoid a TDZ /
    // identity churn dependency (DEF-062). The Bug 5 stamp-mirror
    // clear adds the stable `dropPlacedStamps` callback (a
    // useCallback([]) defined before onUndo) — that does NOT carry
    // the proxy refresh, so the ref pattern is preserved.
    expect(undoBlock()).not.toMatch(/\[[^\]]*refreshDocProxyFor/);
    expect(redoBlock()).not.toMatch(/\[[^\]]*refreshDocProxyFor/);
    expect(undoBlock()).toMatch(/dropPlacedStamps\(tabId\)/);
    expect(redoBlock()).toMatch(/dropPlacedStamps\(tabId\)/);
  });
});