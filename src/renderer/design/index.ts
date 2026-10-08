// Phase 100 — the stable public API of the design foundation.
//
// A feature imports every shared visual family from here
// (`src/renderer/design`), never from a scattered local literal:
//   color, typography, spacing, radii, elevation, motion, icons.
// The modules mirror the CSS token layer in src/renderer/styles.css and
// src/renderer/styles/animations.css;
// test/unit/renderer/foundationMirrors.test.ts pins the pairing.

export * from "./color";
export * from "./typography";
export * from "./spacing";
export * from "./layout";
export * from "./radii";
export * from "./elevation";
export * from "./motion";
export * from "./icons";
