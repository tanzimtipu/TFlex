// Phase 20 — morphing surfaces: the measurement hook.
//
// The surface is rendered at its FINAL rect (the placement/clamping maths
// belongs to the call site and is untouched). This hook reads the two live
// rects and builds the FLIP preset that puts the surface on the trigger's
// box for its first frame.
//
// It must run in the CALL SITE, not inside the surface wrapper: a layout
// effect runs child-first, so a hook living inside the wrapper would measure
// before the call site's own placement effect has positioned the surface
// (the annotation menu is placed imperatively in viewport coordinates).
// Called from the call site, its layout effect runs after that placement
// effect in the same commit — the measured rect is the final one.
//
// The preset is kept after the surface closes so the exit animation (which
// AnimatePresence runs after `open` flips false) still has its target.

import { useLayoutEffect, useState, type RefObject } from "react";
import {
  tfMorph,
  type MorphAnchorCorner,
  type MorphRect,
  type TfMorphPreset,
} from "./tfPresets";

export interface UseMorphPresetOptions {
  /** True while the surface is open (the state that mounts it). */
  open: boolean;
  /** The trigger the surface grows out of. */
  triggerRef: RefObject<HTMLElement | null>;
  /** The surface element itself (the wrapper's ref target). */
  surfaceRef: RefObject<HTMLElement | null>;
  /** The surface corner pinned to the trigger. */
  anchorCorner: MorphAnchorCorner;
}

/** Read a viewport rect into the pure FLIP shape. */
function toMorphRect(rect: DOMRect): MorphRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/** The surface's FINAL LAYOUT rect — never a `getBoundingClientRect` read
 *  while a mid-exit transform is still applied.
 *
 *  DEF-237 (ADV-053): a surface re-opened during its own exit still
 *  carries the exit transform (motion writes it inline as
 *  `element.style.transform`), so a raw rect read returns the shrunken,
 *  offset mid-exit box and the FLIP maths grows the surface from its own
 *  ghost (measured 34-108px first-frame deviation from the trigger).
 *  Resetting the inline transform for the read gives the placement
 *  maths' layout rect; the previous value is restored immediately and
 *  motion rewrites it on the next frame anyway, so the reset is never
 *  painted. */
export function measureSurfaceLayoutRect(surface: HTMLElement): MorphRect {
  const previous = surface.style.transform;
  const hadTransform = previous !== "" && previous !== "none";
  if (hadTransform) surface.style.transform = "none";
  const rect = surface.getBoundingClientRect();
  if (hadTransform) surface.style.transform = previous;
  return toMorphRect(rect);
}

/** Measure a trigger/surface pair and return its morph preset (null until
 *  the first measurement lands). Re-measures on every open. */
export function useMorphPreset(options: UseMorphPresetOptions): TfMorphPreset | null {
  const { open, triggerRef, surfaceRef, anchorCorner } = options;
  const [preset, setPreset] = useState<TfMorphPreset | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const surface = surfaceRef.current;
    const trigger = triggerRef.current;
    if (surface === null || trigger === null) return;
    setPreset(
      tfMorph(
        toMorphRect(trigger.getBoundingClientRect()),
        // The surface's final layout rect, not its transformed paint box
        // (an exit in flight when the re-open starts is reset first —
        // see measureSurfaceLayoutRect).
        measureSurfaceLayoutRect(surface),
        anchorCorner,
      ),
    );
  }, [open, triggerRef, surfaceRef, anchorCorner]);
  return preset;
}
