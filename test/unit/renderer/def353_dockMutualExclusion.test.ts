// DEF-353 — the dock's pins and un-pins must be mutually exclusive, so the
// palette's "pinned" icon can never disagree with what the dock is rendering.
//
// A hand-edited / cross-version settings file can hold the same id in BOTH
// `dockPins` and `dockUnpinned`. `sanitizeDockPins` and `sanitizeDockUnpinned`
// alone kept both copies; `isToolPinned` then read `unpinned` for a stage
// default while the dock rendered the explicit pin. The rule enforced here: the
// UN-PIN wins — an id present in both is dropped from `dockPins` and kept in
// `dockUnpinned`.

import { describe, expect, it } from 'vitest';
import { sanitizeDockCuration } from '../../../src/renderer/state/dockModel';

/** The adversarial ADV-093 settings payload. */
const HOSTILE = {
  pins: ['__nope__', 'rotate', 'rotate', 'delete', 'delete', 'annotate', 'sign', 'watermark', 'merge'],
  unpinned: ['merge', 'merge', '__bogus__', 'not-real-tool', 'delete'],
};

describe('DEF-353 — sanitizeDockCuration makes the two stores mutually exclusive', () => {
  it('drops an id from dockPins when it is also in dockUnpinned (un-pin wins)', () => {
    const { pins, unpinned } = sanitizeDockCuration(HOSTILE);
    expect(pins).not.toContain('delete');
    expect(unpinned).toContain('delete');
    expect(pins).toContain('rotate');
    expect(unpinned).not.toContain('rotate');
  });

  it('never leaves an id in both lists for the hostile payload', () => {
    const { pins, unpinned } = sanitizeDockCuration(HOSTILE);
    const overlap = pins.filter((id) => unpinned.includes(id));
    expect(overlap).toEqual([]);
  });

  it('keeps each list registry-valid, deduped and capped', () => {
    const { pins, unpinned } = sanitizeDockCuration(HOSTILE);
    // Phase 58 — the pin cap is 200, so `watermark` is no longer evicted.
    expect(pins).toEqual(['rotate', 'annotate', 'sign', 'watermark']);
    expect(pins.length).toBeLessThanOrEqual(200);
    expect(unpinned).toEqual(['merge', 'delete']);
    expect(unpinned.length).toBeLessThanOrEqual(200);
  });

  it('is deterministic (same input, same output on every read)', () => {
    expect(sanitizeDockCuration(HOSTILE)).toEqual(sanitizeDockCuration(HOSTILE));
  });

  it('agrees with the palette membership for the disputed id', () => {
    const { pins, unpinned } = sanitizeDockCuration(HOSTILE);
    // The host's TRUE-membership predicate: for a focused-stage default it is
    // `!unpinned.includes(id)`, otherwise `pins.includes(id)`.
    const defaultIds = ['delete', 'rotate'];
    const palettePinned = (id: string): boolean =>
      defaultIds.includes(id) ? !unpinned.includes(id) : pins.includes(id);
    // The dock renders a stage default unless it is un-pinned, plus the
    // explicit pins (deduped against the stage set). The disputed id is a
    // stage default in `unpinned`, so the dock does NOT show it.
    const dockShows = (id: string): boolean =>
      (defaultIds.includes(id) && !unpinned.includes(id)) || pins.includes(id);
    expect(palettePinned('delete')).toBe(false);
    expect(dockShows('delete')).toBe(false);
    expect(palettePinned('delete')).toBe(dockShows('delete'));
  });

  it('treats non-array input like the individual sanitizers (empty lists)', () => {
    expect(sanitizeDockCuration({ pins: 'nope', unpinned: 7 })).toEqual({ pins: [], unpinned: [] });
  });
});
