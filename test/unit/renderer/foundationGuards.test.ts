// @vitest-environment node
//
// Phase 100 feature B (TFL-731) — the foundation raw-literal / one-off-motion
// drift guard.
//
// AUTHORITATIVE SPEC: docs/phase-specs/phase-100.md ruling 4 (the MIGRATED_SURFACES
// list) and ruling 5 (the motion one-off rule). The scan scope is an EXPLICIT list
// that GROWS as each chunk migrates more surfaces, mirroring the explicit-list style
// of phase94_noAdHocIcons.test.ts (RAW_SIZE_SCAN_FILES). Chunks C and D append to
// MIGRATED_SURFACES and populate MIGRATED_MOTION_RULES; this file implements the
// whole mechanism so those chunks only add scope.
//
// Rule (a) — raw literals in an inline style context of a migrated surface:
//   * numeric literal or raw-string `fontSize`, `borderRadius`, `boxShadow`;
//   * numeric literal in `padding` / `margin` / `gap` (and their longhands);
//   * raw hex colour (#rgb / #rrggbb / #rrggbbaa) used as a style value.
//   A value that is a CSS token (`var(--...)`), a template/expression over a model
//   value (`${x}px`, `cs.fontSize`, `${pt}pt`) or a function call is COMPLIANT; only
//   a bare number or a raw literal string is a violation.
//
// Rule (b) — motion one-off: a `transition:`/`animation:` carrying a raw `\d+ms` /
//   `\d+s` duration or a raw `cubic-bezier(` is a violation unless it references a
//   motion token (`--tf-motion-*`, `--motion-*`, `--tf-ease-*`, `--ease*`) or is
//   `none`. Inline styles are scanned now; styles.css rule bodies are scanned
//   through MIGRATED_MOTION_RULES (populated in chunk D). The token-definition
//   blocks (`:root`, `:root[data-theme=...]`, `@property`, `@keyframes`) are
//   excluded from the CSS scan.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = resolve(process.cwd(), "src/renderer");

/**
 * The surfaces migrated to the foundation. Chunk D completes the list to EVERY
 * renderer TSX file (the same walk `sourceFiles()` performs), so rule (a)
 * and the inline half of rule (b) now cover the whole renderer. The companion
 * test asserts the list EQUALS the walk: complete (no surface skipped) and
 * non-stale (no phantom entry).
 */
const MIGRATED_SURFACES: readonly string[] = [
  "App.tsx",
  "annotations/AnnColorBox.tsx",
  "annotations/AnnCommentIcon.tsx",
  "annotations/AnnotationCommentBox.tsx",
  "annotations/AnnotationOverlay.tsx",
  "annotations/AnnotationToolbar.tsx",
  "annotations/AnnotationsPanel.tsx",
  "annotations/ColorPalette.tsx",
  "annotations/StampAnnotations.tsx",
  "annotations/StampOverlay.tsx",
  "annotations/ThreadStream.tsx",
  "bug-report/BugReportErrorBoundary.tsx",
  "components/AboutDialog.tsx",
  "components/AccountMenu.tsx",
  "components/AccountsDialog.tsx",
  "components/ActionDock.tsx",
  "components/ActivityAlertNotice.tsx",
  "components/ActivityShelf.tsx",
  "components/AnimatedDialog.tsx",
  "components/AnimatedPanel.tsx",
  "components/AnimatedTab.tsx",
  "components/AnnotationFlyout.tsx",
  "components/AppHeader.tsx",
  "components/AuditSpaceDialog.tsx",
  "components/BatesDialog.tsx",
  "components/BlankPagesDialog.tsx",
  "components/BookView.tsx",
  "components/BrandLoader.tsx",
  "components/BrandMark.tsx",
  "components/BrandWordmark.tsx",
  "components/Button.tsx",
  "components/CanvasAlertNotice.tsx",
  "components/CanvasPills.tsx",
  "components/CloseTabPromptDialog.tsx",
  "components/CommandBar.tsx",
  "components/CommandMenu.tsx",
  "components/CommandPalette.tsx",
  "components/CommentExportDialog.tsx",
  "components/CommentImportDialog.tsx",
  "components/ConfirmDialog.tsx",
  "components/ContextPanel.tsx",
  "components/ContextToolbox.tsx",
  "components/ConversionNotice.tsx",
  "components/CreateFromImagesDialog.tsx",
  "components/CropPagesDialog.tsx",
  "components/DeletePageDialog.tsx",
  "components/DialogShell.tsx",
  "components/DocumentInfoDialog.tsx",
  "components/DocumentRail.tsx",
  "components/DocumentView.tsx",
  "components/DocxExportDialog.tsx",
  "components/EmptyState.tsx",
  "components/EncryptDialog.tsx",
  "components/EngineeringLayersPanel.tsx",
  "components/ExportDialog.tsx",
  "components/ExportFidelityNotes.tsx",
  "components/ExportPagesWithoutTextNotice.tsx",
  "components/FillFromCsvDialog.tsx",
  "components/FormDataIoDialog.tsx",
  "components/GlassChrome.tsx",
  "components/GlassSidebar.tsx",
  "components/home/HomeRecentRow.tsx",
  "components/home/HomeSampleCard.tsx",
  "components/home/OrbitMotif.tsx",
  "components/InsertPagesDialog.tsx",
  "components/Inspector.tsx",
  "components/MergeDialog.tsx",
  "components/MultiActionDock.tsx",
  "components/MultiPane.tsx",
  "components/OcrDialog.tsx",
  "components/OcrSuspectsPanel.tsx",
  "components/OfficeExportDialog.tsx",
  "components/OptimizeDialog.tsx",
  "components/PageLayoutControl.tsx",
  "components/PageView.tsx",
  "components/PaneThumbStrip.tsx",
  "components/PasswordPromptDialog.tsx",
  "components/Pdf3dNotice.tsx",
  "components/PreferencesDialog.tsx",
  "components/PreviewTaskDialog.tsx",
  "components/PrintPanel.tsx",
  "components/PropertyPopover.tsx",
  "components/ProtectionNotice.tsx",
  "components/ReadingView.tsx",
  "components/RenumberPagesDialog.tsx",
  "components/ReplacePagesDialog.tsx",
  "components/ReviewElementsPanel.tsx",
  "components/SanitizeDialog.tsx",
  "components/SaveAsDialog.tsx",
  "components/SearchBar.tsx",
  "components/SettingsStudio.tsx",
  "components/SideRail.tsx",
  "components/SplitDialog.tsx",
  "components/StageRail.tsx",
  "components/StampDialog.tsx",
  "components/TaskDialog.tsx",
  "components/TextExportDialog.tsx",
  "components/TitleBar.tsx",
  "components/Toasts.tsx",
  "components/Toolbar.tsx",
  "components/ToolsPalette.tsx",
  "components/Tooltip.tsx",
  "components/UpdateIndicator.tsx",
  "components/UpdatePromptDialog.tsx",
  "components/ValidateDocumentDialog.tsx",
  "components/ValidationNotice.tsx",
  "components/ViewStrip.tsx",
  "components/WatermarkDialog.tsx",
  "components/Welcome.tsx",
  "components/motion/TfMotion.tsx",
  "components/motion/TfResize.tsx",
  "components/pageThumbMenu.tsx",
  "components/panels/PanelPrimitives.tsx",
  "components/panels/PanelResizeHandle.tsx",
  "components/selectableContent.tsx",
  "edit/EditOverlay.tsx",
  "edit/TextPropertiesPanel.tsx",
  "forms/FlattenConfirmDialog.tsx",
  "forms/FormFieldControl.tsx",
  "forms/FormsOverlay.tsx",
  "icons/Icon.tsx",
  "icons/quietPrecision.tsx",
  "intake/IntakeTray.tsx",
  "main.tsx",
  "print-window/PrintWindowApp.tsx",
  "redaction/RedactionOverlay.tsx",
  "signatures/SignatureManagerModal.tsx",
  "signatures/SignaturesOverlay.tsx",
  "spell/SpellCheckTextarea.tsx",
  "state/PageDragContext.tsx",
];

