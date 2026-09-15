// DEF-142 — whole-window close request wiring (renderer half).
//
// The backend added a close gate on the main process: EVERY window
// close attempt (caption X, Alt+F4, the Window menu's Close role,
// Exit -> app.quit) is preventDefault'd and pushed to the renderer
// as `window:closeRequested`; the renderer is the source of truth
// for unsaved edits. Without the renderer wiring the window can
// never close.
//
// The contract this test pins (App.tsx source scan — the
// established pattern for App-level wiring, see B8):
//   1. A mount effect subscribes to `tflex.onCloseRequested` and
//      returns its unsubscribe (cleanup on unmount).
//   2. The callback re-checks every open tab with the SAME
//      modified check closeTab uses (`tabMeta.modified` OR the
//      engineUi mirror's `state.modified`).
//   3. No modified tab -> `confirmClose(true)` immediately.
//   4. Any modified tab -> the existing CloseTabPromptDialog is
//      shown (pendingCloseTabId set) and `confirmClose` is NOT
//      called; the queue walks every modified tab through
//      onCloseTabPromptChoose (which carries the DEF-128 Save-As
//      routing). Save-success / Don't-save for every tab ->
//      `confirmClose(true)`; Cancel -> nothing, the window stays
//      open.
//   5. Duplicate re-pushes while a window-close flow is prompting
//      are ignored (main re-fires on every close attempt).
//
// Phase 17 — the flow body (checks + confirmClose + queue setup)
// moved OUT of the subscription callback into the stable
// `runWindowCloseFlow` callback: the callback now guards (queue
// ref, the new multi-tab confirmation ref, the
// confirmCloseMultipleTabs preference) and then calls
// `runWindowCloseFlow()`, which the "Close all tabs?" confirmation
// re-enters after the user confirms. The close-flow assertions
// below scan `runWindowCloseFlow`'s body; the callback assertions
// scan the guards + delegation.
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

/** The body of the `onCloseRequested` callback passed to
 *  `window.tflex.onCloseRequested` in the DEF-142 mount effect. */
function closeRequestCallback(): string {
  const match = appSource.match(
    /const unsubscribeCloseRequest = window\.tflex\.onCloseRequested\(\(\) => \{([\s\S]*?)\n    \}\);/,
  );
  expect(match).not.toBeNull();
  return match === null ? "" : match[1];
}

/** The body of the `runWindowCloseFlow` callback — the DEF-142
 *  close-flow body (modified check, confirmClose, queue setup),
 *  extracted by Phase 17 so the multi-tab confirmation can
 *  re-enter it after the user confirms. */
function windowCloseFlowBody(): string {
  const match = appSource.match(
    /const runWindowCloseFlow = useCallback\(\(\): void => \{([\s\S]*?)\n  \}, \[\]\);/,
  );
  expect(match).not.toBeNull();
  return match === null ? "" : match[1];
}

