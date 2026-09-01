// @vitest-environment node
//
// Regression guard for DEF-093 — `tflexDiagnostics().activeTool`
// must return `null` when no annotation tool is armed, not
// `undefined`. Before the fix the field was absent from the
// diagnostics surface entirely; e2e harnesses had to special-case
// `undefined` (which trips TypeScript's `noUncheckedIndexedAccess`
// and complicates the JS-side assertion), and the field's absence
// from the surface type meant the contract was implicit rather
// than declared.
//
// The fix has three coordinated parts, each pinned by a source-
// level assertion below:
//
//   1. DocumentView's `DocDiagnostics` interface declares
//      `activeTool: AnnotationTool | null` (Phase-13 contract).
//   2. DocumentView's diagnostics-seeding useEffect writes
//      `activeTool: annTool.tool === "select" ? null : annTool.tool`
//      so the renderer maps the renderer's "no tool" sentinel
//      (`"select"`) to `null` before publishing.
//   3. App.tsx's `tflexDiagnostics()` read function includes
//      `activeTool` in the returned object, derived from
//      `diagnosticsRef.current["activeTool"]` with a default of
//      `null` for the cold-start case (no DocumentView has yet
//      published a value, or `diagnosticsRef.current` is empty).
//
// We assert the source shape directly because App.tsx is too large
// to mount under jsdom (it pulls in the engine adapter, settings
// pipeline, IPC bridges, etc.). The assertions live alongside the
// other App-source tests under test/unit/renderer and follow the
// same convention as `welcomeSamplesResolver.test.tsx`.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RENDERER_DIR = resolve(__dirname, "../../../src/renderer");
const DOC_VIEW_PATH = resolve(RENDERER_DIR, "components/DocumentView.tsx");
const APP_PATH = resolve(RENDERER_DIR, "App.tsx");
const MODEL_PATH = resolve(RENDERER_DIR, "annotations/model.ts");

describe("DEF-093 — tflexDiagnostics().activeTool returns null, not undefined", () => {
  it("DocDiagnostics interface declares activeTool: AnnotationTool | null", async () => {
    const text = await readFile(DOC_VIEW_PATH, "utf8");
    // The type declaration must be present so the contract is
    // explicit at the type level — a future edit that drops the
    // field trips the compiler.
    expect(text).toMatch(/interface\s+DocDiagnostics\b/);
    expect(text).toMatch(
      /activeTool\s*:\s*AnnotationTool\s*\|\s*null\s*;/,
    );
  });

  it("DocDiagnostics useEffect publishes `select` -> null mapping", async () => {
    const text = await readFile(DOC_VIEW_PATH, "utf8");
    // The diagnostics-seeding useEffect must write the active tool
    // mapped through the `"select"` -> `null` translation so e2e
    // harnesses see a uniform `value | null` shape.
    expect(text).toMatch(
      /onDiagnostics\(\{[\s\S]*?activeTool\s*:\s*annTool\.tool\s*===\s*["']select["']\s*\?\s*null\s*:\s*annTool\.tool\b/,
    );
  });

  it("DocDiagnostics useEffect depends on annTool.tool so the mirror stays fresh", async () => {
    const text = await readFile(DOC_VIEW_PATH, "utf8");
    // The effect must include `annTool.tool` in its dependency
    // array; otherwise the mirror would go stale on every tool
    // change until the next unrelated state update.
    const useEffectBlock = text.match(
      /onDiagnostics\(\{[\s\S]*?annTool\.tool[\s\S]*?\}\s*,\s*\[([\s\S]*?)\]\)/,
    );
    expect(useEffectBlock).not.toBeNull();
    if (useEffectBlock !== null) {
      expect(useEffectBlock[1]).toContain("annTool.tool");
    }
  });

  it("App.tsx tflexDiagnostics() returns an `activeTool` key (null default)", async () => {
    const text = await readFile(APP_PATH, "utf8");
    // The return object must include the `activeTool` field, and
    // it must be derived from `diagnosticsRef.current` with a
    // nullish-coalesce fallback to `null` (NOT `undefined`) so the
    // surface contract is uniform.
    //
    // (The comment + return-shape assertion below double-checks the
    // DEF-093 marker so the regression-detector is loud if a future
    // edit removes either the field or the marker comment.)
    expect(text).toMatch(/DEF-093/);
    // The local `activeTool` variable must be computed before the
    // return object. Search for the `const activeTool` declaration
    // that's followed by a `string | null` type annotation and the
    // `typeof rawActiveTool === "string" ? rawActiveTool : null`
    // shape that gives us the null-default guarantee.
    expect(text).toMatch(
      /const\s+activeTool\s*:\s*string\s*\|\s*null\s*=[\s\S]*?typeof\s+rawActiveTool\s*===\s*["']string["']\s*\?\s*rawActiveTool\s*:\s*null\s*;/,
    );
    // And the return object must include `activeTool,` (no value,
    // shorthand) — not `activeTool: undefined` and not omitted.
    expect(text).toMatch(/\bactiveTool\s*,/);
  });

  it("AnnotationTool union includes 'select' as the no-tool sentinel", async () => {
    // Sanity check on the model — the renderer's `AnnotationTool`
    // type must include `"select"` so the mapping
    // `tool === "select" ? null : tool` is exhaustive at the type
    // level (any new tool that's added will require an explicit
    // handling).
    const text = await readFile(MODEL_PATH, "utf8");
    expect(text).toMatch(/type\s+AnnotationTool\b/);
    expect(text).toMatch(/["']select["']\s*\|/);
  });
});
