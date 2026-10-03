// @vitest-environment node
//
// Phase 43 (item 2, criterion 4) — the APP-WIDE icon-identity invariant.
//
// Phase 42's registry invariant already pins "one icon per registry tool". This
// test EXTENDS it to the app's icon usages as a source scan: every named icon
// surface (the registry, the header controls, the page-layout control, the
// dock, the palette, the panels/rail, the pills, the dialogs and the Multi Mode
// pane chrome) is parsed for its Lucide imports and `<Icon` usages, and an icon
// may be shared across files ONLY when it is on the explicit, justified
// allow-list below.
//
// The operator's confirmed clash — the Multi Mode toggle and the two-page
// layout option rendering the same glyph — is guarded directly (the last two
// tests): the two controls must never resolve to the same icon, and the
// layout control's three glyphs must not leak into any other named surface.
//
// "Different actions may not share" is enforced for NEW collisions: an icon
// used by two named surfaces fails unless it is listed here. The allow-list is
// deliberately small and splits into two kinds:
//   (a) ONE universal affordance repeated verbatim (the close X), and
//   (b) a single action that legitimately renders the same glyph in more than
//       one surface (page zoom in the pills AND the legacy CommandBar; an
//       annotation type in its toolbar AND its list legend; "delete" in every
//       delete verb; a menu-disclosure chevron; a rail-scroll chevron).

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = resolve(process.cwd(), "src/renderer");

/** The named icon surfaces the invariant covers. */
const NAMED_FILES: readonly string[] = [
  "state/toolsRegistry.ts",
  "components/AppHeader.tsx",
  "components/AccountMenu.tsx",
  "components/TitleBar.tsx",
  "components/PageLayoutControl.tsx",
  "components/ActionDock.tsx",
  "components/CommandPalette.tsx",
  "components/SideRail.tsx",
  "components/StageRail.tsx",
  "components/ContextPanel.tsx",
  "components/Inspector.tsx",
  "components/OcrSuspectsPanel.tsx",
  "annotations/AnnotationsPanel.tsx",
  "annotations/AnnotationToolbar.tsx",
  "annotations/AnnotationOverlay.tsx",
  "annotations/AnnCommentIcon.tsx",
  "annotations/AnnotationCommentBox.tsx",
  "edit/TextPropertiesPanel.tsx",
  "components/AnnotationFlyout.tsx",
  "components/CanvasPills.tsx",
  "components/CommandBar.tsx",
  "components/MultiPane.tsx",
  "components/Welcome.tsx",
  "components/Toasts.tsx",
  "components/UpdateIndicator.tsx",
  "components/UpdatePromptDialog.tsx",
  // The print window is a SECOND document surface (its own BrowserWindow via
  // main.tsx); its warning/alert glyphs are audited here so the shared-icon
  // allow-list covers them (DEF-363 `TriangleAlert`).
  "print-window/PrintWindowApp.tsx",
];

/**
 * Components that no longer exist on any rendered surface: they are imported
 * by nobody, so their icons cannot collide with a live one. They are parsed
 * out of the sweep (not allow-listed) and the test below fails if one is ever
 * re-wired, at which point it must move back into NAMED_FILES.
 */
const DEAD_FILES: readonly string[] = ["components/ToolsPalette.tsx"];

/** Every dialog in the renderer's components folder that renders a Lucide glyph. */
const DIALOG_FILES: readonly string[] = readdirSync(resolve(RENDERER, "components"))
  .filter((n) => /Dialog\.tsx$/.test(n))
  .map((n) => `components/${n}`)
  .filter((f) => readFileSync(resolve(RENDERER, f), "utf8").includes("lucide-react"));

/**
 * Icons allowed to appear in more than one named file, each with its reason.
 * Anything not listed here may live in exactly one named file.
 */
