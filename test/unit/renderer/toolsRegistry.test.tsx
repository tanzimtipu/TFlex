// @vitest-environment jsdom
//
// Phase 36 (chunk 1b) — the tool registry.
//
// The registry is the SINGLE inventory of every tool in the renderer, so
// these tests pin the properties the phase depends on:
//
//   1. COMPLETENESS — every control the UI audit found is present, exactly
//      once. The audited id list below is the audit's output; a control that
//      is added or removed in a later chunk must update it deliberately.
//   2. UNIQUENESS — no duplicate id and no duplicate command id.
//   3. EVERY ENTRY IS USABLE — a non-empty label and description, a Lucide
//      icon, and a stage from the five-value vocabulary.
//   4. THE 29 PALETTE IDS KEEP THEIR TEXT — the All-tools palette's labels,
//      descriptions, order and shortcuts are byte-identical to before the
//      registry became the source (a chunk that retires the palette must not
//      silently reword a tool on the way).
//   5. THE PALETTE READS THE REGISTRY — the rendered palette's entry ids and
//      labels come from the registry, not from a private list.
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";
import { buildPaletteRows } from "../../../src/renderer/state/commandPalette";
import {
  PALETTE_GROUPS,
  PALETTE_TOOL_IDS,
  TOOL_REGISTRY,
  dockRelevantIdsForStage,
  dockToolsForStage,
  isPinVisibleInStage,
  paletteEntries,
  toolById,
  toolsForStage,
  type ToolEntry,
} from "../../../src/renderer/state/toolsRegistry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The audit's output: every control the UI exposes, by stage.
 *  DEF-306 — the chunk-1b audit skipped MultiPane.tsx (and StageRail.tsx);
 *  the sweep added `paneOpen`/`panePick`/`paneClear`/`paneResize` and the
 *  four stage buttons here, in registry order. */
const AUDITED: Record<string, readonly string[]> = {
  pages: [
    "merge", "split", "extract", "rotate", "delete", "insertPages",
    "replacePages", "renumberPages", "cropPages", "rotateCounterClockwise",
    "pageThumbnails", "outlinePanel", "pageContextMenu", "clearPageSelection",
    "dragPage",
  ],
  edit: [
    "editMode", "editToolOff", "editText", "editTextBox", "editImage",
    "editDefaultFont", "recognizeText", "batchOcr", "ocrSuspects",
  ],
  review: [
    "annotate", "sign", "flatten", "stamp", "watermark", "bates", "redact", "exportComments",
    "importComments", "fillFromCsv", "exportFormData", "importFormData", "validateDocument",
    "sanitize",
    "engineeringLayers", "documentInfo", "annotationsPanel", "annSelect", "annHighlight",
    "annUnderline", "annStrikeout", "annInk", "annTextbox", "annRect",
    "annEllipse", "annArrow", "annCallout", "annNote", "annColor",
    "annPenWidth",
  ],
  deliver: ["optimize", "audit", "createFromImages", "exportPages", "exportText", "exportDocx", "exportXlsx", "exportPptx", "encrypt"],
  global: [
    "open", "openRecent", "openSample", "removeRecent", "createFromClipboard",
    "save", "saveAs", "print", "find", "zoomIn", "zoomOut", "fitWidth",
    "fitPage", "prevPage", "nextPage", "pageJump", "undo", "redo", "tabNew",
    "tabClose", "multi-mode", "paneOpen", "panePick", "paneClear",
    "paneResize", "toggleTheme", "preferences", "checkForUpdate",
    "updateDownload", "updateInstall", "about", "toolsPalette",
    "panMode", "railCollapse", "stagePages", "stageEdit", "stageReview",
    "stageDeliver", "windowMinimize", "windowMaximize", "windowClose",
    "openReadingView", "openComicView",
  ],
};

const AUDITED_IDS: readonly string[] = Object.values(AUDITED).flat();

