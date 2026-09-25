// @vitest-environment jsdom
//
// DEF-345 — the Inspector must not keep an ENABLED text-manipulation panel
// after the text stage is left.
//
// The adversary reproduced it on long.pdf / report.pdf: select a text run in
// EDIT, press Ctrl+1 (PAGES). The header's selection line already read
// "page", but `inspectorTextPanelFor` returned a panel for the stale snapshot
// whenever one existed, so the field stayed enabled and typing was accepted
// then silently discarded (fail-loud violation). The fix routes the panel
// through `inspectorTextPanelForSelection`, which yields a panel only while
// the RESOLVED selection kind is `text`.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  inspectorSelectionFor,
  inspectorTextPanelFor,
  inspectorTextPanelForSelection,
} from "../../../src/renderer/components/Inspector";
import type { InspectorTextSelection } from "../../../src/renderer/components/Inspector";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";

function textSnapshot(overrides: Partial<InspectorTextSelection> = {}): InspectorTextSelection {
  const values = defaultTextStyleValues("Helvetica");
  return {
    targetKey: "run:1",
    name: "Text run",
    values,
    defaults: values,
    mode: "text",
    text: "Hello world",
    onPatch: vi.fn(),
    onTextChange: vi.fn(),
    onTextCommit: vi.fn(),
    focusToken: 1,
    ...overrides,
  };
}

describe("DEF-345 — the Inspector text panel follows the RESOLVED selection", () => {
  const text = textSnapshot();

  it("shows the panel for the legitimate EDIT flow", () => {
    const selection = inspectorSelectionFor({ stage: "edit", text, signatureLabel: null, page: 1 });
    expect(selection.kind).toBe("text");
    const panel = inspectorTextPanelForSelection(selection, text);
    expect(panel).not.toBeNull();
    expect(panel?.text).toBe("Hello world");
  });

  it("shows the panel for the legitimate REVIEW annotate flow", () => {
    const selection = inspectorSelectionFor({ stage: "review", text, signatureLabel: null, page: 1 });
    expect(selection.kind).toBe("text");
    expect(inspectorTextPanelForSelection(selection, text)).not.toBeNull();
  });

  it("drops the panel when the SAME snapshot survives a switch to PAGES", () => {
    // The stale surface the adversary recorded: the snapshot is still non-null,
    // but the stage no longer resolves a text target.
    const selection = inspectorSelectionFor({ stage: "pages", text, signatureLabel: null, page: 1 });
    expect(selection.kind).toBe("page");
    expect(inspectorTextPanelForSelection(selection, text)).toBeNull();
    // And the raw mapper would still have returned a panel — the precise bug.
    expect(inspectorTextPanelFor(text)).not.toBeNull();
  });

  it("drops the panel in REVIEW when the text target is gone (signature/page)", () => {
    const signature = inspectorSelectionFor({
      stage: "review",
      text: null,
      signatureLabel: "Ada",
      page: 1,
    });
    expect(signature.kind).toBe("signature");
    expect(inspectorTextPanelForSelection(signature, text)).toBeNull();
    const page = inspectorSelectionFor({ stage: "pages", text: null, signatureLabel: null, page: 2 });
    expect(inspectorTextPanelForSelection(page, text)).toBeNull();
  });

  it("App routes the panel through the selection-aware helper", () => {
    const app = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");
    expect(app).toContain("inspectorTextPanelForSelection(");
    expect(app).not.toMatch(/inspectorTextPanelFor\(\s*inspectorTextSelection\s*\)/);
  });
});