/**
 * The ONLY literals permitted to remain, keyed `"<file>:<property>"` with a written
 * reason proving each is DATA or functional — never a whole-file grant to skip
 * chrome. A companion test asserts every entry is still a real violation (not stale).
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
  "annotations/StampOverlay.tsx:boxShadow":
    "zoom-scaled on-page stamp ghost: the shadow is part of the rendered stamp affordance, not chrome",
  "annotations/AnnotationOverlay.tsx:boxShadow":
    "zoom-scaled on-page note-label overlay: the shadow is part of the rendered annotation content, not chrome",
  "annotations/AnnotationOverlay.tsx:fill":
    "on-page annotation content: the DEF-547 error-boundary marker (ann-error) is a diagnostic glyph painted into the SVG annotation layer over the page, not chrome; it mirrors the stamp/note data allow-list above",
  "components/AccountsDialog.tsx:fill":
    "third-party brand data: the four #-hex fills are the Google 'G' logo's canonical brand colours, reproduced verbatim and never chrome",
  "components/BrandMark.tsx:fill":
    "brand mark data: the #fff fill is part of the TFlex logo vector itself, not a UI surface colour",
  "spell/SpellCheckTextarea.tsx:textDecorationColor":
    "functional spellcheck state: the wavy underline marks misspelled tokens on the preserved text mirror; a state indicator, not chrome",
  "edit/EditOverlay.tsx:background":
    "on-page edit content: the opaque white fill / whiteout preview is drawn INTO the page bitmap (erase preview, text-box editor and box background), so it is document content, not app chrome",
};

/**
 * The stylesheet scope for the CSS one-off motion scan: every `styles.css`
 * rule body EXCEPT the token-definition blocks (`:root`, `@property`,
 * `@keyframes`), which `cssRules` already drops. Chunk D populates it with the
 * migrated stylesheet, mirroring MIGRATED_CSS_RULES; the mechanism (rule
 * extraction, token-definition exclusion, one-off detection) lives below.
 */
const MIGRATED_MOTION_RULES: readonly string[] = ["styles.css"];

/**
 * The stylesheet rule-body scope for the CSS ELEVATION / RADII scan. Chunk C seeds
 * it with the single migrated stylesheet — every rule body EXCEPT the token-
 * definition blocks (`:root`, the themed `:root`s, `@property`, `@keyframes`),
 * which `cssRules` already drops. Later chunks append further scopes.
 */
const MIGRATED_CSS_RULES: readonly string[] = ["styles.css"];

/**
 * The ONLY CSS declarations permitted to remain as raw literals, keyed
 * `"<selector>|<property>"` with a written reason proving each is a functional
 * ring / hairline or structural corner — never a whole-rule grant. A companion
 * test asserts every entry is still a real violation (not stale).
 */
