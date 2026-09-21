// @vitest-environment jsdom
//
// DEF-065 — `App.tsx` wires the active-tab state to the application
// menu so that Save / Save As / Close Tab / Undo / Redo flip their
// `.enabled` flag in lock-step with the renderer's view. The
// renderer ships a `MenuEnabledState` snapshot to main over
// `window.tflex.menu.setEnabled(...)`; main looks each id up via
// `Menu.getApplicationMenu()?.getMenuItemById(id)` and toggles
// `.enabled` accordingly.
//
// These tests pin two structural facts that the App's wiring relies
// on:
//   1. `snapshotMenuEnabled(hasActiveDoc)` returns an object whose
//      keys are exactly the shared `MenuItemId` union members
//      (`menu.save`, `menu.saveAs`, `menu.closeTab`, `menu.undo`,
//      `menu.redo`).
//   2. Each key is set to the `hasActiveDoc` boolean verbatim — no
//      extra per-action logic at the moment (the orchestrator's
//      note is "code against the contract"; a follow-up can layer
//      in undo/redo enablement based on the engine's stack depth
//      when the contract lands).
//
// The tests also document the App-level effect contract — the
// snapshot is pushed on every `tabs.activeId` change — so a
// regression in the App's `useEffect` dep array is easy to spot
// by reading the wiring pattern in the source code.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { snapshotMenuEnabled } from "../../../src/renderer/state/menuActions";

interface CapturedSetEnabledCall {
  state: ReturnType<typeof snapshotMenuEnabled>;
}

describe("App → menu.setEnabled wiring (DEF-065)", () => {
  let originalTflex: unknown;

  beforeEach(() => {
    // Save the existing window.tflex so the test can restore it
    // without leaving a global side effect across the suite.
    originalTflex = (window as unknown as { tflex?: unknown }).tflex;
  });

  afterEach(() => {
    if (originalTflex === undefined) {
      delete (window as unknown as { tflex?: unknown }).tflex;
    } else {
      (window as unknown as { tflex: unknown }).tflex = originalTflex;
    }
  });

  it("snapshotMenuEnabled(false) returns false for every active-doc menu id", () => {
    // Welcome screen — no document open. The App's effect should
    // push this exact shape so main disables every active-doc menu
    // item until the user opens a file.
    const snap = snapshotMenuEnabled(false);
    expect(snap).toEqual({
      "menu.save": false,
      "menu.saveAs": false,
      "menu.closeTab": false,
      "menu.undo": false,
      "menu.redo": false,
      "menu.print": false,
    });
  });

  it("snapshotMenuEnabled(true) returns true for every active-doc menu id", () => {
    // A document is open. The App's effect pushes this shape on
    // every active-tab change so the menu's visual enable state
    // flips immediately.
    const snap = snapshotMenuEnabled(true);
    expect(snap).toEqual({
      "menu.save": true,
      "menu.saveAs": true,
      "menu.closeTab": true,
      "menu.undo": true,
      "menu.redo": true,
      "menu.print": true,
    });
  });

  it("snapshot keys are exactly the shared MenuItemId union (no extras, no misses)", () => {
    // The shared `MenuItemId` union in src/shared/types.ts is the
    // single source of truth for the toggleable ids. The
    // renderer's snapshot must carry every id in the union —
    // anything else is a stray id the renderer doesn't know about
    // and main would treat as "no change" (silent no-op).
    const expected = [
      "menu.save",
      "menu.saveAs",
      "menu.closeTab",
      "menu.undo",
      "menu.redo",
      "menu.print",
    ] as const;
    const snap = snapshotMenuEnabled(true);
    expect(Object.keys(snap).sort()).toEqual([...expected].sort());
  });

  it("App's setEnabled call is shape-compatible with the shared IPC contract", async () => {
    // The `window.tflex.menu.setEnabled` IPC channel accepts a
    // `Partial<Record<MenuItemId, boolean>>`. The snapshot is a
    // concrete Record<MenuItemId, boolean> — a fully-populated
    // Partial — so it satisfies the contract verbatim (assignable
    // without coercion). The test pins the call shape: whatever
    // the App's effect passes in must be the same shape the
    // preload's preload bridge consumes.
    const setEnabledCalls: CapturedSetEnabledCall[] = [];
    (window as unknown as {
      tflex: {
        menu: {
          setEnabled: (s: ReturnType<typeof snapshotMenuEnabled>) => void;
        };
      };
    }).tflex = {
      menu: {
        setEnabled: (state): void => {
          setEnabledCalls.push({ state });
        },
      },
    };
    // Simulate the App's effect: tab activated, doc open.
    const hasActiveDoc = true;
    window.tflex.menu.setEnabled(snapshotMenuEnabled(hasActiveDoc));
    expect(setEnabledCalls).toHaveLength(1);
    expect(setEnabledCalls[0]?.state).toEqual({
      "menu.save": true,
      "menu.saveAs": true,
      "menu.closeTab": true,
      "menu.undo": true,
      "menu.redo": true,
      "menu.print": true,
    });
    // Simulate the inverse: all tabs closed, no active doc.
    window.tflex.menu.setEnabled(snapshotMenuEnabled(false));
    expect(setEnabledCalls).toHaveLength(2);
    expect(setEnabledCalls[1]?.state).toEqual({
      "menu.save": false,
      "menu.saveAs": false,
      "menu.closeTab": false,
      "menu.undo": false,
      "menu.redo": false,
      "menu.print": false,
    });
  });

  it("every snapshot value is a boolean (no nulls / undefined slip through to main)", () => {
    // main's IPC handler reads `state[id]` directly; if the
    // renderer ever shipped a value that's not a boolean, main
    // would either type-error or set the menu's enabled state to
    // a truthy non-boolean (silent visual glitch). Pin the type
    // contract: every value is a boolean.
    for (const hasActiveDoc of [true, false]) {
      const snap = snapshotMenuEnabled(hasActiveDoc);
      for (const value of Object.values(snap)) {
        expect(typeof value).toBe("boolean");
      }
    }
  });
});
