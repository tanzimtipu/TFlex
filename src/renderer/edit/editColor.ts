// Phase 26 — the text-colour / font helpers that used to live in the
// retired Edit-mode inline editor (the inline editor is gone; Edit-mode
// text is edited in the text-properties panel's Text field). Kept as a
// tiny module so the panel, the run preview and the engine stub share
// one rounding rule and one font map.

import type { EditFont } from "../../shared/types";

/** Convert an `EditColor` to a `#rrggbb` string. Centralised so the
 *  input + swatch + live preview all use the same rounding. */
export function colorToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(Math.min(1, Math.max(0, c.r)) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c.g)) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c.b)) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** B5 — the CSS font-family that mirrors a PDF standard font so a live
 *  preview reflects the chosen font immediately. The engine draws
 *  `Times` as Times-Roman and `Courier` as Courier (the PDF
 *  standard-14 families); the preview maps each to the nearest
 *  locally-installed font so picking Times/Courier changes the
 *  on-screen glyphs right away. */
export function fontFamilyFor(font: EditFont): string {
  switch (font) {
    case "Times":
      return '"Times New Roman", Times, serif';
    case "Courier":
      return '"Courier New", Courier, monospace';
    // Phase 27 — the three bundled OFL families. The engine embeds the
    // real subset, so the live mirror names the family first and falls
    // back to the closest installed face.
    case "Liberation Sans":
      return '"Liberation Sans", Arial, sans-serif';
    case "DejaVu Serif":
      return '"DejaVu Serif", Georgia, serif';
    case "DejaVu Sans Mono":
      return '"DejaVu Sans Mono", Consolas, monospace';
    case "Helvetica":
    default:
      return "Helvetica, Arial, sans-serif";
  }
}
