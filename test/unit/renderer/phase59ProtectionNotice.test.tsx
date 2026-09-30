// @vitest-environment jsdom
//
// Phase 59 (feature B) — the protection notice is now a rounded, animated box
// that auto-collapses into a floating "i" (info) icon at the canvas's
// top-left after a ~10 s reading pause, and can be expanded/collapsed by the
// user at will. Virtual time (`vi.useFakeTimers`) drives the dwell. jsdom
// applies no stylesheet, so the rounded-box / placement contract is asserted
// as a textual CSS scan (the established pattern) while every state change is
// asserted against the rendered DOM.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { DocumentProtectionState } from "../../../src/shared/types";
import {
  ProtectionNotice,
  PROTECTION_NOTICE_AUTO_COLLAPSE_MS,
} from "../../../src/renderer/components/ProtectionNotice";
import { setAnimationsEnabledPreference } from "../../../src/renderer/hooks/motionPolicy";
import { MOTION_DURATION } from "../../../src/renderer/hooks/motionTokens";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `selector { ... }` whose selector starts a line. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

const PROTECTION: DocumentProtectionState = {
  encrypted: true,
  v: 5,
  r: 6,
  cfm: "AESV3",
  algorithm: "AES-256",
  permissions: {
    print: false,
    highResPrint: false,
    copy: true,
    accessibleCopy: true,
    modify: false,
    comment: false,
    assemble: false,
    fillForms: true,
  },
};

function mount(node: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  return {
    host,
    root,
    cleanup(): void {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const stateOf = (host: HTMLElement): string =>
  host
    .querySelector("[data-protection-notice-state]")
    ?.getAttribute("data-protection-notice-state") ?? "";

const iconOf = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>("[data-protection-icon]");

const clickCollapse = (host: HTMLElement): void => {
  act((): void => {
    host
      .querySelector<HTMLButtonElement>("[data-protection-collapse]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("phase 59 — ProtectionNotice: rounded box, auto-collapse, manual toggle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAnimationsEnabledPreference(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    setAnimationsEnabledPreference(true);
  });

  it("starts expanded as the rounded box with the Phase 52 content unchanged", () => {
    const view = mount(createElement(ProtectionNotice, { protection: PROTECTION }));
    try {
      expect(stateOf(view.host)).toBe("expanded");
      const box = view.host.querySelector(".protection-notice");
      expect(box).not.toBeNull();
      expect(box?.getAttribute("role")).toBe("note");
      const text = view.host.textContent ?? "";
      expect(text).toContain("AES-256");
      expect(text).toContain("/R 6");
      expect(text).toContain("/V 5");
      expect(text).toContain("/CFM AESV3");
      expect(text).toContain("Copy");
      expect(text).toContain("does not enforce");
      // The collapsed icon is not present while expanded.
      expect(iconOf(view.host)).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("auto-collapses after ~10 s into the accessible \"i\" button", () => {
    const view = mount(createElement(ProtectionNotice, { protection: PROTECTION }));
    try {
      act((): void => {
        vi.advanceTimersByTime(PROTECTION_NOTICE_AUTO_COLLAPSE_MS - 1);
      });
      expect(stateOf(view.host)).toBe("expanded");
      expect(iconOf(view.host)).toBeNull();
      // The dwell fires: the box plays its exit...
      act((): void => {
        vi.advanceTimersByTime(1);
      });
      expect(view.host.querySelector(".protection-notice--leaving")).not.toBeNull();
      // ...then is swapped for the icon.
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host)).toBe("collapsed");
      expect(view.host.querySelector(".protection-notice")).toBeNull();
      const icon = iconOf(view.host);
      expect(icon).not.toBeNull();
      expect(icon?.tagName).toBe("BUTTON");
      expect(icon?.getAttribute("aria-label")).toBe("Show document protection details");
    } finally {
      view.cleanup();
    }
  });

  it("expands from the icon and resets the 10 s timer", () => {
    const view = mount(createElement(ProtectionNotice, { protection: PROTECTION }));
    try {
      act((): void => {
        vi.advanceTimersByTime(PROTECTION_NOTICE_AUTO_COLLAPSE_MS);
      });
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host)).toBe("collapsed");
      // Re-expand from the icon.
      act((): void => {
        iconOf(view.host)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(stateOf(view.host)).toBe("expanded");
      // 9.5 s later it is STILL expanded — the dwell was reset on expand...
      act((): void => {
        vi.advanceTimersByTime(9500);
      });
      expect(stateOf(view.host)).toBe("expanded");
      // ...and past 10 s it collapses again.
      act((): void => {
        vi.advanceTimersByTime(600);
      });
      expect(view.host.querySelector(".protection-notice--leaving")).not.toBeNull();
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host)).toBe("collapsed");
    } finally {
      view.cleanup();
    }
  });

  it("the expanded box's collapse control collapses without unmounting the notice", () => {
    const view = mount(createElement(ProtectionNotice, { protection: PROTECTION }));
    try {
      const region = view.host.querySelector("[data-protection-notice-state]");
      clickCollapse(view.host);
      // Mid-exit: still mounted, box leaving, no icon yet.
      expect(view.host.querySelector("[data-protection-notice-state]")).toBe(region);
      expect(view.host.querySelector(".protection-notice--leaving")).not.toBeNull();
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host)).toBe("collapsed");
      // Expand, collapse again — repeatable.
      act((): void => {
        iconOf(view.host)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(stateOf(view.host)).toBe("expanded");
      clickCollapse(view.host);
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.standard);
      });
      expect(stateOf(view.host)).toBe("collapsed");
      expect(iconOf(view.host)).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("collapses instantly on the instant path (Animations OFF / reduced motion)", () => {
    setAnimationsEnabledPreference(false);
    const view = mount(createElement(ProtectionNotice, { protection: PROTECTION }));
    try {
      expect(stateOf(view.host)).toBe("expanded");
      clickCollapse(view.host);
      // Immediate: no intermediate leaving box, no commit timer to wait on.
      expect(stateOf(view.host)).toBe("collapsed");
      expect(view.host.querySelector(".protection-notice--leaving")).toBeNull();
      expect(iconOf(view.host)).not.toBeNull();
    } finally {
      view.cleanup();
    }
  });
});

describe("phase 59 — ProtectionNotice CSS contract", () => {
  it("draws the box with the design-system radius token and the shared motion token", () => {
    const box = ruleBody(".protection-notice");
    expect(box).toMatch(/border-radius:\s*var\(--radius-3\)/);
    expect(box).toMatch(
      /animation:\s*protection-notice-in var\(--motion-duration-standard\)/,
    );
    // The expanded box stays in the document-column flow (never an overlay).
    expect(box).not.toMatch(/position:\s*absolute/);
  });

  it("pins the collapsed icon to the canvas top-left as an absolute overlay", () => {
    const region = ruleBody(".protection-notice-region");
    expect(region).toMatch(/position:\s*relative/);
    const icon = ruleBody(".protection-notice-collapsed-toggle");
    expect(icon).toMatch(/position:\s*absolute/);
    expect(icon).toMatch(/top:/);
    expect(icon).toMatch(/left:/);
  });
});
