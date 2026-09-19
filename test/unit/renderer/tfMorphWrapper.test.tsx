// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Phase 20 — the TfMorph wrapper contract:
//   1. a measured preset puts the surface on the trigger's pinned corner
//      (transform-origin) and drives the CSS content fade via
//      data-tf-morph="in",
//   2. the reduced-motion path is opacity-only — no transform ever
//      animates, structure unchanged (same element, same attribute),
//   3. DEF-239 — the FIRST exit frame pins `pointer-events: none`
//      (React's synchronous style commit, not motion's one-frame-late
//      discrete set) and DEF-235 class — the exiting surface is inert,
//      both cleared again when the surface re-presents mid-exit.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AnimatePresence } from "motion/react";
import { TfMorph } from "../../../src/renderer/components/motion/TfMotion";
import {
  tfMorph,
  type MorphRect,
  type TfMorphPreset,
} from "../../../src/renderer/components/motion/tfPresets";

function rect(left: number, top: number, width: number, height: number): MorphRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const PRESET: TfMorphPreset = tfMorph(
  rect(1387, 54, 28, 32),
  rect(1215, 86, 200, 510),
  "top-right",
);

/** DEF-198-style controllable matchMedia stub: the wrappers read the OS
 *  setting through matchMedia("(prefers-reduced-motion: reduce)"). */
function installReducedMotion(matches: boolean): void {
  const listeners = new Set<(ev: { matches: boolean }) => void>();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): unknown => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: (_t: string, l: (ev: { matches: boolean }) => void): void => {
        listeners.add(l);
      },
      removeEventListener: (_t: string, l: (ev: { matches: boolean }) => void): void => {
        listeners.delete(l);
      },
      addListener: (l: (ev: { matches: boolean }) => void): void => {
        listeners.add(l);
      },
      removeListener: (l: (ev: { matches: boolean }) => void): void => {
        listeners.delete(l);
      },
      dispatchEvent: (): boolean => true,
    }),
  });
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach((): void => {
  installReducedMotion(false);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach((): void => {
  act((): void => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

function renderSurface(morph: TfMorphPreset | null): void {
  act((): void => {
    root?.render(
      <AnimatePresence>
        <TfMorph morph={morph} className="morph-probe">
          <button type="button">row</button>
        </TfMorph>
      </AnimatePresence>,
    );
  });
}

/** Presence-controlled render so the exit (and a mid-exit re-present)
 *  can be driven explicitly. */
function renderToggle(open: boolean): void {
  act((): void => {
    root?.render(
      <AnimatePresence>
        {open && (
          <TfMorph morph={PRESET} className="morph-probe">
            <button type="button">row</button>
          </TfMorph>
        )}
      </AnimatePresence>,
    );
  });
}

describe("TfMorph — the morphing surface wrapper", () => {
  it("renders the surface with the pinned transform-origin and the fade-in phase", () => {
    renderSurface(PRESET);
    const el = document.querySelector(".morph-probe");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-tf-morph")).toBe("in");
    expect((el as HTMLElement | null)?.style.transformOrigin).toBe("top right");
    // The surface's children are the content-fade targets (animations.css).
    expect(el?.querySelector("button")).not.toBeNull();
  });

  it("renders without a transform-origin before the preset is measured", () => {
    renderSurface(null);
    const el = document.querySelector(".morph-probe");
    expect(el).not.toBeNull();
    expect((el as HTMLElement | null)?.style.transformOrigin).toBe("");
  });

  it("collapses to opacity-only under reduced motion (same element, no transform)", () => {
    installReducedMotion(true);
    renderSurface(PRESET);
    const el = document.querySelector(".morph-probe") as HTMLElement | null;
    expect(el).not.toBeNull();
    // Structure unchanged: the surface still mounts with the fade phase...
    expect(el?.getAttribute("data-tf-morph")).toBe("in");
    expect(el?.querySelector("button")).not.toBeNull();
    // ...but the morph transform is never applied.
    expect(el?.style.transformOrigin).toBe("");
    expect(el?.style.transform).toBe("");
  });

  it("DEF-239 — the FIRST exit frame pins pointer-events:none and the exit is inert", () => {
    renderToggle(true);
    const present = document.querySelector(".morph-probe") as HTMLElement | null;
    expect(present?.getAttribute("data-tf-morph")).toBe("in");
    expect(present?.hasAttribute("inert")).toBe(false);
    expect(present?.style.pointerEvents).toBe("");

    renderToggle(false);
    const exiting = document.querySelector(".morph-probe") as HTMLElement | null;
    // The surface is still mounted (AnimatePresence runs the exit)...
    expect(exiting, "the exit runs through AnimatePresence, not a pop").not.toBeNull();
    expect(exiting?.getAttribute("data-tf-morph")).toBe("out");
    // ...and the FIRST out frame already carries the guards: React's
    // synchronous style commit beats motion's one-frame-late discrete
    // pointerEvents set (ADV-055), and the exiting subtree leaves the
    // focus order (ADV-051..054 class).
    expect(exiting?.style.pointerEvents).toBe("none");
    expect(exiting?.hasAttribute("inert")).toBe(true);
  });

  it("clears the exit guards when the surface re-presents mid-exit", () => {
    renderToggle(true);
    renderToggle(false);
    const exiting = document.querySelector(".morph-probe") as HTMLElement | null;
    expect(exiting?.style.pointerEvents).toBe("none");
    expect(exiting?.hasAttribute("inert")).toBe(true);

    // Re-open during the exit: the surface is the SAME node, and both
    // guards must lift (an inert / pointer-dead re-opened menu would be
    // unclickable).
    renderToggle(true);
    const reopened = document.querySelector(".morph-probe") as HTMLElement | null;
    expect(reopened).not.toBeNull();
    expect(reopened?.getAttribute("data-tf-morph")).toBe("in");
    expect(reopened?.hasAttribute("inert")).toBe(false);
    expect(reopened?.style.pointerEvents).toBe("");
  });
});
