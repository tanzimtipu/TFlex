// @vitest-environment jsdom
//
// DEF-227 (ADV-046) — the annotation tools menu dismiss is a ONE-SHOT
// guard: the outside-dismiss pointerdown is marked, the page overlay
// consumes exactly that native event, and every other pointerdown
// passes through. These tests pin the guard in isolation; the overlay
// wiring is covered by the renderer suite and qa's e2e.

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearMenuDismissPointer,
  consumeMenuDismissPointer,
  markMenuDismissPointer,
} from "../../../src/renderer/annotations/menuDismissGuard";

describe("menu dismiss one-shot guard (DEF-227 / ADV-046)", () => {
  beforeEach(() => {
    clearMenuDismissPointer();
  });

  it("consumes the marked pointerdown exactly once", () => {
    const dismissing = new Event("pointerdown");
    markMenuDismissPointer(dismissing);
    expect(consumeMenuDismissPointer(dismissing)).toBe(true);
    // A second check on the same event (e.g. a re-dispatch) must not
    // be consumed again.
    expect(consumeMenuDismissPointer(dismissing)).toBe(false);
  });

  it("lets a different pointerdown through (no stale swallow)", () => {
    const dismissing = new Event("pointerdown");
    const laterGesture = new Event("pointerdown");
    markMenuDismissPointer(dismissing);
    // A non-matching event is never consumed and does not clear the
    // mark (the dismissing event may not reach the overlay, e.g. a
    // CommandBar button click).
    expect(consumeMenuDismissPointer(laterGesture)).toBe(false);
    expect(consumeMenuDismissPointer(dismissing)).toBe(true);
    // The NEXT page pointerdown is a real gesture.
    expect(consumeMenuDismissPointer(laterGesture)).toBe(false);
  });

  it("consumes nothing when no dismiss happened", () => {
    expect(consumeMenuDismissPointer(new Event("pointerdown"))).toBe(false);
  });
});
