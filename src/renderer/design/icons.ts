// Phase 100 — iconography foundation.
//
// CSS source of truth: src/renderer/styles.css (--tf-icon-size*,
// --tf-icon-stroke), owned by the central wrapper src/renderer/icons/Icon.tsx.
// This module is a re-export, never a copy: the wrapper stays the single
// source and test/unit/renderer/phase94_noAdHocIcons.test.ts keeps every
// glyph on it.

export { ICON_SIZES, ICON_STROKE, ICON_STROKE_BOLD } from "../icons/Icon";
export type { IconSize, IconVariant, IconProps } from "../icons/Icon";
