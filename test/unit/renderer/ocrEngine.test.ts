// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  StubRendererEngine,
  type OcrCallRecord,
} from "../../../src/renderer/engine/stubEngine";

/**
 * Phase 11 — Renderer engine adapter's OCR contract.
 *
 * The stub doesn't ship with tesseract, so ocrRecognize returns
 * engine-error (just like a real backend that hasn't been upgraded).
 * The renderer treats the failure as a friendly toast; the test
 * surface here pins the options-shape the renderer sends and the
 * error path the dialog handles.
 */

describe("StubRendererEngine — ocrRecognize (Phase 11)", () => {
  it("records the call options on the per-tab log", async () => {
    const engine = new StubRendererEngine();
    const tabId = 'tab-1';
    engine.registerTab(tabId, 3);
    const result = await engine.ocrRecognize(tabId, {
      language: 'eng',
      downsample: 300,
      pageImages: [
        {
          page: 1,
          pngBytes: new Uint8Array([1]),
          dpi: 300,
          widthPx: 100,
          heightPx: 100,
        },
        {
          page: 2,
          pngBytes: new Uint8Array([2]),
          dpi: 300,
          widthPx: 100,
          heightPx: 100,
        },
      ],
    });
    // Stub returns engine-error (no tesseract); the call IS recorded.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('engine-error');
    const last = engine.getLastOcrCall(tabId) as OcrCallRecord | undefined;
    expect(last).toBeDefined();
    expect(last?.language).toBe('eng');
    expect(last?.downsample).toBe(300);
    expect(last?.pageCount).toBe(2);
  });

  it("returns empty-range when pageImages is empty", async () => {
    const engine = new StubRendererEngine();
    const tabId = 'tab-1';
    engine.registerTab(tabId, 3);
    const result = await engine.ocrRecognize(tabId, {
      language: 'eng',
      downsample: 300,
      pageImages: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('empty-range');
  });

  it("returns engine-error when the tab is unknown", async () => {
    const engine = new StubRendererEngine();
    const result = await engine.ocrRecognize('unknown', {
      language: 'eng',
      downsample: 300,
      pageImages: [{ page: 1, pngBytes: new Uint8Array([1]), dpi: 300, widthPx: 1, heightPx: 1 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('engine-error');
  });
});

describe("StubRendererEngine — ocrSuspects (Phase 11)", () => {
  it("returns engine-error when no OCR has run on the doc", async () => {
    const engine = new StubRendererEngine();
    const tabId = 'tab-1';
    engine.registerTab(tabId, 3);
    const result = await engine.ocrSuspects(tabId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('engine-error');
  });

  it("returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const result = await engine.ocrSuspects('nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('engine-error');
  });
});

describe("StubRendererEngine — onOcrProgress (Phase 11)", () => {
  it("returns a no-op unsubscribe function", () => {
    const engine = new StubRendererEngine();
    let called = false;
    const unsub = engine.onOcrProgress(() => {
      called = true;
    });
    expect(typeof unsub).toBe('function');
    // The stub never invokes the callback.
    expect(called).toBe(false);
    unsub();
    expect(called).toBe(false);
  });
});

// DEF-050 — Phase 11 refresh hook. The stub has no PDF bytes of its
// own, so it degrades to engine-error exactly like the pre-Phase-11
// real backend. The renderer's OCR confirm handler treats this as
// "no refresh possible" and falls back to the cached search-index
// invalidator; this test pins the stub's contract.
describe("StubRendererEngine — getDocumentBytes (Phase 11)", () => {
  it("returns engine-error for a registered tab (stub has no bytes)", async () => {
    const engine = new StubRendererEngine();
    engine.registerTab('tab-1', 3);
    const result = await engine.getDocumentBytes!('tab-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('engine-error');
  });

  it("returns engine-error for an unknown doc", async () => {
    const engine = new StubRendererEngine();
    const result = await engine.getDocumentBytes!('nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('engine-error');
  });
});