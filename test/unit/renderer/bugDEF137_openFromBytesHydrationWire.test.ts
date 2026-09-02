// @vitest-environment node
//
// DEF-137 renderer half — the tab-open flow hydrates the renderer's
// engine mirrors from the engine's authoritative post-load state.
//
// The engine parses annotations, rotations, text boxes, form fields
// and page labels into its doc state during loadDocument /
// loadDocumentBytes, but `openFromBytes` used to seed the tab from an
// empty `initialUiState` (empty annotations, zero rotations) and
// never asked the engine for its state again. A reopened saved file
// therefore rendered clean even though the engine had the content
// loaded — the annotations and rotations stayed at their empty
// defaults until the first UI op forced a getState round-trip
// (DEF-138 renderer half).
//
// This is a source-contract test (the DEF-117 pattern): it reads
// App.tsx, strips comments and string literals, and asserts the
// open-bytes flow's plumbing:
//   1. `openFromBytes` calls `engineRef.current.getState(engineDocId)`
//      after a successful engine load, on BOTH the disk path
//      (`loadDocument`) and the bytes path (`loadDocumentBytes`).
//   2. The hydrated EngineState seeds `openTabs[id].engine` and
//      `engineUi[id]` (via `seeded.state` / `seeded`) instead of the
//      bare empty `initialUiState`.
//   3. A getState failure degrades gracefully: `stateResult.ok` gates
//      the hydrated value, and `seededEngineUiState` falls back to
//      the empty initial state (behavior pinned by the companion
//      bugDEF137_seededEngineUiState.test.ts).
//
// Comment/string stripping matters here: the App.tsx comments describe
// exactly the wiring this test pins, so the scan must only see real
// program text.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "App.tsx",
);

/** Blank comments and quoted strings (keeping newlines) so the scan
 *  sees only program text — copy in comments that describes the fix
 *  must not satisfy the assertions by itself. */
function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const ch = source[i] ?? "";
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          out.push(" ", " ");
          i += 2;
          break;
        }
        out.push(source[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n && source[j] !== "\n") {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) {
        out.push(ch);
        i += 1;
        continue;
      }
      while (i <= j) {
        out.push(source[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }
    if (ch === "`") {
      out.push(" ");
      i += 1;
      while (i < n) {
        const c = source[i];
        if (c === "\\") {
          out.push(" ", " ");
          i += 2;
          continue;
        }
        if (c === "`") {
          out.push(" ");
          i += 1;
          break;
        }
        out.push(c === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

/** Extract the body of the `openFromBytes` useCallback — the arrow
 *  function plus everything up to (not including) the deps array. */
function openFromBytesBody(stripped: string): string {
  const startMarker = "const openFromBytes = useCallback(";
  const start = stripped.indexOf(startMarker);
  if (start === -1) throw new Error("openFromBytes useCallback not found");
  const depsMarker = "[pushToast, toastForPdfError]";
  const deps = stripped.indexOf(depsMarker, start);
  if (deps === -1) throw new Error("openFromBytes deps array not found");
  return stripped.slice(start, deps);
}

describe("DEF-137 renderer half — openFromBytes hydrates engine mirrors from getState", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const stripped = stripCommentsAndStrings(source);
  const body = openFromBytesBody(stripped);
  const getStateAt = body.indexOf("engineRef.current.getState(engineDocId)");

  it("calls engine.getState after a successful engine load", () => {
    expect(getStateAt).toBeGreaterThan(-1);
    // The getState call sits after the engine-registration block so it
    // observes the freshly-loaded doc. Both the disk path and the bytes
    // path must run it.
    expect(body.indexOf("engineRef.current.loadDocument(")).toBeGreaterThan(-1);
    expect(body.indexOf("engineRef.current.loadDocumentBytes(")).toBeGreaterThan(-1);
    const diskLoad = body.indexOf("engineRef.current.loadDocument(");
    const bytesLoad = body.indexOf("engineRef.current.loadDocumentBytes(");
    const registerTab = body.indexOf("stubRendererEngine.registerTab(");
    expect(diskLoad).toBeGreaterThan(-1);
    expect(bytesLoad).toBeGreaterThan(-1);
    expect(registerTab).toBeGreaterThan(-1);
    expect(getStateAt).toBeGreaterThan(diskLoad);
    expect(getStateAt).toBeGreaterThan(bytesLoad);
    expect(getStateAt).toBeGreaterThan(registerTab);
  });

  it("seeds openTabs[id].engine and engineUi[id] from the hydrated state, not the bare initialUiState", () => {
    // The hydrated EngineState lands in both mirrors: the openTabs
    // fallback (`engine: seeded.state`) and the engineUi mirror
    // (`[id]: seeded`).
    expect(body).toContain("engine: seeded.state");
    expect(body).toContain("[id]: seeded");
    // The old empty-seed is gone from the open flow.
    expect(body).not.toContain("initialUiState(parsed.doc.numPages)");
  });

  it("degrades gracefully when getState fails (no crash, fallback preserved)", () => {
    // `stateResult.ok ? stateResult.value : null` — a failed getState
    // feeds null into the helper, which falls back to the empty initial
    // state (the helper's behavior is unit-tested elsewhere).
    expect(body).toContain("stateResult.ok ? stateResult.value : null");
    expect(body).toContain("seededEngineUiState(");
  });
});