const CSS_ALLOWLIST: Readonly<Record<string, string>> = {
  // --- focus / selection RINGS: a hairline that carries a colour token, not elevation ---
  ".titlebar-file-dot|box-shadow":
    "colour-dot ring: a 1.5px bg-toolbar outline separates the dot from the tab strip; a hairline ring, not a shadow",
  ".text-props-btn[aria-pressed=\"true\"]|box-shadow":
    "pressed-button inset hairline ring (select-edge); a state edge, not elevation (Phase 113: the legacy .text-props-btn-active class is retired; the pressed state is driven by [aria-pressed=\"true\"])",
  ".page-input:focus|box-shadow":
    "focus ring on the page field: raw accent alpha forms the 2px halo; a functional focus affordance, not elevation",
  ".tools-badge-tracker:focus-visible|box-shadow":
    "keyboard focus ring: a raw white inset halo on the accent badge; a functional focus affordance, not elevation",
  ".thumb-selected|box-shadow":
    "selected-thumbnail inset hairline ring (select-edge); a state edge, not elevation",
  ".thumb-drop-line|box-shadow":
    "thumbnail drop-indicator ring plus a soft select-edge glow; a drag affordance, not elevation",
  ".ann-color-swatch-active|box-shadow":
    "active annotation swatch ring (bg-toolbar); a state edge, not elevation",
  ".form-editor:focus|box-shadow":
    "form-field focus ring (accent-soft); a functional focus affordance, not elevation",
  ".stamp-annotation:hover|box-shadow":
    "stamp hover ring (accent); a state indicator, not elevation",
  ".ann-color-swatch-main|box-shadow":
    "colour-swatch border ring (border-strong); a swatch edge, not elevation",
  ".ann-color-swatch-main-active|box-shadow":
    "active colour-swatch ring (accent); a state edge, not elevation",
  ".ann-color-box|box-shadow":
    "colour-box border ring (border-strong); a swatch edge, not elevation",
  ".ann-color-box[aria-pressed='true']|box-shadow":
    "pressed colour-box ring (accent); a state edge, not elevation",
  ".color-swatch-active|box-shadow":
    "active colour-swatch ring (bg-raised); a state edge, not elevation",
  ".color-swatch-wrap-active .color-swatch|box-shadow":
    "active colour-swatch wrapper ring (accent-soft); a state edge, not elevation",
  ".tab-stage[data-multi-mode=\"true\"] .tab-pane[data-pane]|box-shadow":
    "multi-pane default: a transparent inset hairline that reserves the focus-ring slot; not elevation",
  ".tab-stage[data-multi-mode=\"true\"] .tab-pane[data-pane][data-pane-focused=\"true\"]|box-shadow":
    "focused multi-pane ring (accent-soft); a state edge, not elevation",
  ".page-drop-indicator|box-shadow":
    "page drop-indicator ring plus an accent glow; a drag affordance, not elevation",
  ".document-scroller[data-page-drop-pane=\"true\"]|box-shadow":
    "page-drop target ring (accent inset); a drag state, not elevation",
  ".action-dock-verb[aria-pressed='true']:not(:disabled):not(.btn)|box-shadow":
    "pressed action-dock verb ring (accent inset); a state edge, not elevation",
  ".btn.action-dock-verb[aria-pressed='true']:not(:disabled)|box-shadow":
    "pressed action-dock verb (btn) ring (accent inset); a state edge, not elevation",
  // --- functional one-off affordances: raw colour inside a ring, not chrome elevation ---
  ".color-pad-cursor|box-shadow":
    "colour-picker cursor chaser: a dark outline plus contact shadow keeps the crosshair legible over any canvas colour; a functional affordance, not chrome elevation",
  ".color-hue-cursor|box-shadow":
    "hue-strip cursor chaser: a dark outline plus contact shadow for legibility over any hue; a functional affordance, not chrome elevation",
  ".tools-palette-entry:hover:not(:disabled)|box-shadow":
    "palette-entry hover affordance: an accent-tinted glow plus an inset accent ring; a hover treatment, not the neutral elevation ladder",
  ".glass-control-group|box-shadow":
    "glass control-group material: an inset top highlight hairline plus a contact shadow; the documented glass recipe, not the elevation ladder",
  ".tab-active|box-shadow":
    "active-tab raised surface: an inset top hairline (accent-derived colour-mix) plus a soft 6px lift; a composed tab affordance, not a ladder surface",
  ".tab-area .tab.tab-active[data-tab-color-id]|box-shadow":
    "Phase 105 active-tab identity: an inset 2px contrast keyline plus a soft lift on the saturated identity surface; a composed state affordance, not a ladder surface",
  '.tab-area[data-tab-style="colorful"] .tab.tab-active[data-tab-color-id]|box-shadow':
    "Phase 105 (chunk D) colorful identity: the same inset 2px contrast keyline re-asserted over the colorful `.tab-active { box-shadow: none }`; a composed state edge, not a ladder surface",
  ".inspector[data-inspector-selection]:not([data-inspector-selection='none'])|box-shadow":
    "inspector edge: an inset hairline plus a directional panel shadow; a docked-edge affordance, not a floating ladder surface",
  // --- structural corner geometry: composed radii, not a single token ---
  ".tab-active::after|border-radius":
    "single-edge structural underline geometry (1px 1px 0 0); a 2px-tall shape, below the 3px token floor",
  ".selection-handle|border-radius":
    "Phase 117 shared selection handle: an 8x8 corner grip with a 2px softening radius, below the 3px --radius-1 token floor; a functional affordance, not a tokenised surface",
  ".side-rail|border-radius":
    "structural single-corner rounding (0 0 panel-radius 0): the rail docks flush to the window, only the inner corner rounds",
  ".ann-textbox-grip, .content-grip|border-radius":
    "structural grips on a text-box handle: square outward corners, token-rounded inner corners",
  ".ann-textbox-wrap .ann-textbox-editor|border-radius":
    "structural editor corners: token-rounded bottom pair, square top pair flush to the text box",
  ".tools-badge-tracker|border-radius":
    "structural left-attached badge: rounded left pair (radius-control), square right pair flush to the rail",
  ".pane-thumb-strip|border-radius":
    "structural single-corner rounding (0 0 panel-radius 0): the strip docks flush to the pane edge",
  ".workspace[data-rail-side=\"right\"] .pane-thumb-strip|border-radius":
    "structural mirrored single-corner rounding (0 0 0 panel-radius) for the right rail",
  ".tools-palette|border-radius":
    "structural side-panel rounding: both corners on the docked edge round, the outer edge stays square",
  ".book-view-layout-button|border-radius":
    "derived 1px-inset radius (calc(radius-2 - 1px)) so the button nests inside its parent border; a computed one-off, not a token radius",
  // --- typography: the ONE genuinely relative type size (no px ladder step) ---
  ".reading-chapter-title|font-size":
    "em-relative chapter heading scale (1.15em of the reader base size): a proportional ratio that inherits the reader's font size, not a fixed px ladder step",
  // --- motion: documented functional progress loops, exempt from the collapsible motion durations ---
  ".update-indicator-spin|animation":
    "documented indeterminate loading spinner (progress feedback, not an interaction): the loop must keep spinning when reduced-motion / animations-off collapse every --motion-duration-* token to 0ms, so it deliberately carries no duration token (phase43AnimationTokens.test.ts ANIMATION_EXEMPT)",
  ".update-prompt-spinner|animation":
    "documented indeterminate loading spinner (progress feedback, not an interaction): same deliberate exemption from the collapsible motion durations as .update-indicator-spin (phase43AnimationTokens.test.ts ANIMATION_EXEMPT)",
  ".update-prompt-progress-indeterminate .update-prompt-progress-bar|animation":
    "documented indeterminate progress bar (progress feedback, not an interaction): same deliberate exemption from the collapsible motion durations as the loading spinner (phase43AnimationTokens.test.ts ANIMATION_EXEMPT)",
  ".activity-shelf-track-bar--indeterminate|animation":
    "Phase 118 (TFL-1216 chunk C2) Activity Shelf indeterminate progress bar (progress feedback, not an interaction): the 1.4s loop must keep advancing when reduced-motion / animations-off collapse every --motion-duration-* token to 0ms, so it deliberately carries a literal duration (phase43AnimationTokens.test.ts ANIMATION_EXEMPT)",
  // --- DEF-546: on-page / paper / data surfaces, never chrome ---
  ".pdf-page|background":
    "on-page paper: DEF-099 keeps the PDF page white in every theme (a blank page must read as paper, not a dark panel); the page's own background is document surface, not chrome",
  ".page-slot|background":
    "on-page paper: DEF-302/DEF-099 reserve scroll space with a paper-white slot painted before the canvas mounts, so the scroll area stays stable in dark mode; document surface, not chrome",
  ".spell-text-wrap:has(> .edit-run-editor)|background":
    "on-page cover: the on-canvas run editor floats its own white cover over the paper page, so the wrapper must stay page-white in both themes; document surface, not chrome",
  ".content-move-hint|background":
    "on-page hint chip: the 'double-click to edit' hint floats over the paper-white page and is deliberately a fixed dark chip in BOTH themes (DEF-159 on-page ink), not a themeable chrome surface",
  ".sig-canvas|background":
    "captured-signature data surface: the signature pad is necessarily white paper (the drawn ink is dark), independent of app theme",
  ".sig-thumb|background":
    "captured-signature data preview: the saved signature PNG is rendered on white paper so the dark ink reads, independent of app theme",
  ".edit-inline-editor|background":
    "on-page edit content: the inline text editor overlays the paper page and pins white-on-black text so the on-page content is never inverted in dark mode",
  ".print-preview-sheet|background":
    "on-page paper: the print-preview sheet renders the page as physical paper, white in every theme",
  ".print-preview-cell|background":
    "on-page paper (DEF-649): the page-bearing preview cell paints the page as paper-white in every theme so a contain-fitted page raster never letterboxes against dark --bg-base; document surface, not chrome",
  ".watermark-preview-frame|background":
    "on-page paper: the watermark preview frame shows the watermark over paper, white in every theme",
  ".reading-comic-page|background":
    "on-page paper: the comic reading page is the scanned page surface and stays paper-white in every theme",
  ".ann-note|filter":
    "on-page annotation content: the committed sticky-note icon is painted into the annotation layer over the page, so its contact drop-shadow is part of the rendered annotation, not chrome (same contract as the AnnotationOverlay note/ stamp allow-list)",
  ".thumb-overlay .thumb-label|text-shadow":
    "on-page ink legibility halo (TFL-1585): the page-number label floats directly on the paper-white page with no bar behind it, so a two-stop theme-colour halo (0 0 2px / 0 0 4px var(--bg-raised)) keeps it readable on the white page in every theme; the offsets are a functional legibility affordance, not chrome elevation, and there is no text-shadow foundation token",
  // --- DEF-545: the canonical reduced-motion no-motion sentinels ---
  "@media (prefers-reduced-motion: reduce)|animation":
    "canonical reduced-motion catch-all: 0.01ms / 0ms are the no-motion sentinels that collapse every animation to an instant state change (still reaching the end pose); this is the motion-control layer, not authored motion",
  "@media (prefers-reduced-motion: reduce)|transition":
    "canonical reduced-motion catch-all: the same no-motion sentinels for transitions; the motion-control layer, not authored motion",
};

