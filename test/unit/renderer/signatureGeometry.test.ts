// @vitest-environment node
// Signature placement geometry tests.
//
// The functions in src/renderer/signatures/model.ts are pure,
// DOM-free, and exercise the move / resize / clamp math the
// SignaturesOverlay runs on every pointer event.

import { describe, expect, it } from "vitest";
import {
  clampPlacementToPage,
  defaultPlacementRect,
  defaultSignatureLabel,
  movePlacement,
  replacePlacements,
  resizePlacement,
  signatureIsEmpty,
  signatureLabel,
} from "../../../src/renderer/signatures/model";
import type { SavedSignature } from "../../../src/shared/types";

describe("movePlacement", () => {
  it("translates the rect by the supplied delta", () => {
    const next = movePlacement({ x: 10, y: 20, width: 100, height: 30 }, { x: 5, y: -3 });
    expect(next).toEqual({ x: 15, y: 17, width: 100, height: 30 });
  });

  it("preserves width and height", () => {
    const before = { x: 0, y: 0, width: 200, height: 50 };
    const after = movePlacement(before, { x: 100, y: 100 });
    expect(after.width).toBe(200);
    expect(after.height).toBe(50);
  });

  it("accepts negative deltas (drag up/left)", () => {
    const next = movePlacement({ x: 50, y: 60, width: 100, height: 40 }, { x: -10, y: -20 });
    expect(next).toEqual({ x: 40, y: 40, width: 100, height: 40 });
  });
});

describe("resizePlacement", () => {
  const start = { x: 100, y: 100, width: 200, height: 100 };

  it("'se' grows the rect by the delta (positive)", () => {
    const next = resizePlacement(start, "se", { x: 50, y: 30 });
    expect(next.width).toBe(250);
    expect(next.height).toBe(130);
    // x, y unchanged for se handle.
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
  });

  it("'nw' shrinks and moves the top-left corner", () => {
    const next = resizePlacement(start, "nw", { x: 30, y: 20 });
    expect(next.width).toBe(170);
    expect(next.height).toBe(80);
    expect(next.x).toBe(130);
    expect(next.y).toBe(120);
  });

  it("'ne' moves the top edge and grows width + height", () => {
    const next = resizePlacement(start, "ne", { x: 50, y: 20 });
    expect(next.width).toBe(250);
    expect(next.height).toBe(80);
    expect(next.x).toBe(100); // x unchanged for ne handle
    expect(next.y).toBe(120); // top moved DOWN (delta.y < 0 reduces height, so y moves toward start.y)
  });

  it("'sw' moves the left edge and grows width", () => {
    const next = resizePlacement(start, "sw", { x: 30, y: 40 });
    expect(next.width).toBe(170);
    expect(next.height).toBe(140);
    expect(next.x).toBe(130);
    expect(next.y).toBe(100); // y unchanged for sw
  });

  it("clamps width to MIN (12) when dragged inward (se handle)", () => {
    const next = resizePlacement(start, "se", { x: -300, y: -300 });
    expect(next.width).toBe(12);
    expect(next.height).toBe(12);
  });

  it("clamps height without affecting width when the handle is on the top edge (ne handle, vertical only)", () => {
    // ne handle with delta.y=+300: height shrinks by 300 (100 -> -200),
    // which gets clamped to MIN (12). The top of the rect then slides
    // down to keep the bottom edge anchored: y = 100 + (100 - 12) = 188.
    // Width is unchanged because delta.x = 0.
    const next = resizePlacement(start, "ne", { x: 0, y: 300 });
    expect(next.height).toBe(12);
    expect(next.width).toBe(200); // unchanged
    // Bottom edge must remain anchored at start.y + start.height = 200.
    expect(next.y + next.height).toBe(200);
  });
});

