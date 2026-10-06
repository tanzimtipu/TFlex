// @vitest-environment jsdom
//
// Phase 106 (chunk B) — the Orbit Desk decorative motif + ambient motion gate.
//
// Pins:
//   - the pure on/off decision precedence (reduced motion > Animations OFF >
//     document hidden > window minimised/blurred);
//   - the new 18s / 20deg motion tokens and their reduced-motion collapse;
//   - the scoped CSS gate (`data-orbit-motion="on"`, transform-only, opacity
//     inside the spec's 0.18-0.28 band);
//   - the decorative layer's aria-hidden contract and the pause control's
//     reuse of the existing Animations setting path.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Welcome } from "../../../src/renderer/components/Welcome";
import { shouldAnimateOrbit } from "../../../src/renderer/utils/orbitMotion";
import { resolveMotionMode } from "../../../src/renderer/hooks/motionPolicy";
import { MOTION_DURATION } from "../../../src/renderer/hooks/motionTokens";
import type { SampleDocument } from "../../../src/shared/types";

const OPEN = {
  animationsEnabled: true,
  homeMotionPaused: false,
  prefersReduced: false,
  documentHidden: false,
  windowMinimized: false,
  windowBlurred: false,
};

describe("Phase 106 (chunk B) — orbit motion decision", () => {
  it("drifts only while every gate is open", () => {
    expect(shouldAnimateOrbit(OPEN)).toBe(true);
  });

  it("lets prefers-reduced-motion win even with Animations on", () => {
    expect(shouldAnimateOrbit({ ...OPEN, prefersReduced: true })).toBe(false);
  });

  it("treats Animations OFF as a user pause that wins", () => {
    expect(shouldAnimateOrbit({ ...OPEN, animationsEnabled: false })).toBe(false);
    expect(
      shouldAnimateOrbit({ ...OPEN, animationsEnabled: false, prefersReduced: true }),
    ).toBe(false);
  });

  it("lets the Home pause win while global Animations stays ON", () => {
    expect(
      shouldAnimateOrbit({ ...OPEN, animationsEnabled: true, homeMotionPaused: true }),
    ).toBe(false);
  });

  it("leaves the global motion layer untouched by the Home pause", () => {
    expect(resolveMotionMode({ animationsEnabled: true, prefersReduced: false })).toBe(
      "animated",
    );
  });

  it("suspends on document visibility and window state", () => {
    expect(shouldAnimateOrbit({ ...OPEN, documentHidden: true })).toBe(false);
    expect(shouldAnimateOrbit({ ...OPEN, windowMinimized: true })).toBe(false);
    expect(shouldAnimateOrbit({ ...OPEN, windowBlurred: true })).toBe(false);
  });
});

describe("Phase 106 (chunk B) — motion token + CSS gate", () => {
  it("registers the 18s orbit duration + 20deg swing and collapses it", () => {
    const css = readFileSync(
      resolve(__dirname, "../../../src/renderer/styles/animations.css"),
      "utf8",
    );
    expect(css).toContain("--motion-duration-orbit: 18s");
    expect(css).toContain("--motion-orbit-swing: 20deg");
    expect(css).toMatch(/--motion-duration-orbit:\s*var\(--motion-duration-reduced\)/);
    expect(css).toContain(".orbit-desk-orbit");
    expect(MOTION_DURATION.orbit).toBe(18000);
  });

  it("pins the pause control to the header top-right without a specificity drop (DEF-587)", () => {
    const css = readFileSync(
      resolve(__dirname, "../../../src/renderer/styles.css"),
      "utf8",
    );
    // The header-children stacking rule must not match the toggle, or its
    // lower-specificity `position: absolute` is overridden by `position: relative`.
    expect(css).toMatch(
      /\.orbit-desk \.welcome-hero > :not\(\.orbit-desk-motif\):not\(\.orbit-desk-motion-toggle\)\s*\{/,
    );
    expect(css).toMatch(
      /\.orbit-desk-motion-toggle\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*right:\s*0;/s,
    );
  });

  it("gates the drift on data-orbit-motion and animates transform only", () => {
    const css = readFileSync(
      resolve(__dirname, "../../../src/renderer/styles.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.orbit-desk-orbit\[data-orbit-motion="on"\]\s*\{[^}]*var\(--motion-duration-orbit\)/s,
    );
    expect(css).toContain("var(--motion-orbit-swing)");
    expect(css).toContain("@keyframes tf-anim-orbit");
    const opacity = Number(/--orbit-opacity:\s*(0\.[0-9]+)/.exec(css)?.[1]);
    expect(opacity).toBeGreaterThanOrEqual(0.18);
    expect(opacity).toBeLessThanOrEqual(0.28);
  });
});

const RESOLVE_SAMPLES =
  (list: SampleDocument[]) =>
  (): Promise<SampleDocument[]> =>
    Promise.resolve(list);

function renderWelcome(
  homeMotionPaused?: boolean,
  onSetHomeMotionPaused?: (next: boolean) => void,
): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <Welcome
        recentFiles={[]}
        onOpenRecent={(): void => undefined}
        onRemoveRecent={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSampleClick={(): void => undefined}
        samplesResolver={RESOLVE_SAMPLES([])}
        homeMotionPaused={homeMotionPaused}
        onSetHomeMotionPaused={onSetHomeMotionPaused}
      />,
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("Phase 106 (chunk B) — Orbit Desk motif + pause control", () => {
  it("renders the decorative motif and drifts by default", () => {
    const { host, unmount } = renderWelcome();
    try {
      const motif = host.querySelector("[data-orbit-motif]");
      expect(motif).not.toBeNull();
      expect(motif?.getAttribute("aria-hidden")).toBe("true");
      expect(host.querySelector('[data-orbit-motion="on"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("renders no pause control without the settings handler", () => {
    const { host, unmount } = renderWelcome();
    try {
      expect(host.querySelector("[data-orbit-motion-toggle]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("pauses through the Home-only persisted preference", () => {
    const onSet = vi.fn();
    const { host, unmount } = renderWelcome(false, onSet);
    try {
      const toggle = host.querySelector<HTMLButtonElement>(
        "[data-orbit-motion-toggle]",
      );
      expect(toggle).not.toBeNull();
      expect(toggle?.textContent).toContain("Pause background motion");
      expect(toggle?.getAttribute("aria-pressed")).toBe("false");
      act((): void => {
        toggle?.click();
      });
      expect(onSet).toHaveBeenCalledWith(true);
    } finally {
      unmount();
    }
  });

  it("reflects the paused state with a resume label", () => {
    const { host, unmount } = renderWelcome(true, vi.fn());
    try {
      const toggle = host.querySelector<HTMLButtonElement>(
        "[data-orbit-motion-toggle]",
      );
      expect(toggle).not.toBeNull();
      expect(toggle?.textContent).toContain("Resume background motion");
      expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    } finally {
      unmount();
    }
  });
});
