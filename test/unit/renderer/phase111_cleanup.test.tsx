// @vitest-environment jsdom
//
// Phase 111 cleanup — the superseded SideRail wrapper is retired. Every
// thumbnail / outline entry point now renders the shared navigator
// components (ThumbnailRail / OutlinePanel / RulerStrip); the legacy
// `SideRail` component export must never come back, and its dead
// `.rail-content-swap` CSS layer is gone with it.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as SideRailModule from "../../../src/renderer/components/SideRail";

describe("Phase 111 cleanup — the orphaned SideRail component is removed", () => {
  it("does not export the retired SideRail component", () => {
    expect("SideRail" in SideRailModule).toBe(false);
  });

  it("keeps the shared navigator building blocks exported", () => {
    expect(typeof SideRailModule.ThumbnailRail).toBe("function");
    expect(typeof SideRailModule.OutlinePanel).toBe("function");
    expect(typeof SideRailModule.RulerStrip).toBe("function");
  });

  it("still exposes the RailTab type for host state", () => {
    const tabs: SideRailModule.RailTab[] = ["thumbs", "outline", "annotations"];
    expect(tabs).toHaveLength(3);
  });
});

describe("Phase 111 cleanup — the dead .rail-content-swap rule is gone", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "styles.css"),
    "utf8",
  );

  it("no .rail-content-swap rule remains in styles.css", () => {
    expect(css).not.toMatch(/\.rail-content-swap\s*\{/);
  });
});