const SHARED_ALLOW: Readonly<Record<string, string>> = {
  // (a) the one universal affordance.
  X: "the close / dismiss / remove affordance, repeated verbatim on every dialog, panel, toast and window control",
  // (b) the same action rendered on more than one surface.
  // Phase 58 (operator amendment) — the edit-mode remove-tool badge on the dock
  // and the home edit rows is specified to be "a minus icon", so it shares the
  // glyph with the pre-existing window-minimize caption control.
  Minus: "the horizontal-line affordance: window minimize (caption control) plus the Phase-58 remove-tool badges on the dock and home edit rows; distinct contexts, never ambiguous",
  ChevronRight: "page paging forward (CanvasPills + CommandBar + registry nextPage); the outline disclosure uses the distinct SquareChevronRight",
  ChevronLeft: "page paging backward (CanvasPills + CommandBar + registry prevPage)",
  SquareChevronRight: "outline tree disclosure toggle (context panel outline + side rail outline tree)",
  ChevronsLeft: "rail/dock scroll-left affordance (ActionDock + AnnotationFlyout)",
  ChevronsRight: "rail/dock scroll-right affordance (ActionDock + AnnotationFlyout)",
  ChevronDown: "menu/disclosure chevron (theme menu + title-bar menu + tool menu)",
  Slash: "the pen-width control (registry annPenWidth + the annotation toolbar's width swatch)",
  Plus: "new-tab verb (header + registry tabNew)",
  ZoomIn: "zoom-in, the pills' and the legacy bar's rendering of the registry zoomIn action",
  ZoomOut: "zoom-out, the pills' and the legacy bar's rendering of the registry zoomOut action",
  MoveHorizontal: "fit-width, the pills' and the legacy bar's rendering of the registry fitWidth action",
  Expand: "fit-page, the pills' and the legacy bar's rendering of the registry fitPage action",
  Hand: "pan mode, the pills' and the legacy bar's rendering of the registry panMode action",
  FolderOpen: "the open-a-PDF verb (header, welcome, Multi Mode pane, registry open)",
  GitMerge: "the merge/combine verb (welcome, header merge, context combine, registry merge)",
  Search: "the find-in-document verb (header find control + legacy bar + registry find); the palette search-field uses the distinct TextSearch",
  Settings: "the open-preferences verb (header gear + stage rail gear + registry preferences)",
  Trash2: "the delete verb (page delete, annotation delete, saved-signature delete)",
  FileSignature: "the sign verb (sign tool + registry sign + its context entries)",
  PanelsLeftRight: "the Multi Mode verb (header toggle + legacy bar toggle + registry/palette route)",
  Sparkles: "the open-sample verb (welcome sample card + registry openSample)",
  FilePlus2: "the add-document/page verb (context panel + registry insertPages; Welcome holds a hidden bundle sprite)",
  Download: "the download-update verb (update indicator + registry updateDownload)",
  RefreshCw: "the check-for-update / retry verb (indicator + update prompt + registry checkForUpdate)",
  Type: "the annotation text type glyph (annotation toolbar + list legend)",
  TextCursor: "the edit-content text item (registry editText + the context panel's edit-content text row)",
  MessageSquareText: "the annotations-rail verb (registry annotationsPanel + the rail's annotations tab)",
  MessageSquare: "the on-page comment/note affordance (the placed note marker's AnnCommentIcon + its AnnotationCommentBox editor header); one comment concept, two surfaces",
  TriangleAlert: "the warning/alert glyph (registry ocrSuspects \"review suspects\" + the print window's error banner); the print window is a SEPARATE document surface (its own BrowserWindow), and both uses are the same warning semantics",
  // Annotation tool glyphs shared between the toolbar and the annotations list legend.
  Highlighter: "highlight annotation type (annotation toolbar + list legend); the Inspector text-format toggle uses the distinct PaintBucket",
  Underline: "underline annotation type (annotation toolbar + list legend); the Inspector text-format toggle uses the distinct Baseline",
  Strikethrough: "strikethrough annotation type (annotation toolbar + list legend)",
  Pen: "ink annotation type (annotation toolbar + list legend)",
  Square: "rectangle annotation type (annotation toolbar + list legend)",
  Circle: "ellipse annotation type (annotation toolbar + list legend)",
  ArrowUpRight: "arrow annotation type (annotation toolbar + list legend)",
  StickyNote: "sticky-note annotation type (annotation toolbar + list legend) and the placed on-page note marker, which renders the note it represents",
  MessageCirclePlus: "add-comment annotation type (annotation toolbar + list legend)",
  PanelLeftClose: "collapse a side panel (rail + context panel + registry railCollapse)",
  PanelRightOpen: "expand a side panel (rail + context panel + inspector)",
  Check: "the check/confirm mark (registry toggle + annotation tool menu selection)",
  Crop: "the crop-pages verb (registry cropPages + its dialog)",
  Ellipsis: "the more-actions overflow (registry moreActions + the dock's overflow lane)",
  FileDown: "the export-comments verb (registry exportComments + its dialog)",
  File: "the generic document/file item glyph (Multi Mode untitled pane + welcome-recents file row); both denote an open PDF document",
  ClipboardPaste: "the create-PDF-from-clipboard verb (registry createFromClipboard + the CreateFromImagesDialog paste affordance)",
  GripVertical: "the drag-handle affordance (page drag + the Multi Mode divider)",
  Images: "the page-thumbnails verb (registry pageThumbnails + the rail's thumbs tab)",
  Layers: "the flatten verb (registry flatten + the legacy bar)",
  List: "the outline/bookmarks verb (registry outlinePanel + the rail's outline tab)",
  Minimize2: "the optimize verb (registry optimize + the legacy bar)",
  Moon: "the dark-theme option (registry theme entry + the header theme icon)",
  MousePointer2: "the annotation Select tool (registry annSelect + the toolbar)",
  Pencil: "the edit-content verb (registry editMode + the legacy bar)",
  PieChart: "the audit-space verb (registry audit + the legacy bar)",
  Printer: "the print verb (registry print + the header)",
  RotateCcw: "rotate counter-clockwise (registry + the legacy bar)",
  RotateCw: "rotate clockwise (registry + the rail verb + the legacy bar)",
  Save: "the save verb (registry save + the header)",
  SaveAll: "the save-a-copy verb (registry saveAs + the header)",
  // Phase 44 (operator amendment) — the account menu repeats two verbs that
  // already live on the signed-in account dialog: sign out and sync now.
  LogOut: "the sign-out verb (the signed-in AccountsDialog surface + the top-bar avatar menu)",
  RefreshCcw: "the sync-now verb (the signed-in AccountsDialog surface + the top-bar avatar menu)",
  ScanText: "the recognize-text/OCR verb (registry + the context panel)",
  Scissors: "the extract/split verb (registry + the rail verb + the legacy bar)",
  Stamp: "the stamp verb (registry stamp + its dialog)",
  Undo2: "the undo verb (registry undo + the rail verb)",
  FileSpreadsheet: "the fill-form-fields-from-CSV verb (registry fillFromCsv + its import dialog); one concept, two surfaces",
  Upload: "the confirm-import action (CommentImportDialog + FillFromCsvDialog) rendered identically on both import dialogs",
  // Phase 88 (FEA-037) — the sanitize verb renders the same Shield glyph on the
  // REVIEW dock (registry) and the SanitizeDialog it opens.
  Shield: "the sanitize-document verb (SanitizeDialog + the registry's sanitize entry); one concept, two surfaces",
  // Phase 89 (FEA-033) — the Bates-numbering verb renders the same Hash glyph
  // on the registry dock entry, its dialog, and the Inspector's Bates row.
  Hash: "the Bates-numbering verb (BatesDialog + Inspector's Bates row + the registry's bates entry); one concept, the same glyph",
  // Phase 84 — the redact verb renders Eraser on the registry entry and the
  // edit TextPropertiesPanel's redact control.
  Eraser: "the redact-marked-region verb (the edit TextPropertiesPanel's redact control + the registry's redact entry)",
  // Phase 88 (FEA-037) — the two list-indent controls share their directional
  // glyphs between the SideRail edit controls and the TextPropertiesPanel.
  IndentIncrease: "the increase-list-indent control (SideRail edit controls + TextPropertiesPanel); one direction, two surfaces",
  IndentDecrease: "the decrease-list-indent control (SideRail edit controls + TextPropertiesPanel); one direction, two surfaces",
};

