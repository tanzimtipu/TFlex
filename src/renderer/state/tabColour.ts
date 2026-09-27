// Phase 45 (item 2 / feature C) — DISTINCT TAB COLOURS.
//
// Every open document tab carries its own colour, visibly distinct from its
// neighbours, in all three themes. The colour is chosen by the tab's position
// in the strip from a FIXED palette of the app's declared semantic roles
// (styles.css maps slot -> token; this module owns only the assignment rule).
//
// The rule is a plain cycle: slot = index mod PALETTE_SIZE. Because the
// palette has more than one entry, two ADJACENT tabs always land on
// consecutive slots and therefore never collide. Closing a tab re-flows the
// remaining indices, so adjacency is still guaranteed after a close (the tabs
// to the right of the closed one shift slot by one, which is exactly what
// keeps neighbour-pairs distinct).
//
// The DIAGNOSIS (why the old tabs looked identical): every `.tab` painted
// `--bg-tab`, which is `transparent` in all three themes — the only colour
// signal was the shared `--accent` underline on the ACTIVE tab. Nothing was
// per-tab. This module + the `.tab[data-tab-colour]` rules are that missing
// per-tab colour.

/** How many distinct hues the tab palette offers. Must stay >= 2 so a cycle
 *  can never place the same hue on two neighbours. The CSS maps each slot
 *  to a declared semantic token (`.tab[data-tab-colour="N"]`). */
export const TAB_COLOUR_PALETTE_SIZE = 4;

/** The palette slot for a tab at strip `index` (0-based). Negative or
 *  non-finite indices collapse to slot 0 so a bad call can never paint a
 *  tab with an undefined colour. Two ADJACENT indices always differ because
 *  `PALETTE_SIZE >= 2` and the modulo wraps by one. */
export function tabColourSlot(index: number): number {
  if (!Number.isFinite(index)) return 0;
  const size = TAB_COLOUR_PALETTE_SIZE;
  return ((Math.trunc(index) % size) + size) % size;
}

/** The declared semantic token each slot resolves to. Exported so the
 *  assignment can be asserted without a browser: slot 0 -> PRIMARY (blue),
 *  1 -> ATTENTION (red), 2 -> AFFIRMATIVE (green), 3 -> NEUTRAL (slate).
 *  Adjacent pairs are (blue,red) (red,green) (green,slate) (slate,blue) —
 *  every pair is strongly distinguishable in light, dark and frosted. */
export const TAB_COLOUR_TOKENS = [
  "--sem-primary",
  "--sem-attention",
  "--sem-affirmative",
  "--sem-neutral",
] as const;

/** True when two strip positions land on different palette slots. The one
 *  invariant the fix must hold: neighbours never collide. */
export function tabColoursDiffer(a: number, b: number): boolean {
  return tabColourSlot(a) !== tabColourSlot(b);
}
