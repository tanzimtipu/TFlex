// @vitest-environment jsdom
//
// Phase 97 (chunk B) — the renderer type-naming in-app message for the
// registered PDF-family types. Covers the `routeOpenPath` family short
// circuit (nothing is opened, `onUnsupported` fires), the unknown-type
// regression path (sourceInfo is still consulted once), the unchanged `.pdf`
// fall-through, and the `associationMessageFor` copy.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import {
  associationMessageFor,
  routeOpenPath,
} from "../../../src/renderer/state/convert";
import type { ConvertSourceInfo } from "../../../src/shared/convert";
import type { TFlexApiConvert } from "../../../src/shared/ipc";

const INFO: ConvertSourceInfo = { format: "text", label: "Text document", fidelity: "native" };

function unsupported(): { ok: false; error: { code: "unsupported-format"; message: string } } {
  return { ok: false, error: { code: "unsupported-format", message: "nope" } };
}

/** A minimal TFlexApiConvert fake: only the named members are real. */
function fakeApi(parts: Partial<TFlexApiConvert>): TFlexApiConvert {
  return {
    sourceInfo: parts.sourceInfo ?? (async () => ({ ok: true, value: INFO })),
    toDocument:
      parts.toDocument ??
      (async () => ({
        ok: true,
        value: { docId: "doc-1", pageCount: 1, sourceFormat: "text", fidelity: "native", warnings: [], title: "x" },
      })),
    cancel: parts.cancel ?? ((): void => undefined),
    onProgress: parts.onProgress ?? ((): (() => void) => () => undefined),
    csvToDocumentFields:
      parts.csvToDocumentFields ??
      (async () => ({
        ok: false as const,
        error: { code: "unsupported-format", message: "not used in these tests" },
      })),
  };
}

describe("phase 97 — routeOpenPath family short circuit", () => {
  it("a family extension opens nothing and reports through onUnsupported", async () => {
    const sourceInfo = vi.fn(async () => ({ ok: true as const, value: INFO }));
    const api = fakeApi({ sourceInfo });
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const onUnsupported = vi.fn();
    const out = await routeOpenPath("C:/docs/form.xdp", { api, openPdf, openConverted, onUnsupported });
    expect(out).toBeNull();
    expect(sourceInfo).not.toHaveBeenCalled();
    expect(openPdf).not.toHaveBeenCalled();
    expect(openConverted).not.toHaveBeenCalled();
    expect(onUnsupported).toHaveBeenCalledWith("C:/docs/form.xdp");
  });

  it("the acrobat: URL target also short circuits before sourceInfo", async () => {
    const sourceInfo = vi.fn(async () => ({ ok: true as const, value: INFO }));
    const api = fakeApi({ sourceInfo });
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const onUnsupported = vi.fn();
    const out = await routeOpenPath("acrobat:foo", { api, openPdf, openConverted, onUnsupported });
    expect(out).toBeNull();
    expect(sourceInfo).not.toHaveBeenCalled();
    expect(openPdf).not.toHaveBeenCalled();
    expect(onUnsupported).toHaveBeenCalledWith("acrobat:foo");
  });

  it("a .pdf still consults sourceInfo and falls through to the PDF path", async () => {
    const sourceInfo = vi.fn(async () => unsupported());
    const api = fakeApi({ sourceInfo });
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    await expect(routeOpenPath("a.pdf", { api, openPdf, openConverted })).resolves.toBe("pdf-tab");
    expect(sourceInfo).toHaveBeenCalledTimes(1);
    expect(openPdf).toHaveBeenCalledWith("a.pdf");
    expect(openConverted).not.toHaveBeenCalled();
  });

  it("an unknown type still consults sourceInfo once, then reports unsupported", async () => {
    const sourceInfo = vi.fn(async () => unsupported());
    const api = fakeApi({ sourceInfo });
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const onUnsupported = vi.fn();
    const out = await routeOpenPath("notes.xyz", { api, openPdf, openConverted, onUnsupported });
    expect(out).toBeNull();
    expect(sourceInfo).toHaveBeenCalledTimes(1);
    expect(openPdf).not.toHaveBeenCalled();
    expect(onUnsupported).toHaveBeenCalledWith("notes.xyz");
  });
});

describe("phase 97 — associationMessageFor copy", () => {
  it("names the family type, its extension and the file", () => {
    const message = associationMessageFor("form.xdp", "form.xdp");
    expect(message).toContain("Acrobat XML Data Package");
    expect(message).toContain(".xdp");
    expect(message).toContain("form.xdp");
  });

  it("names the .xfdf family type", () => {
    expect(associationMessageFor("a.xfdf", "a.xfdf")).toContain("Acrobat Forms Document");
  });

  it("has dedicated copy for the acrobat: URL target", () => {
    expect(associationMessageFor("acrobat:foo", "foo")).toBe('Jovrel cannot open an "acrobat:" link yet.');
  });

  it("is null for a .pdf and for an unknown type", () => {
    expect(associationMessageFor("a.pdf", "a.pdf")).toBeNull();
    expect(associationMessageFor("notes.txt", "notes.txt")).toBeNull();
  });
});
