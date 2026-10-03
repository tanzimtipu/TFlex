// @vitest-environment node
//
// Phase 94 (feature A) — the fail-loud "no ad-hoc icon" source guard.
//
// Two rules over `src/renderer/**/*.{ts,tsx}`:
//   (a) any `<svg` belongs to the functional/brand allow-list below; a tool
//       icon must render through the central `Icon` wrapper, never as a
//       hand-declared inline SVG;
//   (b) a migrated named surface must not pass a raw numeric `size={...}` to a
//       Lucide glyph — sizes are token names from `ICON_SIZES`.
//
// The scan lists are explicit on purpose: Phase 94B (tool/command surfaces) and
// 94C (shell/panel/dialog/status surfaces) APPEND their migrated files to
// RAW_SIZE_SCAN_FILES as they land. The `<svg` rule is app-wide from the start.

import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = resolve(process.cwd(), "src/renderer");

/**
 * Functional/brand vector art (NOT tool icons): the only files permitted to
 * hand-declare an inline SVG. Each carries its reason; the list is exactly the
 * Phase 94 ruling-current-state item 5 set.
 */
const SVG_ALLOWLIST: Readonly<Record<string, string>> = {
  "components/BrandMark.tsx": "Phase 69/70 Jovrel brand mark: brand art, not a tool icon",
  "components/BrandLoader.tsx": "brand loader mark: brand art, not a tool icon",
  "components/AccountsDialog.tsx": "Phase 44 Google provider mark: third-party identity art",
  "annotations/AnnotationOverlay.tsx": "annotation/callout canvas: rendered page content, not chrome",
  "signatures/SignaturesOverlay.tsx": "signature vector source: rendered page content, not chrome",
  "signatures/SignatureManagerModal.tsx": "signature thumbnail rendering: page content, not chrome",
};

/**
 * The named surfaces Phase 94A migrated to the wrapper. Any direct Lucide
 * render here with a numeric `size` fails. 94B/94C extend this list.
 */
const RAW_SIZE_SCAN_FILES: readonly string[] = [
  "forms/FormsOverlay.tsx",
  "annotations/AnnCommentIcon.tsx",
  // Phase 94B — the tool/command identity surface sweep. `state/toolsRegistry.ts`
  // is deliberately NOT listed: it is a NO-CHANGE state module that renders no
  // glyph (only `icon: X` references), so it has nothing to scan and cannot
  // satisfy this suite's wrapper-presence assertion.
  "components/AppHeader.tsx",
  "components/TitleBar.tsx",
  "components/StageRail.tsx",
  "components/ActionDock.tsx",
  "components/CommandBar.tsx",
  "components/CommandPalette.tsx",
  "components/PageLayoutControl.tsx",
  "components/CanvasPills.tsx",
  "annotations/AnnotationToolbar.tsx",
  "components/ContextPanel.tsx",
  // Phase 94C1 — the dialog-chrome sweep: every `*Dialog.tsx` that still
  // rendered a direct Lucide glyph now renders through the wrapper. MergeDialog
  // and SplitDialog are deliberately NOT listed: both delegate their close
  // affordance to DialogShell and render no glyph in-file, so they cannot
  // satisfy the wrapper-presence assertion below (they are covered transitively
  // through DialogShell, which IS listed). DocxExportDialog / OcrDialog /
  // OfficeExportDialog / OptimizeDialog joined that DialogShell-delegating set,
  // and RenumberPagesDialog followed after its DialogShell migration (it now
  // renders no glyph in-file), so none of them are listed here either.
  "components/AboutDialog.tsx",
  "components/AccountsDialog.tsx",
  "components/AuditSpaceDialog.tsx",
  "components/BatesDialog.tsx",
  "components/BlankPagesDialog.tsx",
  "components/CommentExportDialog.tsx",
  "components/CommentImportDialog.tsx",
  "components/CreateFromImagesDialog.tsx",
  "components/CropPagesDialog.tsx",
  "components/DialogShell.tsx",
  "components/EncryptDialog.tsx",
  "components/FillFromCsvDialog.tsx",
  "components/FormDataIoDialog.tsx",
  "components/InsertPagesDialog.tsx",
  "components/PasswordPromptDialog.tsx",
  "components/PreferencesDialog.tsx",
  "components/ReplacePagesDialog.tsx",
  "components/SanitizeDialog.tsx",
  "components/StampDialog.tsx",
  "components/UpdatePromptDialog.tsx",
  "components/ValidateDocumentDialog.tsx",
  "components/WatermarkDialog.tsx",
  // Phase 94C2 — the shell / panel / view / status sweep: the remaining chrome
  // surfaces (toasts, notices, side rail, welcome, text properties, print
  // window, signatures) now render every direct Lucide glyph through the
  // wrapper. `annotations/AnnotationOverlay.tsx` is deliberately NOT listed:
  // its StickyNote render is a zoom-scaled on-page page-content mark (dynamic
  // `size`), not chrome, so it keeps its direct render.
  "annotations/AnnotationCommentBox.tsx",
  "annotations/AnnotationsPanel.tsx",
  "App.tsx",
  "components/AccountMenu.tsx",
  "components/AnimatedTab.tsx",
  "components/AnnotationFlyout.tsx",
  "components/BookView.tsx",
  "components/ConversionNotice.tsx",
  "components/DocumentView.tsx",
  "components/EngineeringLayersPanel.tsx",
  "components/ExportFidelityNotes.tsx",
  "components/Inspector.tsx",
  "components/MultiPane.tsx",
  "components/OcrSuspectsPanel.tsx",
  "components/Pdf3dNotice.tsx",
  "components/ProtectionNotice.tsx",
  "components/ReadingView.tsx",
  "components/SearchBar.tsx",
  "components/selectableContent.tsx",
  "components/SideRail.tsx",
  "components/Toasts.tsx",
  "components/ToolsPalette.tsx",
  "components/UpdateIndicator.tsx",
  "components/ValidationNotice.tsx",
  "components/Welcome.tsx",
  "edit/TextPropertiesPanel.tsx",
  "print-window/PrintWindowApp.tsx",
  "signatures/SignatureManagerModal.tsx",
];

