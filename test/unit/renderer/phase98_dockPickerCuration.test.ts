// TFL-660 (TFL-520 chunk A) — the dock's ONE curation rule.
//
// `dockPickerIdsForStage` and the pin writers must agree: every id the picker
// offers is dock-pinnable, and no non-dock id can be seeded through the pin or
// restore paths. Pure registry / model, no DOM.

import { describe, expect, it } from "vitest";
import {
  DOCK_GLOBAL_IDS,
  dockPickerIdsForStage,
  dockRelevantIdsForStage,
  isDockPinnableId,
} from "../../../src/renderer/state/toolsRegistry";
import { addDockPin, sanitizeDockPins } from "../../../src/renderer/state/dockModel";
import type { Stage } from "../../../src/renderer/state/stages";

const STAGES: readonly Stage[] = ["pages", "edit", "review", "deliver"];

const NON_DOCK_GLOBALS = [
  "openSample",
  "windowMaximize",
  "windowMinimize",
  "windowClose",
  "toggleTheme",
  "preferences",
  "save",
  "saveAs",
  "open",
  "tabNew",
  "checkForUpdate",
] as const;

describe("TFL-660 — dockPickerIdsForStage obeys the one curation rule", () => {
  for (const stage of STAGES) {
    it(`${stage}: every offered id is dock-pinnable, and the set is stage-relevant + curated globals`, () => {
      const ids = dockPickerIdsForStage(stage);
      for (const id of ids) {
        expect(isDockPinnableId(id), `${id} must be dock-pinnable`).toBe(true);
      }
      const relevant = dockRelevantIdsForStage(stage);
      const expected = [
        ...relevant,
        ...DOCK_GLOBAL_IDS.filter((id) => !relevant.includes(id)),
      ];
      expect(ids).toEqual(expected);
    });
  }

  it("pages offers the curated globals and none of the non-dock globals", () => {
    const ids = dockPickerIdsForStage("pages");
    expect(ids).toContain("undo");
    expect(ids).toContain("redo");
    for (const id of NON_DOCK_GLOBALS) {
      expect(ids, id).not.toContain(id);
    }
  });
});

describe("TFL-660 — the pin writers refuse non-dock ids", () => {
  it("sanitizeDockPins keeps only dock-pinnable ids, in order, deduped", () => {
    expect(
      sanitizeDockPins(["undo", "openSample", "windowMaximize", "rotate"]),
    ).toEqual(["undo", "rotate"]);
  });

  it("addDockPin refuses a non-dock id and accepts a curated global", () => {
    expect(addDockPin([], "openSample")).toEqual([]);
    expect(addDockPin([], "undo")).toEqual(["undo"]);
  });
});