/** The palette's pre-registry text, id -> [label, description]. */
const PALETTE_TEXT: Record<string, readonly [string, string]> = {
  merge: ["Merge PDFs", "Combine another PDF with the active document."],
  split: ["Split pages", "Split a range of pages into a new document."],
  extract: ["Extract pages", "Pull specific pages into a new document."],
  rotate: ["Rotate pages", "Rotate the selected page clockwise or counter-clockwise."],
  delete: ["Delete pages", "Remove the selected page from the document."],
  insertPages: ["Insert pages", "Insert a blank page, or import pages from another PDF."],
  replacePages: ["Replace pages", "Swap a contiguous range with another PDF; outline and links survive."],
  renumberPages: ["Rename pages", "Set logical page labels (e.g. i, ii, iii)."],
  cropPages: ["Crop pages", "Set the CropBox/TrimBox for every page."],
  sign: ["Sign", "Draw, type, or place a saved signature."],
  flatten: ["Flatten", "Bake filled form values into the page content."],
  optimize: ["Reduce file size", "Re-serialise the document with a compression preset."],
  audit: ["Audit space usage", "See a per-element breakdown of the file size."],
  stamp: ["Stamp", "Drop an APPROVED, DRAFT, CONFIDENTIAL or FINAL stamp."],
  watermark: ["Watermark", "Overlay text or an image across the selected pages."],
  createFromImages: ["Create PDF from images", "Combine picked images into a new PDF document."],
  "multi-mode": ["Multi Mode", "View two documents side by side in one workspace."],
  recognizeText: ["Recognize text (OCR)", "Add a searchable text layer to a scanned PDF."],
  batchOcr: ["Batch OCR all tabs", "Run OCR on every open document, sequentially."],
  ocrSuspects: ["OCR suspects", "Browse low-confidence words from the last OCR run."],
  exportPages: ["Export pages as images", "Save selected pages as PNG, JPEG, or TIFF files."],
  exportText: ["Export text", "Save extracted text as .txt or .rtf."],
  exportDocx: ["Export to Word (.docx)", "Render every page to a single .docx document."],
  exportComments: ["Export comments (FDF)", "Save every annotation to a local .fdf file."],
  importComments: ["Import comments (FDF)", "Merge a local .fdf file into the active document."],
  fillFromCsv: ["Fill form fields from CSV…", "Map a CSV file’s columns onto the active document’s form fields."],
  exportFormData: ["Export form data…", "Save the active document’s form field values as an FDF or XFDF data file."],
  importFormData: ["Import form data…", "Load FDF or XFDF field values into the active document’s matching form fields."],
  engineeringLayers: ["Engineering layers…", "Show the document’s layers and switch each one on or off."],
  documentInfo: ["Document info…", "Show the document’s PDF/E engineering metadata, layers and 3D content."],
};

const STAGES = ["pages", "edit", "review", "deliver", "global"];