const ENFORCED_PROPS = ["fontSize", "borderRadius", "boxShadow"] as const;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const MOTION_TOKEN = /--(?:tf-motion|motion|tf-ease|ease)/;
// DEF-545 — the DURATION slot, split out from the easing/reference slot. A raw
// duration anywhere in a motion declaration is a violation even when a motion
// token appears in the same declaration: the token exempts the easing slot, not
// the duration slot.
const RAW_DURATION = /(?:\d+(?:\.\d+)?ms\b|\d+(?:\.\d+)?s\b)/;
const RAW_BEZIER = /cubic-bezier\s*\(/;
// DEF-546 — sibling-property spellings of the same foundations.
const RAW_COLOR_FN = /\brgba?\(/;
const RAW_PX = /-?\d+(?:\.\d+)?px\b/;
const RAW_CSS_GRADIENT = /gradient\s*\(/;
const TOKEN_DEF_SELECTOR = /^(:root\b|@property\b|@keyframes\b|@-webkit-keyframes\b)/;

// A CSS value: a quoted / template string (kept whole, so a shadow's inner commas
// survive) or a bare token up to the next comma / newline / closing brace.
const VAL =
  "\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`|[^,\\n}]+";

function sourceFiles(dir: string = RENDERER): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

function relOf(file: string): string {
  return relative(RENDERER, file).replace(/\\/g, "/");
}

/** Extract the balanced `{...}` block starting at `braceStart` (string-aware). */
function extractBlock(text: string, braceStart: number): string {
  let depth = 0;
  for (let i = braceStart; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(braceStart + 1, i);
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < text.length) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === q) break;
        i++;
      }
    }
  }
  return text.slice(braceStart + 1);
}