describe("DEF-142 — the renderer subscribes to window close requests", () => {
  it("a mount effect subscribes to tflex.onCloseRequested", () => {
    expect(appSource).toMatch(/window\.tflex\.onCloseRequested\(\(\) => \{/);
  });

  it("the effect returns the unsubscribe so the listener is dropped on unmount", () => {
    expect(appSource).toMatch(/return unsubscribeCloseRequest;/);
  });

  it("the effect degrades when an older preload has no onCloseRequested", () => {
    const effectMatch = appSource.match(
      /useEffect\(\(\) => \{[\s\S]*?window\.tflex\.onCloseRequested[\s\S]*?\},\s*\[[^\]]*\]\);/,
    );
    expect(effectMatch).not.toBeNull();
    const effect = effectMatch === null ? "" : effectMatch[0];
    expect(effect).toMatch(/typeof window\.tflex\.onCloseRequested !== "function"/);
  });

  it("duplicate close-request pushes are ignored while a window-close prompt is showing", () => {
    const cb = closeRequestCallback();
    const guardIdx = cb.indexOf("windowCloseQueueRef.current !== null");
    expect(guardIdx).toBeGreaterThan(-1);
    // Phase 17 — the multi-tab close confirmation adds a second
    // duplicate guard (its dialog is open while the queue is still
    // null, so the queue guard alone can't catch a re-push).
    const confirmGuardIdx = cb.indexOf("closeAllConfirmOpenRef.current");
    expect(confirmGuardIdx).toBeGreaterThan(-1);
    expect(confirmGuardIdx).toBeGreaterThan(guardIdx);
    // The guards sit before the close flow starts: a re-push while
    // a prompt is already up must not restart the flow.
    const flowIdx = cb.indexOf("runWindowCloseFlow()");
    expect(flowIdx).toBeGreaterThan(guardIdx);
    expect(flowIdx).toBeGreaterThan(confirmGuardIdx);
    expect(cb.slice(guardIdx, guardIdx + 60)).toMatch(/return/);
  });

  it("Phase 17 — a window with two or more documents asks for confirmation before the close flow", () => {
    const cb = closeRequestCallback();
    // The confirmCloseMultipleTabs preference (default on) gates the
    // confirmation; empty placeholder tabs don't count toward the
    // multiple-tabs threshold.
    expect(cb).toMatch(/confirmCloseMultipleTabs/);
    expect(cb).toMatch(/t\.kind !== "empty"/);
    expect(cb).toMatch(/docTabCount >= 2/);
    expect(cb).toMatch(/setCloseAllConfirmOpen\(true\)/);
    // The confirmation gate precedes the close flow: the dialog
    // opens INSTEAD of the flow running.
    const gateIdx = cb.indexOf("docTabCount >= 2");
    const flowIdx = cb.indexOf("runWindowCloseFlow()");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(flowIdx);
  });
});

describe("DEF-142 — the close flow applies the closeTab modified check", () => {
  it("reads BOTH the tabs reducer modified flag and the engineUi mirror", () => {
    expect(appSource).toMatch(
      /t\.modified \|\| engineUiRef\.current\[t\.id\]\?\.state\.modified === true/,
    );
  });

  it("iterates all open tabs via the tabs reducer list", () => {
    // Phase 17 — the iteration moved into runWindowCloseFlow (the
    // callback only guards and delegates).
    const flow = windowCloseFlowBody();
    expect(flow).toMatch(/tabsRef\.current\.tabs/);
    expect(flow).toMatch(/\.map\(\(t\) => t\.id\)/);
  });
});

describe("DEF-142 — no modified tab closes the window immediately", () => {
  it("calls confirmClose(true) when every tab is clean and returns", () => {
    const cb = windowCloseFlowBody();
    const zeroIdx = cb.indexOf("modifiedIds.length === 0");
    expect(zeroIdx).toBeGreaterThan(-1);
    // The clean branch ends at the first closing brace after the check.
    const branch = cb.slice(zeroIdx, cb.indexOf("}", zeroIdx));
    expect(branch).toMatch(/confirmClose\?\.\(true\)/);
    // No dialog, no queue: the window shuts right away.
    expect(branch).not.toMatch(/setWindowCloseQueue/);
    expect(branch).toMatch(/return/);
  });
});

describe("DEF-142 — modified tabs show the existing close prompt instead of confirming", () => {
  it("sets the prompt's pending tab id (dialog shown) and does NOT confirmClose", () => {
    const cb = windowCloseFlowBody();
    const queueIdx = cb.indexOf("setWindowCloseQueue(queue)");
    expect(queueIdx).toBeGreaterThan(-1);
    const queueBranch = cb.slice(queueIdx);
    // The dialog opens for the first modified tab.
    expect(queueBranch).toMatch(/setPendingCloseTabId\(queue\[0\] \?\? null\)/);
    // The prompt path must never call confirmClose — the window only
    // closes after every tab resolves.
    expect(queueBranch).not.toMatch(/confirmClose/);
  });

  it("keeps an already-showing per-tab close prompt first in the queue", () => {
    const cb = windowCloseFlowBody();
    expect(cb).toMatch(/pendingCloseTabIdRef\.current/);
    expect(cb).toMatch(/pending !== null && modifiedIds\.includes\(pending\)/);
  });
});

describe("DEF-142 — the prompt handler resolves the queue and closes the window at the end", () => {
  function handlerBody(): string {
    const match = appSource.match(/const onCloseTabPromptChoose = useCallback[\s\S]*?\},\s*\[\]\);/);
    expect(match).not.toBeNull();
    return match === null ? "" : match[0];
  }

  function advanceBody(): string {
    const match = appSource.match(
      /const advanceWindowCloseQueue = useCallback\(\(\): void => \{[\s\S]*?\},\s*\[\]\);/,
    );
    expect(match).not.toBeNull();
    return match === null ? "" : match[0];
  }

  it("Cancel aborts the window-close flow and calls nothing (window stays open)", () => {
    const body = handlerBody();
    const cancelIdx = body.indexOf('choice === "cancel"');
    const discardIdx = body.indexOf('choice === "discard"');
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(discardIdx).toBeGreaterThan(cancelIdx);
    const cancelBranch = body.slice(cancelIdx, discardIdx);
    // The queue is cleared (abort) but confirmClose is never called.
    expect(cancelBranch).toMatch(/setWindowCloseQueue\(null\)/);
    expect(cancelBranch).not.toMatch(/confirmClose\?\.\(/);
    expect(cancelBranch).not.toMatch(/performCloseTab/);
    expect(cancelBranch).toMatch(/return/);
  });

  it("Don't save advances the queue after closing the tab", () => {
    const body = handlerBody();
    expect(body).toMatch(/performCloseTab\(id\);[\s\S]*?advanceWindowCloseQueue\(\);/);
  });

  it("a successful save (and the DEF-128 Save-As path) also advances the queue", () => {
    const body = handlerBody();
    // All three close-resolving branches (discard, path-less Save-As,
    // in-place save) call advanceWindowCloseQueue right after
    // performCloseTab.
    const matches = body.match(/performCloseTab\(id\);[\s\S]*?advanceWindowCloseQueue\(\);/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBeGreaterThanOrEqual(3);
  });

  it("a failed or OS-cancelled save does not advance the queue (window still open)", () => {
    const body = handlerBody();
    const nullPathIdx = body.indexOf("tab.session.onDiskPath === null");
    expect(nullPathIdx).toBeGreaterThan(-1);
    const branch = body.slice(nullPathIdx);
    const cancelledIdx = branch.indexOf('saved.error.code === "cancelled"');
    expect(cancelledIdx).toBeGreaterThan(-1);
    const cancelToNext = branch.slice(cancelledIdx, branch.indexOf("advanceWindowCloseQueue()"));
    expect(cancelToNext).toMatch(/return;/);
    // Engine error path also returns before any advance.
    expect(branch).toMatch(/setPendingCloseError\(/);
  });

  it("advanceWindowCloseQueue no-ops for a plain per-tab close (queue null)", () => {
    const body = advanceBody();
    expect(body).toMatch(/if \(queue === null\) return;/);
  });

  it("advanceWindowCloseQueue shows the next modified tab when the queue continues", () => {
    const body = advanceBody();
    expect(body).toMatch(/setWindowCloseQueue\(next\)/);
    expect(body).toMatch(/setPendingCloseTabId\(next\[0\] \?\? null\)/);
  });

  it("advanceWindowCloseQueue calls confirmClose(true) when the queue empties", () => {
    const body = advanceBody();
    const emptyIdx = body.indexOf("next.length === 0");
    expect(emptyIdx).toBeGreaterThan(-1);
    const branch = body.slice(emptyIdx);
    expect(branch).toMatch(/confirmClose\?\.\(true\)/);
  });
});