describe("toolsRegistry — completeness and uniqueness", () => {
  it("contains every audited control, and nothing else, exactly once", () => {
    expect(new Set(AUDITED_IDS).size, "the audit list itself has duplicates").toBe(
      AUDITED_IDS.length,
    );
    expect(TOOL_REGISTRY).toHaveLength(AUDITED_IDS.length);
    expect(TOOL_REGISTRY.map((e) => e.id).slice().sort()).toEqual(
      AUDITED_IDS.slice().sort(),
    );
  });

  it("has no duplicate tool id and no duplicate command id", () => {
    const ids = TOOL_REGISTRY.map((e) => e.id);
    const actions = TOOL_REGISTRY.map((e) => e.action);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("gives every entry a label, a description, an icon and a valid stage", () => {
    for (const entry of TOOL_REGISTRY) {
      expect(entry.label.trim().length, entry.id).toBeGreaterThan(0);
      expect(entry.description.trim().length, entry.id).toBeGreaterThan(10);
      expect(entry.icon, entry.id).toBeDefined();
      expect(STAGES, entry.id).toContain(entry.stage);
      expect(typeof entry.shortcut, entry.id).toBe("string");
      expect(entry.action.trim().length, entry.id).toBeGreaterThan(0);
    }
  });

  it("buckets every entry under exactly the audited stage", () => {
    let total = 0;
    for (const [stage, ids] of Object.entries(AUDITED)) {
      expect(toolsForStage(stage as ToolEntry["stage"]).map((e) => e.id), stage).toEqual(ids);
      total += ids.length;
    }
    expect(total).toBe(TOOL_REGISTRY.length);
  });

  it("keeps the two operator-approved placements", () => {
    expect(toolById("multi-mode")?.stage).toBe("global");
    expect(toolById("watermark")?.stage).toBe("review");
  });

  it("returns undefined for an unknown id", () => {
    expect(toolById("nope")).toBeUndefined();
    expect(toolById("")).toBeUndefined();
  });

  it("DEF-306 — registers the Multi Mode pane chrome and the stage buttons as global", () => {
    const paneChrome = ["paneOpen", "panePick", "paneClear", "paneResize"];
    for (const id of paneChrome) {
      const entry = toolById(id);
      expect(entry, id).toBeDefined();
      expect(entry?.stage, id).toBe("global");
      // Multi-Mode-only controls declare their scope in the text: the
      // availability union has no multi-mode-only value, so the entry stays
      // on the precondition that does exist and the surface owns the gate.
      expect(entry?.availability, id).toBe(id === "panePick" ? "multi-doc" : "document");
    }
    // One entry per command: the divider and the pane controls are chrome,
    // not per-pane duplicates.
    expect(new Set(paneChrome.map((id) => toolById(id)?.action)).size).toBe(4);

    const stages = ["stagePages", "stageEdit", "stageReview", "stageDeliver"];
    expect(stages.map((id) => [toolById(id)?.stage, toolById(id)?.shortcut])).toEqual([
      ["global", "Ctrl+1"],
      ["global", "Ctrl+2"],
      ["global", "Ctrl+3"],
      ["global", "Ctrl+4"],
    ]);
  });
});

describe("toolsRegistry — canonical surface + the curated dock sets (DEF-313)", () => {
  it("marks EVERY entry with a surface", () => {
    for (const entry of TOOL_REGISTRY) {
      expect(entry.surface, entry.id).toBeDefined();
    }
  });

  it("gives the REVIEW dock one Annotate primary and the flyout the annotation set", () => {
    // The dock's primary is the FIRST review entry, so `annotate` must lead.
    expect(dockToolsForStage("review")[0]?.id).toBe("annotate");
    expect(toolById("annotate")?.action).toBe("annotate");
    expect(toolById("annotate")?.stage).toBe("review");
  });

  it("marks every annotation tool `surface: 'flyout'` and nothing else", () => {
    const flyout = TOOL_REGISTRY.filter((e) => e.surface === "flyout").map((e) => e.id);
    expect(flyout.sort()).toEqual(
      [
        "annArrow", "annCallout", "annColor", "annEllipse", "annHighlight",
        "annInk", "annNote", "annPenWidth", "annRect", "annSelect",
        "annStrikeout", "annTextbox", "annUnderline",
      ].sort(),
    );
  });

  it("returns the FULL relevant dock set per stage (Phase 37 item 21)", () => {
    expect(dockToolsForStage("pages").map((e) => e.id)).toEqual([
      "rotate", "extract", "insertPages", "replacePages", "split", "delete", "merge", "cropPages",
    ]);
    expect(dockToolsForStage("edit").map((e) => e.id)).toEqual([
      "editToolOff", "editText", "editImage", "editTextBox", "recognizeText", "batchOcr", "ocrSuspects",
    ]);
    expect(dockToolsForStage("review").map((e) => e.id)).toEqual([
      "annotate", "sign", "stamp", "flatten", "watermark", "bates",
      "exportComments", "importComments", "fillFromCsv", "exportFormData",
      "importFormData", "validateDocument", "sanitize", "engineeringLayers", "documentInfo",
    ]);
    expect(dockToolsForStage("deliver").map((e) => e.id)).toEqual([
      "optimize", "audit", "exportPages", "exportText", "exportDocx",
      "exportXlsx", "exportPptx", "createFromImages", "encrypt",
    ]);
    expect(dockToolsForStage("global")).toEqual([]);
    // The closed list must equal the derived Phase-37 relevance rule exactly, so
    // the rule cannot drift from the rendered set.
    for (const stage of ["pages", "edit", "review", "deliver"] as const) {
      expect(
        new Set(dockToolsForStage(stage).map((e) => e.id)),
        stage,
      ).toEqual(new Set(dockRelevantIdsForStage(stage)));
    }
  });

  it("keeps the panel/navigation verbs and GLOBAL entries OUT of the dock", () => {
    const allDockIds = ["pages", "edit", "review", "deliver"].flatMap((s) =>
      dockToolsForStage(s as "pages").map((e) => e.id),
    );
    for (const id of [
      "renumberPages", "rotateCounterClockwise", "pageThumbnails",
      "outlinePanel", "pageContextMenu", "clearPageSelection", "dragPage",
      "editMode", "editDefaultFont", "annotationsPanel",
      "annSelect", "annHighlight", "annInk", "annColor", "annPenWidth",
      "stagePages", "open", "save", "undo",
    ]) {
      expect(allDockIds, id).not.toContain(id);
      // ...and each is still a registered entry (nothing removed).
      expect(toolById(id), id).toBeDefined();
    }
  });
});

describe("toolsRegistry — Phase 42: one icon per tool and one home per tool", () => {
  it("gives every entry a DISTINCT icon (zero duplicate icon groups)", () => {
    const icons = TOOL_REGISTRY.map((e) => e.icon);
    const distinct = new Set(icons);
    // The identity of a Lucide icon is its component reference, so a shared
    // glyph is a shared reference and this set collapses the duplicates.
    expect(distinct.size, "entries vs distinct icons").toBe(TOOL_REGISTRY.length);
    // And no two entries share a component: a duplicate would appear here.
    const seen = new Map<unknown, string>();
    const clashes: string[] = [];
    for (const entry of TOOL_REGISTRY) {
      const prev = seen.get(entry.icon);
      if (prev !== undefined) clashes.push(`${prev} + ${entry.id}`);
      else seen.set(entry.icon, entry.id);
    }
    expect(clashes, "duplicate icon groups").toEqual([]);
  });

  it("puts watermark in exactly ONE stage's dock (REVIEW) and no other", () => {
    const stages = ["pages", "edit", "review", "deliver"] as const;
    const holders = stages.filter((stage) =>
      dockToolsForStage(stage).some((e) => e.id === "watermark"),
    );
    expect(holders).toEqual(["review"]);
    // The registry designates REVIEW as its canonical stage.
    expect(toolById("watermark")?.stage).toBe("review");
  });

  it("keeps watermark reachable (and enabled) through the palette", () => {
    expect(PALETTE_TOOL_IDS).toContain("watermark");
    const row = buildPaletteRows({ query: "watermark" }).find(
      (r) => r.kind === "tool" && r.id === "watermark",
    );
    expect(row?.kind === "tool" ? row.enabled : false).toBe(true);
  });

  it("renders a stale STAGE pin only in the tool's own stage; GLOBAL pins anywhere", () => {
    // The operator's persisted `dockPins: ['watermark']` must not leak into the
    // EDIT dock; it surfaces only in REVIEW.
    const watermark = toolById("watermark");
    expect(watermark).toBeDefined();
    if (watermark === undefined) return;
    expect(isPinVisibleInStage(watermark, "review")).toBe(true);
    expect(isPinVisibleInStage(watermark, "edit")).toBe(false);
    expect(isPinVisibleInStage(watermark, "pages")).toBe(false);
    // A GLOBAL tool has no stage dock, so a pin is its only home and it may
    // appear in any stage.
    const undo = toolById("undo");
    expect(undo?.stage).toBe("global");
    if (undo === undefined) return;
    for (const stage of ["pages", "edit", "review", "deliver"] as const) {
      expect(isPinVisibleInStage(undo, stage), stage).toBe(true);
    }
  });
});

describe("toolsRegistry — the palette's 30 entries", () => {
  it("preserves the 30 ids, their canonical order and the four groups", () => {
    expect(PALETTE_TOOL_IDS).toHaveLength(30);
    expect(new Set(PALETTE_TOOL_IDS).size).toBe(30);
    expect(PALETTE_GROUPS.map((g) => g.id)).toEqual([
      "organize",
      "document",
      "recognition",
      "export",
    ]);
    expect(paletteEntries().map((e) => e.id)).toEqual([...PALETTE_TOOL_IDS]);
  });

  it("keeps every palette label and description byte-identical", () => {
    expect(Object.keys(PALETTE_TEXT)).toHaveLength(30);
    for (const [id, [label, description]] of Object.entries(PALETTE_TEXT)) {
      expect(toolById(id)?.label, id).toBe(label);
      expect(toolById(id)?.description, id).toBe(description);
    }
  });

  it("keeps the palette's two accelerators and invents no others", () => {
    expect(
      paletteEntries()
        .filter((e) => e.shortcut !== "")
        .map((e) => [e.id, e.shortcut]),
    ).toEqual([
      ["merge", "Ctrl+Shift+O"],
      ["recognizeText", "Ctrl+Shift+R"],
    ]);
  });
});

/** Mount the palette with EVERY optional handler wired, so all 29 registry
 *  entries render (an unwired entry is correctly absent — see
 *  toolsPaletteOrganization.test.tsx). */
function mountFullyWiredPalette(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const noop = (): void => undefined;
  act((): void => {
    root.render(
      <ToolsPalette
        layout="list"
        onLayoutChange={noop}
        onMerge={noop}
        onSplit={noop}
        onExtract={noop}
        onRotate={noop}
        onDelete={noop}
        onSign={noop}
        onFlatten={noop}
        onOptimize={noop}
        onAudit={noop}
        onClose={noop}
        onCreateFromImages={noop}
        onExportPages={noop}
        onExportText={noop}
        onExportDocx={noop}
        onInsertPages={noop}
        onRecognizeText={noop}
        onBatchOcr={noop}
        onOcrSuspects={noop}
        onReplacePages={noop}
        onRenumberPages={noop}
        onCropPages={noop}
        onStamp={noop}
        onExportComments={noop}
        onImportComments={noop}
        onFillFromCsv={noop}
        onExportFormData={noop}
        onImportFormData={noop}
        onEngineeringLayers={noop}
        onDocumentInfo={noop}
        onWatermark={noop}
        onMultiMode={noop}
        hasOcrSuspects
        documentRequired
        hasFormFields
      />,
    );
  });
  return host;
}

describe("ToolsPalette reads the registry", () => {
  it("renders the registry's 30 entries, in registry order, with registry text and icons", () => {
    const host = mountFullyWiredPalette();
    const ids = [...host.querySelectorAll("[data-tool-id]")].map((el) =>
      el.getAttribute("data-tool-id"),
    );
    expect(ids).toEqual([...PALETTE_TOOL_IDS]);
    for (const id of ids) {
      const button = host.querySelector(`[data-tool-id="${id}"]`);
      const entry = toolById(id ?? "");
      expect(entry, String(id)).toBeDefined();
      expect(button?.querySelector("svg"), String(id)).not.toBeNull();
      expect(
        button?.querySelector(".tools-palette-entry-label")?.textContent,
        String(id),
      ).toBe(entry?.label);
      expect(
        button?.querySelector(".tools-palette-entry-desc")?.textContent,
        String(id),
      ).toBe(entry?.description);
      expect(button?.getAttribute("aria-label"), String(id)).toBe(entry?.label);
      expect(button?.getAttribute("title"), String(id)).toBe(entry?.description);
    }
    host.remove();
  });
});

