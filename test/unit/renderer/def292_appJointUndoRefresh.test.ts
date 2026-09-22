// DEF-292 — App-level wiring: a joint cross-document undo/redo must
// refresh BOTH panes.
//
// App.tsx bootstraps the whole workspace and is not mountable in a unit
// test, so — like the existing App guards (bugB8c, bugB19) — this pins the
// source contract. The decision logic itself is covered by
// `def292_jointUndo.test.ts` and the adapter cache work by
// `def292_engineClientJointUndo.test.ts`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");
const appSrc = readFileSync(APP_PATH, "utf8");

function slice(start: string, end: string): string {
  const from = appSrc.indexOf(start);
  const to = appSrc.indexOf(end, from + 1);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return appSrc.slice(from, to);
}

const applyHelperBlock = slice(
  "const applyJointPaneRefresh = useCallback",
  "const onUndo = useCallback",
);
const undoBlock = slice("const onUndo = useCallback", "const onRedo = useCallback");
const redoBlock = slice("const onRedo = useCallback", "const onCreateAnnotation");

describe("DEF-292 — App joint undo/redo refresh wiring", () => {
  it("onUndo plans the other pane's refresh from the paired echo", () => {
    expect(undoBlock).toMatch(/result\.value\.pairedState/);
    expect(undoBlock).toMatch(/planJointPaneRefresh\(\s*"undo"/);
    expect(undoBlock).toMatch(/applyJointPaneRefresh\(/);
  });

  it("onRedo plans the other pane's refresh symmetrically", () => {
    expect(redoBlock).toMatch(/result\.value\.pairedState/);
    expect(redoBlock).toMatch(/planJointPaneRefresh\(\s*"redo"/);
    expect(redoBlock).toMatch(/applyJointPaneRefresh\(/);
  });

  it("applyJointPaneRefresh mirrors the other pane and refreshes its proxy", () => {
    expect(applyHelperBlock).toMatch(/setEngineUiFor\(plan\.tabId/);
    expect(applyHelperBlock).toMatch(/plan\.counters/);
    expect(applyHelperBlock).toMatch(/plan\.canUndo/);
    expect(applyHelperBlock).toMatch(/plan\.canRedo/);
    // Same forward-declared-ref refresh path the active pane uses; the
    // helper reads it through the ref (no useCallback dep churn).
    expect(applyHelperBlock).toMatch(/const refreshFn = refreshDocProxyForRef\.current/);
    expect(applyHelperBlock).toMatch(/refreshFn\(plan\.tabId\)/);
    // A null plan (single-document undo) is a clean no-op.
    expect(applyHelperBlock).toMatch(/if \(plan === null\) return;/);
  });

  it("maps the paired engine doc id back to a live tab", () => {
    const mapperBlock = slice(
      "const tabIdForEngineDoc = useCallback",
      "const applyJointPaneRefresh",
    );
    expect(mapperBlock).toMatch(/Object\.entries\(openTabsRef\.current\)/);
    expect(mapperBlock).toMatch(/open\.session\.engineDocId === engineDocId/);
  });

  it("the active pane is still refreshed, so BOTH panes follow one call", () => {
    expect(undoBlock).toMatch(/refreshFn\(tabId\)/);
    expect(redoBlock).toMatch(/refreshFn\(tabId\)/);
    // The other-pane work is gated on the paired echo — a plain
    // single-document undo never re-serializes the other pane.
    expect(undoBlock).toMatch(/planJointPaneRefresh\(\s*"undo",\s*tabId,\s*result\.value\.pairedState/);
    expect(redoBlock).toMatch(/planJointPaneRefresh\(\s*"redo",\s*tabId,\s*result\.value\.pairedState/);
  });

  it("a failed joint undo surfaces the typed engine-error and mutates nothing", () => {
    const toast = undoBlock.indexOf("describeEngineError(result.error.code, result.error.message)");
    const dispatch = undoBlock.indexOf("setEngineUiFor(tabId, {");
    expect(toast).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    // The error toast is emitted before any state mirror, and the handler
    // returns first — so the failed joint undo is a no-op.
    expect(toast).toBeLessThan(dispatch);
    expect(undoBlock).toMatch(/pushToast\("error"/);
  });
});