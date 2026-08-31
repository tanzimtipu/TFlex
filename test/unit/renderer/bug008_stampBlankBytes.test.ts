// @vitest-environment jsdom
//
// Bug 8 (DEF-063) — `renderStampToPng` must produce a real drawn
// PNG canvas (text + border composited) before base64-encoding the
// bytes. In some Chromium / Electron configurations, the encode
// silently fails (canvas.toDataURL returns `"data:image/png;base64,"`)
// and the engine receives a `pngBytes: []` stamp which it bakes as
// a blank rectangle into the page. The dialog already catches this
// via its PNG magic + size check, but the stamp renderer itself
// must:
//   1. Set `canvas.width` / `canvas.height` BEFORE accessing the
//      2D context (some Chromium builds return a broken context when
//      pixel dimensions aren't set up front).
//   2. After drawing, validate the canvas isn't fully transparent
//      by sampling pixels at the centre. If it IS, fall through to
//      the same 1x1 transparent PNG fallback the `getContext === null`
//      branch already uses — the dialog then surfaces a friendly
//      error rather than embedding a no-op stamp.
//   3. Validate the encoded base64 isn't empty before handing bytes
//      to the engine. An empty encode is degenerate; the same 1x1
//      fallback applies.
//
// These tests polyfill the jsdom canvas the way the existing
// stampRender.test.ts does, but ADD a "blank canvas" mode
// (getImageData returns all-zero alpha) to exercise the new
// fallback paths.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAMP_ID,
  STAMP_CANVAS_H,
  STAMP_CANVAS_W,
  renderStampToPng,
} from "../../../src/renderer/annotations/stampRender";

interface PolyfillState {
  /** The value `canvas.toDataURL` returns. The renderer decodes
   *  this to Uint8Array bytes. Empty string simulates a Chromium
   *  silent-encode failure. */
  toDataURL: string;
  /** The alpha value `getImageData` reports across the sampled
   *  patch. 255 = opaque pixels (draw landed); 0 = fully
   *  transparent (silent-draw failure). */
  alpha: number;
  /** Whether to throw on getImageData (tainted / detached canvas). */
  throwOnGetImageData: boolean;
}

const polyfillState: PolyfillState = {
  toDataURL:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  alpha: 255,
  throwOnGetImageData: false,
};

interface StubContext {
  fillRect: () => void;
  clearRect: () => void;
  beginPath: () => void;
  rect: () => void;
  fill: () => void;
  stroke: () => void;
  fillText: () => void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  /** Returns an ImageData whose alpha channel is governed by
   *  polyfillState.alpha. The renderer reads this to detect
   *  silent-draw failures. */
  getImageData: (x: number, y: number, w: number, h: number) => ImageData;
}

function makeStubContext(): StubContext {
  // The renderer calls a small, fixed set of methods on the 2D
  // context. Anything else is a no-op so the renderer doesn't crash.
  const noop = (): void => undefined;
  return {
    fillRect: noop,
    clearRect: noop,
    beginPath: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillText: noop,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "",
    textBaseline: "",
    getImageData: (
      _x: number,
      _y: number,
      w: number,
      h: number,
    ): ImageData => {
      if (polyfillState.throwOnGetImageData) {
        throw new Error("simulated SecurityError on getImageData");
      }
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 3; i < data.length; i += 4) {
        data[i] = polyfillState.alpha;
      }
      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    },
  };
}

function installPolyfills(): void {
  (HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  }).getContext = function getContextStub(): unknown {
    return makeStubContext();
  };
  (HTMLCanvasElement.prototype as unknown as {
    toDataURL: (type?: string) => string;
  }).toDataURL = function toDataURLStub(): string {
    return polyfillState.toDataURL;
  };
}