interface Usage {
  file: string;
  icon: string;
  line: number;
}

/** Lucide names imported by a file. */
function importedIcons(text: string): Set<string> {
  const names = new Set<string>();
  // `[^}]*` (NOT the lazy `[\s\S]*?`) keeps each import's specifier list
  // inside its OWN braces. The lazy form spanned statement boundaries, so an
  // earlier `import { useMemo } from 'react'` was swallowed into the next
  // lucide import and its FIRST named icon was dropped (DEF-363: Inspector's
  // `Hash`). Matching one statement at a time fixes the extractor; the guard
  // is unchanged in strictness.
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && name !== "LucideIcon") names.add(name);
    }
  }
  return names;
}

function usagesIn(file: string, text: string): Usage[] {
  const names = importedIcons(text);
  const lines = text.split(/\r?\n/);
  const out: Usage[] = [];
  lines.forEach((line, i) => {
    for (const icon of names) {
      // A glyph is "used" when it is rendered (`<Icon` JSX), assigned as a
      // control's icon (`icon: Icon` in the registry, `Icon: Icon` in the
      // page-layout option table), or passed to the Phase 94 central wrapper
      // (`icon={Icon}` — including the DialogShell `icon={<Icon icon={Icon}>`
      // form, whose inner expression the same pattern matches). Phase 94C1
      // migrated the dialog chrome onto the wrapper, so without this third form
      // a migrated dialog would contribute no usage and read as dead.
      const used =
        new RegExp(`<${icon}(?![A-Za-z0-9])`).test(line) ||
        new RegExp(`(?:^|[\\s{(])[iI]con:\\s*${icon}\\b`).test(line) ||
        new RegExp(`[iI]con=\\{\\s*${icon}\\b`).test(line);
      if (used) {
        out.push({ file, icon, line: i + 1 });
      }
    }
  });
  return out;
}

