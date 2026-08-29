// @vitest-environment jsdom
// Phase 10 — renderer-side image rasterization tests.
//
// The image-edit overlay produces the bytes the engine embeds via
// its own canvas pipeline (the engine only composites; the renderer
// does the crop / resize transform). The functions under test
// accept a `decoder` and `encoder` dependency so the tests don't
// have to bring up a real canvas — they pass stubs that record
// the arguments and return synthetic bytes. The pure-geometry
// concerns (pixel-size calculation, format detection, decode /
// encode wiring) are what we exercise here.
//
// We still have to stub jsdom's `HTMLCanvasElement.getContext`,
// which returns `null` (jsdom has no 2D context implementation).
// The stub returns a no-op fake context so the helpers' getContext
// call lands on a non-null object. The actual drawing surface
// behaviour is exercised via the `decoder` / `encoder` stubs
// passed to the helpers, so the canvas's drawing state is
// irrelevant for these tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cropImageToBytes,
  defaultImageDecoder,
  defaultImageEncoder,
  detectImageFormat,
  facadeFromImage,
  rectToPixelSize,
  resizeImageToBytes,
  type DecodedImage,
} from "../../../src/renderer/edit/rasterize";

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  // jsdom's canvas.getContext("2d") returns null. We replace it
  // with a no-op fake so the rasterize helpers' getContext call
  // lands on a non-null object. The fake supports only the
  // properties the helpers read or write: fillStyle, fillRect,
  // drawImage.
  const fakeGetContext = vi.fn(() => makeFake2dContext());
  HTMLCanvasElement.prototype.getContext = fakeGetContext as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function makeFake2dContext(): Record<string, unknown> {
  const noop = (): void => undefined;
  return {
    fillStyle: "",
    fillRect: noop,
    drawImage: noop,
  };
}

describe("detectImageFormat", () => {
  it("identifies PNG bytes from the signature", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectImageFormat(png)).toBe("png");
  });

  it("identifies JPEG bytes from the signature", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageFormat(jpg)).toBe("jpeg");
  });

  it("returns 'unknown' for bytes that are neither PNG nor JPEG", () => {
    const txt = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // 'GIF89a'
    expect(detectImageFormat(txt)).toBe("unknown");
  });

  it("returns 'unknown' for too-short input", () => {
    expect(detectImageFormat(new Uint8Array([]))).toBe("unknown");
    expect(detectImageFormat(new Uint8Array([0x89]))).toBe("unknown");
  });
});

describe("rectToPixelSize", () => {
  it("scales a page-point rect to pixel dimensions at 72 DPI", () => {
    const size = rectToPixelSize({ x: 0, y: 0, width: 100, height: 50 });
    expect(size).toEqual({ width: 100, height: 50 });
  });

  it("scales by the DPI ratio (150 DPI -> 100pt => 208px)", () => {
    const size = rectToPixelSize({ x: 0, y: 0, width: 100, height: 100 }, 150);
    expect(size.width).toBe(208);
    expect(size.height).toBe(208);
  });

  it("always returns at least 1px so an empty rect still encodes", () => {
    const size = rectToPixelSize({ x: 0, y: 0, width: 0, height: 0 });
    expect(size.width).toBe(1);
    expect(size.height).toBe(1);
  });
});

