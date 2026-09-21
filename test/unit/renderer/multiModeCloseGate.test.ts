// Phase 32 (chunk 2c) — the close / quit gate across both panes.
//
// The DEF-142 gate snapshots EVERY modified tab and walks the
// CloseTabPromptDialog through them one at a time. A pane's document IS a
// tab, so two modified panes are two modified tabs — the gate must prompt
// for both, and Cancel must abort with the window still open. These tests
// pin the pure selection/queue helpers plus the App wiring that uses them,
// and that the selection never looks at the focused pane or the active tab.

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  collectModifiedTabIds,
  orderWindowCloseQueue,
  type CloseGateEngineUi,
} from "../../../src/renderer/state/closeGate";

const appSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
  "utf8",
);

/** The two-pane case: pane A holds "a", pane B holds "b", both dirty. */
const PANES = [
  { id: "a", modified: true },
  { id: "b", modified: true },
  { id: "c", modified: false },
];
const NO_MIRROR: CloseGateEngineUi = {};

describe("collectModifiedTabIds — every modified document, both panes", () => {
  it("collects both modified panes in tab order", () => {
    expect(collectModifiedTabIds(PANES, NO_MIRROR)).toEqual(["a", "b"]);
  });

  it("includes a tab that only the engineUi mirror reports as modified", () => {
    const mirror: CloseGateEngineUi = { c: { state: { modified: true } } };
    expect(collectModifiedTabIds(PANES, mirror)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing when no tab is modified (the window may close at once)", () => {
    expect(
      collectModifiedTabIds(
        [{ id: "a", modified: false }],
        NO_MIRROR,
      ),
    ).toEqual([]);
  });
});

describe("orderWindowCloseQueue — the prompt walk", () => {
  it("keeps an already-showing per-tab prompt first, then the rest", () => {
    expect(orderWindowCloseQueue(["a", "b"], "b")).toEqual(["b", "a"]);
  });

  it("leaves the order alone when no prompt is showing", () => {
    expect(orderWindowCloseQueue(["a", "b"], null)).toEqual(["a", "b"]);
  });

  it("ignores a pending id that is no longer modified", () => {
    expect(orderWindowCloseQueue(["a", "b"], "c")).toEqual(["a", "b"]);
  });
});

/** The App's queue walk, mirrored as a pure model: `advanceWindowCloseQueue`
 *  shows the next tab, and `onCloseTabPromptChoose`'s Cancel branch clears
 *  the queue with no confirmClose. */
function walkGate(
  modifiedIds: string[],
  choices: Array<"save" | "discard" | "cancel">,
): { prompted: string[]; confirmed: boolean } {
  let queue = orderWindowCloseQueue(modifiedIds, null);
  const prompted: string[] = [];
  let confirmed = false;
  for (const choice of choices) {
    if (queue.length === 0) break;
    prompted.push(queue[0]);
    if (choice === "cancel") {
      queue = [];
      break;
    }
    queue = queue.slice(1);
    if (queue.length === 0) {
      confirmed = true;
      break;
    }
  }
  return { prompted, confirmed };
}

describe("the gate covers two modified panes", () => {
  it("prompts for BOTH modified documents and confirms only after both resolve", () => {
    const { prompted, confirmed } = walkGate(
      collectModifiedTabIds(PANES, NO_MIRROR),
      ["save", "discard"],
    );
    expect(prompted).toEqual(["a", "b"]);
    expect(confirmed).toBe(true);
  });

  it("Cancel on the first prompt aborts: one prompt, no confirm, window stays open", () => {
    const { prompted, confirmed } = walkGate(
      collectModifiedTabIds(PANES, NO_MIRROR),
      ["cancel", "discard"],
    );
    expect(prompted).toEqual(["a"]);
    expect(confirmed).toBe(false);
  });

  it("Cancel on the SECOND prompt still aborts the whole window close", () => {
    const { prompted, confirmed } = walkGate(
      collectModifiedTabIds(PANES, NO_MIRROR),
      ["discard", "cancel"],
    );
    expect(prompted).toEqual(["a", "b"]);
    expect(confirmed).toBe(false);
  });
});

describe("App wiring — the gate selects every tab, never the focused pane", () => {
  function closeRequestCallback(): string {
    const match = appSource.match(
      /const unsubscribeCloseRequest = window\.tflex\.onCloseRequested\(\(\) => \{([\s\S]*?)\n    \}\);/,
    );
    if (match === null) throw new Error("close-request callback not found");
    return match[1];
  }

  it("uses the pure selection + queue helpers", () => {
    const cb = closeRequestCallback();
    expect(cb).toMatch(/collectModifiedTabIds\(/);
    expect(cb).toMatch(/orderWindowCloseQueue\(/);
  });

  it("iterates every open tab via the tabs reducer list (both panes included)", () => {
    const cb = closeRequestCallback();
    expect(cb).toMatch(/tabsRef\.current\.tabs/);
    // No pane/active-tab scoping in the selection.
    expect(cb).not.toMatch(/multiMode/);
    expect(cb).not.toMatch(/tabs\.activeId/);
  });

  it("Cancel clears the queue and never calls confirmClose", () => {
    const body = appSource.match(
      /const onCloseTabPromptChoose = useCallback\([\s\S]*?\n  \);/,
    );
    if (body === null) throw new Error("onCloseTabPromptChoose not found");
    const cancelIdx = body[0].indexOf('choice === "cancel"');
    const discardIdx = body[0].indexOf('choice === "discard"');
    expect(cancelIdx).toBeGreaterThan(-1);
    const cancelBranch = body[0].slice(cancelIdx, discardIdx);
    expect(cancelBranch).toMatch(/setWindowCloseQueue\(null\)/);
    expect(cancelBranch).not.toMatch(/confirmClose\?\.\(/);
  });
});
