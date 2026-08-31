// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAMP_ID,
  STAMP_CANVAS_H,
  STAMP_CANVAS_W,
  STAMP_IDS,
  STAMP_STYLES,
  drawStamp,
  renderStampToPng,
} from "../../../src/renderer/annotations/stampRender";

/**
 * Phase 12 — built-in stamp renderer.
 *
 * Pins the visual contract: each built-in stamp id has its own
 * border / fill / text colour, the canvas always paints at the
 * declared width × height, and `renderStampToPng` returns a valid
 * PNG byte buffer.
 *
 * jsdom doesn't ship a working canvas 2D backend; we polyfill
 * `HTMLCanvasElement.prototype.getContext` with a Proxy that
 * returns no-op functions for every method the renderer uses.
 * We also polyfill `toDataURL` to return a base64 of the PNG
 * magic header so the renderer's PNG-decode path runs.
 */

interface StubContext {
  [key: string]: unknown;
}

const NO_OP_FN = (): void => undefined;

function makeStubContext(): StubContext {
  // Every method the stamp renderer touches returns a no-op
  // function; setters / getters are accepted silently.
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "canvas") return null;
        return NO_OP_FN;
      },
      set() {
        return true;
      },
    },
  ) as StubContext;
}

interface PolyfillState {
  /** True when the polyfill's getContext returns a stub context;
   *  false when it returns null (the "no canvas backend" branch). */
  enabled: boolean;
  /** toDataURL's return value, used by renderStampToPng's PNG
   *  encode path. */
  toDataURL: string;
}

const polyfillState: PolyfillState = {
  enabled: true,
  toDataURL: "data:image/png;base64,iVBORw0KGgo=",
};

function installPolyfills(): void {
  (HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  }).getContext = function getContextStub(): unknown {
    return polyfillState.enabled ? makeStubContext() : null;
  };
  (HTMLCanvasElement.prototype as unknown as {
    toDataURL: (type?: string) => string;
  }).toDataURL = function toDataURLStub(): string {
    return polyfillState.toDataURL;
  };
  // Bug 8 (DEF-063) — the renderer now samples pixels via
  // getImageData to detect silent-draw failures. The jsdom Proxy
  // stub above returns a no-op function for every method access
  // (including getImageData), so the renderer's blank-canvas check
  // would treat the call as "could not read" and assume the canvas
  // drew. To preserve the original "happy path" assertions (real
  // bytes out) we polyfill getImageData to return a synthetic
  // ImageData with alpha=255 so the renderer thinks the draw
  // landed. The blank-canvas branches are covered by the new
  // bug008_stampBlankBytes.test.ts file.
  (HTMLCanvasElement.prototype as unknown as {
    getImageData: (x: number, y: number, w: number, h: number) => ImageData;
  }).getImageData = function getImageDataStub(
    _x: number,
    _y: number,
    w: number,
    h: number,
  ): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < data.length; i += 4) {
      data[i] = 255;
    }
    return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
  };
}

describe("stampRender — built-in stamps", () => {
  it("STAMP_IDS lists every built-in id", () => {
    expect(STAMP_IDS).toEqual([
      "APPROVED",
      "DRAFT",
      "CONFIDENTIAL",
      "FINAL",
    ]);
  });

  it("DEFAULT_STAMP_ID is APPROVED (the spec default)", () => {
    expect(DEFAULT_STAMP_ID).toBe("APPROVED");
  });

  it("STAMP_STYLES maps every stamp id to its visual config", () => {
    for (const id of STAMP_IDS) {
      const style = STAMP_STYLES[id];
      expect(typeof style.border).toBe("string");
      expect(typeof style.fill).toBe("string");
      expect(typeof style.text).toBe("string");
      expect(typeof style.label).toBe("string");
      expect(style.label.length).toBeGreaterThan(0);
    }
  });

  it("STAMP_CANVAS_W and STAMP_CANVAS_H are positive integers", () => {
    expect(Number.isInteger(STAMP_CANVAS_W)).toBe(true);
    expect(Number.isInteger(STAMP_CANVAS_H)).toBe(true);
    expect(STAMP_CANVAS_W).toBeGreaterThan(0);
    expect(STAMP_CANVAS_H).toBeGreaterThan(0);
  });

  it("drawStamp runs against a stub 2D context for every built-in id", () => {
    const ctx = makeStubContext() as unknown as CanvasRenderingContext2D;
    for (const id of STAMP_IDS) {
      expect((): void =>
        drawStamp(ctx, id, STAMP_CANVAS_W, STAMP_CANVAS_H),
      ).not.toThrow();
    }
  });
});

describe("renderStampToPng — output shape", () => {
  it("returns bytes + dimensions for every built-in stamp id", () => {
    installPolyfills();
    polyfillState.enabled = true;
    for (const id of STAMP_IDS) {
      const out = renderStampToPng(id);
      expect(out.pngBytes).toBeInstanceOf(Uint8Array);
      expect(out.pngBytes.byteLength).toBeGreaterThan(0);
      expect(out.width).toBe(STAMP_CANVAS_W);
      expect(out.height).toBe(STAMP_CANVAS_H);
    }
  });

  it("returns non-empty bytes on a happy path", () => {
    installPolyfills();
    polyfillState.enabled = true;
    const out = renderStampToPng("APPROVED");
    expect(out.pngBytes.byteLength).toBeGreaterThan(0);
  });

  it("falls back to a 1x1 transparent PNG when canvas 2D is unavailable", () => {
    installPolyfills();
    polyfillState.enabled = false;
    const out = renderStampToPng("DRAFT");
    expect(out.pngBytes).toBeInstanceOf(Uint8Array);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    // The 1x1 fallback PNG starts with the PNG magic.
    expect(out.pngBytes[0]).toBe(0x89);
    expect(out.pngBytes[1]).toBe(0x50);
    expect(out.pngBytes[2]).toBe(0x4e);
    expect(out.pngBytes[3]).toBe(0x47);
  });
});