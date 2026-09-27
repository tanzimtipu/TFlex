// Phase 35 item 8 - the renderer entry branch (pure).
//
// Pins: no flag -> the normal app; flag + valid context -> the print UI;
// flag + missing/unreadable/malformed context -> the print window's error
// state (never a half-rendered UI).
import { describe, expect, it } from "vitest";
import {
  PRINT_WINDOW_MAX_PAGES,
  PRINT_WINDOW_TITLE,
  parsePrintWindowContext,
  printWindowOpenFailureMessage,
  rendererEntryTitle,
  resolveRendererEntry,
} from "../../../src/renderer/print-window/context";
import type { PrintWindowContext } from "../../../src/shared/types";

const CONTEXT: PrintWindowContext = {
  docId: "doc-1",
  documentName: "report.pdf",
  pageCount: 3,
  settings: { deviceName: "HP LaserJet", copies: 2, landscape: false },
};

function searchFor(context: unknown, flag = "print"): string {
  return `?tfWindow=${flag}&context=${encodeURIComponent(JSON.stringify(context))}`;
}

describe("resolveRendererEntry - entry flag", () => {
  it("boots the normal app when the flag is absent", () => {
    expect(resolveRendererEntry("")).toEqual({ kind: "app" });
    expect(resolveRendererEntry("?foo=bar")).toEqual({ kind: "app" });
  });

  it("boots the normal app for a different tfWindow value", () => {
    expect(resolveRendererEntry("?tfWindow=about")).toEqual({ kind: "app" });
  });

  it("boots the print UI when the flag carries a valid context", () => {
    const entry = resolveRendererEntry(searchFor(CONTEXT));
    expect(entry.kind).toBe("print");
    if (entry.kind !== "print") return;
    expect(entry.context.docId).toBe("doc-1");
    expect(entry.context.documentName).toBe("report.pdf");
    expect(entry.context.pageCount).toBe(3);
    expect(entry.context.settings.copies).toBe(2);
  });
});

describe("resolveRendererEntry - malformed context", () => {
  it("reports a missing context instead of rendering a print UI", () => {
    const entry = resolveRendererEntry("?tfWindow=print");
    expect(entry.kind).toBe("print-error");
    if (entry.kind !== "print-error") return;
    expect(entry.reason).toMatch(/without its document context/);
  });

  it("reports an unparseable context", () => {
    const entry = resolveRendererEntry("?tfWindow=print&context=not-json");
    expect(entry.kind).toBe("print-error");
  });

  it("reports a JSON value that is not a context object", () => {
    const entry = resolveRendererEntry(searchFor("nope"));
    expect(entry.kind).toBe("print-error");
  });

  it("reports a context with a missing document id", () => {
    const entry = resolveRendererEntry(searchFor({ ...CONTEXT, docId: "" }));
    expect(entry.kind).toBe("print-error");
    if (entry.kind !== "print-error") return;
    expect(entry.reason).toMatch(/document id/);
  });

  it("reports a context with an absurd page count", () => {
    const entry = resolveRendererEntry(
      searchFor({ ...CONTEXT, pageCount: PRINT_WINDOW_MAX_PAGES + 1 }),
    );
    expect(entry.kind).toBe("print-error");
    if (entry.kind !== "print-error") return;
    expect(entry.reason).toMatch(/page count/);
  });
});

describe("rendererEntryTitle - the print window's OS title (DEF-298)", () => {
  it("is 'Print - Jovrel' for the print entry", () => {
    const entry = resolveRendererEntry(searchFor(CONTEXT));
    expect(rendererEntryTitle(entry)).toBe("Print - Jovrel");
    expect(rendererEntryTitle(entry)).toBe(PRINT_WINDOW_TITLE);
  });

  it("is 'Print - Jovrel' for the print window's error state", () => {
    const entry = resolveRendererEntry("?tfWindow=print");
    expect(entry.kind).toBe("print-error");
    expect(rendererEntryTitle(entry)).toBe("Print - Jovrel");
  });

  it("is null for the normal app entry, so the main window's title is untouched", () => {
    expect(rendererEntryTitle(resolveRendererEntry(""))).toBeNull();
  });
});

describe("printWindowOpenFailureMessage - refusal surfacing", () => {
  it("is null when the window opened", () => {
    expect(printWindowOpenFailureMessage({ ok: true, created: true })).toBeNull();
    expect(printWindowOpenFailureMessage({ ok: true, created: false })).toBeNull();
  });

  it("names the reason when the open was refused", () => {
    const message = printWindowOpenFailureMessage({
      ok: false,
      reason: "docId must be a non-empty string",
    });
    expect(message).not.toBeNull();
    expect(message).toContain("Could not open the print window");
    expect(message).toContain("docId must be a non-empty string");
  });
});

describe("parsePrintWindowContext", () => {
  it("accepts a well-formed context", () => {
    const result = parsePrintWindowContext(CONTEXT);
    expect(result.ok).toBe(true);
  });

  it.each([
    [null, /not an object/],
    [{ ...CONTEXT, documentName: 7 }, /document name/],
    [{ ...CONTEXT, pageCount: -1 }, /page count/],
    [{ ...CONTEXT, pageCount: 1.5 }, /page count/],
    [{ ...CONTEXT, settings: null }, /print settings/],
  ])("rejects %j", (raw, pattern) => {
    const result = parsePrintWindowContext(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(pattern);
  });
});