/** Every inline style context: a `style={...}` prop and a `: CSSProperties = {...}`. */
function styleBlocks(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const styleProp = /style\s*=\s*\{/g;
  while ((m = styleProp.exec(text)) !== null) {
    out.push(extractBlock(text, m.index + m[0].length - 1));
  }
  const typed = /:\s*CSSProperties\s*=/g;
  while ((m = typed.exec(text)) !== null) {
    const brace = text.indexOf("{", m.index + m[0].length);
    if (brace !== -1) out.push(extractBlock(text, brace));
  }
  return out;
}

/**
 * DEF-547 — an un-annotated module/const style object reaching the DOM through
 * `style={S}`. BEST-EFFORT by design: it only resolves a bare identifier prop to
 * a same-file `const S = { ... }` literal. A computed object (`useMemo`, a
 * function return, a spread) is intentionally out of reach — the seeded test
 * documents this limit, and the guard's contract tolerates it.
 */
function styleConstBlocks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const styleProp = /style\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = styleProp.exec(text)) !== null) {
    const ident = m[1];
    if (seen.has(ident)) continue;
    seen.add(ident);
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*=\\s*\\{`);
    const dm = decl.exec(text);
    if (dm !== null) out.push(extractBlock(text, dm.index + dm[0].length - 1));
  }
  return out;
}

/** DEF-547 — a `style="..."` string prop, parsed as inline CSS declarations. */
function styleStringProps(text: string): StyleProp[] {
  const out: StyleProp[] = [];
  const re = /style\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1];
    const decl = /(?:^|[;{])\s*([A-Za-z-]+)\s*:\s*([^;}]+)/g;
    let dm: RegExpExecArray | null;
    while ((dm = decl.exec(body)) !== null) {
      const prop = dm[1];
      const value = dm[2].trim();
      if (HEX.test(value)) out.push({ prop, value });
      else if (/^(?:font-size|border-radius|box-shadow|padding|margin|gap)/.test(prop) && RAW_PX.test(value)) {
        out.push({ prop, value });
      }
    }
  }
  return out;
}

/** DEF-547 — an inline SVG presentation attribute carrying a raw hex literal. */
function svgAttrProps(text: string): StyleProp[] {
  const out: StyleProp[] = [];
  const re = /\b(fill|stroke|strokeWidth)\s*=\s*"(#[0-9a-fA-F]{3,8})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ prop: m[1], value: m[2] });
  return out;
}

interface StyleProp {
  prop: string;
  value: string;
}

/** A bare number or a raw (non-token) quoted string — the only raw-literal shapes. */
function isRawLiteralValue(value: string): boolean {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return true;
  if (/^"(?:[^"\\]|\\.)*"$/.test(v) || /^'(?:[^'\\]|\\.)*'$/.test(v)) {
    if (v.includes("${")) return false;
    if (/^["']var\(/.test(v)) return false;
    return true;
  }
  return false;
}

/** The raw-literal violations in one source text, one entry per property. */
function scanSource(text: string): StyleProp[] {
  const found = new Map<string, StyleProp>();
  const add = (prop: string, value: string): void => {
    if (!found.has(prop)) found.set(prop, { prop, value });
  };
  for (const body of [...styleBlocks(text), ...styleConstBlocks(text)]) {
    for (const prop of ENFORCED_PROPS) {
      const re = new RegExp(`(?:^|[\\s,{])${prop}\\s*:\\s*(${VAL})`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        if (isRawLiteralValue(m[1])) add(prop, m[1].trim());
      }
    }
    const spacing = new RegExp(`(?:^|[\\s,{])((?:padding|margin|gap)[A-Za-z]*)\\s*:\\s*(${VAL})`, "g");
    let sm: RegExpExecArray | null;
    while ((sm = spacing.exec(body)) !== null) {
      if (/^-?\d+(\.\d+)?$/.test(sm[2].trim())) add(sm[1], sm[2].trim());
    }
    const generic = new RegExp(`(?:^|[\\s,{])([A-Za-z$][\\w$-]*)\\s*:\\s*(${VAL})`, "g");
    let hm: RegExpExecArray | null;
    while ((hm = generic.exec(body)) !== null) {
      if (HEX.test(hm[2])) add(hm[1], hm[2].trim());
    }
  }
  for (const { prop, value } of styleStringProps(text)) add(prop, value);
  for (const { prop, value } of svgAttrProps(text)) add(prop, value);
  return [...found.values()];
}

/**
 * A one-off motion declaration. DEF-545: a raw `\d+ms` / `\d+s` duration is a
 * violation ANYWHERE in the declaration, even beside a motion token — the token
 * exempts the easing/reference slot, never the duration slot. A raw
 * `cubic-bezier(` is a violation only with no motion token (the token exempts
 * the easing slot).
 */
function isOneOffMotion(declaration: string): boolean {
  const d = declaration.trim();
  if (d === "none") return false;
  if (RAW_DURATION.test(d)) return true;
  if (MOTION_TOKEN.test(d)) return false;
  return RAW_BEZIER.test(d);
}

interface CssRule {
  selector: string;
  body: string;
}

/**
 * Every top-level rule body in a stylesheet, comments stripped. Token-definition
 * blocks (`:root`, `:root[data-theme=...]`, `@property`, `@keyframes`) are dropped.
 * Nested at-rule bodies (for example `@media`) are captured under their wrapper
 * selector; chunk D, which populates the scope, follows the same convention.
 */
function cssRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: CssRule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (selector !== "" && !TOKEN_DEF_SELECTOR.test(selector)) out.push({ selector, body });
    i = j;
  }
  return out;
}

/** Raw one-off motion in the styles.css rule bodies named by `scoped`. */
function cssMotionViolations(css: string, scoped: readonly string[]): string[] {
  const scope = new Set(scoped.map((s) => s.replace(/\s+/g, " ").trim()));
  const out: string[] = [];
  for (const { selector, body } of cssRules(css)) {
    const norm = selector.replace(/\s+/g, " ").trim();
    if (!scope.has(norm)) continue;
    const re = /(?:^|[;{\s])(transition|animation)(?:-duration|-delay)?\s*:\s*([^;}\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      if (isOneOffMotion(m[2])) out.push(`${norm} ${m[1]}: ${m[2].trim()}`);
    }
  }
  return out;
}

const CSS_VAR = /^var\(--[\w-]+\)$/;
const CSS_RADII_OK = /^(?:var\(--[\w-]+\)|0|50%|inherit|unset)$/i;

interface CssViolation {
  selector: string;
  prop: string;
  value: string;
}

/**
 * Raw ELEVATION / RADII literals in a stylesheet's non-token rule bodies, plus
 * their DEF-546 SIBLING spellings: elevation via `filter: drop-shadow(...)` /
 * `text-shadow` carrying a raw px/rgba, opaque colour via the `border` /
 * `background` / `outline` shorthands carrying a raw hex (a `var(--...)`,
 * `transparent`, `none` or gradient is compliant), and a non-token
 * `backdrop-filter: blur(<n>px)` (it must be `var(--...)`). ELEVATION
 * (`box-shadow`) is compliant only when it is a lone `var(--...)` or `none`;
 * RADII (`border-radius`) only when it is a lone `var(--...)`, `0`, `50%` or
 * `inherit`/`unset`. Everything else is a violation unless allow-listed.
 */
function cssFoundationViolations(css: string): CssViolation[] {
  const out: CssViolation[] = [];
  for (const { selector, body } of cssRules(css)) {
    const norm = selector.replace(/\s+/g, " ").trim();
    const re = /(?:^|[;{\n])\s*(box-shadow|border-radius)\s*:\s*([^;}]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const prop = m[1];
      const value = m[2].replace(/\s+/g, " ").trim();
      const ok =
        prop === "box-shadow" ? CSS_VAR.test(value) || value === "none" : CSS_RADII_OK.test(value);
      if (!ok) out.push({ selector: norm, prop, value });
    }
    const colour = /(?:^|[;{\n])\s*(border|background|outline)\s*:\s*([^;}]+)/g;
    let cm: RegExpExecArray | null;
    while ((cm = colour.exec(body)) !== null) {
      const value = cm[2].replace(/\s+/g, " ").trim();
      if (HEX.test(value) && !RAW_CSS_GRADIENT.test(value)) {
        out.push({ selector: norm, prop: cm[1], value });
      }
    }
    const elevation = /(?:^|[;{\n])\s*(filter|text-shadow)\s*:\s*([^;}]+)/g;
    let em: RegExpExecArray | null;
    while ((em = elevation.exec(body)) !== null) {
      const value = em[2].replace(/\s+/g, " ").trim();
      if (RAW_PX.test(value) || RAW_COLOR_FN.test(value)) {
        out.push({ selector: norm, prop: em[1], value });
      }
    }
    const backdrop = /(?:^|[;{\n])\s*(?:-webkit-)?backdrop-filter\s*:\s*([^;}]+)/g;
    let bm: RegExpExecArray | null;
    while ((bm = backdrop.exec(body)) !== null) {
      const value = bm[1].replace(/\s+/g, " ").trim();
      if (!CSS_VAR.test(value) && value !== "none") {
        out.push({ selector: norm, prop: "backdrop-filter", value });
      }
    }
  }
  return out;
}

const CSS_FONT_OK = /^(?:var\(--[\w-]+\)|inherit|unset)$/i;

/**
 * Raw TYPOGRAPHY literals in a stylesheet's non-token rule bodies: a `font-size`
 * is compliant only when it is a lone `var(--...)`, `inherit` or `unset`; a
 * `font` shorthand (DEF-546 sibling spelling) is a violation when it sets a raw
 * px size (a `font: inherit` / token-only shorthand stays compliant).
 */
function cssTypographyViolations(css: string): CssViolation[] {
  const out: CssViolation[] = [];
  for (const { selector, body } of cssRules(css)) {
    const norm = selector.replace(/\s+/g, " ").trim();
    const re = /(?:^|[;{\n])\s*(font-size)\s*:\s*([^;}]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const value = m[2].replace(/\s+/g, " ").trim();
      if (!CSS_FONT_OK.test(value)) out.push({ selector: norm, prop: "font-size", value });
    }
    const shorthand = /(?:^|[;{\n])\s*(font)\s*:\s*([^;}]+)/g;
    let sm: RegExpExecArray | null;
    while ((sm = shorthand.exec(body)) !== null) {
      const value = sm[2].replace(/\s+/g, " ").trim();
      if (RAW_PX.test(value)) out.push({ selector: norm, prop: "font", value });
    }
  }
  return out;
}

/** Raw one-off motion in EVERY non-token rule body of a stylesheet (file scope). */
function cssMotionFileViolations(css: string): CssViolation[] {
  const out: CssViolation[] = [];
  for (const { selector, body } of cssRules(css)) {
    const norm = selector.replace(/\s+/g, " ").trim();
    const re = /(?:^|[;{\s])(transition|animation)(?:-duration|-delay)?\s*:\s*([^;}\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const value = m[2].replace(/\s+/g, " ").trim();
      if (isOneOffMotion(value)) out.push({ selector: norm, prop: m[1], value });
    }
  }
  return out;
}

/** Every enforced CSS literal family, for one allow-list staleness oracle. */
function cssViolations(css: string): CssViolation[] {
  return [
    ...cssFoundationViolations(css),
    ...cssTypographyViolations(css),
    ...cssMotionFileViolations(css),
  ];
}

describe("Phase 100 — foundation raw literals in migrated surfaces", () => {
  it("MIGRATED_SURFACES names real renderer source files", () => {
    const all = new Set(sourceFiles().map(relOf));
    for (const rel of MIGRATED_SURFACES) expect(all.has(rel), rel).toBe(true);
  });

  it("MIGRATED_SURFACES covers every renderer TSX exactly (complete, not stale)", () => {
    const all = sourceFiles().map(relOf).sort();
    expect([...MIGRATED_SURFACES].sort()).toEqual(all);
  });

  it("a migrated surface contains no raw literal for an enforced family", () => {
    const violations: string[] = [];
    for (const rel of MIGRATED_SURFACES) {
      const text = readFileSync(resolve(RENDERER, rel), "utf8");
      for (const { prop, value } of scanSource(text)) {
        if (ALLOWLIST[`${rel}:${prop}`] !== undefined) continue;
        violations.push(`${rel}:${prop} = ${value}`);
      }
    }
    expect(violations, "raw foundation literal in a migrated surface").toEqual([]);
  });

  it("every allow-list entry is still a real violation (not stale)", () => {
    for (const key of Object.keys(ALLOWLIST)) {
      const idx = key.lastIndexOf(":");
      const rel = key.slice(0, idx);
      const prop = key.slice(idx + 1);
      const props = scanSource(readFileSync(resolve(RENDERER, rel), "utf8")).map((v) => v.prop);
      expect(props, `${key} is allow-listed but is no longer a violation`).toContain(prop);
    }
  });
});

describe("Phase 100 — motion one-off guard", () => {
  it("no raw one-off transition / animation in a migrated inline style", () => {
    const violations: string[] = [];
    for (const rel of MIGRATED_SURFACES) {
      const text = readFileSync(resolve(RENDERER, rel), "utf8");
      for (const body of styleBlocks(text)) {
        const re = /(?:^|[\s,{;])(transition|animation)(?:-duration|-delay)?\s*:\s*([^,;\n}]+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(body)) !== null) {
          if (isOneOffMotion(m[2])) violations.push(`${rel} ${m[1]}: ${m[2].trim()}`);
        }
      }
    }
    expect(violations, "raw one-off motion in a migrated inline style").toEqual([]);
  });

  it("MIGRATED_MOTION_RULES names real renderer stylesheets", () => {
    for (const rel of MIGRATED_MOTION_RULES) {
      expect(existsSync(resolve(RENDERER, rel)), rel).toBe(true);
    }
  });

  it("no raw one-off motion in a migrated stylesheet rule body", () => {
    const violations: string[] = [];
    for (const rel of MIGRATED_MOTION_RULES) {
      const css = readFileSync(resolve(RENDERER, rel), "utf8");
      for (const v of cssMotionFileViolations(css)) {
        if (CSS_ALLOWLIST[`${v.selector}|${v.prop}`] !== undefined) continue;
        violations.push(`${rel} ${v.selector} { ${v.prop}: ${v.value} }`);
      }
    }
    expect(violations, "raw one-off motion in a migrated stylesheet").toEqual([]);
  });
});

describe("Phase 100 — foundation elevation / radii in migrated stylesheet rule bodies", () => {
  it("MIGRATED_CSS_RULES names real renderer stylesheets", () => {
    for (const rel of MIGRATED_CSS_RULES) {
      expect(existsSync(resolve(RENDERER, rel)), rel).toBe(true);
    }
  });

  it("a migrated stylesheet rule body contains no raw elevation or radii literal", () => {
    const violations: string[] = [];
    for (const rel of MIGRATED_CSS_RULES) {
      const css = readFileSync(resolve(RENDERER, rel), "utf8");
      for (const v of cssFoundationViolations(css)) {
        if (CSS_ALLOWLIST[`${v.selector}|${v.prop}`] !== undefined) continue;
        violations.push(`${rel} ${v.selector} { ${v.prop}: ${v.value} }`);
      }
    }
    expect(violations, "raw elevation / radii literal in a migrated stylesheet").toEqual([]);
  });

  it("a migrated stylesheet rule body contains no raw typography literal", () => {
    const violations: string[] = [];
    for (const rel of MIGRATED_CSS_RULES) {
      const css = readFileSync(resolve(RENDERER, rel), "utf8");
      for (const v of cssTypographyViolations(css)) {
        if (CSS_ALLOWLIST[`${v.selector}|${v.prop}`] !== undefined) continue;
        violations.push(`${rel} ${v.selector} { ${v.prop}: ${v.value} }`);
      }
    }
    expect(violations, "raw typography literal in a migrated stylesheet").toEqual([]);
  });

  it("every CSS allow-list entry is still a real violation (not stale)", () => {
    const css = readFileSync(resolve(RENDERER, MIGRATED_CSS_RULES[0]), "utf8");
    const live = cssViolations(css);
    for (const key of Object.keys(CSS_ALLOWLIST)) {
      const idx = key.lastIndexOf("|");
      const selector = key.slice(0, idx);
      const prop = key.slice(idx + 1);
      expect(
        live.some((v) => v.selector === selector && v.prop === prop),
        `${key} is allow-listed but is no longer a violation`,
      ).toBe(true);
    }
  });
});

describe("Phase 100 — the guard is provably live (seeded self-check)", () => {
  it("flags a seeded raw numeric fontSize and raw string border radius", () => {
    expect(scanSource('<div style={{ fontSize: 12 }} />').map((v) => v.prop)).toEqual(["fontSize"]);
    expect(scanSource('<div style={{ borderRadius: "8px" }} />').map((v) => v.prop)).toEqual(["borderRadius"]);
  });

  it("flags a seeded raw hex colour used as a style value", () => {
    expect(scanSource('<div style={{ background: "#ff0000" }} />').map((v) => v.prop)).toEqual(["background"]);
  });

  it("flags a seeded numeric spacing value", () => {
    expect(scanSource('<div style={{ gap: 6 }} />').map((v) => v.prop)).toEqual(["gap"]);
  });

  it("ignores token, template and model-derived values", () => {
    expect(
      scanSource('<div style={{ fontSize: "var(--fs-sm)", borderRadius: `var(--radius-1)` }} />'),
    ).toEqual([]);
    expect(scanSource("<div style={{ fontSize: `${size}px`, gap: cs.gap }} />")).toEqual([]);
    expect(scanSource('<div style={{ boxShadow: "var(--elevation-1)" }} />')).toEqual([]);
  });

  it("flags a seeded one-off motion declaration and ignores tokens / none", () => {
    expect(isOneOffMotion("opacity 200ms ease")).toBe(true);
    expect(isOneOffMotion("opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)")).toBe(true);
    expect(isOneOffMotion("opacity var(--tf-motion-fast) var(--tf-ease-fast)")).toBe(false);
    expect(isOneOffMotion("none")).toBe(false);
    expect(cssMotionViolations(".x { transition: opacity 200ms ease; }", [".x"])).toHaveLength(1);
  });

  it("excludes token-definition blocks from the CSS motion scan", () => {
    expect(cssMotionViolations(":root { transition: 200ms; }", [":root"])).toEqual([]);
    expect(
      cssMotionViolations("@keyframes spin { from { transform: rotate(0); } }", ["@keyframes spin"]),
    ).toEqual([]);
  });

  it("flags a seeded raw elevation shadow and a raw corner radius", () => {
    expect(
      cssFoundationViolations(".x { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }").map((v) => v.prop),
    ).toEqual(["box-shadow"]);
    expect(cssFoundationViolations(".x { border-radius: 8px; }").map((v) => v.prop)).toEqual([
      "border-radius",
    ]);
  });

  it("ignores token, none and structural radius values", () => {
    expect(cssFoundationViolations(".x { box-shadow: var(--elevation-1); }")).toEqual([]);
    expect(cssFoundationViolations(".x { box-shadow: none; }")).toEqual([]);
    expect(cssFoundationViolations(".x { border-radius: 0; }")).toEqual([]);
    expect(cssFoundationViolations(".x { border-radius: 50%; }")).toEqual([]);
    expect(cssFoundationViolations(".x { border-radius: inherit; }")).toEqual([]);
    expect(cssFoundationViolations(".x { border-radius: var(--radius-pill); }")).toEqual([]);
  });

  it("excludes token-definition blocks from the CSS elevation / radii scan", () => {
    expect(
      cssFoundationViolations(":root { border-radius: 8px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }"),
    ).toEqual([]);
    expect(cssFoundationViolations("@keyframes k { from { border-radius: 8px; } }")).toEqual([]);
  });

  it("flags a seeded raw font size and ignores token / inherit values", () => {
    expect(cssTypographyViolations(".x { font-size: 12px; }").map((v) => v.prop)).toEqual([
      "font-size",
    ]);
    expect(cssTypographyViolations(".x { font-size: var(--fs-sm); }")).toEqual([]);
    expect(cssTypographyViolations(".x { font-size: inherit; }")).toEqual([]);
  });

  it("scans EVERY non-token stylesheet rule body for one-off motion", () => {
    expect(cssMotionFileViolations(".x { animation: spin 1.4s linear infinite; }")).toHaveLength(1);
    expect(
      cssMotionFileViolations(".x { animation: spin var(--motion-duration-fast) linear infinite; }"),
    ).toEqual([]);
    expect(cssMotionFileViolations(":root { transition: 200ms; }")).toEqual([]);
  });

  // --- DEF-545: motion LONGHANDS + the duration slot ---
  it("flags a seeded motion-duration longhand exactly like the shorthand", () => {
    expect(cssMotionFileViolations(".x { animation-duration: 9s; }")).toHaveLength(1);
    expect(cssMotionFileViolations(".x { transition-duration: 200ms; }")).toHaveLength(1);
    expect(cssMotionFileViolations(".x { animation-delay: 1.5s; }")).toHaveLength(1);
    expect(cssMotionFileViolations(".x { transition-delay: 120ms; }")).toHaveLength(1);
    expect(cssMotionFileViolations(".x { animation: fade var(--motion-duration-fast) both; }")).toEqual([]);
  });

  it("flags a raw duration beside a motion token (the token exempts the easing slot only)", () => {
    expect(isOneOffMotion("acrylic-sheen 7s var(--tf-ease-standard) infinite")).toBe(true);
    expect(isOneOffMotion("opacity var(--motion-duration-fast) cubic-bezier(0.4, 0, 0.2, 1)")).toBe(false);
    expect(isOneOffMotion("opacity 200ms var(--tf-ease-standard)")).toBe(true);
  });

  // --- DEF-546: sibling-property spellings ---
  it("flags a seeded elevation, colour, type and blur literal in a sibling property", () => {
    expect(cssFoundationViolations(".x { filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.18)); }").map((v) => v.prop)).toEqual(["filter"]);
    expect(cssFoundationViolations(".x { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); }").map((v) => v.prop)).toEqual(["text-shadow"]);
    expect(cssFoundationViolations(".x { border: 2px solid #ffffff; }").map((v) => v.prop)).toEqual(["border"]);
    expect(cssFoundationViolations(".x { background: #ffffff; }").map((v) => v.prop)).toEqual(["background"]);
    expect(cssFoundationViolations(".x { outline: 2px solid #f00; }").map((v) => v.prop)).toEqual(["outline"]);
    expect(cssFoundationViolations(".x { backdrop-filter: blur(12px); }").map((v) => v.prop)).toEqual(["backdrop-filter"]);
    expect(cssTypographyViolations(".x { font: 12px/1.4 Inter; }").map((v) => v.prop)).toEqual(["font"]);
  });

  it("keeps token, transparent, none and gradient sibling values compliant", () => {
    expect(cssFoundationViolations(".x { border: 1px solid var(--border); background: var(--bg-base); }")).toEqual([]);
    expect(cssFoundationViolations(".x { background: transparent; border: none; outline: none; }")).toEqual([]);
    expect(cssFoundationViolations(".x { background: linear-gradient(90deg, #fff, #000); }")).toEqual([]);
    expect(cssFoundationViolations(".x { filter: none; backdrop-filter: var(--glass-blur); }")).toEqual([]);
    expect(cssFoundationViolations(".x { filter: brightness(1.08); }")).toEqual([]);
    expect(cssTypographyViolations(".x { font: inherit; }")).toEqual([]);
  });

  // --- DEF-547: inline JSX style contexts ---
  it("flags a raw literal reached through an un-annotated style const", () => {
    expect(scanSource('const S = { fontSize: 12 };\n<div style={S} />').map((v) => v.prop)).toEqual(["fontSize"]);
  });

  it("flags a raw literal reached through a style string", () => {
    expect(scanSource('<div style="font-size: 12px" />').map((v) => v.prop)).toEqual(["font-size"]);
  });

  it("flags a raw hex reached through an inline SVG presentation attribute", () => {
    expect(scanSource('<circle cx={0} cy={0} r={4} fill="#ef4444" />').map((v) => v.prop)).toEqual(["fill"]);
  });

  it("documents the style-const limit: a computed object is out of reach", () => {
    expect(scanSource('const S = useMemo(() => ({ fontSize: 12 }), []);\n<div style={S} />')).toEqual([]);
  });
});