describe("cropImageToBytes", () => {
  /** A tiny stub decoder that returns a fixed-size image whose
   *  pixels are 1:1 with the source rect. The tests assert the
   *  output bytes have the right pixel dimensions. */
  function makeStubDecoder(width: number, height: number): (bytes: Uint8Array) => Promise<DecodedImage> {
    return async (): Promise<DecodedImage> => ({
      width,
      height,
      draw: (): void => undefined,
    });
  }

  it("produces bytes whose pixel size matches the crop rect (default 72 DPI)", async () => {
    const encoder = jestEncoder({ bytes: new Uint8Array([1, 2, 3]) });
    const out = await cropImageToBytes({
      sourceBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      imageRect: { x: 0, y: 0, width: 200, height: 100 },
      crop: { x: 50, y: 25, width: 100, height: 50 },
      decoder: makeStubDecoder(200, 100),
      encoder,
    });
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
    // The encoder was called with a canvas matching the crop's
    // pixel size. We check the last canvas's size below.
    const canvas = encoder.lastCanvas();
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(100);
    expect(canvas?.height).toBe(50);
  });

  it("respects the dpi argument when scaling the crop to pixels", async () => {
    const encoder = jestEncoder({ bytes: new Uint8Array([0]) });
    await cropImageToBytes({
      sourceBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      imageRect: { x: 0, y: 0, width: 100, height: 100 },
      crop: { x: 0, y: 0, width: 100, height: 100 },
      dpi: 150,
      decoder: makeStubDecoder(100, 100),
      encoder,
    });
    const canvas = encoder.lastCanvas();
    expect(canvas?.width).toBe(208);
    expect(canvas?.height).toBe(208);
  });

  it("calls decoder once with the source bytes", async () => {
    const calls: Uint8Array[] = [];
    const decoder = async (b: Uint8Array): Promise<DecodedImage> => {
      calls.push(b);
      return { width: 1, height: 1, draw: (): void => undefined };
    };
    const encoder = jestEncoder({ bytes: new Uint8Array([0]) });
    const source = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await cropImageToBytes({
      sourceBytes: source,
      imageRect: { x: 0, y: 0, width: 1, height: 1 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
      decoder,
      encoder,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(source);
  });
});

describe("resizeImageToBytes", () => {
  it("produces a canvas sized to the target rect at 72 DPI", async () => {
    const encoder = jestEncoder({ bytes: new Uint8Array([9, 8, 7]) });
    const decoder = async (): Promise<DecodedImage> => ({
      width: 200,
      height: 100,
      draw: (): void => undefined,
    });
    const out = await resizeImageToBytes({
      sourceBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      target: { x: 0, y: 0, width: 80, height: 40 },
      decoder,
      encoder,
    });
    expect(out).toEqual(new Uint8Array([9, 8, 7]));
    const canvas = encoder.lastCanvas();
    expect(canvas?.width).toBe(80);
    expect(canvas?.height).toBe(40);
  });

  it("draws the decoded image at the full source rect into the new canvas", async () => {
    let lastDraw: { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } | null = null;
    const decoder = async (): Promise<DecodedImage> => ({
      width: 200,
      height: 100,
      draw: (_ctx, sx, sy, sw, sh, dx, dy, dw, dh): void => {
        lastDraw = { sx, sy, sw, sh, dx, dy, dw, dh };
      },
    });
    const encoder = jestEncoder({ bytes: new Uint8Array([0]) });
    await resizeImageToBytes({
      sourceBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      target: { x: 0, y: 0, width: 50, height: 50 },
      decoder,
      encoder,
    });
    expect(lastDraw).toEqual({
      sx: 0,
      sy: 0,
      sw: 200,
      sh: 100,
      dx: 0,
      dy: 0,
      dw: 50,
      dh: 50,
    });
  });
});

describe("facadeFromImage", () => {
  it("captures naturalWidth / naturalHeight (with fallback to width/height)", () => {
    const facade = facadeFromImage({ naturalWidth: 100, naturalHeight: 50, width: 0, height: 0 } as unknown as HTMLImageElement);
    expect(facade.width).toBe(100);
    expect(facade.height).toBe(50);
  });

  it("falls back to width/height when naturalWidth/Height are zero", () => {
    const facade = facadeFromImage({ naturalWidth: 0, naturalHeight: 0, width: 80, height: 60 } as unknown as HTMLImageElement);
    expect(facade.width).toBe(80);
    expect(facade.height).toBe(60);
  });
});

describe("defaultImageEncoder / defaultImageDecoder (smoke)", () => {
  it("defaultImageEncoder returns a function", () => {
    expect(typeof defaultImageEncoder()).toBe("function");
  });

  it("defaultImageDecoder returns a function", () => {
    expect(typeof defaultImageDecoder()).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Test helpers

/** A recording stub for the encoder. Captures the most-recent
 *  canvas so the test can assert the pixel dimensions the
 *  crop/resize helper wrote into. The returned bytes are the
 *  caller-supplied value. */
function jestEncoder(opts: { bytes: Uint8Array }): {
  (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array>;
  lastCanvas: () => OffscreenCanvas | HTMLCanvasElement | null;
  callCount: () => number;
} {
  let captured: OffscreenCanvas | HTMLCanvasElement | null = null;
  let count = 0;
  const fn = async (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> => {
    captured = canvas;
    count += 1;
    return opts.bytes;
  };
  Object.assign(fn, {
    lastCanvas: (): OffscreenCanvas | HTMLCanvasElement | null => captured,
    callCount: (): number => count,
  });
  return fn as unknown as {
    (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array>;
    lastCanvas: () => OffscreenCanvas | HTMLCanvasElement | null;
    callCount: () => number;
  };
}
