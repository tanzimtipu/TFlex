// Phase 100 — iconography foundation.
//
// CSS source of truth: src/renderer/styles.css (--tf-icon-size*,
// --tf-icon-stroke), owned by the central wrapper src/renderer/icons/Icon.tsx.
// This module is a re-export, never a copy: the wrapper stays the single
// source and test/unit/renderer/phase94_noAdHocIcons.test.ts keeps every
// glyph on it.
//
// Phase 103 adds the Quiet Precision semantic registry and its geometry tokens
// (viewBox, stroke, small-size stroke) so a feature imports them from the same
// barrel as the existing foundation.

export { ICON_SIZES, ICON_STROKE, ICON_STROKE_BOLD } from "../icons/Icon";
export {
  QUIET_ICONS,
  QUIET_ICON_STROKE,
  QUIET_ICON_STROKE_SMALL,
  QUIET_ICON_VIEWBOX,
} from "../icons/quietPrecision";
export type { QuietGlyph, QuietIconId } from "../icons/quietPrecision";
export type { IconSize, IconVariant, IconProps } from "../icons/Icon";
