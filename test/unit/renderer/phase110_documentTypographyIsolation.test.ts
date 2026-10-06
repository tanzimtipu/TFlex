// @vitest-environment node
//
// Phase 110 (chunk A) - document typography isolation guard.
//
// The Quiet Precision UI type scale must never leak into the PDF/document
// pipeline: the renderer previews, annotation appearance text and signature
// canvas own their own font stacks, independent from interface typography.
// These files may not reference any UI type token, and their document font
// stacks must stay intact. Mirrors the read-the-source approach of the other
// renderer contract suites.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = resolve(__dirname, "../../../src/renderer");

function read(rel: string): string {
  return readFileSync(resolve(RENDERER, rel), "utf8");
}

const DOCUMENT_FILES = [
  "edit/editColor.ts",
  "annotations/annTextStyle.ts",
  "components/WatermarkDialog.tsx",
  "annotations/stampRender.ts",
  "signatures/canvas.ts",
] as const;

const UI_TYPE_TOKENS = ["--type-", "--fs-", "--tf-label-size", "--font-sans"] as const;

describe("Phase 110 (chunk A) - document pipeline is isolated from UI type tokens", () => {
  it("references no UI type token in any document-pipeline file", () => {
    const violations: string[] = [];
    for (const rel of DOCUMENT_FILES) {
      const text = read(rel);
      for (const needle of UI_TYPE_TOKENS) {
        if (text.includes(needle)) violations.push(`${rel} references ${needle}`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps the document font stacks in editColor.ts", () => {
    const text = read("edit/editColor.ts");
    for (const stack of [
      "Helvetica",
      "Times New Roman",
      "Courier New",
      "Liberation Sans",
      "DejaVu",
    ]) {
      expect(text, `editColor.ts must still contain ${stack}`).toContain(stack);
    }
  });

  it("keeps the annotation preview stacks in annTextStyle.ts", () => {
    const text = read("annotations/annTextStyle.ts");
    expect(text).toContain("Inter");
    expect(text).toContain("Times");
  });

  it("keeps the watermark FONT_CSS stacks independent", () => {
    const text = read("components/WatermarkDialog.tsx");
    expect(text).toContain("FONT_CSS");
    expect(text).toContain("'Inter', 'Helvetica Neue', Arial, sans-serif");
  });
});
