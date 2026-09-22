// DEF-293 — the Multi View composite tab separator must be " | " (a pipe
// with single spaces), not the old " + ". The operator asked for "|"; qa
// measured the label as "…alpha.pdf + …beta.pdf" (compositeTab.ts:60 joined
// with " + ").
//
// The projection is pure, so the separator is pinned directly; the rendered
// label (innerText + title) is pinned in phase34_chunk2.test.tsx against the
// same compositeHeaderTab output.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compositeDocRefs,
  compositeHeaderTab,
  type CompositeDocRef,
} from "../../../src/renderer/state/compositeTab";

const SOURCE_PATH = resolve(__dirname, "../../../src/renderer/state/compositeTab.ts");

const DOCS: CompositeDocRef[] = [
  { id: "a", title: "alpha.pdf", modified: false },
  { id: "b", title: "beta.pdf", modified: false },
];

const byId = (id: string): CompositeDocRef | null => DOCS.find((d) => d.id === id) ?? null;

describe("DEF-293 — composite tab uses the pipe separator", () => {
  it("joins the pane names with ' | '", () => {
    const tab = compositeHeaderTab(compositeDocRefs("a", "b", byId));
    expect(tab.title).toBe("alpha.pdf | beta.pdf");
    expect(tab.title).toContain(" | ");
    expect(tab.title).not.toContain(" + ");
  });

  it("a single-document tab is unchanged (no separator)", () => {
    const tab = compositeHeaderTab(compositeDocRefs("a", null, byId));
    expect(tab.title).toBe("alpha.pdf");
  });

  it("the source joins with a pipe (revert to ' + ' fails)", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    expect(source).toMatch(/\.join\(" \| "\)/);
    expect(source).not.toMatch(/\.join\(" \+ "\)/);
  });
});