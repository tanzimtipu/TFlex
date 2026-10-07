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
//       one surface (page zoom in the CanvasPills AND the CommandBar; an
//       annotation type in its toolbar AND its list legend; "delete" in every
//       delete verb; a menu-disclosure chevron; a rail-scroll chevron).

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = resolve(process.cwd(), "src/renderer");

/** The named icon surfaces the invariant covers. */
const NAMED_FILES: readonly string[] = [
  "state/toolsRegistry.ts",
  // Phase 103 — the shared Quiet Precision registry HOLDS the retained Lucide
  // glyphs for every "RETAIN lucide" row, so it is a named surface in its own
  // right. Its `icon: X` entries and the registry's own `icon: X` entries are
  // the same action in two places, allow-listed below.
  "icons/quietPrecision.tsx",
  "components/AppHeader.tsx",
  // Phase 105 (chunk C) — the document rail owns the tab strip's New-tab glyph.
  "components/DocumentRail.tsx",
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
  // Phase 103 (TFL-834, chunk 3d) — the view/notice surfaces migrated in wave 4
  // join the sweep so the registry-name identity is enforced where the glyphs
  // now live (the book/reading views, the page-drag grip and the validation).
  "components/BookView.tsx",
  "components/ReadingView.tsx",
  "components/DocumentView.tsx",
  "components/selectableContent.tsx",
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

/** Every dialog in the renderer's components folder. Phase 103 chunk 3c migrated
 *  the dialogs onto the shared registry, so a dialog may render a registry name
 *  without importing Lucide; the sweep therefore covers EVERY dialog rather than
 *  only the ones still importing `lucide-react`, keeping the identity invariant
 *  strict across the migrated surfaces. */
const DIALOG_FILES: readonly string[] = readdirSync(resolve(RENDERER, "components"))
  .filter((n) => /Dialog\.tsx$/.test(n))
  .map((n) => `components/${n}`);

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
  ChevronRight: "page paging forward (registry nextPage retained glyph + toolsRegistry nextPage); the outline tree disclosure uses the distinct SquareChevronRight",
  ChevronLeft: "page paging backward (registry prevPage retained glyph + toolsRegistry prevPage)",
  ChevronDown: "menu/disclosure chevron (theme menu + title-bar menu + tool menu)",
  Slash: "the pen-width control (registry annPenWidth + the annotation toolbar's width swatch)",
  Plus: "new-tab verb (registry tabNew + the dock's add control)",
  FolderOpen: "the folder / open-a-location glyph (the registry's open entry + the Preferences Storage row); the same folder metaphor for choosing a location",
  Search: "the find-in-document verb (header find control + registry find); the palette search-field uses the distinct TextSearch",
  Settings: "the open-preferences verb (header gear + registry preferences)",
  PanelsLeftRight: "the Multi Mode verb (header toggle + registry/palette route)",
  Sparkles: "the bundled-samples mark (the welcome samples-empty state) and the registry's retained openSample metaphor",
  Download: "the download-update verb (update indicator + registry updateDownload)",
  RefreshCw: "the check-for-update / retry verb (indicator + update prompt + registry checkForUpdate)",
  TextCursor: "the edit-content text item (registry editText + the context panel's edit-content text row)",
  MessageSquareText: "the annotations-panel command glyph (registry annotationsPanel + the shared Quiet Precision registry holds its retained glyph)",
  MessageSquare: "the on-page comment/note affordance (the placed note marker's AnnCommentIcon + its AnnotationCommentBox editor header); one comment concept, two surfaces",
  TriangleAlert: "the warning/alert glyph (registry ocrSuspects \"review suspects\" + the print window's error banner); the print window is a SEPARATE document surface (its own BrowserWindow), and both uses are the same warning semantics",
  // Annotation tool glyphs: the annotation toolbar and the annotations list legend
  // now share the registry COMMAND ID (the ann* entries below); the retained
  // Lucide metaphor is still owned by the shared Quiet Precision registry and the
  // registry command entry in toolsRegistry, so each glyph stays allow-listed.
  Highlighter: "highlight annotation metaphor (registry annHighlight entry + the shared Quiet Precision registry holds its retained glyph)",
  Underline: "underline annotation metaphor (registry annUnderline entry + the shared Quiet Precision registry holds its retained glyph); the Inspector text-format toggle uses the distinct Baseline",
  Strikethrough: "strikethrough annotation metaphor (registry annStrikeout entry + the shared Quiet Precision registry holds its retained glyph)",
  Pen: "ink annotation metaphor (registry annInk entry + the shared Quiet Precision registry holds its retained glyph)",
  Square: "the rectangle annotation metaphor (registry annRect entry + the shared Quiet Precision registry holds its retained glyph) plus the conventional maximize-window caption glyph (windowMaximize; Copy is the distinct windowRestore glyph)",
  Circle: "ellipse annotation metaphor (registry annEllipse entry + the shared Quiet Precision registry holds its retained glyph)",
  ArrowUpRight: "arrow annotation metaphor (registry annArrow entry + the shared Quiet Precision registry holds its retained glyph)",
  StickyNote: "sticky-note annotation metaphor (registry annNote entry + the shared Quiet Precision registry holds its retained glyph) and the placed on-page note marker, which renders the note it represents",
  MessageCirclePlus: "add-comment annotation metaphor (registry annCallout entry + the shared Quiet Precision registry holds its retained glyph)",
  PanelLeftClose: "collapse a side panel (rail + context panel + registry railCollapse)",
  PanelRightOpen: "expand a side panel (rail + context panel + inspector)",
  Check: "the check/confirm mark (registry toggle + annotation tool menu selection)",
  Ellipsis: "the more-actions overflow (registry pageContextMenu/dockOverflow retained glyph + toolsRegistry)",
  // Phase 111 (chunk B) — the More affordance on the page-card footer and the
  // PAGES panel header. One overflow metaphor, two sibling surfaces.
  MoreHorizontal: "the More overflow affordance (the PAGES panel header More + the per-page card footer More)",
  File: "the generic document/file item glyph (Multi Mode untitled pane + welcome-recents file row); both denote an open PDF document",
  ClipboardPaste: "the create-PDF-from-clipboard verb (registry createFromClipboard + toolsRegistry holds its retained glyph)",
  GripVertical: "the drag-handle affordance (page drag + the Multi Mode divider)",
  Images: "the page-thumbnails verb (registry pageThumbnails + the context panel's empty-thumbs state)",
  Moon: "the dark-theme option (registry theme entry + the header theme icon)",
  Printer: "the print verb (registry print + the header)",
  RotateCcw: "rotate counter-clockwise (registry retained glyph + toolsRegistry)",
  Save: "the save verb (registry save + the header)",
  SaveAll: "the save-a-copy verb (registry saveAs + the header)",
  // Phase 44 (operator amendment) — the account menu repeats two verbs that
  // already live on the signed-in account dialog: sign out and sync now.
  LogOut: "the sign-out verb (the signed-in AccountsDialog surface + the top-bar avatar menu)",
  RefreshCcw: "the sync-now verb (the signed-in AccountsDialog surface + the top-bar avatar menu)",
  Upload: "the confirm-import action (CommentImportDialog + FillFromCsvDialog + FormDataIoDialog) rendered identically on every import dialog",
  // Phase 84 — the redact verb renders Eraser on the registry entry and the
  // edit TextPropertiesPanel's redact control.
  Eraser: "the redact-marked-region verb (the edit TextPropertiesPanel's redact control + the registry's redact entry)",
  // Phase 111 (chunk C) — the outline's inline indent/outdent verbs were
  // retired (the row More menu now uses text rows), so IndentIncrease /
  // IndentDecrease are owned by the edit TextPropertiesPanel alone and no
  // longer need a shared-allow entry.
  // Phase 103 (TFL-829) — the shared Quiet Precision registry HOLDS the retained
  // Lucide glyph for every "RETAIN lucide, normalize to 1.65/24" row, so each
  // such glyph is legitimately owned by the registry command AND the shared
  // source. One concept, one source of truth, two locations.
  SquareDashed: "the clear-page-selection verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  ListX: "the remove-from-Recents verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  ArrowRightToLine: "the go-to-page verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  SquareX: "the close-tab verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  FolderInput: "the open-PDF-into-a-pane verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  FileInput: "the choose-a-document-for-a-pane verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  PanelRightDashed: "the clear-a-pane verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  SeparatorVertical: "the resize-panes verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  Info: "the about verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  Menu: "the application-menu verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  Minimize: "the minimize-window caption control (registry + the shared Quiet Precision registry holds its retained glyph)",
  Palette: "the annotation-colour verb (registry + the shared Quiet Precision registry holds its retained glyph)",
  // Phase 103 (TFL-831, chunk 3a) — the wave-1 Quiet Precision command IDs
  // legitimately rendered by more than one named surface. Identity is now the
  // registry command id, so sharing is expressed as the id, not the Lucide glyph.
  prevPage: "page paging backward (CanvasPills + CommandBar + BookView + ReadingView), one command, one glyph",
  nextPage: "page paging forward (CanvasPills + CommandBar + the AnnotationsPanel row jump + BookView + ReadingView), one command, one glyph",
  zoomIn: "zoom in (CanvasPills + CommandBar), one command, one glyph",
  zoomOut: "zoom out (CanvasPills + CommandBar), one command, one glyph",
  fitWidth: "fit-width zoom (CanvasPills + CommandBar), one command, one glyph",
  fitPage: "fit-page zoom (CanvasPills + CommandBar), one command, one glyph",
  panMode: "pan mode (CanvasPills + CommandBar), one command, one glyph",
  // Phase 105 (chunk C) — `find`, `multi-mode`, `preferences` and
  // `headerMenuDisclosure` are no longer rendered as `<Icon name="...">` in
  // more than one surface: the relocated commands render through the
  // application menu's registry icon ids (a data path this sweep does not
  // count), leaving a single `<Icon name>` owner each. They are dropped here
  // so the "still shared" guard stays honest.
  // Phase 103 (TFL-832, chunk 3b) — wave-2 Quiet Precision command IDs legitimately
  // rendered by more than one named surface. Identity is the registry command id.
  editMode: "the edit-content verb (CommandBar + the SideRail outline rename + the welcome home-row edit toggle), one command, one glyph",
  delete: "the delete verb (CommandBar + the rail page/outline delete + the annotations list delete + the review-element delete + the DeletePageDialog confirm), one command, one glyph",
  // Phase 111 (chunk B) — `merge` is no longer shared: the ContextPanel
  // header's Combine control moved into the More menu (a text row), leaving
  // the CommandBar as its only icon owner.
  open: "the open-a-PDF verb (AppHeader + the Multi Mode pane's Open control + the welcome fixed Open tile), one command, one glyph",
  recognizeText: "the recognize-text/OCR verb (the ContextPanel action + the OcrSuspectsPanel header), one command, one glyph",
  annHighlight: "the highlight annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annUnderline: "the underline annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annStrikeout: "the strikeout annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annInk: "the ink annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annTextbox: "the text-box annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annRect: "the rectangle annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annEllipse: "the ellipse annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annArrow: "the arrow annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annCallout: "the callout annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  annNote: "the note annotation glyph (annotation toolbar + annotations list legend), one command, one glyph",
  // Phase 103 (TFL-833, chunk 3c) — wave-3 Quiet Precision command IDs legitimately
  // rendered by more than one named surface. Identity is the registry command id.
  dialogClose: "the dialog close X (AccountsDialog + CreateFromImagesDialog; DialogShell owns the shared close control), one chrome affordance",
  checkForUpdate: "the refresh / check-for-update command (the AuditSpaceDialog refresh + the UpdatePromptDialog restart + the UpdateIndicator), one command, one glyph",
  updateDownload: "the download-update command (the UpdateIndicator available chip + the UpdatePromptDialog download state), one command, one glyph",
  bates: "the Bates-numbering verb (the BatesDialog header + the Inspector Bates row), one command, one glyph",
  insertPages: "the insert-documents verb (the InsertPagesDialog picker + the ContextPanel action), one command, one glyph",
  dockScrollLeft: "dock scroll-left affordance (the ActionDock chrome + the AnnotationFlyout), one chrome affordance",
  dockScrollRight: "dock scroll-right affordance (the ActionDock chrome + the AnnotationFlyout), one chrome affordance",
  // Phase 103 (TFL-834, chunk 3d) — wave-4 Quiet Precision command IDs legitimately
  // rendered by more than one named surface. Identity is the registry command id.
  tabNew: "the neutral create/add verb (the AppHeader new-tab control + the welcome home-row add-tool picker), one plus metaphor, one command glyph",
  // Phase 105 (chunk D) — the All-tabs switcher discloses a list of open
  // documents, so it shares the disclosure chevron with the title-bar File
  // menu; one disclosure metaphor, two menu surfaces.
  headerMenuDisclosure: "the disclosure chevron (the title-bar File menu + the document rail's All-tabs switcher), one menu-disclosure metaphor",
  dragPage: "the drag-handle affordance (the Multi Mode divider + the canvas page-drag grip + the shared floating-editor grip), one command, one glyph",
  openReadingView: "the open-reading/book-view verb (BookView + ReadingView + the DocumentView Book View entry), one command, one glyph",
  // Phase 113 / TFL-1053 — three glyphs whose two owners render the SAME
  // action or the same designed metaphor, so sharing is legitimate and each is
  // justified here rather than re-glyphed.
  optimize: "the reduce-file-size / Optimize verb (the CommandBar toolbar's 'Reduce file size' control + the ContextPanel Deliver Optimize action); both invoke the same onOptimize command, one command, one glyph",
  ScanText: "the recognize-text / OCR metaphor (the registry recognizeText entry's Lucide glyph + the ContextPanel Recognition empty-state illustration); one OCR concept across the panel and its command",
  MousePointerClick: "the click-to-select empty-state illustration (the ContextPanel EDIT no-selection state + the Inspector no-document-open state); one 'nothing selected yet' empty-state metaphor, two designed empty states",
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
  // Phase 103 — a static Quiet Precision render (`<Icon name="save" />`) is a
  // usage of the named command id attributed to this file. Only `<Icon`-scoped
  // `name=` attributes count, so a form control's `name="radio-group"` is not
  // mistaken for a glyph.
  const nameRe = /<Icon\b[^>]*\bname="([^"]+)"/gs;
  let nm: RegExpExecArray | null;
  while ((nm = nameRe.exec(text)) !== null) {
    const line = text.slice(0, nm.index).split(/\r?\n/).length;
    out.push({ file, icon: nm[1], line });
  }
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
      "import { MousePointerClick, PanelRightClose, PanelRightOpen, X } from 'lucide-react';",
    ].join("\n");
    expect([...importedIcons(text)].sort()).toEqual([
      "MousePointerClick",
      "PanelRightClose",
      "PanelRightOpen",
      "X",
    ]);
    // The exact file that exposed the bug: `MousePointerClick` is now the
    // Inspector's first named Lucide import (Phase 103 chunk 3b migrated the
    // Bates `Hash` row onto the Quiet Precision `bates` id).
    const inspector = readFileSync(resolve(RENDERER, "components/Inspector.tsx"), "utf8");
    expect([...importedIcons(inspector)]).toContain("MousePointerClick");
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
    // Phase 103 — the layout control renders through the Quiet Precision
    // registry, so its identity is the command id, not the legacy Lucide glyph.
    const used = [...layout.matchAll(/<Icon\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect(used.sort()).toEqual(["layoutFourPage", "layoutOnePage", "layoutTwoPage"]);
    // None of the layout glyph ids may be used by any other named surface.
    for (const icon of used) {
      expect(iconOwners(icon), `${icon} leaks out of the layout control`).toEqual([
        "components/PageLayoutControl.tsx",
      ]);
    }
  });

  it("criterion 4 regression guard: the Multi Mode toggle and the two-page option are DISTINCT", () => {
    const control = readFileSync(resolve(RENDERER, "components/PageLayoutControl.tsx"), "utf8");
    const two = control.match(/two:\s*\{[^}]*name="([^"]+)"/)?.[1];
    const one = control.match(/one:\s*\{[^}]*name="([^"]+)"/)?.[1];
    const four = control.match(/four:\s*\{[^}]*name="([^"]+)"/)?.[1];

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
