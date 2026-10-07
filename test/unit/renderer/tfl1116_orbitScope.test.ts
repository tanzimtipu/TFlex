// @vitest-environment node
//
// TFL-1116 (R10) — the EFFECTIVE background-motion scope for the Home orbit.
//
// The decorative arcs may move only when ALL FOUR independent gates allow it:
//   1. the global Animations setting is ON,
//   2. the OS prefers-reduced-motion is OFF,
//   3. Home is visible (the document is not hidden),
//   4. the persisted Home pause is OFF.
// Each gate independently disables the drift. This pins the pure resolver
// matrix AND the React binding that feeds it, so a future refactor cannot
// quietly widen the scope.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldAnimateOrbit, type OrbitMotionInput } from "../../../src/renderer/utils/orbitMotion";

const OPEN = {
  animationsEnabled: true,
  homeMotionPaused: false,
  prefersReduced: false,
  documentHidden: false,
  windowMinimized: false,
  windowBlurred: false,
};

describe("TFL-1116 (R10) — effective orbit motion scope", () => {
  it("runs ONLY when all four gates are open", () => {
    expect(shouldAnimateOrbit(OPEN)).toBe(true);
  });

  it("each of the four gates independently disables the drift", () => {
    expect(shouldAnimateOrbit({ ...OPEN, animationsEnabled: false })).toBe(false);
    expect(shouldAnimateOrbit({ ...OPEN, prefersReduced: true })).toBe(false);
    expect(shouldAnimateOrbit({ ...OPEN, documentHidden: true })).toBe(false);
    expect(shouldAnimateOrbit({ ...OPEN, homeMotionPaused: true })).toBe(false);
  });

  it("keeps the scope closed while any single gate is shut", () => {
    const closed: OrbitMotionInput[] = [
      { ...OPEN, animationsEnabled: false },
      { ...OPEN, prefersReduced: true },
      { ...OPEN, documentHidden: true },
      { ...OPEN, homeMotionPaused: true },
    ];
    for (const input of closed) {
      expect(shouldAnimateOrbit(input)).toBe(false);
    }
  });

  it("binds the four gates through useOrbitMotion and the Welcome pass-through", () => {
    const hook = readFileSync(
      resolve(__dirname, "../../../src/renderer/hooks/useOrbitMotion.ts"),
      "utf8",
    );
    expect(hook).toContain("useAnimationsEnabled()");
    expect(hook).toContain("useLiveReducedMotion()");
    expect(hook).toContain("document.hidden");
    expect(hook).toContain("homeMotionPaused");
    expect(hook).toContain("shouldAnimateOrbit(");

    const welcome = readFileSync(
      resolve(__dirname, "../../../src/renderer/components/Welcome.tsx"),
      "utf8",
    );
    expect(welcome).toContain("const paused = homeMotionPaused === true;");
    expect(welcome).toContain("const orbitMotion = useOrbitMotion(paused);");
    expect(welcome).toContain("<OrbitMotif active={orbitMotion} />");
  });
});
