// DEF-429 — a Recents row created by opening a welcome-grid sample stores
// the display path `samples/<name>`. Clicking it previously sent that path
// into `openFromRequest` -> `openPdfFromPath`, a filesystem open that cannot
// resolve `samples/form.pdf`, so the row showed "Could not open file" and
// opened nothing.
//
// The fix routes `samples/` recents through the same flow as a sample card
// click. These tests mirror welcomeSamplesResolver.test.tsx's App-level
// structural call-site pattern: they read App.tsx and pin that the recent
// click consults `splitRecentPath(path).isSample` and, when true, calls the
// extracted `openSampleByName` helper rather than `openFromRequest` /
// `openPdfFromPath`.

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const APP_PATH = path.resolve(__dirname, "../../../src/renderer/App.tsx");

async function appSource(): Promise<string> {
  return readFile(APP_PATH, "utf8");
}

/**
 * Return the balanced-brace body of the first occurrence of `marker`.
 * `marker` must not itself contain a `{`; the first `{` after it opens the
 * body. Used to fence a single callback so assertions cannot be satisfied
 * by an unrelated region of the 11k-line file.
 */
function extractBody(text: string, marker: string): string {
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const open = text.indexOf("{", start);
  if (open < 0) throw new Error(`no body brace after marker: ${marker}`);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after marker: ${marker}`);
}

describe("DEF-429 — sample Recents reopen through the sample flow", () => {
  it("extracts the sample flow into a reusable openSampleByName callback", async () => {
    const text = await appSource();
    expect(text).toMatch(/const\s+openSampleByName\s*=\s*useCallback\(/);

    const body = extractBody(text, "const openSampleByName = useCallback(");
    // The sample flow reads bundled bytes, never a filesystem open.
    expect(body).toContain("window.tflex.readSample(");
    expect(body).toContain("openFromBytes(");
    expect(body).toContain('kind: "sample"');
    expect(body).not.toContain("openFromRequest(");
    expect(body).not.toContain("openPdfFromPath(");
  });

  it("onSampleClick delegates to openSampleByName (card behaviour preserved)", async () => {
    const text = await appSource();
    const body = extractBody(text, "const onSampleClick = useCallback(");
    expect(body).toContain("openSampleByName(sample.name)");
    expect(body).not.toContain("window.tflex.readSample(");
    expect(body).not.toContain("openPdfFromPath(");
  });

  it("onRecentClick detects a sample path and routes it to openSampleByName", async () => {
    const text = await appSource();
    const body = extractBody(text, "const onRecentClick = useCallback(");

    // The sample branch is keyed off the shared recent-path splitter.
    expect(body).toContain("splitRecentPath(entry.path)");
    expect(body).toMatch(/meta\.isSample/);
    expect(body).toContain("openSampleByName(meta.name)");

    // Ordering: the sample test must precede the generic filesystem open.
    expect(body.indexOf("meta.isSample")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("meta.isSample")).toBeLessThan(
      body.indexOf("openFromRequest(entry.path)"),
    );

    // The sample branch itself must not fall through into the fs open.
    const branchStart = body.indexOf("if (meta.isSample)");
    const branch = extractBody(body.slice(branchStart), "if (meta.isSample)");
    expect(branch).toContain("openSampleByName(meta.name)");
    expect(branch).not.toContain("openFromRequest(");
    expect(branch).not.toContain("openPdfFromPath(");
  });

  it("non-sample recent paths keep the generic open path", async () => {
    const text = await appSource();
    const body = extractBody(text, "const onRecentClick = useCallback(");
    expect(body).toContain("await openFromRequest(entry.path);");
  });
});
