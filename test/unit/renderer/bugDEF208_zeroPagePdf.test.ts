// @vitest-environment jsdom
//
// DEF-208 (ADV-029) — broken page-tree PDFs were accepted by the
// renderer's load path. The IPC sniff in main only checks the `%PDF-`
// header, so bytes with a broken /Pages tree still reach
// `openPdfDocument`; when pdf.js resolves such a document with ZERO
// pages, the old code happily returned the proxy and the app opened a
// hollow tab (every viewer path derives from `numPages`).
//
// The fix rejects a `numPages === 0` proxy with the shared 'corrupt'
// error code and destroys the proxy. pdfjs-dist is mocked so the guard
// can be exercised in jsdom without a real worker backend.

import { describe, expect, it, vi } from "vitest";

const destroyCalls: number[] = [];

interface FakeDocProxy {
  numPages: number;
  destroy: () => Promise<void>;
}

// Controllable fake document: tests reassign `numPages` between cases.
const fakeDoc: FakeDocProxy = {
  numPages: 3,
  async destroy(): Promise<void> {
    destroyCalls.push(Date.now());
  },
};

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
  VerbosityLevel: { ERRORS: 0 },
}));

import { openPdfDocument } from "../../../src/renderer/pdf/pdfjs";

const SOME_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
  .buffer as ArrayBuffer; // "%PDF-1.4"

describe("DEF-208 — zero-page documents are rejected as corrupt", () => {
  it("returns error 'corrupt' when pdf.js resolves a document with 0 pages", async () => {
    destroyCalls.length = 0;
    fakeDoc.numPages = 0;
    const result = await openPdfDocument(SOME_BYTES);
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toBe("corrupt");
  });

  it("destroys the zero-page proxy (no worker-side document leak)", async () => {
    destroyCalls.length = 0;
    fakeDoc.numPages = 0;
    await openPdfDocument(SOME_BYTES);
    expect(destroyCalls).toHaveLength(1);
  });

  it("still returns the proxy for a document with pages", async () => {
    destroyCalls.length = 0;
    fakeDoc.numPages = 3;
    const result = await openPdfDocument(SOME_BYTES);
    expect("doc" in result).toBe(true);
    if ("doc" in result) {
      expect(result.doc.numPages).toBe(3);
    }
    expect(destroyCalls).toHaveLength(0);
  });

  it("the 1-page boundary is accepted (only 0 pages is corrupt)", async () => {
    destroyCalls.length = 0;
    fakeDoc.numPages = 1;
    const result = await openPdfDocument(SOME_BYTES);
    expect("doc" in result).toBe(true);
    expect(destroyCalls).toHaveLength(0);
  });
});
