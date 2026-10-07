// TFL-1116 C10 (R14) — the ONE dock-eligibility capability predicate.
//
// `dockEligible` must be the SINGLE source of truth shared by the dock's
// eligible-tool chooser rows, the Pin-to-dock affordance and pin execution
// (`addDockPin`). These tests pin that the three AGREE for a fixture of
// available / unavailable / persisted-pin tools, and that a temporarily
// unavailable persisted pin is RETAINED and explainable rather than reset.
// Pure registry / model, no DOM.

import { describe, expect, it } from "vitest";
import {
  DOCK_GLOBAL_IDS,
  DOCK_UNSUPPORTED_AVAILABILITY,
  dockEligible,
  dockEligibleIdsForStage,
  dockPickerIdsForStage,
  isDockPinnableId,
  toolById,
  type ToolEntry,
} from "../../../src/renderer/state/toolsRegistry";
import {
  DOCK_AVAILABILITY_REASON,
  DOCK_MAX_PINS,
  addDockPin,
  dockPinAffordance,
  sanitizeDockPins,
} from "../../../src/renderer/state/dockModel";
import type { Stage } from "../../../src/renderer/state/stages";

const STAGES: readonly Stage[] = ["pages", "edit", "review", "deliver"];

function entry(id: string): ToolEntry {
  const e = toolById(id);
  if (e === undefined) throw new Error(`no registry entry for "${id}"`);
  return e;
}

/** The three entry points the predicate must keep in agreement. */
function verdicts(id: string): {
  eligible: boolean;
  chooserOffers: boolean;
  affordanceAllows: boolean;
  executionPins: boolean;
} {
  const e = entry(id);
  const eligible = dockEligible(e);
  const inChooser = STAGES.some((s) => dockEligibleIdsForStage(s).includes(id));
  return {
    eligible,
    // A stage whose picker set contains the id represents the chooser.
    chooserOffers: inChooser,
    affordanceAllows: dockPinAffordance({ entry: e, alreadyPinned: false, pins: [] }).allowed,
    executionPins: addDockPin([], id).length === 1,
  };
}

describe("TFL-1116 C10 (R14) — dockEligible capability predicate", () => {
  it("accepts an executable dock tool (stage verb and curated global)", () => {
    expect(dockEligible(entry("rotate"))).toBe(true);
    expect(dockEligible(entry("undo"))).toBe(true);
    expect(dockEligible(entry("openComicView"))).toBe(true);
  });

  it("refuses an id no dock may host", () => {
    for (const id of ["openSample", "preferences", "windowMaximize", "save"]) {
      expect(dockEligible(entry(id)), id).toBe(false);
    }
  });

  it("refuses a build-level unsupported command", () => {
    const v = entry("validateDocument");
    expect(DOCK_UNSUPPORTED_AVAILABILITY.has(v.availability)).toBe(true);
    expect(dockEligible(v)).toBe(false);
  });

  it("is a subset of the curation rule: every eligible id is dock-pinnable", () => {
    for (const stage of STAGES) {
      for (const id of dockEligibleIdsForStage(stage)) {
        expect(isDockPinnableId(id), `${stage}: ${id}`).toBe(true);
      }
    }
  });

  it("every chooser row is in the dock-picker set and passes the predicate", () => {
    for (const stage of STAGES) {
      const offered = dockEligibleIdsForStage(stage);
      for (const id of offered) {
        expect(dockPickerIdsForStage(stage), `${stage}: ${id}`).toContain(id);
        expect(dockEligible(entry(id)), `${stage}: ${id}`).toBe(true);
      }
    }
  });

  it("the chooser keeps the curated reading-view globals (R14 does not live-gate the chooser)", () => {
    // A persisted pin of a temporarily-unavailable tool must stay OFFERED/
    // retained, so the capability predicate is deliberately NOT the live gate.
    const pages = dockEligibleIdsForStage("pages");
    for (const id of DOCK_GLOBAL_IDS) {
      expect(pages, `pages chooser offers ${id}`).toContain(id);
    }
  });

  it("chooser, affordance and execution agree across the fixture", () => {
    const fixture = ["rotate", "undo", "openComicView", "validateDocument", "openSample"];
    for (const id of fixture) {
      const v = verdicts(id);
      expect(v.chooserOffers, `${id}: chooser`).toBe(v.eligible);
      expect(v.affordanceAllows, `${id}: affordance`).toBe(v.eligible);
      expect(v.executionPins, `${id}: execution`).toBe(v.eligible);
    }
  });
});

describe("TFL-1116 C10 (R14) — pin affordance and execution consult dockEligible", () => {
  it("refuses an ineligible entry with a reason, and never offers what execution refuses", () => {
    const v = entry("validateDocument");
    const affordance = dockPinAffordance({ entry: v, alreadyPinned: false, pins: [] });
    expect(affordance.allowed).toBe(false);
    expect(affordance.reason).toBeTruthy();
    expect(addDockPin([], "validateDocument")).toEqual([]);
  });

  it("reports an already-pinned entry and a full dock distinctly", () => {
    expect(
      dockPinAffordance({ entry: entry("rotate"), alreadyPinned: true, pins: ["rotate"] }).reason,
    ).toBe("Already pinned");
    const full = new Array<string>(DOCK_MAX_PINS).fill("rotate");
    expect(dockPinAffordance({ entry: entry("rotate"), alreadyPinned: false, pins: full }).reason).toBe(
      "Dock is full",
    );
  });
});

describe("TFL-1116 C10 (R14) — temporarily unavailable persisted pins survive", () => {
  it("keeps a persisted pin whose tool is only temporarily unavailable", () => {
    // `openComicView` is dock-eligible (a curated global) but the live gate
    // disables it on a PDF. The saved dock must NOT be reset by the predicate.
    expect(dockEligible(entry("openComicView"))).toBe(true);
    expect(sanitizeDockPins(["openComicView", "rotate"])).toEqual(["openComicView", "rotate"]);
  });

  it("exposes an explanation for the temporarily-unavailable case", () => {
    // The dock renders the live refusal copy; the predicate leaves the tool
    // retained so the pin can be explained instead of silently lost.
    expect(DOCK_AVAILABILITY_REASON["reading-view"]).toBeTruthy();
    expect(DOCK_AVAILABILITY_REASON["validation"]).toBeTruthy();
  });
});