const FILES = [...new Set([...NAMED_FILES, ...DIALOG_FILES])];
const USAGES: Usage[] = FILES.flatMap((file) =>
  usagesIn(file, readFileSync(resolve(RENDERER, file), "utf8")),
);

function iconOwners(icon: string): string[] {
  return [...new Set(USAGES.filter((u) => u.icon === icon).map((u) => u.file))].sort();
}

/** Every TypeScript module under the renderer, for reachability checks. */
function rendererModules(): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
    }
  };
  visit(RENDERER);
  return out;
}

describe("Phase 43 — app-wide icon identity", () => {
  it("DEF-363: the extractor detects the first named icon after a preceding import", () => {
    const text = [
      "import { useMemo } from 'react';",
      "import type { ReactElement, ReactNode } from 'react';",
      "import { Hash, PanelRightClose, PanelRightOpen, X } from 'lucide-react';",
    ].join("\n");
    expect([...importedIcons(text)].sort()).toEqual([
      "Hash",
      "PanelRightClose",
      "PanelRightOpen",
      "X",
    ]);
    // The exact file that exposed the bug: `Hash` is its first named import.
    const inspector = readFileSync(resolve(RENDERER, "components/Inspector.tsx"), "utf8");
    expect([...importedIcons(inspector)]).toContain("Hash");
  });

  it("dead files stay unimportable (excluded from the sweep, not allow-listed)", () => {
    const modules = rendererModules();
    for (const dead of DEAD_FILES) {
      const abs = resolve(RENDERER, dead);
      const name = dead.split("/").pop()!.replace(/\.tsx?$/, "");
      const importRe = new RegExp(`from\\s+["'][^"']*${name}["']|<${name}\\b`);
      const importers = modules.filter((p) => p !== abs && importRe.test(readFileSync(p, "utf8")));
      expect(importers, `${dead} is DEAD but is now imported by ${importers.join(", ")}`).toEqual([]);
    }
  });
  it("every named surface exists and contributes icon usages", () => {
    for (const file of NAMED_FILES) {
      expect(USAGES.some((u) => u.file === file), `${file} contributes no icon usage`).toBe(true);
    }
  });

  it("no icon is shared by two named surfaces unless it is allow-listed with a reason", () => {
    const violations: string[] = [];
    for (const icon of new Set(USAGES.map((u) => u.icon))) {
      const owners = iconOwners(icon);
      if (owners.length < 2) continue;
      if (SHARED_ALLOW[icon] === undefined) {
        violations.push(`${icon} shared by ${owners.join(" + ")}`);
      }
    }
    expect(violations, "un-allow-listed shared icons").toEqual([]);
  });

  it("every allow-listed icon actually has a written reason and is still shared", () => {
    for (const [icon, reason] of Object.entries(SHARED_ALLOW)) {
      expect(reason.length, `${icon} needs a reason`).toBeGreaterThan(10);
      // (X is universal; the rest must still be shared somewhere or the list is stale.)
      expect(iconOwners(icon).length, `${icon} is no longer shared; drop it from the list`).toBeGreaterThan(1);
    }
  });

  it("the layout control's three glyphs are unique app-wide", () => {
    const layout = readFileSync(resolve(RENDERER, "components/PageLayoutControl.tsx"), "utf8");
    const used = [...importedIcons(layout)];
    expect(used.sort()).toEqual(["Columns2", "Grid2x2", "RectangleVertical"]);
    // None of the layout glyphs may be used by any other named surface.
    for (const icon of used) {
      expect(iconOwners(icon), `${icon} leaks out of the layout control`).toEqual([
        "components/PageLayoutControl.tsx",
      ]);
    }
  });

  it("criterion 4 regression guard: the Multi Mode toggle and the two-page option are DISTINCT", () => {
    const control = readFileSync(resolve(RENDERER, "components/PageLayoutControl.tsx"), "utf8");
    const two = control.match(/two:\s*\{[^}]*Icon:\s*([A-Za-z0-9]+)/)?.[1];
    const one = control.match(/one:\s*\{[^}]*Icon:\s*([A-Za-z0-9]+)/)?.[1];
    const four = control.match(/four:\s*\{[^}]*Icon:\s*([A-Za-z0-9]+)/)?.[1];

    const header = readFileSync(resolve(RENDERER, "components/AppHeader.tsx"), "utf8");
    // Phase 94B correction — read the REAL render source: the header toggle's
    // glyph is the `APP_HEADER_GLYPHS.multiMode` map entry. Matching a `<Name`
    // token (or worse, a comment naming the glyph) would let the mapping regress
    // to Columns2 while this guard still passed.
    const headerIcon = header.match(/multiMode:\s*\{\s*icon:\s*([A-Za-z0-9]+)/)?.[1];
    const registry = readFileSync(resolve(RENDERER, "state/toolsRegistry.ts"), "utf8");
    const registryIcon = registry.match(/id:\s*'multi-mode'[\s\S]{0,220}?icon:\s*([A-Za-z0-9]+)/)?.[1];

    expect(one, "one-page icon").toBeDefined();
    expect(two, "two-page icon").toBeDefined();
    expect(four, "four-page icon").toBeDefined();
    expect(headerIcon, "header multi-mode icon").toBeDefined();
    expect(registryIcon, "registry multi-mode icon").toBeDefined();

    // The clash the operator reported: must never come back.
    expect(two).not.toBe(headerIcon);
    expect(two).not.toBe(registryIcon);
    // The Multi Mode verb uses ONE glyph everywhere it is offered.
    expect(headerIcon).toBe(registryIcon);
    // Pin the actual glyph: the header toggle and the registry entry both use
    // PanelsLeftRight (a real source oracle, not a comment or a `<Name` token).
    expect(headerIcon, "header multi-mode glyph").toBe("PanelsLeftRight");
    // The three layout options are mutually distinct.
    expect(new Set([one, two, four]).size).toBe(3);
  });
});