describe("clampPlacementToPage", () => {
  const pageW = 612;
  const pageH = 792;

  it("returns the rect unchanged when fully inside the page", () => {
    const rect = clampPlacementToPage({ x: 50, y: 50, width: 100, height: 40 }, pageW, pageH);
    expect(rect).toEqual({ x: 50, y: 50, width: 100, height: 40 });
  });

  it("clamps negative x to 0", () => {
    const rect = clampPlacementToPage({ x: -10, y: 0, width: 100, height: 40 }, pageW, pageH);
    expect(rect.x).toBe(0);
  });

  it("clamps negative y to 0", () => {
    const rect = clampPlacementToPage({ x: 0, y: -10, width: 100, height: 40 }, pageW, pageH);
    expect(rect.y).toBe(0);
  });

  it("clamps to right edge so width fits the page", () => {
    const rect = clampPlacementToPage({ x: 600, y: 0, width: 100, height: 40 }, pageW, pageH);
    // x = pageW - width = 612 - 100 = 512
    expect(rect.x).toBe(512);
  });

  it("clamps to bottom edge so height fits the page", () => {
    const rect = clampPlacementToPage({ x: 0, y: 800, width: 100, height: 40 }, pageW, pageH);
    expect(rect.y).toBe(752);
  });

  it("does not change width or height", () => {
    const rect = clampPlacementToPage({ x: -50, y: -50, width: 100, height: 40 }, pageW, pageH);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(40);
  });
});

describe("defaultPlacementRect", () => {
  it("produces a 100x36pt rect anchored at the given point", () => {
    expect(defaultPlacementRect({ x: 50, y: 100 })).toEqual({
      x: 50,
      y: 100,
      width: 100,
      height: 36,
    });
  });
});

describe("replacePlacements", () => {
  it("returns a fresh array (no aliasing of the input)", () => {
    const input = [
      { id: "a", signatureId: "s1", page: 1, rect: { x: 0, y: 0, width: 10, height: 10 }, pngBytes: new Uint8Array() },
    ];
    const out = replacePlacements(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});

describe("signatureIsEmpty", () => {
  const drawn = (points: { x: number; y: number }[][]): SavedSignature => ({
    id: "x",
    label: "x",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: { kind: "drawn", points, width: 360, height: 120 },
  });
  const typed = (text: string): SavedSignature => ({
    id: "x",
    label: "x",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: { kind: "typed", text, width: 480, height: 140 },
  });

  it("returns true for an empty drawn signature (no strokes)", () => {
    expect(signatureIsEmpty(drawn([]))).toBe(true);
  });
  it("returns true for a drawn signature with only empty strokes", () => {
    expect(signatureIsEmpty(drawn([[]]))).toBe(true);
  });
  it("returns false for a drawn signature with at least one point", () => {
    expect(signatureIsEmpty(drawn([[{ x: 1, y: 2 }]]))).toBe(false);
  });
  it("returns true for a typed signature with whitespace-only text", () => {
    expect(signatureIsEmpty(typed("   "))).toBe(true);
  });
  it("returns false for a typed signature with content", () => {
    expect(signatureIsEmpty(typed("John"))).toBe(false);
  });
});

describe("signatureLabel", () => {
  it("returns the typed text trimmed for typed signatures", () => {
    const sig: SavedSignature = {
      id: "x",
      label: "fallback",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: { kind: "typed", text: "  Jane Doe ", width: 480, height: 140 },
    };
    expect(signatureLabel(sig)).toBe("Jane Doe");
  });
  it("falls back to the stored label for typed signatures with empty text", () => {
    const sig: SavedSignature = {
      id: "x",
      label: "My Sig",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: { kind: "typed", text: "  ", width: 480, height: 140 },
    };
    expect(signatureLabel(sig)).toBe("My Sig");
  });
  it("returns the stored label for drawn signatures", () => {
    const sig: SavedSignature = {
      id: "x",
      label: "Signature 3",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: { kind: "drawn", points: [[]], width: 360, height: 120 },
    };
    expect(signatureLabel(sig)).toBe("Signature 3");
  });
});

describe("defaultSignatureLabel", () => {
  it("returns the typed text for typed signatures", () => {
    expect(
      defaultSignatureLabel({ kind: "typed", text: "John Doe", width: 480, height: 140 }, 0),
    ).toBe("John Doe");
  });
  it("truncates long typed text to 32 chars", () => {
    const long = "A".repeat(50);
    expect(defaultSignatureLabel({ kind: "typed", text: long, width: 480, height: 140 }, 0))
      .toBe("A".repeat(32) + "…");
  });
  it("returns 'Signature N' (1-based) for drawn signatures", () => {
    expect(defaultSignatureLabel({ kind: "drawn", points: [], width: 360, height: 120 }, 0))
      .toBe("Signature 1");
    expect(defaultSignatureLabel({ kind: "drawn", points: [], width: 360, height: 120 }, 4))
      .toBe("Signature 5");
  });
});
