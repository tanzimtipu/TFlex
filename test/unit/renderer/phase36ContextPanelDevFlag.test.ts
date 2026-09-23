// Phase 36 (chunk 2) — the temporary PAGES-panel dev flag.
//
// The ContextPanel is mounted ALONGSIDE the unchanged SideRail only when an
// explicit dev flag is on, so the default app is untouched. `readStagePanelDevFlag`
// is pure, so the resolution order (localStorage wins, then the query string)
// is pinned here without a DOM.

import { describe, expect, it } from "vitest";
import {
  currentStagePanelDevFlag,
  isDevFlagOn,
  readStagePanelDevFlag,
  STAGE_PANEL_DEV_KEY,
} from "../../../src/renderer/state/devFlags";

describe("Phase 36 chunk 2 — the PAGES-panel dev flag", () => {
  it("names ONE key for both sources", () => {
    expect(STAGE_PANEL_DEV_KEY).toBe("tfStagePanel");
  });

  it("accepts only the explicit truthy strings", () => {
    expect(isDevFlagOn("1")).toBe(true);
    expect(isDevFlagOn("true")).toBe(true);
    expect(isDevFlagOn("0")).toBe(false);
    expect(isDevFlagOn("")).toBe(false);
    expect(isDevFlagOn(null)).toBe(false);
    expect(isDevFlagOn(undefined)).toBe(false);
    // A bare `?tfStagePanel` (no value) must NOT enable the panel.
    expect(readStagePanelDevFlag({ search: "?tfStagePanel" })).toBe(false);
  });

  it("reads the query string", () => {
    expect(readStagePanelDevFlag({ search: "?tfStagePanel=1" })).toBe(true);
    expect(readStagePanelDevFlag({ search: "?foo=1&tfStagePanel=true" })).toBe(true);
    expect(readStagePanelDevFlag({ search: "?tfStagePanel=0" })).toBe(false);
    expect(readStagePanelDevFlag({ search: "" })).toBe(false);
    expect(readStagePanelDevFlag({})).toBe(false);
  });

  it("lets localStorage win (the always-reachable switch for a file:// renderer)", () => {
    expect(readStagePanelDevFlag({ search: "", stored: "1" })).toBe(true);
    expect(readStagePanelDevFlag({ search: "?tfStagePanel=0", stored: "1" })).toBe(true);
    expect(readStagePanelDevFlag({ search: "?tfStagePanel=1", stored: null })).toBe(true);
  });

  it("reads as OFF with no window (node env)", () => {
    expect(typeof window).toBe("undefined");
    expect(currentStagePanelDevFlag()).toBe(false);
  });
});
