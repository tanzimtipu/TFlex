// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  defaultExportFilename,
  downloadBlob,
} from "../../../src/renderer/utils/exportDownload";

/**
 * Phase 9 — Per-page download helper tests.
 *
 * The download helper is a thin browser-anchor click that triggers
 * the OS save dialog. jsdom doesn't fire a real download, but the
 * function's return value (true / false) is observable through the
 * synchronous click handler. We exercise the filename builder
 * directly; the actual downloadBlob click path is covered by the
 * e2e harness.
 */

describe("defaultExportFilename — sanitised basename + page index", () => {
  it("strips the .pdf extension and suffixes -page-N", () => {
    expect(defaultExportFilename("report.pdf", 1, "png")).toBe("report-page-1.png");
    expect(defaultExportFilename("invoice.pdf", 7, "jpeg")).toBe("invoice-page-7.jpg");
  });

  it("handles names without a .pdf extension", () => {
    expect(defaultExportFilename("notes", 3, "png")).toBe("notes-page-3.png");
  });

  it("sanitises OS-illegal characters in the basename", () => {
    expect(defaultExportFilename("a:b/c\\d?e.pdf", 2, "png")).toBe(
      "a_b_c_d_e-page-2.png",
    );
  });

  it("falls back to a generic name when the sanitised basename is empty", () => {
    expect(defaultExportFilename("////.pdf", 4, "jpeg")).toBe("page-4.jpg");
  });

  it("uses .jpg for jpeg format", () => {
    expect(defaultExportFilename("report.pdf", 1, "jpeg")).toMatch(/\.jpg$/);
  });
});

describe("downloadBlob — anchor click contract", () => {
  it("appends and clicks an anchor with the supplied filename", () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });
    // Spy on document.body.appendChild to verify the anchor is
    // constructed with the right attributes (download attribute,
    // blob URL).
    const appended: HTMLElement[] = [];
    const originalAppend = document.body.appendChild.bind(document.body);
    document.body.appendChild = ((node: Node) => {
      appended.push(node as HTMLElement);
      return originalAppend(node as Node);
    }) as typeof document.body.appendChild;
    let clickedHref: string | null = null;
    let clickedDownload: string | null = null;
    // We override HTMLAnchorElement.prototype.click so we can read
    // the constructed anchor's href + download attribute without
    // triggering a real download. The prototype override is left
    // in place after the test; vitest's per-file module isolation
    // keeps it from leaking into other tests.
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
      clickedHref = this.href;
      clickedDownload = this.download;
    };
    downloadBlob(blob, "page-1.png");
    expect(appended.length).toBeGreaterThan(0);
    const anchor = appended[0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe("A");
    expect(clickedDownload).toBe("page-1.png");
    expect(clickedHref).toMatch(/^blob:/);
  });
});
