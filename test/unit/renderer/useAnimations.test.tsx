// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { MotionVariantSet, ThemeTransitionApi } from "../../../src/renderer/hooks/useAnimations";
import {
  shouldAnimateThemeTransition,
  themeTransitionStrategy,
  useBackdropFadeAnimation,
  useBloomAnimation,
  useLiftAnimation,
  usePopAnimation,
  useScaleAnimation,
  useSlideAnimation,
  useTabVariants,
  useThemeTransition,
} from "../../../src/renderer/hooks/useAnimations";
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SCALE,
  MOTION_THEME_CROSSFADE,
  MOTION_TRANSLATE,
  THEME_TRANSITION_CLASS,
  msToSeconds,
} from "../../../src/renderer/hooks/motionTokens";

/** DEF-198 — the hooks read the OS setting through
 *  matchMedia("(prefers-reduced-motion: reduce)") and react to its
 *  `change` events, so jsdom's never-matching built-in stub is no
 *  longer a simulation channel. Tests install a controllable fake:
 *  boot-time reduced motion sets `matches` BEFORE rendering; a
 *  mid-session flip sets `matches` and dispatches `change` (the
 *  exact DEF-198 regression). A fresh function identity per install
 *  also forces the hook module to build a fresh subscription. */
interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
  removeEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
  /** Simulate the OS flipping the setting. */
  dispatchChange(): void;
}

let fakeMql: FakeMql | null = null;

function installReducedMotionStub(matches = false): FakeMql {
  const listeners = new Set<(ev: { matches: boolean }) => void>();
  const mql: FakeMql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type: string, listener: (ev: { matches: boolean }) => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (ev: { matches: boolean }) => void): void => {
      listeners.delete(listener);
    },
    dispatchChange(): void {
      const ev = { matches: mql.matches };
      for (const listener of [...listeners]) listener(ev);
    },
  };
  (window as unknown as { matchMedia: (query: string) => FakeMql }).matchMedia = (
    query: string,
  ): FakeMql => {
    mql.media = query;
    return mql;
  };
  fakeMql = mql;
  return mql;
}

/** One probe component calls every variant hook so a single mount
 *  snapshots them all (hooks must run unconditionally — same contract
 *  the real components follow). */
interface HookSnapshot {
  bloom: MotionVariantSet;
  backdrop: MotionVariantSet;
  slideLeftDocked: MotionVariantSet;
  slideRightDocked: MotionVariantSet;
  slideLeftOverlay: MotionVariantSet;
  slideRightOverlay: MotionVariantSet;
  pop: MotionVariantSet;
  popRise: MotionVariantSet;
  popTravelOnly: MotionVariantSet;
  lift: ReturnType<typeof useLiftAnimation>;
  liftSmall: ReturnType<typeof useLiftAnimation>;
  press: ReturnType<typeof useScaleAnimation>;
  tabs: MotionVariantSet;
}

let snap: HookSnapshot | null = null;

function Probe(): ReactElement | null {
  snap = {
    bloom: useBloomAnimation(),
    backdrop: useBackdropFadeAnimation(),
    slideLeftDocked: useSlideAnimation({ side: "left" }),
    slideRightDocked: useSlideAnimation({ side: "right" }),
    slideLeftOverlay: useSlideAnimation({ side: "left", mode: "overlay" }),
    slideRightOverlay: useSlideAnimation({ side: "right", mode: "overlay" }),
    pop: usePopAnimation(),
    popRise: usePopAnimation({ from: "below" }),
    popTravelOnly: usePopAnimation({ scale: false }),
    lift: useLiftAnimation(),
    liftSmall: useLiftAnimation({ distance: "small" }),
    press: useScaleAnimation(),
    tabs: useTabVariants(),
  };
  return null;
}

function renderProbe(): { root: Root; container: HTMLElement } {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act((): void => {
    root.render(<Probe />);
  });
  return { root, container };
}

beforeEach((): void => {
  installReducedMotionStub(false);
  document.documentElement.dataset.theme = "";
  document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
});

afterEach((): void => {
  vi.useRealTimers();
  document.documentElement.classList.remove(THEME_TRANSITION_CLASS);
});

