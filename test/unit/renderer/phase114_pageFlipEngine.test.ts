// @vitest-environment jsdom
//
// Phase 114 (chunk A) — the page-flip transition engine core.
//
// Pins the contract chunk C consumes: the mode/instant decision, the travel
// mapping, latest-wins interrupt coalescing, the DOM applier (class + both
// custom properties, cleared on instant/none), the animationend filter, and
// the styles.css class/keyframe pair.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  PAGE_FLIP_ANIMATION,
  PAGE_FLIP_CLASS,
  PAGE_FLIP_DX_VAR,
  PAGE_FLIP_DY_VAR,
  applyPageFlip,
  clearPageFlip,
  isPageFlipEnd,
  nextPendingFlip,
  pageFlipDecision,
  pageFlipTravel,
  type PageFlipMode,
} from "../../../src/renderer/components/pageFlip";
import {
  usePageFlipTransition,
  type PageFlipTransitionApi,
} from "../../../src/renderer/hooks/usePageFlipTransition";

const ALL_MODES: PageFlipMode[] = ["single", "facing", "grid", "continuous"];

/** Mount the hook in a probe component and expose its API synchronously. */
function mountHook(): { api: () => PageFlipTransitionApi; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let captured: PageFlipTransitionApi | null = null;
  function Probe(): null {
    captured = usePageFlipTransition();
    return null;
  }
  act((): void => {
    root.render(createElement(Probe));
  });
  return {
    api: (): PageFlipTransitionApi => {
      if (captured === null) throw new Error("hook not mounted");
      return captured;
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("Phase 114 — pageFlipDecision gating", () => {
  it("animates only single/facing on a real navigation turn", () => {
    for (const mode of ALL_MODES) {
      const expected = mode === "single" || mode === "facing" ? "animate" : "instant";
      expect(pageFlipDecision({ mode, instant: false, navigation: true })).toBe(expected);
    }
  });

  it("is instant for every mode without navigation", () => {
    for (const mode of ALL_MODES) {
      expect(pageFlipDecision({ mode, instant: false, navigation: false })).toBe("instant");
    }
  });

  it("reduced motion (instant) yields instant for every mode", () => {
    for (const mode of ALL_MODES) {
      expect(pageFlipDecision({ mode, instant: true, navigation: true })).toBe("instant");
      expect(pageFlipDecision({ mode, instant: true, navigation: false })).toBe("instant");
    }
  });
});

describe("Phase 114 — pageFlipTravel", () => {
  it("maps next / prev / none to the travel token", () => {
    expect(pageFlipTravel("single", "next")).toEqual({ dx: 24, dy: 0 });
    expect(pageFlipTravel("facing", "prev")).toEqual({ dx: -24, dy: 0 });
    expect(pageFlipTravel("grid", "none")).toEqual({ dx: 0, dy: 0 });
    expect(pageFlipTravel("continuous", "none")).toEqual({ dx: 0, dy: 0 });
  });
});

describe("Phase 114 — interrupt coalescing (latest wins)", () => {
  it("nextPendingFlip returns the latest request with a strictly increasing key", () => {
    const first = nextPendingFlip(null, { page: 2, dir: "next", key: 5 });
    expect(first).toEqual({ page: 2, dir: "next", key: 5 });
    const second = nextPendingFlip(first, { page: 3, dir: "next", key: 9 });
    expect(second.page).toBe(3);
    expect(second.dir).toBe("next");
    expect(second.key).toBeGreaterThan(first.key);
    const third = nextPendingFlip(second, { page: 4, dir: "prev", key: 1 });
    expect(third.page).toBe(4);
    expect(third.dir).toBe("prev");
    expect(third.key).toBeGreaterThan(second.key);
  });

  it("two rapid play calls leave PAGE_FLIP_CLASS on at most one element", () => {
    const { api, unmount } = mountHook();
    try {
      const a = document.createElement("div");
      const b = document.createElement("div");
      act((): void => {
        api().play(a, "next");
        api().play(b, "prev");
      });
      const count =
        (a.classList.contains(PAGE_FLIP_CLASS) ? 1 : 0) +
        (b.classList.contains(PAGE_FLIP_CLASS) ? 1 : 0);
      expect(count).toBeLessThanOrEqual(1);
      expect(b.classList.contains(PAGE_FLIP_CLASS)).toBe(true);
      expect(a.classList.contains(PAGE_FLIP_CLASS)).toBe(false);
    } finally {
      unmount();
    }
  });
});

describe("Phase 114 — applier DOM contract", () => {
  it("applyPageFlip adds the class and both vars; clearPageFlip removes them", () => {
    const el = document.createElement("div");
    expect(applyPageFlip(el, "next", false)).toBe(true);
    expect(el.classList.contains(PAGE_FLIP_CLASS)).toBe(true);
    expect(el.style.getPropertyValue(PAGE_FLIP_DX_VAR)).toBe("24px");
    expect(el.style.getPropertyValue(PAGE_FLIP_DY_VAR)).toBe("0px");
    clearPageFlip(el);
    expect(el.classList.contains(PAGE_FLIP_CLASS)).toBe(false);
    expect(el.style.getPropertyValue(PAGE_FLIP_DX_VAR)).toBe("");
    expect(el.style.getPropertyValue(PAGE_FLIP_DY_VAR)).toBe("");
  });

  it("applyPageFlip still clears and returns false for instant or none", () => {
    const el = document.createElement("div");
    el.classList.add(PAGE_FLIP_CLASS);
    expect(applyPageFlip(el, "next", true)).toBe(false);
    expect(el.classList.contains(PAGE_FLIP_CLASS)).toBe(false);
    el.classList.add(PAGE_FLIP_CLASS);
    expect(applyPageFlip(el, "none", false)).toBe(false);
    expect(el.classList.contains(PAGE_FLIP_CLASS)).toBe(false);
  });

  it("isPageFlipEnd is true only for the unit's own tf-page-flip event", () => {
    const unit = document.createElement("div");
    const other = document.createElement("div");
    expect(isPageFlipEnd({ animationName: PAGE_FLIP_ANIMATION, target: unit }, unit)).toBe(true);
    expect(isPageFlipEnd({ animationName: PAGE_FLIP_ANIMATION, target: other }, unit)).toBe(false);
    expect(isPageFlipEnd({ animationName: "other", target: unit }, unit)).toBe(false);
  });
});

describe("Phase 114 — styles.css page-flip rules (source scan)", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/renderer/styles.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("declares .tf-page-flip on the fast enter tokens", () => {
    const body = /(?:^|\n)\.tf-page-flip\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(body).toBeDefined();
    expect(body).toMatch(
      /animation:\s*tf-page-flip\s+var\(--motion-duration-fast\)\s+var\(--motion-ease-enter\)\s*;/,
    );
    expect(body).toMatch(/will-change:\s*transform,\s*opacity\s*;/);
  });

  it("declares the tf-page-flip keyframe with a translate + opacity from", () => {
    const start = css.indexOf("@keyframes tf-page-flip");
    expect(start).toBeGreaterThan(-1);
    const from = /from\s*\{([^}]*)\}/.exec(css.slice(start))?.[1];
    expect(from).toBeDefined();
    expect(from).toMatch(/translate\(/);
    expect(from).toMatch(/opacity:\s*0/);
  });
});
