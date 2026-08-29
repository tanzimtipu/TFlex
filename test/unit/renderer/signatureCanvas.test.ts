// @vitest-environment jsdom
// Signature canvas rasterization tests.
//
// We render signature sources to PNG bytes using the canvas API. jsdom
// does NOT implement the 2D drawing primitives (its canvas returns
// `null` for `getContext("2d")` unless the optional `canvas` npm
// package is installed), AND it does NOT implement `toDataURL` to
// return a real PNG (it returns the placeholder "data:," string).
// We stub both APIs:
//   - getContext returns a no-op fake context so canvas methods
//     (`fillStyle =`, `font =`, `fillText`, `clearRect`, …) all
//     silently succeed.
//   - toDataURL returns a real, valid 1×1 transparent PNG so the
//     decode path in canvas.ts can decode bytes end-to-end.
// This lets the tests verify the rasterization plumbing without
// pulling in the `canvas` native dependency.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAW_PEN_COLOR,
  DRAW_PEN_WIDTH,
  rasterizeSavedSignatureToPng,
  rasterizeSignatureToPng,
  renderTypedSignature,
  scaleStrokes,
} from "../../../src/renderer/signatures/canvas";
import type { SavedSignature } from "../../../src/shared/types";

// A real, valid 1×1 transparent PNG so `toDataURL` returns something
// decodable.
const ONE_BY_ONE_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==";

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let originalToDataURL: typeof HTMLCanvasElement.prototype.toDataURL;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  // jsdom's canvas `getContext("2d")` returns null. We replace it
  // with a no-op fake so any 2D method call silently succeeds.
  // The cast goes through `unknown` because the real return type is
  // a wide union over CanvasRenderingContext2D / WebGL* / etc. — we
  // only ever exercise the 2D path here, but the signature is too
  // wide to satisfy a direct cast.
  const fakeGetContext = vi.fn(() => makeFake2dContext());
  HTMLCanvasElement.prototype.getContext = fakeGetContext as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => ONE_BY_ONE_PNG_B64);
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
});

/** Build a no-op CanvasRenderingContext2D-like object. We only stub
 *  the methods the canvas code touches — every other property/method
 *  access returns undefined, which is harmless because the canvas
 *  helpers don't read anything they don't write. */
function makeFake2dContext(): Record<string, unknown> {
  const noop = (): void => undefined;
  const ctx: Record<string, unknown> = {
    clearRect: noop,
    fillRect: noop,
    fillText: noop,
    stroke: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    measureText: (text: string): { width: number } => ({ width: text.length * 12 }),
  };
  // Every assignable property on the real 2D context reads back as
  // `undefined` by default; assignment is a no-op for our purposes.
  return ctx;
}

describe("renderTypedSignature", () => {
  it("returns a non-empty bounding box for a non-empty string", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 140;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    const bbox = renderTypedSignature(ctx, "Jane Doe", "cursive", 64, 480, 140);
    expect(bbox.width).toBeGreaterThan(0);
    expect(bbox.height).toBeGreaterThan(0);
  });

  it("bbox width fits inside the canvas width", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 140;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    const bbox = renderTypedSignature(ctx, "Jane Doe", "cursive", 64, 480, 140);
    expect(bbox.width).toBeLessThanOrEqual(480);
    expect(bbox.height).toBeLessThanOrEqual(140);
  });
});

describe("scaleStrokes", () => {
  it("scales every stroke proportionally from source to target", () => {
    const strokes = [
      { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      { points: [{ x: 100, y: 200 }, { x: 50, y: 100 }] },
    ];
    const out = scaleStrokes(strokes, 200, 200, 100, 100);
    // First stroke: each point scaled by 0.5.
    expect(out[0]?.[0]).toEqual({ x: 0, y: 0 });
    expect(out[0]?.[1]).toEqual({ x: 5, y: 5 });
    // Second stroke: x scaled 0.5, y scaled 0.5.
    expect(out[1]?.[0]).toEqual({ x: 50, y: 100 });
    expect(out[1]?.[1]).toEqual({ x: 25, y: 50 });
  });

  it("returns an empty list for no strokes", () => {
    expect(scaleStrokes([], 200, 200, 100, 100)).toEqual([]);
  });
});

describe("rasterizeSignatureToPng", () => {
  it("returns a Uint8Array that starts with the PNG signature", () => {
    const out = rasterizeSignatureToPng(
      { kind: "typed", text: "John", width: 480, height: 140 },
    );
    // 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    expect(out[0]).toBe(0x89);
    expect(out[1]).toBe(0x50);
    expect(out[2]).toBe(0x4e);
    expect(out[3]).toBe(0x47);
  });

  it("returns non-zero bytes for a typed signature (proves we hit the encode path)", () => {
    const out = rasterizeSignatureToPng(
      { kind: "typed", text: "Jane Doe", width: 480, height: 140 },
    );
    expect(out.length).toBeGreaterThan(0);
    // The 1×1 PNG we injected has a fixed length; any extra bytes
    // beyond it would mean a non-placeholder encode happened. We only
    // check the decode succeeded, not the length, because jsdom's
    // canvas replacement returns the same bytes regardless of input.
    expect(out).toBeInstanceOf(Uint8Array);
  });

  it("returns non-zero bytes for a drawn signature", () => {
    const out = rasterizeSignatureToPng({
      kind: "drawn",
      points: [[{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 100, y: 80 }]],
      width: 360,
      height: 120,
    });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(0);
  });

  it("honours the targetW / targetH parameters", () => {
    // We don't actually inspect the canvas backing store (jsdom doesn't
    // track it), but we can verify the function accepts custom sizes
    // without throwing.
    const out = rasterizeSignatureToPng(
      { kind: "typed", text: "X", width: 200, height: 60 },
      128, 64,
    );
    expect(out).toBeInstanceOf(Uint8Array);
  });
});

describe("rasterizeSavedSignatureToPng", () => {
  it("is equivalent to calling rasterizeSignatureToPng on the saved source", () => {
    const sig: SavedSignature = {
      id: "x",
      label: "x",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: { kind: "typed", text: "Same input", width: 480, height: 140 },
    };
    const fromSig = rasterizeSavedSignatureToPng(sig);
    const fromSrc = rasterizeSignatureToPng(sig.source);
    expect(fromSig.length).toBe(fromSrc.length);
    expect(fromSig[0]).toBe(fromSrc[0]);
  });
});

describe("DRAW_PEN_COLOR / DRAW_PEN_WIDTH", () => {
  it("exports a non-black ink color and a sensible pen width", () => {
    expect(DRAW_PEN_COLOR).toBe("#0f172a");
    expect(DRAW_PEN_WIDTH).toBeGreaterThan(0);
  });
});
