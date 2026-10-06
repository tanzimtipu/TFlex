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

// ---------------------------------------------------------------------------
// Phase 105 (chunk B) — PER-SESSION TAB IDENTITY.
//
// The Phase-45/51/72 colour above is derived from the tab's POSITION in the
// strip (a 4-slot cycle). That is the exact anti-pattern Phase 105 removes:
// closing or reordering a tab re-flows every other tab's colour. The identity
// model below instead gives every SESSION a stable `colorId`, minted once at
// session creation, carried on `TabMeta` and preserved through reorder/rename/
// fill. Colour is a property of the session, never of the current index.
//
// Source of truth for the ids and hues is the committed design token file
// `Visual overhaul/Design System/tab-identity.tokens.json` (12 ids:
// violet/ocean/terracotta/jade/rose/indigo/ochre/olive/orchid/lagoon/
// raspberry/iris). This module owns only the allocation rule; styles.css maps
// each id to its `--tf-tab-identity-<id>` token in light and dark.
// ---------------------------------------------------------------------------

/** The twelve stable session-identity ids, in allocation order. Matches the
 *  `palette` array of `tab-identity.tokens.json` exactly. */
export const IDENTITY_PALETTE = [
  "violet",
  "ocean",
  "terracotta",
  "jade",
  "rose",
  "indigo",
  "ochre",
  "olive",
  "orchid",
  "lagoon",
  "raspberry",
  "iris",
] as const;

/** A canonical palette id (one of the twelve). */
export type IdentityColorId = (typeof IDENTITY_PALETTE)[number];

/** How many distinct canonical ids the identity palette offers. */
export const IDENTITY_PALETTE_SIZE = IDENTITY_PALETTE.length;

/** Allocate the identity for a NEW session.
 *
 *  Unused-first: return the first palette id not present in `used`. When every
 *  canonical id is taken, return a contrast-checked EXTENDED variant of the
 *  first id with a textual disambiguator suffix (e.g. `violet-2`), skipping any
 *  suffix already in `used`. The extended variant reuses the violet hue, whose
 *  contrast pairings are already verified by the token file; the suffix keeps
 *  it textually distinct from a canonical id's `data-tab-color-id` and is never
 *  an empty string.
 *
 *  `used` is the colorIds currently held by open sessions - never a strip
 *  index. Existing sessions are never recoloured to free a slot; callers only
 *  ever allocate for a brand-new session or a brand-new empty tab. */
export function allocateColorId(used: readonly string[]): string {
  const taken = new Set(used);
  for (const id of IDENTITY_PALETTE) {
    if (!taken.has(id)) return id;
  }
  const base = IDENTITY_PALETTE[0];
  let n = 2;
  let candidate = `${base}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}
