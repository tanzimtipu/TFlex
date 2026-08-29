// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { VerbosityLevel } from "pdfjs-dist";
import {
  buildDocumentInit,
  type RendererDocumentInit,
} from "../../../src/renderer/pdf/pdfjs";

describe("buildDocumentInit", () => {
  it("passes the byte length up front so pdfjs skips its size probe", () => {
    const data = new Uint8Array(1234);
    const init = buildDocumentInit(data);
    expect(init.length).toBe(1234);
    expect(init.data).toBe(data);
  });

  it("wraps a raw ArrayBuffer in a Uint8Array view", () => {
    const ab = new ArrayBuffer(64);
    const init = buildDocumentInit(ab);
    expect(init.data).toBeInstanceOf(Uint8Array);
    expect((init.data as Uint8Array).byteLength).toBe(64);
    expect(init.length).toBe(64);
  });

  it("disables the auto-fetch / stream / eval paths the renderer never uses", () => {
    const init = buildDocumentInit(new Uint8Array(8));
    // Each of these is a deliberate memory / CPU trim documented in
    // src/renderer/pdf/pdfjs.ts. They MUST stay set for long.pdf idle
    // to stay under the DEF-016 exit budget — regression-test them.
    expect(init.disableAutoFetch).toBe(true);
    expect(init.disableStream).toBe(true);
    expect(init.isEvalSupported).toBe(false);
  });

  it("leaves font-face conversion enabled so the TextLayer keeps its glyphs", () => {
    const init: RendererDocumentInit = buildDocumentInit(new Uint8Array(8));
    // We deliberately do NOT set disableFontFace: true even though it
    // would shrink the worker's fontCache, because the TextLayer's
    // text-selection glyphs depend on @font-face plumbing. The
    // fontCache is flushed by doc.cleanup() on idle (DocumentView's
    // idle coordinator), which is enough for our exit budget.
    expect("disableFontFace" in init ? init.disableFontFace : undefined).toBeUndefined();
    expect("useSystemFonts" in init ? init.useSystemFonts : undefined).toBeUndefined();
  });

  it("quiets pdfjs's internal logger to errors-only", () => {
    const init: RendererDocumentInit = buildDocumentInit(new Uint8Array(8));
    expect(init.verbosity).toBe(VerbosityLevel.ERRORS);
  });

  it("returns the same Uint8Array reference when given one (no copy)", () => {
    const data = new Uint8Array(16);
    const init = buildDocumentInit(data);
    expect(init.data).toBe(data);
  });
});