/**
 * The ONLY direct Lucide renders permitted to bind their own `size`, keyed by
 * `"<file>:<icon>"` with a written reason (mirrors the Phase 43 `SHARED_ALLOW`
 * style). Everything else in a migrated surface must render through `Icon`.
 */
const RAW_SIZE_DIRECT_ALLOW: Readonly<Record<string, string>> = {
  "components/CommandPalette.tsx:Pin":
    'the pin toggle: its `fill` encodes pinned state (currentColor vs none), and the wrapper forces fill="none"; it is a stateful glyph, not chrome',
  "annotations/AnnotationToolbar.tsx:Slash":
    "the pen-width swatch: its inline svg size/stroke ARE the data (pen thickness), not decoration",
};

function sourceFiles(dir: string = RENDERER): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function relOf(file: string): string {
  return relative(RENDERER, file).replace(/\\/g, "/");
}

/** Lucide value names imported by a file (mirrors the Phase 43 extractor). */
function importedLucide(text: string): string[] {
  const names = new Set<string>();
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && name !== "LucideIcon") names.add(name);
    }
  }
  return [...names];
}

const SVG = /<svg[\s/>]/;

describe("Phase 94 — no ad-hoc inline SVG UI icons", () => {
  it("every <svg in the renderer is on the functional/brand allow-list", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relOf(file);
      if (SVG_ALLOWLIST[rel] === undefined && SVG.test(readFileSync(file, "utf8"))) {
        offenders.push(rel);
      }
    }
    expect(offenders, "hand-declared inline SVG outside the allow-list").toEqual([]);
  });

  it("the allow-list is not stale: every listed file really declares an SVG", () => {
    for (const rel of Object.keys(SVG_ALLOWLIST)) {
      expect(readFileSync(resolve(RENDERER, rel), "utf8"), rel).toMatch(SVG);
    }
  });
});

describe("Phase 94 — migrated surfaces use token sizes, not raw numerics", () => {
  it("a direct Lucide render in a migrated surface never binds its own size={...}", () => {
    const violations: string[] = [];
    for (const rel of RAW_SIZE_SCAN_FILES) {
      const text = readFileSync(resolve(RENDERER, rel), "utf8");
      for (const name of importedLucide(text)) {
        if (RAW_SIZE_DIRECT_ALLOW[`${rel}:${name}`] !== undefined) continue;
        // Whole-file (NOT per-line): the opening tag is matched across newlines
        // and bounded at `>`, so a multi-line render cannot escape the scan.
        if (new RegExp(`<${name}\\b[^>]*size=\\{`, "s").test(text)) {
          violations.push(`${rel} <${name} size={...}`);
        }
      }
    }
    expect(violations, "raw size on a direct Lucide render (whole-file scan)").toEqual([]);
  });

  it("every direct-render allow-list entry is still a real direct render (not stale)", () => {
    for (const key of Object.keys(RAW_SIZE_DIRECT_ALLOW)) {
      const rel = key.slice(0, key.lastIndexOf(":"));
      const name = key.slice(key.lastIndexOf(":") + 1);
      const text = readFileSync(resolve(RENDERER, rel), "utf8");
      expect(
        new RegExp(`<${name}\\b[^>]*size=\\{`, "s").test(text),
        `${key} is allow-listed but is no longer a direct sized render`,
      ).toBe(true);
    }
  });

  it("the two Phase 94A surfaces render through the central wrapper", () => {
    for (const rel of RAW_SIZE_SCAN_FILES) {
      expect(readFileSync(resolve(RENDERER, rel), "utf8"), rel).toContain("<Icon");
    }
  });
});
