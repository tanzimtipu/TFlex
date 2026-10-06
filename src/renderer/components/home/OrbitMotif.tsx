// Phase 106 (chunk B) — the Orbit Desk decorative motif.
//
// A thin, low-opacity violet/amber arc layer derived from the brand mark's
// circular geometry ("thin open concentric arcs at the edge of the home
// header", Home design spec). It is purely decorative:
//
//   - the wrapper is `aria-hidden` and `pointer-events: none`, so screen
//     readers and clicks never touch it;
//   - only `transform` animates, on this small layer, via the shared
//     `--motion-duration-orbit` (18s) / `--motion-orbit-swing` (20deg) tokens;
//   - the caller passes the already-resolved `active` flag (useOrbitMotion),
//     so reduced motion, Animations OFF, document visibility and window
//     minimise/blur all hold it at its static pose.
//
// It renders no SVG on purpose: the arcs are CSS conic-gradient rings masked
// to a 2px stroke (the approved preview's technique), which keeps the layer
// compositor-cheap and free of any animated filter or canvas redraw.

import type { ReactElement } from "react";

export interface OrbitMotifProps {
  /** True while the ambient drift is allowed (resolved through the full
   *  motion policy). False pins the motif to its attractive static pose. */
  active: boolean;
}

export function OrbitMotif({ active }: OrbitMotifProps): ReactElement {
  return (
    <div className="orbit-desk-motif" aria-hidden="true" data-orbit-motif>
      <div
        className="orbit-desk-orbit"
        data-orbit-motion={active ? "on" : "off"}
      >
        <div className="orbit-desk-orbit-inner" />
      </div>
    </div>
  );
}
