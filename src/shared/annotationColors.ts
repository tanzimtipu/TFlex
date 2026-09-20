import type { AnnColor } from './types';

// ---------------------------------------------------------------------------
// DEF-260 — the single canonical annotation colour list
//
// Before this module the renderer's palette (`ANNOTATION_COLORS` in
// src/renderer/annotations/model.ts) and the engine's named-colour set
// (`ANN_COLORS` / `ANN_COLOR_RGB` in src/main/services/annotations.ts) were
// independent literals. They drifted: pink/teal/gray existed only in the
// renderer, so picking them on an engine-backed path (the action-bar colour
// box, or a colour-armed create) was silently dropped.
//
// Both sides now consume THIS module. Adding or removing a colour here is the
// only way to change the accepted set, so a future drift is a type error in the
// engine and a guard-test failure, not a silent no-op in the app.
//
// The canonical set is the union: the nine historic engine presets plus the
// three renderer-only names. The nine keep their historic engine RGB values
// (other tools and older TFlex builds rely on the /C mapping); pink/teal/gray
// use the exact RGB of the renderer palette's hex swatches
// (#ec4899 / #14b8a6 / #64748b) converted to 0..1 fractions.
// ---------------------------------------------------------------------------

/** Canonical annotation colour names, in the engine's historic order with the
 *  DEF-260 additions appended. Order is only the nearest-colour tie-break
 *  order and the renderer's swatch order; membership is what matters. */
export const ANNOTATION_COLOR_NAMES = [
  'yellow',
  'green',
  'blue',
  'red',
  'orange',
  'purple',
  'cyan',
  'magenta',
  'white',
  'pink',
  'teal',
  'gray',
] as const satisfies readonly AnnColor[];

/** Every canonical annotation colour name. */
export type AnnotationColorName = (typeof ANNOTATION_COLOR_NAMES)[number];

/** Canonical name -> RGB triple in 0..1, the values written into an
 *  annotation's /C array and matched by `nearestAnnColor`. The record is
 *  frozen and the tuples are readonly so no consumer can mutate the canonical
 *  values at runtime. */
export const ANN_COLOR_RGB: Readonly<Record<AnnColor, readonly [number, number, number]>> =
  Object.freeze({
    yellow: [1, 1, 0],
    green: [0, 1, 0],
    blue: [0, 0, 1],
    red: [1, 0, 0],
    orange: [1, 0.5, 0],
    purple: [0.5, 0, 0.5],
    cyan: [0, 1, 1],
    magenta: [1, 0, 1],
    white: [1, 1, 1],
    // Renderer palette hex -> 0..1: pink #ec4899, teal #14b8a6, gray #64748b.
    pink: [236 / 255, 72 / 255, 153 / 255],
    teal: [20 / 255, 184 / 255, 166 / 255],
    gray: [100 / 255, 116 / 255, 139 / 255],
  });