describe("variant hooks (full motion)", () => {
  it("bloom enters at the enter scale/opacity and settles to 1 over the standard band", () => {
    renderProbe();
    const { bloom } = snap as HookSnapshot;
    expect(bloom.initial).toMatchObject({ opacity: 0, scale: MOTION_SCALE.enter });
    expect(bloom.animate).toMatchObject({
      opacity: 1,
      scale: 1,
      // motion/react durations are SECONDS: the 250ms token -> 0.25s.
      transition: { duration: msToSeconds(MOTION_DURATION.standard), ease: MOTION_EASE.enter },
    });
    expect(bloom.exit).toMatchObject({
      opacity: 0,
      scale: MOTION_SCALE.exit,
      transition: { duration: msToSeconds(MOTION_DURATION.fast), ease: MOTION_EASE.exit },
      pointerEvents: "none",
    });
  });

  it("bloom honours custom scale options but keeps the token timings", () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const box: { custom: MotionVariantSet | null } = { custom: null };
    function CustomProbe(): null {
      box.custom = useBloomAnimation({ fromScale: 0.9, exitScale: 0.99 });
      return null;
    }
    act((): void => {
      root.render(<CustomProbe />);
    });
    expect(box.custom).not.toBeNull();
    expect(box.custom?.initial.scale).toBe(0.9);
    expect(box.custom?.exit.scale).toBe(0.99);
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  it("backdrop fade is opacity-only on both ends", () => {
    renderProbe();
    const { backdrop } = snap as HookSnapshot;
    expect(Object.keys(backdrop.initial)).toEqual(["opacity"]);
    expect(Object.keys(backdrop.animate).filter((k) => k !== "transition")).toEqual(["opacity"]);
    expect(backdrop.exit.pointerEvents).toBe("none");
  });

  it("docked slides travel the panel distance in the side's direction", () => {
    renderProbe();
    const s = snap as HookSnapshot;
    expect(s.slideLeftDocked.initial.x).toBe(-MOTION_TRANSLATE.panel);
    expect(s.slideRightDocked.initial.x).toBe(MOTION_TRANSLATE.panel);
    expect(s.slideLeftDocked.animate).toMatchObject({
      transition: { duration: msToSeconds(MOTION_DURATION.panel) },
    });
    expect(s.slideLeftDocked.exit).toMatchObject({
      transition: { duration: msToSeconds(MOTION_DURATION.fast) },
    });
  });

  it("overlay slides travel the full element width per side", () => {
    renderProbe();
    const s = snap as HookSnapshot;
    expect(s.slideLeftOverlay.initial.x).toBe("-100%");
    expect(s.slideRightOverlay.initial.x).toBe("100%");
    expect(s.slideLeftOverlay.exit.x).toBe("-100%");
    expect(s.slideRightOverlay.exit.x).toBe("100%");
  });

  it("pop drops onto a top anchor and rises from a bottom anchor", () => {
    renderProbe();
    const s = snap as HookSnapshot;
    expect(s.pop.initial.y).toBe(-MOTION_TRANSLATE.small);
    expect(s.popRise.initial.y).toBe(MOTION_TRANSLATE.small);
    expect(s.pop.initial.scale).toBe(MOTION_SCALE.enter);
    expect(s.pop.exit.y).toBe(-MOTION_TRANSLATE.micro);
  });

  it("pop without scale is a pure drop reveal (travel + opacity only)", () => {
    renderProbe();
    const { popTravelOnly } = snap as HookSnapshot;
    expect(popTravelOnly.initial.scale).toBeUndefined();
    expect(popTravelOnly.animate.scale).toBe(1);
  });

  it("lift moves micro by default, small on demand, and presses at the press scale", () => {
    renderProbe();
    const s = snap as HookSnapshot;
    expect(s.lift.hover.whileHover).toEqual({ y: -MOTION_TRANSLATE.micro });
    expect(s.liftSmall.hover.whileHover).toEqual({ y: -MOTION_TRANSLATE.small });
    expect(s.lift.hover.whileTap).toEqual({ scale: MOTION_SCALE.press });
    expect(s.press.press.whileTap).toEqual({ scale: MOTION_SCALE.press });
  });

  it("tab variants are opacity-only so the strip never moves", () => {
    renderProbe();
    const { tabs } = snap as HookSnapshot;
    expect(Object.keys(tabs.initial)).toEqual(["opacity"]);
    expect(Object.keys(tabs.animate).filter((k) => k !== "transition")).toEqual(["opacity"]);
    expect(Object.keys(tabs.exit).filter((k) => k !== "transition" && k !== "pointerEvents")).toEqual(["opacity"]);
    expect(tabs.animate).toMatchObject({ transition: { duration: msToSeconds(MOTION_DURATION.fast) } });
    expect(tabs.exit).toMatchObject({ transition: { duration: msToSeconds(MOTION_DURATION.micro) } });
  });

  it("never passes a raw millisecond count as a motion duration (seconds guard)", () => {
    renderProbe();
    const s = snap as HookSnapshot;
    // motion/react reads `duration` as SECONDS. A token value (200)
    // leaking through would be a 200-second tween — pinned impossible.
    const check = (v: MotionVariantSet, label: string): void => {
      for (const variant of [v.animate, v.exit]) {
        const t = (variant as { transition?: { duration?: number } }).transition;
        if (t?.duration !== undefined) {
          expect(t.duration, `${label} duration must be seconds`).toBeLessThan(1);
        }
      }
    };
    check(s.bloom, "bloom");
    check(s.backdrop, "backdrop");
    check(s.slideLeftDocked, "slideLeftDocked");
    check(s.slideRightOverlay, "slideRightOverlay");
    check(s.pop, "pop");
    check(s.tabs, "tabs");
    const lift = s.lift.hover.transition?.duration;
    if (lift !== undefined) expect(lift).toBeLessThan(1);
    const press = s.press.press.transition?.duration;
    if (press !== undefined) expect(press).toBeLessThan(1);
  });
});

describe("variant hooks under reduced motion", () => {
  it("collapse to opacity-only with zero duration and keep the exit guard", () => {
    installReducedMotionStub(true);
    renderProbe();
    const s = snap as HookSnapshot;
    for (const v of [
      s.bloom,
      s.backdrop,
      s.slideLeftDocked,
      s.slideRightOverlay,
      s.pop,
      s.tabs,
    ]) {
      expect(v.initial).toEqual({ opacity: 0 });
      expect(v.animate.opacity).toBe(1);
      expect(v.animate.transition).toEqual({ duration: 0, ease: "linear" });
      expect(v.exit).toEqual({
        opacity: 0,
        transition: { duration: 0, ease: "linear" },
        pointerEvents: "none",
      });
    }
    // Hover/press movement disappears entirely; the CSS colour wash
    // keeps communicating hover state.
    expect(s.lift.hover.whileHover).toBeUndefined();
    expect(s.press.press.whileTap).toBeUndefined();
  });
});

describe("live reduced motion (DEF-198)", () => {
  it("picks up a mid-session OS flip on the SAME mounted hooks — no remount", () => {
    // Boot with reduced motion OFF (beforeEach installs the false stub).
    renderProbe();
    const full = snap as HookSnapshot;
    expect(full.bloom.initial).toMatchObject({ scale: MOTION_SCALE.enter });
    expect(full.lift.hover.whileHover).toEqual({ y: -MOTION_TRANSLATE.micro });

    // The user flips the OS "reduce motion" setting while the app runs:
    // the MediaQueryList `change` event must reach every mounted hook.
    act((): void => {
      (fakeMql as FakeMql).matches = true;
      (fakeMql as FakeMql).dispatchChange();
    });
    const collapsed = snap as HookSnapshot;
    expect(collapsed.bloom.initial).toEqual({ opacity: 0 });
    expect(collapsed.bloom.animate).toMatchObject({
      transition: { duration: 0, ease: "linear" },
    });
    expect(collapsed.lift.hover.whileHover).toBeUndefined();
    expect(collapsed.press.press.whileTap).toBeUndefined();

    // Flipping the setting back restores full motion on the same hooks.
    act((): void => {
      (fakeMql as FakeMql).matches = false;
      (fakeMql as FakeMql).dispatchChange();
    });
    const restored = snap as HookSnapshot;
    expect(restored.bloom.initial).toMatchObject({ scale: MOTION_SCALE.enter });
    expect(restored.lift.hover.whileHover).toEqual({ y: -MOTION_TRANSLATE.micro });
  });
});

describe("shouldAnimateThemeTransition", () => {
  it("animates every apply except the boot apply and reduced motion", () => {
    expect(shouldAnimateThemeTransition({ firstApply: true, reducedMotion: false })).toBe(false);
    expect(shouldAnimateThemeTransition({ firstApply: false, reducedMotion: false })).toBe(true);
    expect(shouldAnimateThemeTransition({ firstApply: false, reducedMotion: true })).toBe(false);
    expect(shouldAnimateThemeTransition({ firstApply: true, reducedMotion: true })).toBe(false);
  });
});

describe("themeTransitionStrategy (DEF-195)", () => {
  it("picks the compositor view-transition path when the API exists", () => {
    expect(
      themeTransitionStrategy({ hasViewTransitionApi: true, firstApply: false, reducedMotion: false }),
    ).toBe("view-transition");
  });

  it("falls back to the class crossfade without the API, and flips instantly on boot/reduced", () => {
    expect(
      themeTransitionStrategy({ hasViewTransitionApi: false, firstApply: false, reducedMotion: false }),
    ).toBe("class-crossfade");
    expect(
      themeTransitionStrategy({ hasViewTransitionApi: true, firstApply: true, reducedMotion: false }),
    ).toBe("instant");
    expect(
      themeTransitionStrategy({ hasViewTransitionApi: true, firstApply: false, reducedMotion: true }),
    ).toBe("instant");
    expect(
      themeTransitionStrategy({ hasViewTransitionApi: false, firstApply: true, reducedMotion: true }),
    ).toBe("instant");
  });
});

describe("useThemeTransition", () => {
  function renderThemeProbe(onApi: (api: ThemeTransitionApi) => void): {
    root: Root;
    container: HTMLElement;
  } {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    function ThemeProbe(): null {
      onApi(useThemeTransition());
      return null;
    }
    act((): void => {
      root.render(<ThemeProbe />);
    });
    return { root, container };
  }

  function mountedApi(): ThemeTransitionApi {
    const box: { api: ThemeTransitionApi | null } = { api: null };
    const { root, container } = renderThemeProbe((a): void => {
      box.api = a;
    });
    act((): void => {
      root.unmount();
    });
    container.remove();
    // The unmount cleanup removed the class; the API itself is plain and
    // still usable for the lifecycle assertions below (it holds no React
    // state — only refs).
    expect(box.api).not.toBeNull();
    return box.api as ThemeTransitionApi;
  }

  it("boot apply sets the theme WITHOUT the transitioning class", () => {
    vi.useFakeTimers();
    const api = mountedApi();
    act((): void => {
      api.setTheme("dark");
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it("later applies crossfade: class goes on with the flip and off after the crossfade + grace", () => {
    vi.useFakeTimers();
    const api = mountedApi();
    act((): void => {
      api.setTheme("dark"); // boot apply — no class
    });
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
    act((): void => {
      api.setTheme("light"); // real transition
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(true);
    act((): void => {
      vi.advanceTimersByTime(MOTION_THEME_CROSSFADE + 40);
    });
    // Still inside the grace window.
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(true);
    act((): void => {
      vi.advanceTimersByTime(20);
    });
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it("re-triggers mid-crossfade keep exactly one class and one timer", () => {
    vi.useFakeTimers();
    const api = mountedApi();
    act((): void => {
      api.setTheme("dark");
    });
    act((): void => {
      api.setTheme("light");
    });
    act((): void => {
      api.setTheme("frosted");
    });
    expect(document.documentElement.dataset.theme).toBe("frosted");
    // Document-level query: documentElement.querySelectorAll only sees
    // DESCENDANTS, and the class lives on documentElement itself.
    const matches = document.querySelectorAll(`.${THEME_TRANSITION_CLASS}`);
    expect(matches.length).toBe(1);
    act((): void => {
      vi.advanceTimersByTime(MOTION_THEME_CROSSFADE + 60);
    });
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it("reduced motion applies the theme instantly, never crossfading", () => {
    vi.useFakeTimers();
    installReducedMotionStub(true);
    const api = mountedApi();
    act((): void => {
      api.setTheme("dark");
    });
    act((): void => {
      api.setTheme("light");
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
  });

  it("routes a real apply through startViewTransition when the API exists (DEF-195)", () => {
    const startViewTransition = vi.fn((cb: () => void): void => {
      cb();
    });
    (document as unknown as { startViewTransition?: unknown }).startViewTransition =
      startViewTransition;
    try {
      const api = mountedApi();
      act((): void => {
        api.setTheme("dark"); // boot apply — instant, no API call
      });
      act((): void => {
        api.setTheme("light"); // real apply — compositor crossfade
      });
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dataset.theme).toBe("light");
      // The class-based machinery never engages on this path.
      expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
    } finally {
      delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    }
  });

  it("dedupes a same-theme re-apply: the settings echo starts no second transition (DEF-199)", () => {
    const startViewTransition = vi.fn((cb: () => void): void => {
      cb();
    });
    (document as unknown as { startViewTransition?: unknown }).startViewTransition =
      startViewTransition;
    try {
      const api = mountedApi();
      act((): void => {
        api.setTheme("dark"); // boot apply — instant, no API call
      });
      act((): void => {
        api.setTheme("light"); // the real apply — one View Transition
      });
      act((): void => {
        api.setTheme("light"); // settings.changed echo — deduped, no 2nd VT
      });
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dataset.theme).toBe("light");
      // The class-based machinery never engages on this path.
      expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
    } finally {
      delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    }
  });

  it("holds a skipped transition's .finished rejection so it cannot surface as a pageerror (DEF-199)", () => {
    // Chromium REJECTS ViewTransition.finished with "Transition was
    // skipped" when a newer transition takes over. The hook must
    // attach a handled catch to .finished so that rejection never
    // reaches the renderer's pageerror stream.
    const finishedCatch = vi.fn();
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished: { catch: finishedCatch } };
    });
    (document as unknown as { startViewTransition?: unknown }).startViewTransition =
      startViewTransition;
    try {
      const api = mountedApi();
      act((): void => {
        api.setTheme("dark"); // boot apply — instant, no API call
      });
      act((): void => {
        api.setTheme("light"); // real apply — the hook catches .finished
      });
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      // Exactly one rejection handler was attached to .finished.
      expect(finishedCatch).toHaveBeenCalledTimes(1);
    } finally {
      delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    }
  });

  it("skips a boot apply the data-theme preset already shows, and the first real flip still crossfades (DEF-199)", () => {
    // index.html presets <html data-theme="frosted"> before any React
    // code runs. When the persisted theme matches the preset, the boot
    // apply must be a no-op via the attribute ground-truth guard (a
    // fresh hook instance has no lastAppliedRef to consult) — and that
    // skip must still spend the boot slot, so the user's first REAL
    // flip runs the View Transition instead of an instant flip.
    const startViewTransition = vi.fn((cb: () => void): void => {
      cb();
    });
    (document as unknown as { startViewTransition?: unknown }).startViewTransition =
      startViewTransition;
    try {
      document.documentElement.setAttribute("data-theme", "frosted"); // the index.html boot preset
      const api = mountedApi();
      act((): void => {
        api.setTheme("frosted"); // boot apply — preset already shows it: no VT, no paint work
      });
      expect(startViewTransition).not.toHaveBeenCalled();
      act((): void => {
        api.setTheme("dark"); // first REAL flip — must still earn the crossfade
      });
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.documentElement.classList.contains(THEME_TRANSITION_CLASS)).toBe(false);
    } finally {
      delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    }
  });

  it("never calls startViewTransition under reduced motion (DEF-195)", () => {
    installReducedMotionStub(true);
    const startViewTransition = vi.fn();
    (document as unknown as { startViewTransition?: unknown }).startViewTransition =
      startViewTransition;
    try {
      const api = mountedApi();
      act((): void => {
        api.setTheme("dark");
      });
      act((): void => {
        api.setTheme("light");
      });
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(document.documentElement.dataset.theme).toBe("light");
    } finally {
      delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
    }
  });
});