function isBlank1x1Png(bytes: Uint8Array): boolean {
  // The fallback PNG is a known 67-byte 1x1 transparent blob. We
  // check the leading PNG magic (89 50 4E 47) which is a minimum
  // signature that distinguishes the fallback from arbitrary bytes.
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

describe("renderStampToPng — Bug 8 (DEF-063) blank-canvas fallback", () => {
  it("sets canvas pixel-buffer dimensions BEFORE accessing the 2D context", () => {
    // Pin the rendering order: `canvas.width` / `canvas.height` are
    // assigned before `getContext` is called. jsdom doesn't enforce
    // Chromium's broken-context-on-undimensioned-canvas behaviour,
    // but we record the values for the test's own assertions and
    // pin the contract so a future refactor doesn't reorder the
    // setup (which would regress real-Chromium builds).
    installPolyfills();
    polyfillState.toDataURL =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    polyfillState.alpha = 255;
    polyfillState.throwOnGetImageData = false;

    let widthSetBeforeGetContext: number | null = null;
    let heightSetBeforeGetContext: number | null = null;
    const originalGetContext = (HTMLCanvasElement.prototype as unknown as {
      getContext: (kind: string) => unknown;
    }).getContext;
    (HTMLCanvasElement.prototype as unknown as {
      getContext: (kind: string) => unknown;
    }).getContext = function spyGetContext(): unknown {
      // Snapshot the canvas pixel-buffer dims at the moment the
      // context is requested. They MUST be non-zero — the renderer
      // sets them before the getContext call.
      const c = this as unknown as { width: number; height: number };
      widthSetBeforeGetContext = c.width;
      heightSetBeforeGetContext = c.height;
      return makeStubContext();
    };
    try {
      const out = renderStampToPng(DEFAULT_STAMP_ID);
      expect(out.pngBytes.byteLength).toBeGreaterThan(0);
      expect(widthSetBeforeGetContext).toBe(STAMP_CANVAS_W);
      expect(heightSetBeforeGetContext).toBe(STAMP_CANVAS_H);
    } finally {
      (HTMLCanvasElement.prototype as unknown as {
        getContext: (kind: string) => unknown;
      }).getContext = originalGetContext;
    }
  });

  it("returns real drawn bytes when the canvas has visible pixels", () => {
    // Happy path: the polyfilled context + toDataURL produce a
    // non-empty base64 with valid PNG magic. The renderer should
    // hand back non-blank bytes at the declared canvas dimensions.
    installPolyfills();
    polyfillState.toDataURL =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    polyfillState.alpha = 255;
    polyfillState.throwOnGetImageData = false;

    const out = renderStampToPng(DEFAULT_STAMP_ID);
    expect(out.pngBytes.byteLength).toBeGreaterThan(0);
    expect(out.width).toBe(STAMP_CANVAS_W);
    expect(out.height).toBe(STAMP_CANVAS_H);
    // PNG magic — the bytes start with the standard PNG signature.
    expect(out.pngBytes[0]).toBe(0x89);
    expect(out.pngBytes[1]).toBe(0x50);
    expect(out.pngBytes[2]).toBe(0x4e);
    expect(out.pngBytes[3]).toBe(0x47);
  });

  it("falls back to the 1x1 transparent PNG when the canvas is fully transparent", () => {
    // Simulate a silent-draw failure: getImageData reports alpha=0
    // across the sampled region. The renderer must NOT ship these
    // bytes to the engine (which would bake a blank rectangle into
    // the page). Instead it falls through to the same 1x1 fallback
    // used by the the `getContext === null` branch — the dialog's PNG
    // magic + size check at the boundary then surfaces a friendly
    // error.
    installPolyfills();
    polyfillState.toDataURL =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    polyfillState.alpha = 0; // every sampled pixel is transparent
    polyfillState.throwOnGetImageData = false;

    const out = renderStampToPng("APPROVED");
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(isBlank1x1Png(out.pngBytes)).toBe(true);
  });

  it("falls back to the 1x1 transparent PNG when toDataURL returns an empty payload", () => {
    // Simulate Chromium's silent-encode failure: toDataURL returns
    // the prefix with no base64 payload (""). The renderer's
    // base64.length === 0 guard catches this and returns the same
    // fallback as the getContext === null branch.
    installPolyfills();
    polyfillState.toDataURL = "data:image/png;base64,";
    polyfillState.alpha = 255;
    polyfillState.throwOnGetImageData = false;

    const out = renderStampToPng("DRAFT");
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(isBlank1x1Png(out.pngBytes)).toBe(true);
  });

  it("treats getImageData throwing as best-effort and keeps the drawn bytes", () => {
    // A tainted / detached canvas can throw SecurityError on
    // getImageData. The renderer must NOT false-positive into the
    // blank fallback in that case — that would mask legitimate
    // stamps when the canvas is valid but the read API is blocked.
    // Be conservative: assume the canvas drew and trust the
    // PNG-magic check at the encode boundary.
    installPolyfills();
    polyfillState.toDataURL =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    polyfillState.alpha = 255;
    polyfillState.throwOnGetImageData = true;

    const out = renderStampToPng("FINAL");
    expect(out.pngBytes.byteLength).toBeGreaterThan(0);
    expect(out.width).toBe(STAMP_CANVAS_W);
    expect(out.height).toBe(STAMP_CANVAS_H);
  });
});