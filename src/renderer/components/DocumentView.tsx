import type { PDFDocumentProxy } from "pdfjs-dist";
import { AnimatePresence } from "motion/react";
import { BookOpen, GripVertical } from "lucide-react";
import { Icon } from "../icons/Icon";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  accumulateWheel,
  stepTowards,
  zoomReducer,
  type ZoomMode,
  type ZoomState,
} from "../state/zoom";
import {
  buildPageIndex,
  findPageHits,
  nextHitIndex,
  prevHitIndex,
  type PageTextIndex,
  type SearchHit,
} from "../search/searchIndex";
import {
  isPanBlockingTarget,
  panScrollPosition,
  type PanDragStart,
} from "../state/handPan";
import type { OutlineNode } from "../pdf/pdfjs";
import { useInstantMotion } from "../hooks/useAnimations";
import {
  clearZoomFlip,
  isZoomFlipEnd,
  runZoomFlip,
  zoomAnchorPage,
  type ZoomFlipPending,
  type ZoomFlipPageEl,
  type ZoomFlipRect,
  type FlipKind,
} from "./zoomFlip";
import { PageView } from "./PageView";
import type { ApplyRedactions } from "../redaction/RedactionOverlay";
import { SearchBar } from "./SearchBar";
import { PaneThumbStrip } from "./PaneThumbStrip";
import { ContextPanel, type ContextPanelEditContent } from "./ContextPanel";
import type { RailTab } from "./SideRail";
import { type InspectorTextSelection } from "./Inspector";
import { ActionDock, type DockBulkActions } from "./ActionDock";
import { prunePageSelection } from "../state/pageSelection";
import { dockAvailabilityFor, dockEnabledWithFallback, sanitizeDockPins, type DockAvailability } from "../state/dockModel";
import type { DockLadder } from "../state/dockResponsive";
import { toolById, type ToolEntry } from "../state/toolsRegistry";
import type { Stage } from "../state/stages";
import { usePageDragOptional } from "../state/PageDragContext";
import {
  buildDragSource,
  canvasDropIsAfter,
  canvasInsertIndex,
  dropEffectFor,
  dropModeFromEvent,
  resolveDrop,
  type PageDropOp,
} from "../state/pageDrag";
import { CanvasPills } from "./CanvasPills";
import { PageLayoutControl } from "./PageLayoutControl";
import {
  DEFAULT_PAGE_LAYOUT,
  buildRowGeom,
  layoutFitAnchor,
  layoutFitViewport,
  pageLayoutColumns,
  pageLayoutFitMode,
  pageLayoutFitPages,
  pageReadoutLabel,
  pageToRow,
  rowToFirstPage,
  rowsToPageRange,
  type PageLayoutMode,
} from "./pageLayoutMode";
import { AnnotationFlyout } from "./AnnotationFlyout";
import { AnnotationToolbar } from "../annotations/AnnotationToolbar";
import { isTextPanelFocusTarget } from "../edit/TextPropertiesPanel";
import { useSpellCheck } from "../spell/useSpellCheck";
import {
  annotationStyleFromPanelPatch,
  applyPatchToValues,
  defaultTextStyleValues,
  editColorToHex,
  editTextStyleFromValues,
  runSourceTextStyle,
  textPanelValuesForSelection,
  textStyleValuesFromStyle,
  valuesToPatch,
  type TextStyleValues,
} from "../edit/textStyle";
import {
  editDockVerbFor,
  engineTextBoxesToPlacements,
  hexToEditColor,
  sameTextBoxes,
} from "../edit/model";
import type { TextBoxStylePatch } from "../../shared/types";
import type { EngineState } from "../engine/types";
import { describeEngineError } from "../engine/types";
import type { Result } from "../../shared/result";
import {
  annotationColorToCss,
  annotationToolReducer,
  initialAnnotationToolState,
  rectGeometryPatch,
  type Annotation,
  type AnnotationPatch,
  type AnnotationTool,
  type AnnotationToolAction,
} from "../annotations/model";
import { ANN_TEXT_FONT_CSS } from "../annotations/annTextStyle";
import { annTextMaxHeightPt, grownAnnTextRect } from "../annotations/annTextLayout";
import { measureTextWidthCss } from "../edit/rasterize";
import {
  CONTENT_PADDING_PX,
  mixedPageAtScrollTop,
  mixedSlotOffsetTop,
  mixedVisiblePageRange,
  resolvePageLabel,
  visibleToSourcePageForProxy,
  type MixedPageGeom,
} from "./pageGeometry";
import {
  computeEffectiveScale,
  paneBoxSettled,
  paneFitDeferred,
  type FitBoxSize,
} from "./paneFit";
import {
  createIdleCleanupCoordinator,
  type IdleCleanupCoordinator,
} from "../utils/idleCleanup";
import { waitForRenderActive } from "../state/renderSuspend";
import type {
  AppTheme,
  BatesInfo,
  EngineError,
  FormField,
  ReplaceOccurrence,
  ReplaceSkip,
  ReplaceTextPayload,
  ReplaceTextResult,
  SavedSignature,
  SignaturePlacement,
  WatermarkInfo,
} from "../../shared/types";
import type { ReviewElementRef } from "./ReviewElementsPanel";
import type { TextItemGeom } from "../annotations/geometry";
import type { PaneId } from "../state/multiMode";
import type {
  PaneDockContext,
  SharedToolController,
} from "./multiToolController";

export interface PersistedViewer {
  zoomMode: ZoomMode;
  manualScale: number;
  currentPage: number;
  searchOpen: boolean;
  query: string;
  activeHitIndex: number;
}

export interface SearchIndexProgress {
  built: number;
  total: number;
}

export interface DocDiagnostics {
  pageCount: number;
  currentPage: number;
  zoom: number;
  mode: ZoomMode;
  searchQuery: string;
  searchHits: number;
  searchIndexProgress: SearchIndexProgress | null;
  // DEF-093 â€” the active annotation tool (null when no tool is armed,
  // i.e. when the user is in plain "select" mode). The renderer state
  // holds an `AnnotationTool` enum whose `"select"` value means "no
  // tool active"; e2e harnesses had been getting `undefined` for this
  // field because it was never reported through the diagnostics
  // channel. Mirroring the `"select"` -> `null` mapping here keeps the
  // contract uniform across the surface (every key is either a value
  // or `null`, never `undefined`). The previous behaviour â€” omitting
  // the key entirely â€” left harnesses with an `undefined` they had to
  // special-case.
  activeTool: AnnotationTool | null;
}

/** Phase 86 (FEA-038) — the host hook that rewrites covered glyphs through
 *  `engine.replaceText`. App binds the active tab's `engineDocId`, mirrors
 *  the echoed state (untouched by the brief's App DO-NOTs) and refreshes the
 *  pdf.js proxy on success. */
export type ReplaceTextHook = (
  payload: ReplaceTextPayload,
) => Promise<Result<ReplaceTextResult, EngineError>>;

/** Convert pdf.js text items into top-left-origin page points, preserving the
 *  array indices so a `SearchHit`'s item indices (which address
 *  `PageTextIndex.items`) line up exactly. This mirrors `PageView.tsx`'s
 *  private `textItemsToGeom` — kept index-aligned (one slot per source item,
 *  `undefined` where that converter would skip) because the hit boundaries
 *  address the uncompacted `items` array. */
export function textItemsToGeomAligned(
  items: ReadonlyArray<unknown>,
  pageHeightPt: number,
): Array<TextItemGeom | undefined> {
  return items.map((raw) => {
    const item = raw as {
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    };
    if (typeof item.str !== "string") return undefined;
    if (!Array.isArray(item.transform)) return undefined;
    const t = item.transform;
    if (t.length < 6) return undefined;
    const e = t[4] ?? 0;
    const f = t[5] ?? 0;
    const w = typeof item.width === "number" ? item.width : 0;
    const h = typeof item.height === "number" ? item.height : 0;
    if (w <= 0 || h <= 0) return undefined;
    return { x: e, y: pageHeightPt - f - h, width: w, height: h, text: item.str };
  });
}

/** TFL-686 — true when a focus target lives inside one of the EDIT-text
 *  action bars (the text-run bar or the committed-box toolbar). Pressing a
 *  button in either bar first blurs the Inspector's Text field; without this
 *  guard that blur fired `commitTextSession` — an ENGINE op — before the
 *  Cancel click could discard the live session, so Cancel committed the edit
 *  it was meant to revert. Treating the bar as a "keep the session alive"
 *  surface (exactly like a style control inside `[data-text-panel]`) defers
 *  the commit to the bar's own handler: Confirm commits through the target
 *  clear, Cancel/Delete discard first. Narrow by selector so the annotation /
 *  image bars keep their existing blur semantics. */
export function isEditTextActionBarTarget(target: EventTarget | null | undefined): boolean {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    (target.closest("[data-edit-box-toolbar]") !== null ||
      target.closest('[data-content-action-bar="textrun"]') !== null)
  );
}

/** Phase 86 — map one `SearchHit` to a page-space `ReplaceOccurrence`. The
 *  rect is derived from the existing per-item text geometry plus a
 *  per-character width (`item.width / item.str.length`) over the hit's
 *  start/end boundaries, exactly what the Find bar matched. Returns null when
 *  the hit's geometry is unavailable (page not indexed / a skipped item). */
export function hitToOccurrence(
  hit: SearchHit,
  index: PageTextIndex | undefined,
  geom: ReadonlyArray<TextItemGeom | undefined> | undefined,
): ReplaceOccurrence | null {
  if (index === undefined || geom === undefined) return null;
  const startGeom = geom[hit.start.item];
  const endGeom = geom[hit.end.item];
  if (startGeom === undefined || endGeom === undefined) return null;
  const startCharW =
    startGeom.text.length > 0 ? startGeom.width / startGeom.text.length : startGeom.width;
  const endCharW =
    endGeom.text.length > 0 ? endGeom.width / endGeom.text.length : endGeom.width;
  const startX = startGeom.x + startCharW * hit.start.offset;
  const endX = endGeom.x + endCharW * hit.end.offset;
  const startPos = index.offsets[hit.start.item] + hit.start.offset;
  const endPos = index.offsets[hit.end.item] + hit.end.offset;
  const find = index.text.slice(startPos, endPos);
  if (find.length === 0) return null;
  if (hit.start.item === hit.end.item) {
    const width = Math.max(endX - startX, startCharW);
    return {
      page: hit.page,
      rect: { x: startX, y: startGeom.y, width, height: startGeom.height },
      find,
    };
  }
  // Multi-item hit (a match that wraps across pdf.js runs): span the union of
  // the start/end item boxes. The engine verifies the covered glyphs against
  // `find` and skips when they do not match.
  const left = Math.min(startX, endGeom.x);
  const right = Math.max(startGeom.x + startGeom.width, endX);
  const top = Math.min(startGeom.y, endGeom.y);
  const bottom = Math.max(
    startGeom.y + startGeom.height,
    endGeom.y + endGeom.height,
  );
  return {
    page: hit.page,
    rect: { x: left, y: top, width: Math.max(right - left, startCharW), height: bottom - top },
    find,
  };
}

/** Phase 86 — map every hit to its occurrence, dropping any hit whose
 *  geometry is unavailable (never emitting a rect the engine would have to
 *  reject). */
export function occurrencesForHits(
  hits: readonly SearchHit[],
  indexes: ReadonlyMap<number, PageTextIndex>,
  geoms: ReadonlyMap<number, ReadonlyArray<TextItemGeom | undefined>>,
): ReplaceOccurrence[] {
  const out: ReplaceOccurrence[] = [];
  for (const hit of hits) {
    const occ = hitToOccurrence(hit, indexes.get(hit.page), geoms.get(hit.page));
    if (occ !== null) out.push(occ);
  }
  return out;
}

/** Phase 86 — assemble the engine payload. One occurrence list covers all
 *  pages and is ONE undo entry for replace-all. */
export function buildReplacePayload(
  occurrences: ReplaceOccurrence[],
  replacement: string,
): ReplaceTextPayload {
  return { occurrences, replacement };
}

/** Phase 86 — the readable replace report: always "N replaced, M skipped",
 *  naming the first skip reason when any (plus any font substitutions). */
export function formatReplaceReport(
  replaced: number,
  skipped: readonly ReplaceSkip[],
  substitutedFonts: readonly string[] = [],
): string {
  const head = `${replaced} replaced, ${skipped.length} skipped`;
  const notes: string[] = [];
  if (skipped.length > 0) notes.push(skipped[0].reason);
  if (substitutedFonts.length > 0) {
    notes.push(`substituted font: ${substitutedFonts.join(", ")}`);
  }
  return notes.length > 0 ? `${head}. ${notes.join("; ")}.` : `${head}.`;
}

interface DocumentViewProps extends DocumentViewDockProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  outline: OutlineNode[] | null;
  initial: PersistedViewer;
  onPersist: (v: PersistedViewer) => void;
  onDiagnostics: (d: DocDiagnostics) => void;
  onSearchIndexProgress?: (p: SearchIndexProgress | null) => void;
  /** Def-050 â€” register an imperative invalidator the host can call
   *  when the underlying doc's text content has changed (e.g. after
   *  OCR writes an invisible Tr=3 text layer to the engine's copy of
   *  the doc). The invalidator clears the cached per-page
   *  `PageTextIndex` entries and re-runs the search effect so the
   *  next `findPageHits` walks `pdf.js`'s `getTextContent()` afresh
   *  â€” picking up OCR words that the prior cache didn't have. The
   *  callback runs synchronously; no-op when the search bar isn't
   *  open. */
  registerSearchIndexInvalidator?: (invalidate: () => void) => void;
  onToast?: (kind: "error" | "info", text: string) => void;
  /** Live engine state for the active tab. Drives the rail pageCount,
   *  thumbnail rotations, and toolbar modified indicator. */
  engineState: EngineState;
  /** DEF-139 â€” true once the tab's pdf.js `doc` proxy was rebuilt from
   *  `engine.getDocumentBytes` bytes via `refreshDocProxyFor`. A
   *  re-serialized file is written in the engine's VISIBLE order (the
   *  `serializeDoc` `pageOrder` sequence), so the renderer must ask the
   *  proxy for `visiblePage` itself â€” NOT `pageOrder[visiblePage-1]+1`,
   *  which is a pdf-lib ORIGINAL page index and only addresses the
   *  original open bytes. Defaults to false (original proxy). */
  proxyVisibleOrder?: boolean;
  /** True when the active tab has unsaved engine changes. Phase 22 â€”
   *  the CommandBar no longer shows a Save control, so this view no
   *  longer reads it; the title bar (AppHeader) owns Save state. The
   *  prop is retained (optional) for host/harness compatibility. */
  modified?: boolean;
  /** Whether undo is currently possible for the active tab. */
  canUndo: boolean;
  /** Whether redo is currently possible (DEF-327: the dock/palette gate). */
  canRedo?: boolean;
  /** False for sample documents (Save is gated to Save-As only).
   *  Phase 22 â€” no longer read here (Save moved to the title bar). */
  saveInPlaceEnabled?: boolean;
  /** Rail engine callbacks. Each is optional so the rail can degrade
   *  gracefully (e.g. tests can omit them to render the rail with no
   *  editing capability). */
  onRotate?: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
  /** Toolbar action callbacks. */
  /** Phase 14.1 â€” the command bar's accent Open button (the reference
   *  places Open in the command bar, not the title bar). Phase 22 â€”
   *  SUPERSEDED: Open / Save / Save As live in the caption strip
   *  (AppHeader's .titlebar-file group), so these props are no longer
   *  read here. They stay on the interface for host/harness
   *  compatibility; the real app wires the title bar directly. */
  onOpenFile?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  onMerge?: () => void;
  /** Phase 36 (chunk 3b) â€” SUPERSEDED: the command toolbar row is retired, so
   *  Split is reached from the PAGES dock / the palette / the thumbnails'
   *  verbs (routed through App's `onDockToolAction`). This prop stays on the
   *  interface for host/harness compatibility, like Open / Save above. */
  onSplit?: () => void;
  /** Phase 36 (chunk 2) â€” the PAGES ContextPanel's right-click verbs. Each is
   *  the host's EXISTING surface for that command (the same dialogs the
   *  toolbar / palette already open); the panel passes the VISIBLE 1-based
   *  page the gesture landed on so the host can pre-scope the dialog.
   *  "Insert blank after" is the ONE exception: it is an immediate engine
   *  insert (no dialog), so its handler receives the page and acts at once.
   *  Optional: with a handler absent its menu item is not wired. */
  onExtractPages?: (page: number) => void;
  onInsertBlankPage?: (page: number) => void;
  onReplacePages?: (page: number) => void;
  /** Phase 8 â€” Optimize / Audit Space dialogs. Both are toolbar
   *  actions that the host owns (the dialogs are mounted at the App
   *  level). The toolbar buttons are disabled when there's no active
   *  document, so the dialogs themselves don't need a guard. */
  onOptimize?: () => void;
  onAuditSpace?: () => void;
  /** DEF-041 â€” Rotate the current page clockwise. The host passes a
   *  callback that uses `engine.applyOp({kind:'rotate', page, dir:'cw'})`
   *  with the page the toolbar reports as currently visible. The
   *  toolbar button only renders when this is wired, so missing
   *  wiring (e.g. tests) doesn't surface a no-op button. */
  onRotateClockwise?: () => void;
  /** Phase 13 â€” Rotate the current page counter-clockwise. Same
   *  contract as `onRotateClockwise` with the engine op dir flipped
   *  to "ccw"; the toolbar button only renders when wired. */
  onRotateCounterClockwise?: () => void;
  /** B8 â€” Delete pages (current / custom range). The toolbar
   *  button only renders when this is wired, mirroring the
   *  `onRotateClockwise` opt-in. Disabled when there's only one
   *  page left. Phase 36 (chunk 2) â€” the optional `page` seeds the
   *  dialog with the page the PAGES panel's "Deleteâ€¦" gesture landed
   *  on; the toolbar passes no argument (the dialog then seeds from
   *  the tab's current page). */
  onDeletePage?: (page?: number) => void;
  /** Phase 87 (FEA-039) — opens the Remove blank pages scan dialog. Only
   *  renders the PAGES panel entry when the host wires it. */
  onRemoveBlankPages?: () => void;
  /** Phase 36 (chunk 3b) â€” SUPERSEDED: the retired toolbar was the only
   *  reader; the PAGES dock's Delete verb is disabled from the host's gate
   *  instead. Kept on the interface for host/harness compatibility. */
  canDeletePage?: boolean;
  /** Phase 3 â€” annotations. The host (App) holds the canonical list; this
   *  view threads it through to each PageView's overlay and the rail's
   *  annotations panel. */
  annotations?: Annotation[];
  /** DEF-166 â€” annotation ids whose overlay text must be drawn LIVE
   *  (created / edited since the current page-canvas bytes were
   *  loaded). Threaded to every PageView's AnnotationOverlay so a
   *  parsed-from-file textbox/callout (whose baked FreeText
   *  appearance pdf.js already paints into the page canvas) does not
   *  draw a duplicated overlay text on reopen. */
  liveAnnTextIds?: ReadonlySet<string>;
  onCreateAnnotation?: (annotation: Annotation) => void;
  onEditAnnotation?: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation?: (id: string) => void;
  /** Phase 90 (TFL-509-C1) — the unified review list's non-annotation sources
   *  and handlers, threaded to the REVIEW ContextPanel. The existing
   *  `signatures` prop below is the placed-signature list the same panel
   *  consumes, so it is reused rather than duplicated. */
  bates?: readonly BatesInfo[];
  watermarks?: readonly WatermarkInfo[];
  onSelectReviewElement?: ((el: ReviewElementRef) => void) | null;
  onEditReviewElement?: ((el: ReviewElementRef) => void) | null;
  onDeleteReviewElement?: ((el: ReviewElementRef) => void) | null;
  reviewErrorFor?: ((el: ReviewElementRef) => string | null) | null;
  /** Phase 28 â€” append a comment / reply to an annotation's thread. The
   *  host (App) routes it to the engine and mirrors the echoed state,
   *  which refreshes the comment box's list and flips the annotation's
   *  comment badge on. Threaded to every PageView's overlay. */
  onAddComment?: (annotationId: string, text: string) => void;
  // -- Phase 4: forms --
  formFields?: FormField[];
  onFormValueChange?: (id: string, value: string | string[]) => void;
  onFormListboxToggle?: (id: string, option: string) => void;
  // -- Phase 4: signatures --
  signatures?: SignaturePlacement[];
  savedSignatures?: SavedSignature[];
  armedSignatureId?: string | null;
  /** Phase 36 (chunk 6) â€” the EDIT / REVIEW / DELIVER ContextPanel's host
   *  wiring. All optional: an absent handler disables its control (never a
   *  silent no-op), so the document-less harnesses stay unchanged. */
  onSignSignature?: (signatureId: string) => void;
  onManageSignatures?: () => void;
  ocrStatus?: string | null;
  ocrHasRun?: boolean;
  ocrSuspectCount?: number;
  onRecognizeText?: () => void;
  onOpenOcrSuspects?: () => void;
  fileSize?: number | null;
  onCreateFromImages?: () => void;
  /** Phase 36 (chunk 6) â€” publish the CURRENT text-object selection (the edit
   *  model's selected committed box, or the text-run target the panel edits)
   *  so the host can feed the Inspector's EDIT/text section. `null` when
   *  nothing text-bearing is selected. The snapshot carries the view's OWN
   *  handlers, so the Inspector never re-implements the text edit path.
   *  Phase 36 (chunk 7) â€” BOTH panes publish in Multi Mode; the host's
   *  `resolvePaneSelection` guard keeps only the FOCUSED pane's publish, so the
   *  ONE shared Inspector follows the pane the user is working in. */
  onTextSelectionChange?: (selection: InspectorTextSelection | null) => void;
  /** Phase 82 — the offline spell-check preference for the text surfaces
   *  (Inspector Text field + on-canvas run editor). Optional so direct-mount
   *  hosts/tests without the spell layer render with it off. */
  spellCheckEnabled?: boolean;
  onSpellCheckEnabledChange?: (enabled: boolean) => void;
  /** B10 â€” armed stamp. When non-null, every PageView shows a
   *  ghost preview following the cursor; clicking a page embeds
   *  the stamp at the click point. */
  armedStamp?: {
    stampId: import("../../shared/types").StampId;
    pngBytes: Uint8Array;
    pngWidth: number;
    pngHeight: number;
  } | null;
  /** B10 / DEF-101 â€” successfully placed stamps for this tab
   *  (recorded by the host on `addStamp` success). Rendered as
   *  `.stamp-annotation` DOM surfaces per page. */
  stampAnnotations?: import("../annotations/StampAnnotations").PlacedStamp[];
  /** Bug 6 â€” placed stamps are editable/movable/deletable like
   *  every annotation: the bar's Confirm / Delete / Edit route
   *  through these to the host, which re-bakes the page via the
   *  engine's editImage lever. */
  onMoveStamp?: (
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  onDeleteStamp?: (id: string) => void;
  onRetypeStamp?: (id: string, stampId: import("../../shared/types").StampId) => void;
  onPlaceStamp?: (args: {
    stampId: import("../../shared/types").StampId;
    pngBytes: Uint8Array;
    pngWidth: number;
    pngHeight: number;
    page: number;
    atPt: { x: number; y: number };
  }) => Promise<void> | void;
  /** Phase 84 — the Redact tool is armed; every PageView mounts the
   *  RedactionOverlay so the user can drag a region into a pending mark. */
  redactArmed?: boolean;
  /** Phase 84 — apply hook threaded to every PageView's RedactionOverlay. */
  onApplyRedactions?: ApplyRedactions;
  /** Phase 86 (FEA-038) — rewrite the glyphs covered by a search occurrence
   *  through `engine.replaceText`. The host binds the active tab's engine doc,
   *  mirrors the echoed state and refreshes the pdf.js proxy on success.
   *  Optional: an absent hook leaves the replace verbs inert (their report
   *  names the missing backend update). */
  onReplaceText?: ReplaceTextHook;
  /** Phase 84 — fill colour for pending redaction marks (settings-backed). */
  markColor?: string;
  /** Phase 84 — persist a chosen redaction mark colour. */
  onMarkColorChange?: (hex: string) => void;
  /** Place a saved signature on a specific page at the given rect. The
   *  page number is threaded through so the host doesn't have to track
   *  which page the click landed on; SignaturesOverlay already knows
   *  it (it filters placements by `page`) and passes it along. */
  onPlaceSignature?: (signatureId: string, page: number, rect: SignaturePlacement["rect"]) => void;
  onMoveSignature?: (placementId: string, rect: SignaturePlacement["rect"]) => void;
  onDeleteSignature?: (placementId: string) => void;
  /** B1 â€” exit Sign mode. The host wires this to the same setter
   *  that the toolbar's Sign toggle uses; the pending action bar's
   *  Cancel button calls it through this callback so the overlay
   *  doesn't need a direct reference to App-level state. */
  onCancelSignatureArm?: () => void;
  /** Phase 13 â€” disarm the armed stamp ghost. Pan mode and the stamp
   *  ghost both own page-pointer input; when Hand is armed while a
   *  stamp is pending, the host drops the pending stamp so the pan
   *  drag is the only gesture that handles the press. */
  onDisarmStamp?: () => void;
  /** Phase 6 â€” annotation color palette. The toolbar shows a
   *  single swatch that opens a popover picker; the host owns the
   *  saved presets (typically App.settings.annotationColors). The
   *  shape matches the shared `AppSettings.annotationColors` field:
   *  each bucket is an array of `{ id, hex }` preset objects. */
  annotationPalette?: { light?: Array<{ id: string; hex: string }>; dark?: Array<{ id: string; hex: string }> } | null;
  onAnnotationPaletteChange?: (next: { light?: Array<{ id: string; hex: string }>; dark?: Array<{ id: string; hex: string }> }) => void;
  /** Phase 19 â€” persisted MRU annotation tool order (most-recent-first,
   *  sanitised by the backend to known ids, deduped, capped at 6). App
   *  owns the value; DocumentView threads it to the annotation group so
   *  the visible five can be computed. */
  annotationRecentTools?: string[];
  /** Phase 19 â€” the host persists a new MRU order after the user arms a
   *  tool. Threaded through to the annotation group; App owns the write. */
  onAnnotationRecentToolsChange?: (ids: string[]) => void;
  /** Active theme ('light' | 'dark' | 'frosted'). Drives which
   *  per-theme preset bucket the picker shows. */
  themeName?: AppTheme;
  // -- Phase 10: Edit-content overlay --
  /** Edit mode is open. When true, the per-page EditOverlay
   *  becomes pointer-active and the EDIT dock's edit-layer tools arm
   *  on the page. The overlay is layered on top of the
   *  existing annotation overlay (text selection / signing /
   *  forms), so a single mode is active at a time. */
  editModeOpen?: boolean;
  onEditModeToggle?: () => void;
  /** Phase 16 â€” the side-rail pages panel is collapsed to the ruler
   *  strip. The host (App) owns the persisted value; DocumentView
   *  only threads it to the SideRail. */
  pagesPanelCollapsed?: boolean;
  /** Phase 16 â€” asks the host to toggle the pages-panel collapsed
   *  state. Threaded to the SideRail, whose expand/collapse button
   *  calls it; the rail never owns the value itself. */
  onTogglePagesPanelCollapsed?: () => void;
  /** Phase 59 (item 7 follow-up) — the host-owned active rail tab (App's
   *  `railTab`), threaded to the Pages ContextPanel so the "Page thumbnails" /
   *  "Bookmarks" commands switch the panel's body. Optional: absent = the
   *  legacy local behaviour. */
  railTab?: RailTab;
  onRailTabChange?: (tab: RailTab) => void;
  /** Phase 32 â€” the rail master switch. `false` suppresses the rail
   *  entirely and collapses the workspace grid to the page column
   *  (`data-rail="none"`), leaving no empty gutter. Defaults to `true`.
   *  Phase 33 â€” Multi Mode no longer suppresses it: each pane renders its
   *  own strip (see `multiRail`) instead of the full SideRail. */
  showRail?: boolean;
  /** Phase 33 â€” which side of the page area this view's rail occupies.
   *  Single mode keeps the default `'left'` (unchanged). Multi Mode renders
   *  pane A's strip on its RIGHT and pane B's on its LEFT, so the two
   *  strips meet side by side in the MIDDLE of the workspace:
   *  `[A pages | A thumbs || B thumbs | B pages]`. */
  railSide?: "left" | "right";
  /** Phase 33 â€” Multi Mode's per-pane thumbnail strip. When present the
   *  rail slot renders this pane's OWN strip (document header + the
   *  existing ThumbnailRail) at `railSide`, instead of the full SideRail.
   *  `null` (the single-mode default) renders the unchanged SideRail. */
  multiRail?: {
    /** Which pane this view fills (drives the strip's badge). */
    pane: "A" | "B";
    /** This view's document (the tab id) â€” the strip's drag identity. */
    tabId: string;
    /** The document name shown in the strip header. */
    title: string;
    /** How many documents are loaded across both strips (1 or 2). */
    documentCount: number;
    /** Focus this view's pane (the strip header's click target). */
    onFocusPane: () => void;
    /** Apply a resolved page drop (the cross-document drag seam). */
    onDrop: (op: PageDropOp) => void;
  } | null;
  /** Phase 32 â€” Multi Mode state for the CommandBar control. The host
   *  (App) owns the mode; this view only threads it to the toolbar. */
  multiModeEnabled?: boolean;
  /** Phase 36 (chunk 3b) â€” SUPERSEDED: the retired toolbar hosted this
   *  toggle. Multi Mode's canonical home is now the title bar + the command
   *  palette; the prop stays on the interface for host/harness compatibility. */
  onMultiModeToggle?: () => void;
  /** Phase 32 (chunk 2b) â€” an external page jump: a page drop reveals the
   *  landing page in the target pane. `seq` makes each request unique, so
   *  clicking the same thumbnail twice both land and a re-render never
   *  replays a stale request. `null` (the single-mode default) means this
   *  view is never driven from outside. */
  jumpRequest?: { page: number; seq: number } | null;
  /** Phase 33 (chunk 4) + Phase 36 (chunk 7) â€” Multi Mode's SHARED workspace
   *  wiring. When supplied, this view suppresses its OWN toolbar rows (the ONE
   *  shared Action Dock renders the workspace's verbs) and instead:
   *    - publishes its DOCK CONTEXT (page selection, State-2 bulk verbs, the
   *      live availability gate, its armed / dragging flags) to the controller
   *      so the shared dock can drive this pane;
   *    - routes its annotation-tool reducer through the controller's
   *      fan-out, so arming / disarming from the dock or in either pane keeps
   *      BOTH panes coherent.
   *  `null` (the single-mode default) is the pre-Phase-33 behaviour exactly. */
  sharedTools?: {
    pane: PaneId;
    controller: SharedToolController;
  } | null;
  /** Phase 36 (chunk 7) â€” the pane this view fills in Multi Mode (`null` in
   *  single mode). It gates the per-pane chrome the chunk adds: the pane's own
   *  floating pills (each pane keeps its own page / zoom / pan) and the
   *  document keyboard handler (find / Escape act on the FOCUSED pane only, so
   *  the workspace never ends up with two search bars). */
  multiPane?: PaneId | null;
  /** DEF-343 — the Inspector's REQUESTED inset (px) for this pane's document:
   *  0 while no document is open, `INSPECTOR_COLLAPSED_W_PX` while collapsed,
   *  otherwise `INSPECTOR_W_PX`. The pane first-fit gate will not release until
   *  the live `--tf-tools-inset` has reached this target, so a first fit can
   *  never be committed while the panel slide is still pending. `null` (the
   *  single-mode default) leaves the gate box-only, as before DEF-343. */
  paneInsetTarget?: number | null;
  /** DEF-343 — true once this pane's tab is a REAL document (not the empty
   *  placeholder it is while its bytes load). The engine page count can reach
   *  >0 a commit before the tab's `kind` flips and the Inspector target
   *  changes; without this the gate could settle at the placeholder inset (0)
   *  and only THEN see the panel slide begin. Defaults to `true` (single mode /
   *  a host that does not supply it). */
  paneContentReady?: boolean;
  /** Phase 36 (chunk 7) â€” true while THIS view is the focused pane. The REVIEW
   *  annotations flyout is ONE surface: only the focused pane mounts it. */
  paneFocused?: boolean;
  /** Phase 36 (chunk 7) â€” the shared chrome idle (reported by the ONE dock).
   *  Multi Mode's per-pane pills fade with it, exactly as single mode's pills
   *  fade with the view's own dock. */
  chromeIdle?: boolean;
  /** Phase 66 (chunk 1) — the Book View entry. When the host supplies it, a
   *  single-view canvas control at the overlay's TOP-LEFT toggles the host's
   *  read-only Book View; while that mode is on the host renders BookView
   *  INSTEAD of this DocumentView, so this control vanishes with the dock,
   *  flyout and rail. Absent (every pre-chunk-66 mount) renders exactly as
   *  before - no control. Multi Mode panes never show it. */
  onOpenBookView?: () => void;
  /** Phase 78 (feature A) — the open-triggered notice family
   *  (`ProtectionNotice` / `ConversionNotice` / `Pdf3dNotice`), re-parented
   *  here by the host so they mount INSIDE the canvas-bound `.canvas-overlay`
   *  at the top-right instead of as flow siblings above the scroller. Absent
   *  (every pre-Phase-78 mount) renders exactly as before - no notice layer. */
  canvasNotices?: ReactNode;
  /** Phase 32 (chunk 2d) â€” canvas page drag and drop. Present only in Multi
   *  Mode: each page grows a hover-revealed grip (`data-page-drag-handle`)
   *  that starts a document-aware drag, and every page slot accepts a drop
   *  from the other document with an insertion indicator. Absent (the
   *  single-mode default) means this view renders exactly as before - no
   *  grip, no drop handlers. */
  pageDrag?: {
    /** This view's document (the tab id). */
    tabId: string;
    /** Apply a resolved drop; App owns the engine + refresh sequence. */
    onDrop: (op: PageDropOp) => void;
  } | null;
  /** Per-tab Edit state. DocumentView only forwards it to
   *  PageView; App owns the reducer. */
  edit?: {
    state: import("../edit/model").EditState;
    onAction: (action: import("../edit/model").EditAction) => void;
    defaultFont: import("../../shared/types").EditFont;
    onDefaultFontChange?: (font: import("../../shared/types").EditFont) => void;
    pickImage: () => Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null>;
    onCommitTextEdit: (args: {
      rect: { x: number; y: number; width: number; height: number };
      newText: string;
      style: import("../edit/model").EditTextStyle;
      oldRect?: { x: number; y: number; width: number; height: number };
      /** DEF-232 â€” the page the committing overlay owns. */
      page: number;
    }) => void;
    onCommitTextBox: (args: {
      /** Phase 26 - the id the renderer already minted for a freshly
       *  dragged box (so the engine registers under the same id). */
      id?: string;
      rect: { x: number; y: number; width: number; height: number };
      text: string;
      style: import("../edit/model").EditTextStyle;
      background: "white" | "none";
      /** DEF-232 sibling â€” the page the committing overlay owns. */
      page: number;
    }) => void;
    onCommitImageEdit: (args: {
      op: "move" | "resize" | "replace" | "crop";
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      bytes: Uint8Array;
      format: "png" | "jpeg";
      id: string;
      /** DEF-232 sibling â€” the page the committing overlay owns. */
      page: number;
    }) => void;
    /** DEF-127 â€” commit a committed text box's drag (move/resize):
     *  the host re-bakes the box at `newRect` through the engine's
     *  existing editImage contract. */
    onCommitTextBoxMove: (args: {
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      text: string;
      style: import("../edit/model").EditTextStyle;
      background: "white" | "none";
      id: string;
      /** DEF-232 sibling â€” the page the committing overlay owns. */
      page: number;
    }) => void;
    /** DEF-135/136 â€” delete a committed text box through the engine's
     *  registry (engine.deleteTextBox). Wire â†’ DocumentView â†’ PageView
     *  â†’ EditOverlay's box placement toolbar. */
    onDeleteTextBox?: (id: string) => void;
    /** Phase 21 â€” apply a style patch to the SELECTED committed box
     *  (App routes it to `engine.updateTextBox`). Absent when the host
     *  cannot target a registry box. */
    onTextStylePatch?: (patch: TextBoxStylePatch) => void;
    /** Phase 26 â€” apply a patch (the panel Text field's session commit)
     *  to a SPECIFIC committed box, by id. App routes it to
     *  `engine.updateTextBox`; absent when the host cannot target the
     *  registry. */
    onTextPatch?: (id: string, patch: TextBoxStylePatch) => void;
  } | null;
}

// Stable empty-array reference: passed to PageView when a page has no search
// hits, so the prop's reference doesn't change between renders (which would
// retrigger PageView's measurement effect and cause a setState loop).
const EMPTY_HITS: SearchHit[] = [];

// How many pages to render in the initial synchronous mount on open, so the
// very first paint already shows real bitmaps without waiting for
// IntersectionObserver callbacks. The IO is unreliable in some real-world
// configurations (headless harnesses, certain driver/page-zoom combos); the
// geometry-based mount is the source of truth and the IO is just a progressive
// refinement that can extend the mounted range outward from the viewport.
//
// 3 pages: at fit-width only ~1 page fits the viewport, so 3 covers the
// visible page plus ~1 above for scroll smoothness and keeps the
// always-mounted count for the annotations panel and search overlays
// stable. Each mounted page pins ~3.5MB of GPU/CPU canvas memory at
// cssScale ~1.5x, alpha:false; dropping from 4 -> 3 frees ~3.5MB of
// idle GPU memory on the open canvas (DEF-016 exit target).
const INITIAL_MOUNT_PAGES = 3;

// Phase 29 â€” the canvas is flush. `.document-content` carries no
// top/bottom padding in ANY theme, so the scroll math's top pad is the
// (now zero) CONTENT_PADDING_PX everywhere; the frosted theme no longer
// adds a chrome-stack offset.

/** DEF-232 â€” compare two reported page-1 sizes by VALUE. A doc-proxy
 *  swap re-publishes an equal-but-new `{ w, h }` object; treating that
 *  as a geometry transition made the DEF-098 mount-sync effect yank
 *  the scroller back to the current-page readout on every refresh. */
function samePageSize(
  a: { w: number; h: number } | null,
  b: { w: number; h: number } | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.w === b.w && a.h === b.h;
}

// How many pages of buffer to keep mounted on each side of the viewport, on
// top of the IO rootMargin. The buffer covers the case where the user scrolls
// fast enough that IO callbacks have not yet caught up with the geometry.
//
// 1 page: same per-page bitmap cost as above. The geometry mount
// re-renders a page bitmap on demand when it scrolls into range, so a
// 1-page buffer trades a brief blank-slot flash on extreme fast
// scrolls for ~10 MB less idle GPU memory (was 2, dropped to 1 for
// DEF-016).
const PAGE_BUFFER_PAGES = 1;

// How long the document must be idle (no scroll, no IO change, no
// mounted-set change, no annotation op, no search op) before we ask
// pdf.js to flush its per-document worker-side caches via
// `doc.cleanup()`. The cleanup drops the font cache, the global image
// cache, and the page-tree / page-index lookup tables â€” the dominant
// idle-time memory contributors for long PDFs (DEF-016). 3 seconds is
// long enough that scroll-jitter and the qa 10-second idle window
// both see the cleaned state, short enough that the renderer settles
// quickly after the user stops interacting.
const DOC_IDLE_CLEANUP_MS = 3000;

// How many pages around the viewport we keep mounted. IntersectionObserver
// does the actual gating; this margin only sizes the buffer so fast scrolls
// don't reveal blank slots. The IO rootMargin is hard-coded in the IO
// useEffect below (800px top/bottom) â€” tight enough to keep the IO's
// effective intersection window within ~1 page above and below the
// viewport at fit-width, so the observer's internal entry table stays
// bounded instead of tracking hundreds of slot elements on long.pdf.

// How many pages to index before yielding back to the event loop. Keeps the
// UI thread responsive while building the search index on a 500+ page doc.
const SEARCH_CHUNK_PAGES = 8;

export interface DocumentViewHandle {
  /** Reset any active annotation tool to 'select' (no tool active). */
  disarmAnnotationTool(): void;
}

/**
 * DEF-254 â€” the annotation-selection conduit's page guard.
 *
 * Every mounted page's `AnnotationOverlay` reports its own selection upward:
 * `(null, ownPage)` while nothing on that page is selected, `(ann, ownPage)`
 * when the user selects one. The host keeps a SINGLE selection, so without
 * this guard a page that MOUNTS later (virtualization mounting page 5 while
 * page 4's overlay is selected, or a neighbour remounting during the panel's
 * reflow) reported `null` and clobbered the live selection â€” the text
 * properties panel opened and then closed on its own.
 *
 * Rule: a non-null report from ANY page is authoritative (it sets the
 * selection). A null report only clears when it comes from the page that
 * currently HOLDS the selection â€” a neighbouring page saying "nothing is
 * selected over here" is not a deselect gesture.
 */
export function applyAnnSelectionReport(
  prev: Annotation | null,
  report: Annotation | null,
  fromPage: number,
): Annotation | null {
  if (report !== null) return report;
  if (prev !== null && prev.page === fromPage) return null;
  return prev;
}

/**
 * Phase 24 â€” the annotation text-properties values. The panel reflects the
 * SELECTED annotation's STORED style (font/size/bold/italic/underline/
 * highlight/align/lineHeight/baselineShift/list/indent), falling back to the
 * per-tool defaults for any field the annotation never set (absent fields
 * never overwrite the default). The colour is always the annotation's ACTUAL
 * colour (or the armed tool's colour while nothing is selected yet).
 *
 * DEF-326 â€” extracted as a pure helper so the "panel shows what the ENGINE
 * holds" contract is unit-testable: a reopened note carrying `style.font`
 * must surface that exact family, never the tool default. (The original
 * defect was a click being swallowed by a neighbouring comment card before
 * the note could ever become the selection; this helper pins the resolution
 * half so a regression there is caught too.)
 */
export function annotationTextPanelValues(
  defaults: TextStyleValues,
  annotation: Annotation | null,
  color: TextStyleValues["color"],
): TextStyleValues {
  return {
    ...defaults,
    ...annotation?.style,
    color,
  };
}

/** Phase 36 (chunk 3a) â€” the ActionDock wiring the host (App) supplies. All
 *  optional: a DocumentView with no `activeStage` renders no dock, so the
 *  dev/test harnesses and every pre-chunk-3a mount are unchanged. */
export interface DocumentViewDockProps {
  /** The stage in force for this pane (App's per-pane stage model). */
  activeStage?: Stage;
  /** The persisted, registry-validated dock pins (max 4). */
  dockPins?: readonly string[];
  /** Phase 37 (item 21) — registry tool ids the user unpinned from their
   *  stage's default dock set. */
  dockUnpinned?: readonly string[];
  onDockPin?: (id: string) => void;
  onDockUnpin?: (id: string) => void;
  /** Per-tool usage counts for the compact overflow ranking. */
  toolUsage?: Readonly<Record<string, number>> | undefined;
  /** Phase 37 (items 2 + 6) — the ONE responsive ladder the host resolved from
   *  the measured workspace width; threaded to the ActionDock so the dock's
   *  label/arrow rungs agree with the Inspector/panel rungs. */
  dockLadder?: DockLadder;
  /** App-level registry actions this view cannot run itself (dialogs, OCR,
   *  export, sign, forms, ...). Returns true when it handled the id. */
  onDockToolAction?: (id: string) => boolean;
  /** App-level availability for those same entries. */
  isDockToolEnabled?: (id: string) => boolean;
  /** Phase 36 (chunk 4) â€” publish the view-level commands this view owns
   *  (zoom presets, page stepping, find, pan, the edit / annotation tools) to
   *  the host, which routes the Command Palette's rows through them. Same
   *  pattern as `registerSearchIndexInvalidator`: the SAME handlers the pills
   *  and the dock already call, never a second implementation. `null`
   *  withdraws this view's commands (unmount / tab close). */
  registerViewCommands?: (commands: Record<string, () => void> | null) => void;
  /** DEF-327 â€” publish this view's dock availability (the gate + the refusal
   *  copy the Action Dock consumes) to the host, so the Command Palette's rows
   *  for the dock's own verbs use the dock's verdict instead of a second guess.
   *  `null` withdraws it (unmount / tab close). */
  registerDockAvailability?: (availability: DockAvailability | null) => void;
}

/**
 * The full document workspace: side rail (thumbnails / outline), toolbar,
 * search bar, and the virtualized continuous scroller. All per-document
 * view state (zoom, page, search) lives here and is persisted upwards.
 */
export const DocumentView = forwardRef<DocumentViewHandle, DocumentViewProps>(function DocumentView({
  doc,
  pageCount,
  outline,
  initial,
  onPersist,
  onDiagnostics,
  onSearchIndexProgress,
  registerSearchIndexInvalidator,
  registerViewCommands,
  registerDockAvailability,
  onToast,
  proxyVisibleOrder = false,
  engineState,
  canUndo,
  canRedo = false,
  onRotate,
  onDelete,
  onReorder,
  onUndo,
  onMerge,
  onExtractPages,
  onInsertBlankPage,
  onReplacePages,
  onRotateClockwise,
  onRotateCounterClockwise,
  onDeletePage,
  onRemoveBlankPages,
  onOptimize,
  onAuditSpace,
  annotations = [],
  onCreateAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  bates = [],
  watermarks = [],
  onSelectReviewElement = null,
  onEditReviewElement = null,
  onDeleteReviewElement = null,
  reviewErrorFor = null,
  onAddComment,
  /** DEF-166 â€” annotation ids whose overlay text must be drawn LIVE
   *  (created / edited since the current page-canvas bytes were
   *  loaded). Threaded to every PageView's AnnotationOverlay so a
   *  parsed-from-file textbox/callout (whose baked FreeText
   *  appearance pdf.js already paints into the page canvas) does not
   *  draw a duplicated overlay text on reopen. */
  liveAnnTextIds,
  formFields = [],
  onFormValueChange,
  onFormListboxToggle,
  signatures = [],
  savedSignatures = [],
  armedSignatureId = null,
  onSignSignature,
  onManageSignatures,
  ocrStatus = null,
  ocrHasRun = false,
  ocrSuspectCount = 0,
  onRecognizeText,
  onOpenOcrSuspects,
  fileSize = null,
  onCreateFromImages,
  onTextSelectionChange,
  armedStamp = null,
  onPlaceStamp,
  redactArmed = false,
  onApplyRedactions,
  onReplaceText,
  markColor,
  onMarkColorChange,
  stampAnnotations = [],
  onMoveStamp,
  onDeleteStamp,
  onRetypeStamp,
  onPlaceSignature,
  onMoveSignature,
  onDeleteSignature,
  onCancelSignatureArm,
  onDisarmStamp,
  annotationPalette,
  onAnnotationPaletteChange,
  annotationRecentTools,
  onAnnotationRecentToolsChange,
  themeName = 'frosted',
  editModeOpen = false,
  edit = null,
  onEditModeToggle,
  pagesPanelCollapsed,
  onTogglePagesPanelCollapsed,
  railTab,
  onRailTabChange,
  showRail = true,
  railSide = "left",
  multiRail = null,
  multiModeEnabled,
  jumpRequest = null,
  pageDrag = null,
  sharedTools = null,
  multiPane = null,
  paneInsetTarget = null,
  paneContentReady = true,
  paneFocused = false,
  chromeIdle = false,
  onOpenBookView,
  canvasNotices,
  activeStage,
  dockPins = [],
  dockUnpinned = [],
  onDockPin,
  onDockUnpin,
  toolUsage,
  dockLadder,
  onDockToolAction,
  isDockToolEnabled,
  spellCheckEnabled = false,
  onSpellCheckEnabledChange,
}: DocumentViewProps,
  ref,
) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Phase-C frosted layering â€” the full-bleed scroller needs the
  // measured chrome stack height so .document-content pads down by
  // exactly the toolbar rows that float above it (see the
  // measurement effect below).
  const mainRef = useRef<HTMLDivElement | null>(null);
  const slotRefsRef = useRef(new Map<number, HTMLDivElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wheelRemainderRef = useRef(0);
  const scrollRafRef = useRef(0);
  // pdf.js per-page render tasks are owned by PageView, but the
  // DocumentView-level idle-cleanup coordinator needs a single
  // document-wide "is anything in flight" probe. PageView calls the
  // stable onRenderStart / onRenderEnd callbacks below; we keep a
  // counter here so the coordinator can see all in-flight renders in
  // one place.
  const inFlightRendersRef = useRef(0);
  // Stable callbacks for PageView to report render lifecycle. useCallback
  // with empty deps so the render effect's dep array doesn't churn and
  // re-fire the entire getPage â†’ render â†’ TextLayer pipeline on every
  // DocumentView re-render.
  const onPageRenderStart = useCallback((): void => {
    inFlightRendersRef.current += 1;
  }, []);
  const onPageRenderEnd = useCallback((): void => {
    // Never go negative â€” a cancelled effect that ended without firing
    // its beginRender() (e.g. shouldRender flipped false before any
    // page was actually rendered) should not underflow the counter.
    inFlightRendersRef.current = Math.max(0, inFlightRendersRef.current - 1);
  }, []);
  // Idle-cleanup coordinator. Rebuilt per `doc` identity (so a tab
  // change cancels any pending cleanup against the obsolete document
  // and installs a fresh one for the new one).
  const idleCleanupRef = useRef<IdleCleanupCoordinator | null>(null);

  const [firstPageSize, setFirstPageSize] = useState<{ w: number; h: number } | null>(null);

  // Phase 40 (item 7) — the SINGLE-VIEW page-layout mode (one / two / four
  // pages). Per-tab, session-scoped: DocumentView is mounted once per tab
  // (MultiPane keys each tab-pane by tab id), so this local state is exactly
  // the tab's session value and is never persisted (REQUIREMENTS.md Phase 40,
  // Settings impact: none). Multi Mode panes always render ONE (their layout
  // is out of scope for this item), so the effective mode collapses to ONE
  // whenever this view fills a pane.
  const [pageLayout, setPageLayout] = useState<PageLayoutMode>(DEFAULT_PAGE_LAYOUT);
  const singleView = multiPane === null;
  const layoutMode: PageLayoutMode = singleView ? pageLayout : DEFAULT_PAGE_LAYOUT;
  const layoutColumns = pageLayoutColumns(layoutMode);

  // Phase 3 â€” annotation tool state. Declared ahead of the Phase-21
  // text-properties panel block below, which reads the armed annotation
  // text tool (`textbox` / `callout` / `note`) to decide whether the
  // panel opens in annotation mode and which colour it reflects.
  const [annTool, rawDispatchAnnTool] = useReducer(
    annotationToolReducer,
    initialAnnotationToolState,
  );

  // Phase 33 (chunk 4) â€” when the SHARED Multi Mode toolbar is wired, an
  // annotation action from this pane is fanned out to every pane's reducer
  // through the controller, so both panes arm / disarm together. `self` is
  // passed so this pane's own reducer runs exactly once. Single mode keeps
  // the raw per-view reducer untouched.
  const dispatchAnnTool = useCallback(
    (action: AnnotationToolAction): void => {
      const shared = sharedTools;
      if (shared === null) {
        rawDispatchAnnTool(action);
        return;
      }
      shared.controller.annToolAction(action, rawDispatchAnnTool);
    },
    [sharedTools, rawDispatchAnnTool],
  );

  // Phase 21 â€” text-properties panel state. The panel is selection-aware:
  // a selected committed box shows its ACTUAL values, otherwise the
  // per-tool defaults (with any not-yet-committed tweaks kept locally).
  const [pendingTextStyle, setPendingTextStyle] = useState<TextStyleValues | null>(null);
  /** Phase 80 (F1) — the Format Painter. `formatPainter` holds the captured
   *  full style while armed; `painterHint` tells the user why a non-applicable
   *  selection did not apply. Both are renderer-local and never persisted. */
  const [formatPainter, setFormatPainter] = useState<TextBoxStylePatch | null>(null);
  const [painterHint, setPainterHint] = useState<string | null>(null);
  const textPanelDefaults = useMemo(
    () => defaultTextStyleValues(edit?.defaultFont ?? "Helvetica"),
    [edit?.defaultFont],
  );
  const selectedTextBox = useMemo(() => {
    if (edit === null || edit.state.selectedTextBox === null) return null;
    return edit.state.textBoxes.find((b) => b.id === edit.state.selectedTextBox) ?? null;
  }, [edit?.state.selectedTextBox, edit?.state.textBoxes]);
  // Phase 21 (annotations) â€” the committed annotation the page overlay
  // reports as selected, if any. The overlay owns per-page selection; it
  // reports upward so the panel can reflect a selected annotation text
  // object's ACTUAL colour without a second selection model. The reported
  // OBJECT is kept (not just its id): a just-placed annotation is not in
  // the engine's `annotations` list yet (the create round-trips over IPC),
  // and looking the id up in that list alone made `selectedAnnText` flip
  // false for a frame â€” the panel closed, reflowed 248px, and the user's
  // follow-up click on the placed annotation landed on a moving origin.
  const [selectedAnn, setSelectedAnn] = useState<Annotation | null>(null);
  // DEF-254 â€” the report carries the reporting page's number. `page` is the
  // VISIBLE page index, the same space `Annotation.page` uses, so the guard
  // can compare them. See `applyAnnSelectionReport`.
  const onSelectAnnotation = useCallback((ann: Annotation | null, fromPage: number): void => {
    setSelectedAnn((prev) => applyAnnSelectionReport(prev, ann, fromPage));
  }, []);

  // ---- Phase 26: the panel Text field ---------------------------------
  // The panel's Text field is the single text-editing surface for
  // annotation text and Edit-mode text. A session starts on the first
  // keystroke and is committed as ONE engine op when it ends (field blur
  // / Escape / target change), so one edit session is exactly one undo
  // entry. Mid-typing the page is painted from the renderer-local draft
  // (`renderedAnnotations`) or the box registry â€” never an op per
  // keystroke.
  const [textEdit, setTextEdit] = useState<{
    target: TextTarget;
    text: string;
    original: string;
    /** A just-placed annotation: an empty session drops it again. */
    justPlaced: boolean;
  } | null>(null);
  const textEditRef = useRef<typeof textEdit>(null);
  textEditRef.current = textEdit;
  const [textFocusToken, setTextFocusToken] = useState(0);
  const [textCommitToken, setTextCommitToken] = useState(0);
  /** Phase 26 â€” the Edit overlay's selected text target (box or run). */
  const [editTextTarget, setEditTextTarget] = useState<EditTextTarget | null>(null);
  /** The id of a text annotation placed this gesture with empty text. */
  const justPlacedTextRef = useRef<string | null>(null);
  /** Phase 26 â€” paint the session's live text over the engine list so
   *  the page follows every keystroke (the annotation overlay renders
   *  exactly what the host hands it). */
  const renderedAnnotations = useMemo((): Annotation[] => {
    if (textEdit === null || textEdit.target.kind !== "annotation") return annotations;
    const id = textEdit.target.id;
    const next = textEdit.text;
    return annotations.map((a) => (a.id === id ? { ...a, text: next } : a));
  }, [annotations, textEdit]);
  const selectedAnnotation = useMemo(
    () =>
      selectedAnn === null
        ? null
        : (renderedAnnotations.find((a) => a.id === selectedAnn.id) ?? selectedAnn),
    [selectedAnn, renderedAnnotations],
  );
  const selectedAnnText =
    selectedAnnotation !== null &&
    (selectedAnnotation.kind === "textbox" ||
      selectedAnnotation.kind === "note" ||
      selectedAnnotation.kind === "callout");
  /** The text target the panel currently edits. An annotation selection
   *  wins (Edit mode and the annotation tools are mutually exclusive). */
  const textTarget = useMemo<TextTarget | null>(() => {
    if (selectedAnnText && selectedAnnotation !== null) {
      return { kind: "annotation", id: selectedAnnotation.id };
    }
    return editTextTarget;
  }, [selectedAnnText, selectedAnnotation, editTextTarget]);
  const textTargetKeyNow = textTargetKey(textTarget);
  /** The target's committed text (the session draft overrides it while
   *  one is open). */
  const textTargetBase =
    textTarget === null
      ? ""
      : textTarget.kind === "annotation"
        ? selectedAnnotation !== null && "text" in selectedAnnotation
          ? selectedAnnotation.text
          : ""
        : textTarget.kind === "box"
          ? (selectedTextBox?.text ?? "")
          : textTarget.text;
  const textEditKey = textEdit === null ? null : textTargetKey(textEdit.target);
  const panelText =
    textTarget === null
      ? null
      : textEdit !== null && textEditKey === textTargetKeyNow
        ? textEdit.text
        : textTargetBase;
  // Phase 82 — the offline spell-check state for both text surfaces. The
  // dictionary loads once (lazily) while enabled; the host persists the flip.
  const handleSpellCheckEnabledChange = useCallback(
    (enabled: boolean): void => {
      onSpellCheckEnabledChange?.(enabled);
    },
    [onSpellCheckEnabledChange],
  );
  const spellCheck = useSpellCheck({
    enabled: spellCheckEnabled,
    onEnabledChange: handleSpellCheckEnabledChange,
  });
  // Phase 26 â€” the Edit overlay reported its selected text target (a
  // committed box or a text run). The report arrives through the editProp
  // memo below; it focuses the panel field so clicking a text element in
  // Edit mode starts typing immediately.
  const onEditTextTargetChange = useCallback((target: EditTextTarget | null): void => {
    setEditTextTarget(target);
    if (target !== null) setTextFocusToken((n) => n + 1);
  }, []);
  /** Phase 26 â€” the annotation overlay placed or clicked a text element:
   *  focus the panel's Text field with its content selected. */
  const onAnnTextFocusRequest = useCallback((): void => {
    setTextFocusToken((n) => n + 1);
  }, []);
  // The previous text target (and its key) the target-change effect below
  // compares against. Declared here so `commitTextSession` can clear a
  // committed box's `isNew` flag on the ref the cleanup reads (DEF-257).
  const prevTextTargetKeyRef = useRef<string | null>(null);
  const prevTextTargetRef = useRef<TextTarget | null>(null);
  // DEF-262 â€” mirrors so the stable commit / style callbacks read the latest
  // annotation list and per-page sizes without becoming unstable.
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const pageSizesRef = useRef<Map<number, { w: number; h: number }>>(new Map());
  /** DEF-262 â€” the rect a textbox / callout must be persisted at to hold its
   *  current text + (optionally merged) style legibly. Null when the stored
   *  rect already fits. This is the SAME growth rule the live overlay renders,
   *  so the persisted rect and the on-screen height agree. */
  const annGrownRect = useCallback(
    (
      ann: Annotation,
      text: string,
      style: import("../../shared/types").AnnTextStyle | undefined,
    ): import("../annotations/model").PageRect | null => {
      if (ann.kind !== "textbox" && ann.kind !== "callout") return null;
      const rect = ann.rect;
      if (rect === undefined) return null;
      const font = style?.font ?? ann.style?.font ?? "Helvetica";
      const measure = (t: string, s: number): number =>
        measureTextWidthCss(t, ANN_TEXT_FONT_CSS[font], s);
      const pageHeightPt = pageSizesRef.current.get(ann.page)?.h ?? 792;
      return grownAnnTextRect({
        kind: ann.kind,
        rect,
        text,
        style,
        maxHeightPt: annTextMaxHeightPt(pageHeightPt, rect.y),
        measure,
      });
    },
    [],
  );
  /** DEF-262 / Phase 30 â€” persist a text commit. When the text needs a taller
   *  box the new rect rides `editAnnotation`'s in-place `rect` patch, so the
   *  annotation keeps its id and the panel's selection survives the commit
   *  (the old delete + re-create re-created it and fired a fresh selection
   *  event asynchronously, which a zero-gap burst of style clicks could read
   *  as a stale selection). Otherwise the plain text patch is enough. */
  const persistAnnText = useCallback(
    (ann: Annotation, text: string): void => {
      const grown = annGrownRect(ann, text, ann.style);
      const rect =
        grown === null ? null : rectGeometryPatch(ann, { ...ann, rect: grown } as Annotation);
      onEditAnnotation?.(ann.id, rect === null ? { text } : { text, rect });
    },
    [annGrownRect, onEditAnnotation],
  );
  /** Phase 26 â€” end the edit session and commit it as ONE engine op.
   *  Phase 29 (DEF-266) â€” `relatedTarget` is the focus target the panel's
   *  Text field reported on blur. When it is a control INSIDE the panel the
   *  session must stay open (the user is composing styles on the still-active
   *  run), so no commit happens and the run is not deselected. */
  const commitTextSession = useCallback(
    (relatedTarget?: EventTarget | null): void => {
      if (isTextPanelFocusTarget(relatedTarget)) return;
      // TFL-686 — a press on the EDIT-text action bars (Cancel / Delete /
      // Confirm) must NOT commit the live session on blur: Cancel has to be
      // able to discard it. The bar's own click handler commits or discards.
      if (isEditTextActionBarTarget(relatedTarget)) return;
      const session = textEditRef.current;
    textEditRef.current = null;
    setTextEdit(null);
    if (session === null) return;
    // A session means the placement was USED â€” it is no longer an
    // abandoned empty placement (so the stray-placement cleanup below
    // must not delete it).
    justPlacedTextRef.current = null;
    const { target } = session;
    if (target.kind === "annotation") {
      if (session.text.trim() === "") {
        // An empty text annotation carries no content â€” a fresh
        // placement is dropped again (the old empty-text guard).
        onDeleteAnnotation?.(target.id);
        return;
      }
      if (session.text === session.original) return;
      const ann = annotationsRef.current.find((a) => a.id === target.id);
      if (ann !== undefined) {
        persistAnnText(ann, session.text);
        return;
      }
      onEditAnnotation?.(target.id, { text: session.text });
      return;
    }
    if (target.kind === "box") {
      if (session.text === session.original) return;
      const editApi = editRef.current;
      if (editApi === null) return;
      if (target.isNew === true) {
        // A freshly dragged box lives only in the renderer registry: the
        // commit IS its first engine op (addTextBox), registered under
        // the same id so the local mirror and the engine agree.
        const box = textBoxesRef.current.find((b) => b.id === target.id);
        if (box === undefined) return;
        editApi.onCommitTextBox({
          id: box.id,
          rect: { ...box.rect },
          text: session.text,
          style: box.style,
          background: box.background,
          page: box.page,
        });
        // DEF-257 â€” the box is in the engine registry now, so it is no
        // longer a renderer-only placement. Clear `isNew` on the live
        // target (state + the ref the target-change cleanup reads), else
        // that cleanup treats the committed box as an abandoned empty
        // placement and drops it from the mirror when the target clears
        // (Edit mode close/reopen), leaving the engine's box with no
        // `.edit-box` surface.
        const committed: TextTarget = { ...target, isNew: false };
        prevTextTargetRef.current = committed;
        setEditTextTarget((prev) =>
          prev !== null && prev.kind === "box" && prev.id === target.id ? committed : prev,
        );
        return;
      }
      editApi.onTextPatch?.(target.id, { text: session.text });
      return;
    }
    // A text run: the Edit overlay owns the run's rect AND the white
    // mask cover, so it performs the commit when the token flips.
    setTextCommitToken((n) => n + 1);
  }, [onEditAnnotation, onDeleteAnnotation, persistAnnText]);
  /** Phase 37 (item 11) — the Edit overlay's action-bar Cancel: DISCARD the
   *  live text session without committing it. The panel's keystrokes mutate
   *  the box registry live, so a box target is restored to the session's
   *  original text; a run target needs no engine work (the overlay drops its
   *  pending move). Clearing the session first means the target-change effect
   *  that follows the selection's dismissal commits nothing. */
  const discardTextSession = useCallback((): void => {
    const session = textEditRef.current;
    textEditRef.current = null;
    setTextEdit(null);
    if (session === null) return;
    justPlacedTextRef.current = null;
    const { target } = session;
    if (target.kind === "box" && session.text !== session.original) {
      const box = textBoxesRef.current.find((b) => b.id === target.id);
      if (box !== undefined) {
        editRef.current?.onAction({
          type: "upsert-text-box",
          placement: { ...box, text: session.original },
        });
      }
    }
  }, []);
  /** Phase 26 â€” a keystroke in the panel's Text field. The page follows
   *  immediately (annotation draft / box registry); the engine is
   *  untouched until the session commits. */
  const handlePanelTextChange = useCallback(
    (next: string): void => {
      const target = textTargetRef.current;
      if (target === null) return;
      const key = textTargetKey(target);
      const current = textEditRef.current;
      const base = textBaseRef.current;
      const justPlaced =
        target.kind === "annotation" && justPlacedTextRef.current === target.id;
      if (current !== null && textTargetKey(current.target) === key) {
        textEditRef.current = { ...current, text: next };
        setTextEdit(textEditRef.current);
      } else {
        textEditRef.current = { target, text: next, original: base, justPlaced };
        setTextEdit(textEditRef.current);
      }
      if (target.kind === "box") {
        // Live registry update: the box mirror on the page repaints on
        // every keystroke (no engine op until the session commits).
        const box = textBoxesRef.current.find((b) => b.id === target.id);
        if (box !== undefined) {
          editRef.current?.onAction({
            type: "upsert-text-box",
            placement: { ...box, text: next },
          });
        }
      }
    },
    [],
  );
  // The panel's Text field value / target, mirrored into refs so the
  // stable session callbacks always read the latest values.
  const textTargetRef = useRef<TextTarget | null>(null);
  const textBaseRef = useRef<string>("");
  const textBoxesRef = useRef<readonly import("../edit/model").TextBoxPlacement[]>([]);
  const editRef = useRef(edit);
  textTargetRef.current = textTarget;
  textBaseRef.current = textTargetBase;
  textBoxesRef.current = edit?.state.textBoxes ?? [];
  editRef.current = edit;
  // Commit when the target changes (another element selected) or clears
  // (tool change / panel close) so no edit is lost and each session stays
  // one undo entry. The two refs live above `commitTextSession` so the
  // commit can clear a new box's `isNew` flag on the ref the cleanup
  // below reads (DEF-257).
  useEffect(() => {
    if (prevTextTargetKeyRef.current === textTargetKeyNow) return;
    prevTextTargetKeyRef.current = textTargetKeyNow;
    const previous = prevTextTargetRef.current;
    prevTextTargetRef.current = textTarget;
    const hadSession = textEditRef.current !== null;
    commitTextSession();
    if (hadSession) return;
    // A placement that was never typed into leaves no session behind â€”
    // drop the stray empty surface when the target moves away.
    const abandoned = justPlacedTextRef.current;
    if (abandoned !== null) {
      if (textTargetKeyNow !== `annotation:${abandoned}`) {
        justPlacedTextRef.current = null;
        onDeleteAnnotation?.(abandoned);
      }
      return;
    }
    // Phase 26 â€” a freshly dragged Edit-mode box that never received text
    // is dropped from the renderer registry (it never reached the engine).
    if (previous !== null && previous.kind === "box" && previous.isNew === true) {
      editRef.current?.onAction({ type: "delete-text-box", id: previous.id });
    }
  }, [textTargetKeyNow, textTarget, commitTextSession, onDeleteAnnotation]);
  // The annotation text tools (text box, callout, sticky note) open the
  // SAME panel instance; the annotation colour state it reflects is the
  // selected annotation's colour when one is selected, else the armed
  // tool's colour (the existing annotation colour path).
  const annTextToolArmed =
    annTool.tool === "textbox" || annTool.tool === "callout" || annTool.tool === "note";
  // Text-bearing TFlex-owned tools: the edit-text run editor ("text") and
  // the text box tool ("box"). A selected committed box keeps the panel
  // open regardless of the tool, per the "selection-aware" contract.
  const tfTextPanelOpen =
    edit !== null &&
    editModeOpen &&
    (selectedTextBox !== null || edit.state.tool === "text" || edit.state.tool === "box");
  const textPanelMode: "text" | "annotation" = tfTextPanelOpen ? "text" : "annotation";
  const textPanelOpen = tfTextPanelOpen || annTextToolArmed || selectedAnnText;
  // Phase 38 feature C — the floating text-manipulation card is RETIRED. The
  // Inspector's text block is the ONLY text surface, so this view publishes a
  // text-panel snapshot whenever a text surface is engaged: a selected target
  // (box / run / annotation) OR an armed text tool with nothing selected yet
  // (the pre-placement defaults the retired card used to host). The snapshot
  // rides the existing `onTextSelectionChange` seam; App maps it onto the
  // Inspector (see `inspectorSelectionFor` / `inspectorTextPanelFor`).
  const textPanelSelectionActive = textPanelOpen || textTarget !== null;
  // The full control set is live only for TFlex-owned text objects; the
  // annotation panel values are the per-tool defaults with the colour
  // swapped for the annotation's actual colour.
  // Phase 38 feature D — a selected RUN has no stored style: seed the panel
  // (and therefore the live on-canvas preview and the eventual commit) from
  // the run's source rect, so editing renders at the run's own size, not the
  // 12pt per-tool default (which shrank the text on the canvas).
  const selectedRunValues = useMemo<TextStyleValues | null>(() => {
    if (editTextTarget === null || editTextTarget.kind !== "run") return null;
    return textStyleValuesFromStyle(
      runSourceTextStyle(editTextTarget.rect.height, edit?.defaultFont ?? "Helvetica"),
    );
  }, [editTextTarget, edit?.defaultFont]);
  // Phase 51 item 14 — a committed box shows its own style; a selected run
  // shows its live pending style over its source style; NOTHING selected shows
  // the per-tool defaults (no formatting toggle may stay active once the run
  // is deselected). See `textPanelValuesForSelection`.
  const textPanelTextValues = textPanelValuesForSelection({
    selectedBoxStyle: selectedTextBox?.style ?? null,
    runValues: selectedRunValues,
    pending: pendingTextStyle,
    defaults: textPanelDefaults,
  });
  const annotationPanelColor = hexToEditColor(
    annotationColorToCss(
      selectedAnnText && selectedAnnotation !== null ? selectedAnnotation.color : annTool.color,
    ),
  );
  const textPanelValues: TextStyleValues =
    textPanelMode === "text"
      ? textPanelTextValues
      : annotationTextPanelValues(textPanelDefaults, selectedAnnotation, annotationPanelColor);
  const handleTextPanelPatch = useCallback(
    (patch: TextBoxStylePatch): void => {
      if (textPanelMode === "annotation") {
        // Phase 24 â€” a selected annotation text object now takes the FULL
        // patch. Every non-colour field rides `editAnnotation`'s `style`
        // payload (the engine validates + merges it and re-bakes the /AP
        // stream); colour keeps its own path. A colour-only patch never
        // reaches the style route, and a style-only patch never re-sends
        // colour â€” a mixed patch (clear formatting) goes out as ONE call
        // so it is a single undo step.
        const { color: patchColor, ...rest } = patch;
        const style = annotationStyleFromPanelPatch(rest);
        const hasStyle = Object.keys(style).length > 0;
        const hasColor = patchColor !== undefined;
        if (selectedAnnText && selectedAnnotation !== null) {
          if (!hasStyle && !hasColor) return;
          // DEF-262 / Phase 30 â€” a style control that needs a TALLER box (a
          // bigger size, a list prefix, more indent, a longer line-height)
          // must persist the grown rect too, else save + reopen shrinks the
          // text back into the old one-line box. The grown rect and the new
          // style ride ONE `editAnnotation` op (the engine applies the rect
          // IN PLACE and merges the style), so the panel change is one undo
          // step, the annotation keeps its id, and the selection the next
          // control in a burst reads cannot go stale.
          let grownRect: import("../../shared/types").AnnRect | null = null;
          if (hasStyle) {
            const mergedStyle = { ...selectedAnnotation.style, ...style };
            const grown = annGrownRect(selectedAnnotation, selectedAnnotation.text, mergedStyle);
            grownRect =
              grown === null
                ? null
                : rectGeometryPatch(selectedAnnotation, {
                    ...selectedAnnotation,
                    rect: grown,
                  } as Annotation);
          }
          onEditAnnotation?.(selectedAnnotation.id, {
            ...(grownRect === null ? {} : { rect: grownRect }),
            ...(hasStyle ? { style } : {}),
            ...(hasColor ? { color: editColorToHex(patchColor) } : {}),
          });
          return;
        }
        // Nothing selected yet: only the armed tool's colour is real
        // state. A style gesture before placement would have no target.
        if (hasColor) {
          dispatchAnnTool({ type: "set-color", color: editColorToHex(patchColor) });
        }
        return;
      }
      if (selectedTextBox !== null) {
        edit?.onTextStylePatch?.(patch);
        return;
      }
      // Phase 38 feature D — a style gesture on a selected RUN composes on
      // top of the run's SOURCE style, not the 12pt per-tool default, so the
      // preview and the commit keep the run's size unless the user changes it.
      setPendingTextStyle((prev) =>
        applyPatchToValues(prev ?? selectedRunValues ?? textPanelDefaults, patch),
      );
    },
    [
      textPanelMode,
      selectedAnnText,
      selectedAnnotation,
      onEditAnnotation,
      annGrownRect,
      selectedTextBox,
      edit?.onTextStylePatch,
      selectedRunValues,
      textPanelDefaults,
    ],
  );
  // Phase 80 (F1) — Format Painter. A pick-up needs a source text target to
  // read the full format from; with nothing selected the button is disabled.
  const canPickUpPainter = textTarget !== null;
  const painterArmedKeyRef = useRef<string | null>(null);
  // Phase 80 (F2 / DEF-478) — box ids CREATED while the painter is armed. The
  // transient guard (`isNew`) only covers the uncommitted window; on commit the
  // engine echo clears `isNew`, the box key changes, and the apply pass would
  // otherwise consume the captured format against the just-created box. This
  // set remembers those ids for the whole armed session so the commit
  // transition stays a hint (armed) and only a DIFFERENT, pre-existing
  // committed box can apply. Cleared on arm/disarm.
  const painterCreatedIdsRef = useRef<Set<string>>(new Set());
  // Phase 80 (F2 / DEF-474) — the painter's apply target is the AUTHORITATIVE
  // selection (the engine's selected box under the box tool, or the reported
  // selected annotation), not only the per-page overlay's last report. The
  // panel's values already come from `selectedTextBox`, so reading the target
  // identity from the same source is what makes a cross-page box selection
  // visible to the apply pass in ONE action. A run reported by the text tool
  // stays the reported target (a run is non-applicable).
  const painterTarget = useMemo<TextTarget | null>(
    () =>
      resolvePainterTarget({
        selectedAnnText,
        selectedAnnotationId: selectedAnnotation?.id ?? null,
        boxToolActive: edit?.state.tool === "box",
        selectedBoxId: selectedTextBox?.id ?? null,
        reported: editTextTarget,
      }),
    [
      selectedAnnText,
      selectedAnnotation,
      edit?.state.tool,
      selectedTextBox,
      editTextTarget,
    ],
  );
  const painterTargetKeyNow = textTargetKey(painterTarget);
  // Phase 80 (F2 / DEF-476) — a box the placement verb just created exists only
  // in the renderer registry until committed; it must never consume the
  // captured format. The marker is read from the AUTHORITATIVE reducer mirror
  // (`selectedTextBox`), which updates on the SAME render as the selection,
  // never from the per-page overlay's report (that report is delivered in a
  // post-commit effect and lags the reducer by one render — the DEF-476 root
  // cause). The overlay report is kept only as a defensive fallback.
  const painterTargetIsTransient = painterTargetIsTransientBox({
    target: painterTarget,
    selectedBoxId: selectedTextBox?.id ?? null,
    selectedBoxIsNew: selectedTextBox?.isNew === true,
    reported: editTextTarget,
    createdWhileArmed: painterCreatedIdsRef.current,
  });
  // Remember any transient box seen during the armed session (the placement
  // verb sets `isNew` on the same render as the selection). Recording it here
  // is what keeps the DEF-478 commit transition transient after the engine
  // echo clears `isNew`.
  const painterTargetBoxId = painterTarget?.kind === "box" ? painterTarget.id : null;
  useEffect((): void => {
    if (formatPainter === null || painterTargetBoxId === null) return;
    if (
      selectedTextBox !== null &&
      selectedTextBox.id === painterTargetBoxId &&
      selectedTextBox.isNew === true
    ) {
      painterCreatedIdsRef.current.add(painterTargetBoxId);
    }
  }, [formatPainter, painterTargetBoxId, selectedTextBox]);
  const handleCancelPainter = useCallback((): void => {
    setFormatPainter(null);
    setPainterHint(null);
    painterArmedKeyRef.current = null;
    painterCreatedIdsRef.current = new Set();
  }, []);
  const handleArmPainter = useCallback((): void => {
    if (formatPainter !== null) {
      handleCancelPainter();
      return;
    }
    if (textTarget === null) return;
    painterArmedKeyRef.current = painterTargetKeyNow;
    painterCreatedIdsRef.current = new Set();
    setPainterHint(null);
    setFormatPainter(valuesToPatch(textPanelValues));
  }, [
    formatPainter,
    handleCancelPainter,
    textTarget,
    painterTargetKeyNow,
    textPanelValues,
  ]);
  // The apply pass is keyed on the STABLE target key so a new selection is the
  // trigger. The target that armed the painter is never re-applied to (its key
  // is remembered in `painterArmedKeyRef`) — but returning to it clears any
  // stale hint, so a raw-run hint recovers when the user re-selects an
  // applicable source (DEF-475). An applicable new target takes the whole
  // captured patch in ONE call, then the painter disarms. A non-applicable
  // selection (a raw run, nothing, or the placement verb's transient box)
  // keeps the painter armed and surfaces the hint instead of silently doing
  // nothing.
  useEffect((): void => {
    if (formatPainter === null) return;
    const decision = resolveFormatPainterApply({
      armed: true,
      targetKey: painterTargetKeyNow,
      armedKey: painterArmedKeyRef.current,
      targetKind: painterTarget?.kind ?? null,
      targetIsTransient: painterTargetIsTransient,
    });
    if (decision.kind === "idle") return;
    if (decision.kind === "clear-hint") {
      setPainterHint(null);
      return;
    }
    if (decision.kind === "hint") {
      setPainterHint(decision.hint);
      return;
    }
    handleTextPanelPatch(formatPainter);
    setFormatPainter(null);
    setPainterHint(null);
    painterArmedKeyRef.current = null;
    painterCreatedIdsRef.current = new Set();
  }, [
    formatPainter,
    painterTarget,
    painterTargetKeyNow,
    painterTargetIsTransient,
    handleTextPanelPatch,
  ]);
  // Phase 38 feature D — a NEW run target starts from ITS OWN source size; a
  // pending style composed for a previous run (or for the armed tool) must
  // not bleed across. Clear the renderer-local pending set when the run
  // target changes (including run -> nothing, so the armed-tool defaults
  // resume clean).
  const runTargetKeyRef = useRef<string | null>(null);
  const runTargetKeyNow =
    editTextTarget !== null && editTextTarget.kind === "run" ? textTargetKeyNow : null;
  useEffect((): void => {
    if (runTargetKeyNow === runTargetKeyRef.current) return;
    runTargetKeyRef.current = runTargetKeyNow;
    setPendingTextStyle(null);
  }, [runTargetKeyNow]);
  // The page-1 dimensions the fit modes (fit-width / fit-page) anchor
  // their scale to. Deliberately decoupled from the LIVE `firstPageSize`
  // layout reference above: the live size must track the current bytes
  // (slots, rail ratios, wrapper dims), while the fit anchor must NOT
  // move when a proxy refresh merely shrinks page 1 in place. Before
  // this split, a crop committed through `refreshDocProxyFor` re-fetched
  // page 1's (smaller) dims, the fit recomputed from them, and every
  // OTHER uncropped page re-rendered at a bigger absolute scale â€” the
  // "zoom jump after crop" defect (crop undo showed the reverse jump).
  // The anchor only moves on:
  //   - first resolution (open),
  //   - an explicit user fit action (fit-width / fit-page button),
  //   - a doc refresh whose page-1 size is NOT an inset of the anchor
  //     (a genuine page identity change â€” delete / reorder / insert â€”
  //     which legitimately re-fits to the new first page).
  const [fitAnchor, setFitAnchor] = useState<{ w: number; h: number } | null>(null);
  // `mountedPages` are the only pages that get a real PageView (canvas +
  // TextLayer + search-hit overlays). Every other page is just a fixed-height
  // slot that reserves scroll space. This is what keeps a 520-page doc from
  // freezing the renderer on open.
  const [mountedPages, setMountedPages] = useState<Set<number>>(new Set());
  const [viewportBox, setViewportBox] = useState({ w: 0, h: 0 });
  const [currentPage, setCurrentPage] = useState(initial.currentPage);
  // DEF-141 â€” per-page sizes (un-rotated pt dims) reported by each
  // mounted PageView's `onPageSize`. The scroller renders every slot
  // at ITS OWN page's size so a per-page crop of page 1 no longer
  // collapses pages 2..N into the crop box. The map survives a doc
  // proxy refresh (same DocumentView instance â€” App keys the tab-pane
  // by tab id), so the OTHER pages keep their pre-refresh sizes the
  // moment `refreshDocProxyFor` swaps in the re-serialized bytes; each
  // slot re-reports its size when it re-renders, correcting any page
  // whose size actually changed (the cropped page itself).
  const [pageSizes, setPageSizes] = useState<Map<number, { w: number; h: number }>>(new Map());
  // DEF-262 â€” the commit path reads the latest page sizes through this ref
  // (declared above `commitTextSession`, which must stay stable).
  pageSizesRef.current = pageSizes;

  const [zoom, dispatchZoom] = useReducer(zoomReducer, {
    mode: initial.zoomMode,
    manualScale: initial.manualScale,
  } as ZoomState);

  // Phase 3 â€” per-annotation flash highlight. The annotation tool state
  // itself is declared above (the Phase-21 panel block reads it).
  // DEF-211 â€” imperative handle so the host can disarm the annotation
  // tool before opening a dialog overlaying the workspace.
  useImperativeHandle(ref, () => ({
    disarmAnnotationTool: (): void => {
      dispatchAnnTool({ type: "set-tool", tool: "select" });
    },
  }), []);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const [searchOpen, setSearchOpen] = useState(initial.searchOpen);
  const [query, setQuery] = useState(initial.query);
  const [activeHitIndex, setActiveHitIndex] = useState(initial.activeHitIndex);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchIndexProgress, setSearchIndexProgress] = useState<SearchIndexProgress | null>(null);
  const searchTokenRef = useRef(0);
  const indexesRef = useRef(new Map<number, PageTextIndex>());
  // Phase 86 (FEA-038) — per-page text geometry snapshot, index-aligned with
  // `PageTextIndex.items`, captured in the same search walk. It maps a
  // SearchHit to the page-space occurrence `engine.replaceText` consumes.
  const pageGeomRef = useRef(new Map<number, Array<TextItemGeom | undefined>>());
  // Phase 86 — the replace-row state, owned beside the existing search state.
  const [replaceMode, setReplaceMode] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [replaceReport, setReplaceReport] = useState("");

  // Phase 13 â€” Hand (pan) mode. Transient viewer state (never persisted):
  // when armed, the scroller handles pointer drags as grab-and-drag
  // scrolling, annotation tools are inert (see AnnotationToolbar's
  // `handModeOpen` gate), and every other pointer-active overlay is
  // disarmed on the rising edge below.
  const [handActive, setHandActive] = useState(false);
  const panDragRef = useRef<PanDragStart | null>(null);
  const toggleHand = useCallback((): void => {
    setHandActive((v) => !v);
  }, []);
  // DEF-050 â€” invalidation bump. The host (App) calls the imperative
  // search-index invalidator after OCR completes; this tick state is
  // bumped so the search effect re-runs even though `query`, `doc`,
  // and `pageCount` are unchanged. `indexesRef` is reset at the same
  // moment so the rebuild path calls `pdf.js`'s `getTextContent()`
  // fresh on every page â€” which is where OCR-injected text becomes
  // visible to the indexer.
  const [searchInvalidationTick, setSearchInvalidationTick] = useState(0);

  // Keep the latest `onSearchIndexProgress` in a ref so the search effect can
  // call it without making the callback itself a dependency (which would
  // re-fire the effect on every parent re-render that produced a fresh
  // callback identity).
  const onSearchIndexProgressRef = useRef(onSearchIndexProgress);
  onSearchIndexProgressRef.current = onSearchIndexProgress;

  // DEF-050 â€” wire the host's imperative search-index invalidator. The
  // registered callback (a) clears `indexesRef` so the next search
  // walks every page and re-fetches `getTextContent()`, and (b) bumps
  // `searchInvalidationTick` to trigger the search effect's re-run
  // even when `query` / `doc` / `pageCount` are unchanged. The
  // invalidator is a no-op while the search bar isn't open â€” there
  // is no in-flight search to invalidate.
  //
  // Note: we do not include `registerSearchIndexInvalidator` in the
  // effect's dep array because the host passes a fresh function on
  // every render (the App.tsx factory allocates one per tab, but it
  // may re-render before pinning). The ref pattern below keeps the
  // latest value and registers exactly once.
  const registerSearchIndexInvalidatorRef = useRef(registerSearchIndexInvalidator);
  registerSearchIndexInvalidatorRef.current = registerSearchIndexInvalidator;
  // Phase 86 — the single invalidation action: drop the cached page indexes
  // AND their aligned geometry, then bump the tick so the search effect
  // re-runs even when `query` / `doc` / `pageCount` are unchanged. Shared by
  // the host's OCR invalidator and the post-replace refresh below.
  const invalidateSearchIndex = useCallback((): void => {
    indexesRef.current = new Map();
    pageGeomRef.current = new Map();
    setSearchInvalidationTick((prev) => prev + 1);
  }, []);
  const hasRegisteredInvalidatorRef = useRef(false);
  useEffect(() => {
    if (hasRegisteredInvalidatorRef.current) {
      return;
    }
    const register = registerSearchIndexInvalidatorRef.current;
    if (register === undefined) {
      return;
    }
    const invalidate = (): void => {
      // Drop every cached page index so the next search re-fetches
      // getTextContent() from pdf.js. Clearing the map alone is not
      // enough — the search effect's deps (`query`, `doc`,
      // `pageCount`) are unchanged after OCR, so React would not
      // re-run the effect. Bumping `searchInvalidationTick` is the
      // explicit "kick" that forces a rebuild.
      invalidateSearchIndex();
    };
    register(invalidate);
    hasRegisteredInvalidatorRef.current = true;
  }, [invalidateSearchIndex]);

  // ---- Phase C â€” frosted chrome-over-document measurement ----------------
  //
  // The frosted theme floats the workspace chrome rows (toolbar /
  // annotation toolbar / search bar) OVER a full-bleed
  // .document-scroller, so the page visibly scrolls under the
  // translucent frosted sheets. The stack height is not static: the
  // command toolbar wraps when the window is narrow and the search bar
  // adds a row while open.
  // This effect measures the rows' real heights and publishes the sum
  // as `--tf-chrome-y` on .workspace-main for the floating text panel
  // (`top: calc(var(--tf-chrome-y) + 8px)`).
  //
  // Phase 29 â€” the page view is FLUSH: `.document-content` has no
  // top/bottom padding in any theme, so `contentTopPadRef` is the zero
  // CONTENT_PADDING_PX everywhere and the scroll geometry helpers track
  // the flush DOM exactly. `--tf-chrome-y` no longer feeds any content
  // padding; it survives only for the floating panel placement.
  //
  // `contentTopPadRef` stays the single source of the top pad the CSS
  // paints; every scroll-geometry helper reads this ref so a future
  // padding change can never drift from the math.
  const contentTopPadRef = useRef(CONTENT_PADDING_PX);
  // DEF-500 - the chrome stack is DYNAMIC: the search bar grows when the
  // Phase 86 replace row (and its report line) wrap in, and the command
  // toolbar wraps as the window narrows. A window-resize listener alone
  // misses the replace-row growth, so --tf-chrome-y went stale and the
  // .canvas-page-layout control (top: calc(--tf-chrome-y + 12px)) landed on
  // the replace buttons. Observe the measured rows directly so any size
  // change re-publishes the token and the control stays clear of the bar.
  useEffect(() => {
    const CHROME_SELECTOR = ".toolbar, .search-bar";
    const recompute = (): void => {
      const main = mainRef.current;
      if (main === null) return;
      let chromePx = 0;
      for (const el of Array.from(
        main.querySelectorAll<HTMLElement>(CHROME_SELECTOR),
      )) {
        chromePx += el.offsetHeight;
      }
      // Phase 29 â€” flush canvas: the content top pad is 0 in every
      // theme, so the scroll math never adds a chrome offset.
      contentTopPadRef.current = CONTENT_PADDING_PX;
      if (chromePx > 0) {
        const next = `${chromePx}px`;
        if (main.style.getPropertyValue("--tf-chrome-y") !== next) {
          main.style.setProperty("--tf-chrome-y", next);
        }
      }
    };
    recompute();
    const main = mainRef.current;
    let observer: ResizeObserver | null = null;
    if (main !== null && typeof ResizeObserver === "function") {
      observer = new ResizeObserver(recompute);
      for (const el of Array.from(
        main.querySelectorAll<HTMLElement>(CHROME_SELECTOR),
      )) {
        observer.observe(el);
      }
    }
    // The toolbar wraps (grows) when the window narrows; keep the direct
    // resize listener as the path for engines without ResizeObserver.
    window.addEventListener("resize", recompute);
    return (): void => {
      window.removeEventListener("resize", recompute);
      observer?.disconnect();
    };
  }, [editModeOpen, searchOpen, themeName]);

  // ---- effective scale (DEF-338 pane-constrained first fit) ---------------
  //
  // Fit modes anchor to `fitAnchor` (see its declaration) instead of the
  // live `firstPageSize`. This is what keeps a crop from re-scaling every
  // uncropped page: the refresh re-fetches the cropped page-1 dims into
  // `firstPageSize` (so slots / wrappers track reality), but the fit scale
  // stays anchored to the pre-crop reference until the user explicitly
  // re-fits or the first page genuinely changes identity.
  //
  // DEF-338 — the fit is computed through the pure `computeEffectiveScale`
  // helper, and a Multi Mode view whose pane-constrained box is not the one
  // being measured is DEFERRED (`paneFitDeferred`, see its doc): while a
  // freshly opened tab is still unassigned to a pane it is hidden but laid
  // out at the full stage width, so committing a fit there produced the
  // 204% / grey-slab glitch. The viewport effect below is the only writer of
  // `viewportBox`; the pane remeasure layout effect re-reads it before paint
  // the moment a tab is assigned to a pane.
  //
  // DEF-338 (residual) — the pane's FIRST fit is also held until its scroller
  // box has STOPPED MOVING (`paneBoxSettled`). Opening a document into a pane
  // makes the new tab a brief empty placeholder, which collapses the
  // Inspector's inset to 0 and re-opens it; the registered `--tf-tools-inset`
  // transition then shrinks the pane (and this scroller) over ~200ms. A fit
  // measured mid-transition is wider than the settled fit, so the page stepped
  // 88% -> 78% -> 69% -> 68% and painted placeholders wider than the pane.
  // `firstFitCommittedRef` is the one-shot latch: a view that has already
  // painted in this pane (Multi Mode toggled on over a painted document) never
  // re-gates and never blinks.
  const [paneBoxReady, setPaneBoxReady] = useState(false);
  const firstFitCommittedRef = useRef(false);
  // DEF-343 — a document CLEARED from a pane and later re-opened into it is
  // the SAME view instance with Multi Mode still on: its pane assignment went
  // `"B" -> null -> "B"`. The reopen triggers the placeholder's inset collapse
  // and the panel slide, so the previously committed fit is stale and the gate
  // must run again. The opposite case — Multi Mode toggled ON over an
  // already-painted document — is `false -> null`, its geometry is unchanged
  // (both consume the same inset), and it must NOT re-gate (no blink, qa's
  // placeholder-0-frames expectation). Detect the reopen during RENDER and
  // drop the latch plus the held state BEFORE children render, so the stale
  // wide first frame is never committed.
  const prevMultiPaneRef = useRef<PaneId | null>(multiPane);
  const prevMultiModeRef = useRef(multiModeEnabled === true);
  const reopenedPane =
    prevMultiModeRef.current === true &&
    prevMultiPaneRef.current === null &&
    multiPane !== null &&
    multiModeEnabled === true;
  prevMultiModeRef.current = multiModeEnabled === true;
  prevMultiPaneRef.current = multiPane;
  if (reopenedPane && firstFitCommittedRef.current) {
    firstFitCommittedRef.current = false;
    if (paneBoxReady) setPaneBoxReady(false);
  }
  const paneGateActive =
    multiModeEnabled === true && multiPane !== null && !firstFitCommittedRef.current;
  const paneFitPending = paneFitDeferred(
    multiModeEnabled === true,
    multiPane,
    zoom.mode,
    fitAnchor,
    paneGateActive ? paneBoxReady : true,
  );
  const effectiveScale = useMemo(() => {
    if (layoutMode === "one") {
      // The DEF-338 gate's exact call — byte-identical behaviour for the
      // single-page default (the fit has ONE home in `computeEffectiveScale`).
      return computeEffectiveScale(viewportBox, fitAnchor, zoom, CONTENT_PADDING_PX);
    }
    // Phase 40 (item 7) — TWO / FOUR transform the fit box and anchor so the
    // SAME formula measures the laid-out footprint (2 columns, and 2 rows for
    // FOUR) minus the inter-column / inter-row gaps. The exact rule per mode
    // lives in pageLayoutMode.ts.
    return computeEffectiveScale(
      layoutFitViewport(layoutMode, zoom.mode, viewportBox),
      fitAnchor === null ? null : layoutFitAnchor(layoutMode, zoom.mode, fitAnchor),
      zoom,
      CONTENT_PADDING_PX,
    );
  }, [zoom, viewportBox, fitAnchor, layoutMode]);
  const effectiveScaleRef = useRef(effectiveScale);
  effectiveScaleRef.current = effectiveScale;

  // ---- DEF-302 â€” the page-zoom FLIP --------------------------------------
  //
  // The OLD DEF-296 flip scaled the page about its centre inside a slot that
  // had already jumped to the new size, so the page rubber-banded (on a 25%
  // step it started ~198px from where the layout had already put it). The
  // fix is a real FLIP: capture each mounted page's rect BEFORE the zoom
  // (First), let the layout change (Last), then animate the INVERSE
  // `translate(dx, dy) scale(sx, sy)` about the top-left back to identity
  // (Play). DocumentView owns the scroller, so it can also restore the
  // scroll anchor in the same pre-paint pass: without that, a scrolled-down
  // document jumps because every page above the anchor reflows.
  //
  // The whole pass must run AFTER the new layout commits but BEFORE paint,
  // and it must run the anchor correction BEFORE it measures `Last` (so the
  // FLIP is relative to the corrected geometry). PageView cannot do it: its
  // layout effects fire before the parent's, so the scroll would be corrected
  // too late. Hence: capture synchronously in the zoom handlers, apply in one
  // `useLayoutEffect` on `effectiveScale`.
  //
  // DEF-302 (reopened) â€” the FLIP animates the PAPER-OWNING page unit
  // (`ZOOM_FLIP_UNIT_SELECTOR`, i.e. the `.page-slot`), NOT the content-only
  // `.pdf-page`. The slot paints the sheet's paper background (DEF-099) and
  // reflows to its final box instantly; animating only the content left the
  // paper outline teleported to the new size in the first painted frame. The
  // slot contains `.pdf-page` as a child, so one transform moves the paper
  // AND the content together. The slot's layout box coincides with the page
  // wrapper's (same geometry formula), so the invert maths is unchanged.
  const pendingZoomFlipRef = useRef<ZoomFlipPending | null>(null);
  // Phase 43 (item 1) — which motion band the pending FLIP plays on. The zoom
  // handlers capture `zoom`; the page-layout switch captures `layout` so the
  // slots animate over `--motion-duration-layout` instead of the zoom token.
  const pendingFlipKindRef = useRef<FlipKind>("zoom");
  const instantMotion = useInstantMotion();
  const instantMotionRef = useRef(instantMotion);
  instantMotionRef.current = instantMotion;

  /** The paper-owning page unit for a page number: its `.page-slot`. This is
   *  the element the zoom FLIP animates (paper background + content in one). */
  const pageUnitFor = (page: number | null): HTMLElement | null => {
    if (page === null) return null;
    return slotRefsRef.current.get(page) ?? null;
  };

  /** Synchronously record the pre-zoom rects + scroll anchor. Returns false
   *  when nothing is mounted to animate. Called just before the zoom dispatch
   *  so `First` is the OLD layout. Only slots holding a mounted PageView (a
   *  real sheet) are captured; an empty placeholder slot has no content to
   *  track and reflows instantly like native zoom (accepted). */
  const captureZoomFlip = useCallback((): boolean => {
    const scroller = scrollerRef.current;
    if (scroller === null) return false;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const firstRects = new Map<number, ZoomFlipRect>();
    const pages: ZoomFlipPageEl[] = [];
    slotRefsRef.current.forEach((slotEl, page) => {
      if (slotEl.querySelector(".pdf-page") === null) return;
      const r = slotEl.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return;
      firstRects.set(page, { left: r.left, top: r.top, width: r.width, height: r.height });
      pages.push({ page, el: slotEl });
    });
    if (pages.length === 0) return false;
    const anchor = zoomAnchorPage(pages, scrollerTop);
    if (anchor === null) return false;
    pendingZoomFlipRef.current = {
      firstRects,
      anchorPage: anchor.page,
      anchorOffsetBefore: anchor.el.getBoundingClientRect().top - scrollerTop,
    };
    pendingFlipKindRef.current = "zoom";
    return true;
  }, []);

  /** Phase 43 (item 1) — capture the pre-layout-switch rects for the page-
   *  layout FLIP. It is the same First capture as the zoom (paper-owning
   *  `.page-slot` rects + scroll anchor), tagged `layout` so the apply effect
   *  plays the LAYOUT token band. Returns false when nothing is mounted. */
  const captureLayoutFlip = useCallback((): boolean => {
    const ok = captureZoomFlip();
    if (ok) pendingFlipKindRef.current = "layout";
    return ok;
  }, [captureZoomFlip]);

  // Apply the zoom FLIP after the new layout commits. Keyed on
  // `effectiveScale`: manual zoom steps change it; fit-mode recomputes are
  // never captured (see zoomTo / the wheel handler), so a resize drag runs
  // this effect with a null pending and does nothing.
  useLayoutEffect(() => {
    const pending = pendingZoomFlipRef.current;
    if (pending === null) return;
    pendingZoomFlipRef.current = null;
    const kind = pendingFlipKindRef.current;
    pendingFlipKindRef.current = "zoom";
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const pages: ZoomFlipPageEl[] = [];
    pending.firstRects.forEach((_rect, page) => {
      const el = pageUnitFor(page);
      if (el !== null) pages.push({ page, el });
    });
    runZoomFlip(scroller, pages, pending, instantMotionRef.current, kind);
    // `effectiveScale` and `layoutMode` are the two committed signals that the
    // slot geometry moved (zoom step / page-layout switch). A fit recompute
    // without a capture runs this with a null pending and does nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveScale, layoutMode]);


  // ---- per-page slot geometry (DEF-141) ----------------------------------
  //
  // PageView reports each mounted page's own dimensions through
  // `onPageSize`; the scroller lays every slot out at that page's own
  // size (mixed-size document), instead of deriving every slot from
  // page 1's size. Before this split a per-page crop of page 1 shrank
  // `firstPageSize` and EVERY slot collapsed to the crop box (DEF-141);
  // the full pages rendered clipped into crop-sized squares.
  //
  // `pageSizes` stores the un-rotated pt dims as reported by PageView.
  // The MEMO below derives, per visible page:
  //   - the pt dims passed to PageView as its placeholder sizing, and
  //   - the CSS slot dimensions (rotation-aware, matching PageView's
  //     own wrapper-size math) the scroller reserves scroll space with.
  //
  // Fallback for pages whose size has not been reported yet: the LARGEST
  // known size (page 1's live size on first open, then the biggest page
  // reported so far). Too-big placeholder shows a larger paper rectangle
  // briefly (corrected the moment the page mounts and reports its own
  // size) instead of clipping content into a too-small slot â€” the
  // DEF-141 failure mode. Page 1 always uses `firstPageSize` (the live
  // size of the current proxy â€” authoritative on refresh; a stale
  // `pageSizes` entry from before a crop must not win).
  const onPageSize = useCallback((page: number, widthPt: number, heightPt: number): void => {
    setPageSizes((prev) => {
      const cur = prev.get(page);
      if (cur !== undefined && cur.w === widthPt && cur.h === heightPt) {
        return prev;
      }
      const next = new Map(prev);
      next.set(page, { w: widthPt, h: heightPt });
      return next;
    });
  }, []);

  const fallbackSize = useMemo(() => {
    let best = firstPageSize ?? { w: 612, h: 792 };
    for (const s of pageSizes.values()) {
      if (s.w * s.h > best.w * best.h) {
        best = s;
      }
    }
    return best;
  }, [firstPageSize, pageSizes]);

  const pageLayouts = useMemo(() => {
    const geom: MixedPageGeom[] = [];
    const pt: Array<{ w: number; h: number }> = [];
    for (let p = 1; p <= pageCount; p += 1) {
      const own = pageSizes.get(p);
      const wPt = p === 1 && firstPageSize !== null ? firstPageSize.w : own?.w ?? fallbackSize.w;
      const hPt = p === 1 && firstPageSize !== null ? firstPageSize.h : own?.h ?? fallbackSize.h;
      pt.push({ w: wPt, h: hPt });
      // The slot math must match PageView's wrapper dims (DEF-057):
      // at 90/270 the visible width / height swap.
      const rotForLayout = ((engineState.rotations[p - 1] ?? 0) % 4 + 4) % 4;
      const isQuarterTurn = rotForLayout === 1 || rotForLayout === 3;
      geom.push({
        widthCss: (isQuarterTurn ? hPt : wPt) * effectiveScale,
        heightCss: (isQuarterTurn ? wPt : hPt) * effectiveScale,
      });
    }
    return { geom, pt };
  }, [pageSizes, fallbackSize, firstPageSize, engineState.rotations, effectiveScale, pageCount]);
  // Phase 40 (item 7) — the scroller's geometry math runs on ROWS. A
  // 2-column flow groups pages 1..2 into row 1, 3..4 into row 2, and so on;
  // each CSS grid row sizes to its tallest page. With `layoutColumns === 1`
  // every row holds one page and this reduces to `pageLayouts.geom`, so the
  // single-page default's scroll math is byte-identical.
  const rowGeom = useMemo(
    () => buildRowGeom(pageLayouts.geom, layoutColumns),
    [pageLayouts.geom, layoutColumns],
  );
  const rowGeomRef = useRef(rowGeom);
  rowGeomRef.current = rowGeom;
  const rowCountRef = useRef(rowGeom.length);
  rowCountRef.current = rowGeom.length;
  const columnsRef = useRef(layoutColumns);
  columnsRef.current = layoutColumns;

  // ---- first page dims (placeholder sizing for all pages) -------------------
  //
  // `doc.getPage(1)` materializes page 1's per-page state in the worker
  // (commonObjs, page tree cache entry for index 0). We only need its
  // view[] for layout sizing â€” release the proxy immediately so the
  // page-1 state doesn't stay resident before the initial mount's
  // PageView re-fetches it (page 1 is in the INITIAL_MOUNT_PAGES range
  // anyway, so the small re-parse cost is irrelevant) (DEF-016).
  useEffect(() => {
    let disposed = false;
    void doc.getPage(1).then((page) => {
      if (disposed) {
        return;
      }
      const size = {
        w: page.view[2] - page.view[0],
        h: page.view[3] - page.view[1],
      };
      setFirstPageSize(size);
      // Fit-anchor rule: a proxy refresh (crop / OCR / undo) whose new
      // page-1 size is an INSET of the current anchor (same physical
      // page, just smaller â€” a crop) must NOT re-anchor the fit, or
      // every uncropped page re-scales with the refresh. A refresh that
      // is not an inset is a genuine page identity change (delete /
      // reorder / insert / a new file) and legitimately re-fits. First
      // resolution (anchor null) always anchors.
      setFitAnchor((prev) => {
        if (prev === null) {
          return size;
        }
        if (size.w <= prev.w && size.h <= prev.h) {
          return prev;
        }
        return size;
      });
      // Drop page 1's per-page worker state right after we read the
      // dims. The next time page 1 is touched (the initial mount's
      // PageView) pdfjs re-parses from the document stream â€” a few
      // ms cost in exchange for not pinning page 1's state on the
      // critical-path open.
      try {
        page.cleanup();
      } catch {
        // ignore: cleanup can throw if pdf.js already destroyed the page
      }
    });
    return () => {
      disposed = true;
    };
  }, [doc]);

  // ---- viewport size tracking -------------------------------------------------
  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setViewportBox({ w: el.clientWidth, h: el.clientHeight });
      computeGeometryMountRef.current();
    });
    ro.observe(el);
    setViewportBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // DEF-338 — a Multi Mode pane's scroller is only the pane-constrained box
  // once the tab is actually assigned to that pane. The view instance is
  // never remounted by the assignment (MultiPane keeps the tab-pane keyed by
  // tab id), so its `viewportBox` can still hold the un-split stage width.
  // This LAYOUT effect re-reads the scroller the moment the pane assignment
  // changes and flushes the measurement before the browser paints: the first
  // frame the pane becomes visible is already fitted to the pane, never to
  // the stage. Single mode is untouched (`multiPane === null`).
  useLayoutEffect(() => {
    if (multiModeEnabled !== true || multiPane === null) {
      return;
    }
    const el = scrollerRef.current;
    if (el === null) {
      return;
    }
    const next = { w: el.clientWidth, h: el.clientHeight };
    setViewportBox((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
  }, [multiModeEnabled, multiPane]);

  // DEF-338 (residual) — hold a Multi Mode pane's FIRST fit until its scroller
  // box has stopped moving, then commit the settled box (see the `paneFitPending`
  // comment above). rAF sampling rather than a ResizeObserver: the box moves on
  // every frame of the Inspector's `--tf-tools-inset` transition, and the
  // observer only reports that it changed — the gate needs to know it STOPPED.
  // A view that has already painted in this pane never re-gates. An environment
  // with no layout at all (jsdom: every box is 0) releases immediately, so a
  // unit mount is never held.
  //
  // DEF-343 — the gate's stability signature now ALSO carries the measured
  // `--tf-tools-inset` and only settles once it matches `paneInsetTarget`. The
  // old box-only gate could release during the empty-placeholder window (inset
  // still 0, box temporarily static) and only then did the panel slide begin,
  // narrowing the pane by half the inset and painting a ~34% oversized first
  // frame. The gate also stays closed while `pageCount` is 0, so a fit can
  // never be committed for a pane that has not actually loaded its document.
  useEffect((): (() => void) | undefined => {
    if (multiModeEnabled !== true || multiPane === null) return undefined;
    if (firstFitCommittedRef.current) return undefined;
    const el = scrollerRef.current;
    if (el === null || el.clientWidth <= 0 || el.clientHeight <= 0) {
      setPaneBoxReady(true);
      return undefined;
    }
    if (typeof window.requestAnimationFrame !== "function") {
      setPaneBoxReady(true);
      return undefined;
    }
    let prev2: FitBoxSize | null = null;
    let prev1: FitBoxSize | null = null;
    let zeroFrames = 0;
    let raf = 0;
    const tick = (): void => {
      const node = scrollerRef.current;
      if (node === null) return;
      const next: FitBoxSize = { w: node.clientWidth, h: node.clientHeight };
      if (next.w <= 0 || next.h <= 0) {
        zeroFrames += 1;
        if (zeroFrames >= 3) {
          setPaneBoxReady(true);
          return;
        }
        raf = window.requestAnimationFrame(tick);
        return;
      }
      zeroFrames = 0;
      // DEF-343 — read the live Inspector inset off the stage (the element that
      // transitions the registered token) so it is part of the settle window.
      const stageEl = node.closest(".tab-stage");
      const insetRaw =
        stageEl === null
          ? ""
          : window.getComputedStyle(stageEl).getPropertyValue("--tf-tools-inset").trim();
      const insetParsed = Number.parseFloat(insetRaw);
      next.inset = Number.isFinite(insetParsed) ? insetParsed : 0;
      // A pane whose tab is still the empty placeholder (or whose document has
      // not reported a page count yet) is never "settled": the document load is
      // what flips the Inspector target and starts the slide, so the gate must
      // still be sampling when that happens (the effect re-runs on the
      // paneContentReady / pageCount / target change, resetting the window
      // below). Requiring `paneContentReady` specifically closes the commit gap
      // where engine.pageCount is already >0 but the tab's kind — and therefore
      // `data-tools-open` and the requested inset — has not flipped yet.
      if (!paneContentReady || pageCount <= 0) {
        prev2 = null;
        prev1 = null;
        raf = window.requestAnimationFrame(tick);
        return;
      }
      if (paneBoxSettled(prev2, prev1, next, paneInsetTarget)) {
        setViewportBox((cur) => (cur.w === next.w && cur.h === next.h ? cur : next));
        setPaneBoxReady(true);
        return;
      }
      prev2 = prev1;
      prev1 = next;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return (): void => window.cancelAnimationFrame(raf);
  }, [multiModeEnabled, multiPane, pageCount, paneInsetTarget, paneContentReady]);

  // The one-shot latch: once this view has painted content (in single mode or
  // in a settled pane) its pane assignments never re-gate the fit.
  useEffect((): void => {
    if (!paneFitPending && pageCount > 0) firstFitCommittedRef.current = true;
  }, [paneFitPending, pageCount]);

  // True only while a NEVER-painted pane is waiting for its first settled box.
  // A view that has already painted keeps its pills exactly as before.
  const paneFirstFitHeld = paneGateActive && !paneBoxReady;

  // ---- page slot registry + IntersectionObserver ---------------------------
  //
  // Slots are the always-mounted, fixed-height placeholders that reserve
  // scroll space for every page. The IO observes them; pages the IO reports
  // as intersecting are added to a separate "extras" set so the geometry
  // mount can pull them in if they're close enough to the viewport.
  //
  // The geometry-based mount (below) is the SOURCE OF TRUTH for which pages
  // get a real PageView. The IO is treated as a progressive refinement: it
  // can ADD pages to the union when (and only when) the browser actually
  // fires IO callbacks for them. It cannot REMOVE pages â€” the geometry
  // mount owns removal. This is robust against environments where IO
  // callbacks are dropped or never fire (headless harnesses, certain
  // page-zoom configs): in those cases the geometry mount still works, and
  // the IO simply contributes nothing.
  const ioExtraPagesRef = useRef<Set<number>>(new Set());

  const registerSlot = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el === null) {
      const prev = slotRefsRef.current.get(page);
      // unobserve the DOM element we were tracking for this slot, so the
      // IntersectionObserver's internal map doesn't keep a reference to a
      // node React has already removed. Without this, IO instances leak
      // one slot's HTMLElement per scroll-driven remount cycle (DEF-016
      // â€” DOM-counted headroom, but a real retention path for any code
      // that walks up from the IO).
      if (prev !== undefined) {
        observerRef.current?.unobserve(prev);
      }
      slotRefsRef.current.delete(page);
      return;
    }
    slotRefsRef.current.set(page, el);
    observerRef.current?.observe(el);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    // IntersectionObserver is used as a PROGRESSIVE ENHANCEMENT on top of
    // the geometry-based mount: pages the IO reports as intersecting are
    // added to the visible set so fast scrolls don't reveal blank slots
    // before the geometry mount catches up. The geometry mount owns
    // removal, so the IO cannot keep dead pages mounted.
    //
    // We keep the rootMargin tight (800px / 0px) so the IO's effective
    // intersection window stays within ~1 page above and below the
    // viewport at fit-width. Anything outside that window has nothing to
    // contribute over the geometry mount.
    //
    // Critically we DO NOT pre-observe every slot at mount: that would
    // add 520 entries to the IO's internal tracking table up front, which
    // on long.pdf kept a non-trivial amount of native memory resident in
    // the renderer for elements the geometry mount never cared about
    // (DEF-016). Slots are observed lazily inside registerSlot, and
    // unobserved again on unmount via registerSlot's null branch.
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting && !ioExtraPagesRef.current.has(page)) {
            ioExtraPagesRef.current.add(page);
            changed = true;
          }
        }
        if (changed) {
          // IO is touching the visible range â€” push out any pending
          // idle cleanup so it doesn't fire mid-render.
          idleCleanupRef.current?.noteActivity();
          // Re-run the geometry mount so the IO additions become visible
          // through the state â€” the state IS the union of geometry + IO.
          computeGeometryMountRef.current();
        }
      },
      { root: scroller, rootMargin: "800px 0px", threshold: 0 },
    );
    observerRef.current = io;
    // No pre-observe: registerSlot will observe each slot the first time
    // it mounts. The geometry mount will still pick up the visible
    // range synchronously on the first paint (INITIAL_MOUNT_PAGES), so
    // the user never sees a blank workspace while waiting for the IO.
    return () => {
      io.disconnect();
      observerRef.current = null;
    };
  }, []);

  // ---- geometry-based mount: synchronous on open, recomputed on scroll ----
  //
  // The IO-driven mount above is unreliable in some real-world configurations
  // (headless harnesses, certain window/page-zoom combos); the Intersection
  // callbacks can simply never fire for page slots, leaving nothing mounted.
  // To guarantee a working mount regardless of IO behavior, we compute the
  // visible page range from scrollTop + slot geometry in JS (using
  // `mixedVisiblePageRange` from pageGeometry.ts, the per-page-size
  // variant â€” DEF-141). The mounted set is the geometry range, UNION'd
  // with IO extras that are still close enough to the viewport to be
  // useful. Far-out IO extras are pruned so the mounted set stays bounded.
  const computeGeometryMountRef = useRef<() => void>(() => undefined);
  computeGeometryMountRef.current = (): void => {
    const scroller = scrollerRef.current;
    if (firstPageSize === null) {
      return;
    }
    const range = mixedVisiblePageRange(
      scroller?.scrollTop ?? 0,
      scroller?.clientHeight ?? 0,
      // Phase 40 (item 7) — the range is computed in ROWS, then expanded to
      // the pages those rows hold (1..2 pages per row).
      rowGeomRef.current,
      rowCountRef.current,
      PAGE_BUFFER_PAGES,
      // Phase 29 — flush canvas: the content top pad is 0 in every
      // theme (CONTENT_PADDING_PX), and the mount's "fully above the
      // viewport" math subtracts exactly that real padding.
      contentTopPadRef.current,
    );
    const pageRange = rowsToPageRange(
      range.start,
      range.end,
      columnsRef.current,
      pageCount,
    );
    const rangeStart = pageRange.start;
    const rangeEnd = pageRange.end;

    setMountedPages((prev) => {
      // Drop IO extras that have scrolled far from the current viewport so
      // the union can't grow without bound. We keep anything within
      // PRUNE_DISTANCE_PAGES of the geometry range; farther entries are
      // pruned (and their bitmap is dropped via PageView's unmount +
      // shouldRender=false clear). A smaller buffer keeps idle memory
      // lower at the cost of a slightly slower first scroll into a far
      // page â€” the rail re-renders from scratch on demand.
      const PRUNE_DISTANCE_PAGES = 4;
      const keepLow = rangeStart - PRUNE_DISTANCE_PAGES;
      const keepHigh = rangeEnd + PRUNE_DISTANCE_PAGES;
      for (const page of ioExtraPagesRef.current) {
        if (page < keepLow || page > keepHigh) {
          ioExtraPagesRef.current.delete(page);
        }
      }
      let changed = false;
      const next = new Set<number>();
      for (let p = rangeStart; p <= rangeEnd; p += 1) {
        next.add(p);
      }
      // IO extras within range are included.
      for (const page of ioExtraPagesRef.current) {
        if (page >= rangeStart && page <= rangeEnd) {
          next.add(page);
        }
      }
      if (next.size !== prev.size) {
        changed = true;
      } else {
        for (const p of next) {
          if (!prev.has(p)) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : prev;
    });
  };

  // Initial synchronous mount: as soon as the document opens and the first
  // page's dimensions are known, mount the first INITIAL_MOUNT_PAGES slots so
  // the very first paint already shows real bitmaps. No IO round-trip, no
  // async â€” by definition available on the first paint.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    // DEF-098 â€” the mount-sync block must ONLY land a *pending*
    // jump (one whose scrollTo bailed for lack of geometry). The
    // previous shape â€” `jumpTargetRef.current ?? currentPage` â€”
    // re-ran this effect on EVERY `currentPage` change and
    // INSTANT-scrolled the scroller to whatever page the heuristic
    // last computed. Mid-smooth-scroll that dragged `currentPage`
    // to an intermediate page (the DEF-058 lock only holds while
    // scroll events flow), so this effect snapped the scroller back
    // to that intermediate page â€” the "jump starts then snaps
    // back" failure. With the pending-flag gate the effect only
    // ever applies a jump the user clicked but the scroller has not
    // yet landed, and it clears itself afterwards: after a jump
    // completes (or a user scroll runs), `currentPage` changes
    // never touch the scroll position again.
    const pending = jumpTargetRef.current;
    if (pending !== null && pendingJumpLandingRef.current && firstPageSize !== null) {
      const top =
        mixedSlotOffsetTop(
          pageToRow(pending, columnsRef.current),
          rowGeomRef.current,
          contentTopPadRef.current,
        ) -
        contentTopPadRef.current;
      if (Math.abs(scroller.scrollTop - top) > 1) {
        scroller.scrollTo({ top: Math.max(top, 0), behavior: "instant" });
      }
      pendingJumpLandingRef.current = false;
    } else if (
      pending === null &&
      firstPageSize !== null &&
      (!samePageSize(syncGuardRef.current.firstPageSize, firstPageSize) ||
        syncGuardRef.current.pageCount !== pageCount)
    ) {
      // No jump in flight, but the geometry (or page count) just
      // changed â€” e.g. the doc opened and `firstPageSize` finally
      // resolved, or a delete/reorder changed `pageCount`. Keep the
      // scroller on the currently-active page. This runs only on
      // the transition (guarded by the ref), never on `currentPage`
      // changes driven by the heuristic.
      //
      // DEF-232 â€” the comparison is by VALUE, not object identity. A
      // doc-proxy swap (`refreshDocProxyFor`: edit / annotation /
      // crop / OCR bakes re-serialize the engine doc) publishes a NEW
      // `{ w, h }` object for the SAME page size, and an identity
      // compare treated that as a geometry change: every refresh
      // instantly re-scrolled to `currentPage`, which the heuristic
      // can report as the PREVIOUS page while the target page's top
      // is still below the chrome line. The result was a viewport
      // yank (page 2 at scrollTop 1439 jumped to 0 on Confirm) plus
      // a wrong `currentPage`-derived jump. A byte-identical swap
      // must leave the scroll position untouched; a real size change
      // (page-1 crop, re-laid-out page) still re-syncs.
      const top =
        mixedSlotOffsetTop(
          pageToRow(currentPage, columnsRef.current),
          rowGeomRef.current,
          contentTopPadRef.current,
        ) -
        contentTopPadRef.current;
      if (Math.abs(scroller.scrollTop - top) > 1) {
        scroller.scrollTo({ top: Math.max(top, 0), behavior: "instant" });
      }
    }
    syncGuardRef.current = { firstPageSize, pageCount };
    if (!mountSeededRef.current) {
      mountSeededRef.current = true;
      // Phase 40 (item 7) — for a multi-page layout the first viewport holds
      // up to four pages, so seed at least that many real bitmaps.
      const initialEnd = Math.min(
        pageCount,
        Math.max(INITIAL_MOUNT_PAGES, pageLayoutFitPages(layoutMode)),
      );
      setMountedPages((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (let p = 1; p <= initialEnd; p += 1) {
          if (!next.has(p)) {
            next.add(p);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      // Also seed the IO extras with the initial range so the geometry mount
      // doesn't immediately prune what we just added.
      for (let p = 1; p <= initialEnd; p += 1) {
        ioExtraPagesRef.current.add(p);
      }
    }
    // Run a geometry mount so the state converges with the IO extras.
    computeGeometryMountRef.current();
    // Phase 40 (item 7) — `layoutMode` is a dep so a mode switch re-runs the
    // geometry mount against the NEW row geometry (the guard above means the
    // re-run never re-syncs the scroll or re-seeds the initial range).
  }, [firstPageSize, pageCount, currentPage, layoutMode]);

  // ---- scroll -> current page --------------------------------------------------
  //
  // DEF-058 â€” track an in-flight jump target so the scroll-event
  // heuristic (which fires repeatedly during a smooth scroll) cannot
  // drag `currentPage` back to an intermediate page while the scroll
  // animation is still mid-flight. Without the guard, a jump from
  // page 1 to page 10 in a 10-page doc would briefly put
  // `currentPage` on the value the scroller is currently passing
  // through (e.g. 2 or 3 mid-scroll) and the SideRail highlight
  // would visibly flicker / land on the wrong slot. We freeze the
  // jump target in a ref so the scroll handler can compare against
  // it without making the ref a dep of any effect.
  //
  // The target is cleared in three ways:
  //   1. `scrollend` (browsers that fire it) â€” definitive end of
  //      the smooth scroll.
  //   2. The scroll handler notices the scroller is now AT or PAST
  //      the target page's top edge â€” same math as the initial
  //      `jumpToPage` target â€” and clears the lock.
  //   3. A fallback timer (`JUMP_LOCK_FALLBACK_MS`) â€” covers
  //      browsers / harnesses that never fire `scrollend` and
  //      that may interrupt the smooth scroll before reaching the
  //      target.
  const jumpTargetRef = useRef<number | null>(null);
  const jumpLockTimerRef = useRef<number | null>(null);
  // DEF-098 â€” a queued jump whose `scrollTo` bailed because the
  // geometry (`firstPageSize`) wasn't ready yet. Set inside
  // `jumpToPage` when it returns early; the mount-sync effect below
  // lands the scroller on the jump target the moment the geometry
  // arrives, then clears the flag. The flag is what stops the
  // mount-sync effect from INSTANT-killing an in-flight smooth
  // scroll: a click that *did* scroll must never be re-applied.
  const pendingJumpLandingRef = useRef(false);
  // DEF-098 â€” gates the initial-page-restore effect to a single run
  // per DocumentView mount (see the effect for the why).
  const didInitialRestoreRef = useRef(false);
  // DEF-098 â€” last `{firstPageSize, pageCount}` pair the mount-sync
  // effect synced against. The effect's post-open / post-delete
  // "keep the current page in view" re-sync must fire only on those
  // transitions, never on `currentPage` changes (which the
  // scroll-heuristic drives). Without the guard, every heuristic
  // update re-triggered the sync and INSTANT-snapped the scroller.
  const syncGuardRef = useRef<{ firstPageSize: { w: number; h: number } | null; pageCount: number }>({
    firstPageSize: null,
    pageCount: 0,
  });
  // DEF-098 â€” the mount-sync effect's INITIAL_MOUNT_PAGES seeding
  // (pages 1..3 + IO extras) is an open-time one-shot. Previously it
  // re-ran on every `currentPage` change, re-adding the first pages
  // to the mounted set on every page turn â€” the geometry mount then
  // pruned them again, churning PageView mount/unmount cycles (each
  // a pdf.js getPage render) on every jump.
  const mountSeededRef = useRef(false);
  // DEF-058 â€” last scrollTop we successfully validated as "past
  // the jump target". When the user lands on the target we clear
  // the lock; if a subsequent user-driven scroll moves away the
  // heuristic must take over again immediately.
  const JUMP_LOCK_FALLBACK_MS = 1200;

  const computeCurrentPage = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || firstPageSize === null) {
      return;
    }
    const page = rowToFirstPage(
      mixedPageAtScrollTop(
        scroller.scrollTop,
        rowGeomRef.current,
        rowCountRef.current,
        contentTopPadRef.current,
      ),
      columnsRef.current,
    );
    setCurrentPage((prev) => (prev === page ? prev : page));
  }, [firstPageSize, pageCount]);

  const onScroll = useCallback(() => {
    if (scrollRafRef.current !== 0) {
      return;
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      // Touching the document â€” push out any pending idle cleanup so
      // it doesn't fire mid-render. Resets the 5s window from "now".
      idleCleanupRef.current?.noteActivity();
      // DEF-058 â€” while a jump is in flight, suppress the scroll-driven
      // currentPage update UNLESS the scroller has reached the target
      // (in which case we let the heuristic run, then clear the lock).
      const target = jumpTargetRef.current;
      if (target !== null && firstPageSize !== null) {
        const targetTop =
          mixedSlotOffsetTop(
            pageToRow(target, columnsRef.current),
            rowGeomRef.current,
            contentTopPadRef.current,
          ) -
          contentTopPadRef.current;
        const scroller = scrollerRef.current;
        if (scroller !== null && scroller.scrollTop >= targetTop - 1) {
          jumpTargetRef.current = null;
          if (jumpLockTimerRef.current !== null) {
            window.clearTimeout(jumpLockTimerRef.current);
            jumpLockTimerRef.current = null;
          }
          // The heuristic below will recompute from the final
          // scrollTop; fall through to it.
        } else {
          // Still mid-jump. Re-arm the fallback timer in case the
          // smooth scroll never fires `scrollend` (some harnesses).
          if (jumpLockTimerRef.current === null) {
            jumpLockTimerRef.current = window.setTimeout(() => {
              jumpTargetRef.current = null;
              jumpLockTimerRef.current = null;
              // DEF-098 â€” release the lock WITHOUT recomputing
              // `currentPage`. The scroller may still be advancing
              // toward the jump target on a throttled main thread;
              // forcing a recompute from the mid-flight scrollTop
              // here would flick `currentPage` to the page the
              // view is currently passing and let the mount-sync
              // effect snap the scroller back to it. The jump
              // target stays sticky: the next real scroll event
              // (or `scrollend`) resumes the heuristic.
            }, JUMP_LOCK_FALLBACK_MS);
          }
          computeGeometryMountRef.current();
          return;
        }
      }
      computeCurrentPage();
      computeGeometryMountRef.current();
    });
  }, [computeCurrentPage, firstPageSize]);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== 0) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      if (jumpLockTimerRef.current !== null) {
        window.clearTimeout(jumpLockTimerRef.current);
        jumpLockTimerRef.current = null;
      }
    },
    [],
  );

  // `scrollend` is the definitive "smooth scroll finished" event on
  // modern browsers; attach it once and use it to drop the jump
  // lock immediately. If the browser doesn't support `scrollend`
  // (older Chromium, some WebKit), the fallback timer above covers
  // us â€” see the JUMP_LOCK_FALLBACK_MS branch.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const onScrollEnd = (): void => {
      if (jumpTargetRef.current !== null) {
        jumpTargetRef.current = null;
        if (jumpLockTimerRef.current !== null) {
          window.clearTimeout(jumpLockTimerRef.current);
          jumpLockTimerRef.current = null;
        }
        computeCurrentPage();
      }
    };
    scroller.addEventListener("scrollend", onScrollEnd);
    return () => {
      scroller.removeEventListener("scrollend", onScrollEnd);
    };
  }, [computeCurrentPage]);

  // ---- jump ----------------------------------------------------------------------
  const jumpToPage = useCallback(
    (page: number, smooth = true) => {
      const scroller = scrollerRef.current;
      // B6 â€” always update `currentPage` so the SideRail highlight
      // and the toolbar page indicator reflect the new active page
      // even when the scroller geometry isn't ready yet (e.g. the
      // user clicks a thumb before the first page has reported its
      // viewport size, which happens when firstPageSize is still
      // null on the very first render after tab open). The previous
      // implementation returned early in that case, leaving the
      // click visually a no-op (the rail highlight stayed on page
      // 1, the toolbar indicator stayed on page 1). We still defer
      // the actual `scrollTo` call until `firstPageSize` resolves
      // (the geometry-based offset is meaningless without it); a
      // later render after the size arrives will run the scroll via
      // the fallback path below. The optimistic currentPage update
      // is what makes the click feel responsive at first paint.
      setCurrentPage(page);
      jumpTargetRef.current = page;
      if (jumpLockTimerRef.current !== null) {
        window.clearTimeout(jumpLockTimerRef.current);
      }
      jumpLockTimerRef.current = window.setTimeout(() => {
        jumpTargetRef.current = null;
        jumpLockTimerRef.current = null;
        // DEF-098 â€” release-only. No forced recompute from whatever
        // scrollTop the scroller happens to hold now (it may still
        // be gliding toward the target on a busy main thread). The
        // jump target stays sticky; the heuristic resumes on the
        // next real scroll event or `scrollend`.
      }, JUMP_LOCK_FALLBACK_MS);
      if (scroller === null || firstPageSize === null) {
        // Geometry not ready yet â€” currentPage is set, but the
        // scrollTo call has nothing to land on. The
        // `firstPageSize`-dependent effect above will trigger a
        // re-render and the next interaction will scroll normally.
        // DEF-098 â€” flag the queued jump so the mount-sync effect
        // lands the scroller the moment the geometry arrives (and
        // so it does NOT try to re-apply a click that *did* scroll).
        pendingJumpLandingRef.current = true;
        return;
      }
      const target = mixedSlotOffsetTop(
        pageToRow(page, columnsRef.current),
        rowGeomRef.current,
        contentTopPadRef.current,
      );
      // DEF-098 â€” the click's own scroll runs now; make sure the
      // mount-sync effect does not re-apply it as a queued jump
      // (which would INSTANT-kill this smooth scroll). A subsequent
      // bail (geometry missing) re-flags it above.
      pendingJumpLandingRef.current = false;
      scroller.scrollTo({
        top: Math.max(target - contentTopPadRef.current, 0),
        behavior: smooth ? "smooth" : "instant",
      });
      // DEF-058 â€” set the jump target FIRST so the scroll heuristic
      // sees the lock the moment the first scroll event fires (the
      // browser may begin animating before the next microtask).
      // Set the optimistic currentPage too so the SideRail highlight
      // moves to the destination immediately, not after the smooth
      // scroll lands.
      void target;
    },
    // DEF-098 â€” `computeCurrentPage` is no longer called from this
    // body (the fallback timer is release-only), so it is not a dep
    // anymore. `firstPageSize` alone drives the identity: the body
    // closes over it for the scroll target.
    [firstPageSize],
  );

  // ---- initial page restore -------------------------------------------------------
  useEffect(() => {
    // DEF-098 â€” this effect must fire at most ONCE per DocumentView
    // mount. The previous deps (`[jumpToPage, initial.currentPage]`)
    // re-ran it on every App persist round-trip: `jumpToPage`
    // recreated its identity whenever `firstPageSize`/`pageCount`
    // changed, and `initial.currentPage` changed the moment the
    // optimistic page update round-tripped through the host
    // (`onPersist` -> App -> `initial` prop). Each re-run re-armed
    // the 60ms timer and re-issued `jumpToPage`, re-arming the
    // jump lock and fighting the user's actual navigation target.
    if (didInitialRestoreRef.current) {
      return;
    }
    didInitialRestoreRef.current = true;
    const target = initial.currentPage;
    if (target <= 1) {
      return;
    }
    const timer = window.setTimeout(() => jumpToPage(target, false), 60);
    return () => window.clearTimeout(timer);
  }, [jumpToPage, initial.currentPage]);

  // ---- external jump (Phase 32: the shared Multi Mode rail) ------------------
  //
  // The rail lives outside this view, so it cannot call `jumpToPage`
  // directly. A new `seq` is the only trigger: re-renders (a focus move, a
  // sibling section re-rendering) must never replay the last request.
  const lastJumpSeqRef = useRef(0);
  useEffect(() => {
    const request = jumpRequest;
    if (request === null || request === undefined) return;
    if (request.seq === lastJumpSeqRef.current) return;
    lastJumpSeqRef.current = request.seq;
    jumpToPage(request.page, true);
  }, [jumpRequest, jumpToPage]);

  // ---- zoom controls -----------------------------------------------------------------
  const zoomTo = useCallback((direction: 1 | -1) => {
    const current = effectiveScaleRef.current;
    const next = stepTowards(current, direction);
    if (next === current) {
      // Already at the ladder end â€” no layout change, so no capture (a
      // stale pending would otherwise fire on the next unrelated scale).
      return;
    }
    // DEF-302 â€” capture First + the scroll anchor before the layout moves.
    captureZoomFlip();
    dispatchZoom({ type: "set-manual-scale", scale: next });
  }, [captureZoomFlip]);
  const setMode = useCallback(
    (mode: ZoomMode) => {
      if ((mode === "fit-width" || mode === "fit-page") && firstPageSize !== null) {
        // Explicit user fit: re-anchor the fit to the LIVE page-1 size.
        // A prior crop kept the old anchor so the refresh didn't jump;
        // an explicit fit click means "fit now" and must use the current
        // bytes (post-crop), restoring the pre-split semantics for
        // deliberate fit actions.
        setFitAnchor(firstPageSize);
      }
      dispatchZoom({ type: "set-mode", mode });
    },
    [firstPageSize],
  );

  // Phase 40 (item 9) — selecting a page-layout mode establishes that mode's
  // promised fit (fit-page, the only fit that clamps height, so the pages the
  // mode promises are actually FULLY visible). ONE's layout and readout are
  // unchanged; its default on open is still the App's fit-width, and this
  // re-fits only on an explicit mode selection. The manual zoom controls
  // override the established fit afterwards. Selecting the already-active
  // option also re-establishes the fit, so a document opened at fit-width can
  // be fitted to ONE page by clicking the active ONE option.
  const onChangePageLayout = useCallback(
    (mode: PageLayoutMode): void => {
      // Phase 43 (item 1) — capture First (the pre-switch `.page-slot` rects +
      // scroll anchor) before the grid reflows, so the apply effect plays the
      // LAYOUT-token FLIP for every mounted page (transform only; the page
      // pixels are never recoloured or cross-faded).
      captureLayoutFlip();
      setPageLayout(mode);
      setMode(pageLayoutFitMode(mode));
    },
    [captureLayoutFlip, setMode],
  );

  // Phase 40 (item 9) — the honest readout for the current layout. Single
  // column leaves it null (the pill shows the bare page, unchanged); a
  // multi-column grid shows the row's page range so an even-page jump reports
  // the page it landed on, not just the row's first page.
  const pageReadout = useMemo(
    () =>
      layoutColumns > 1
        ? pageReadoutLabel(currentPage, layoutColumns, pageCount)
        : null,
    [layoutColumns, currentPage, pageCount],
  );

  // ---- ctrl+wheel zoom -----------------------------------------------------------------
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      const { remainder, steps } = accumulateWheel(wheelRemainderRef.current, e.deltaY);
      wheelRemainderRef.current = remainder;
      if (steps !== 0) {
        let scale = effectiveScaleRef.current;
        for (let i = 0; i < Math.abs(steps); i += 1) {
          scale = stepTowards(scale, steps > 0 ? 1 : -1);
        }
        if (scale !== effectiveScaleRef.current) {
          // DEF-302 â€” capture First + the scroll anchor before the layout.
          captureZoomFlip();
          dispatchZoom({ type: "set-manual-scale", scale });
        }
      }
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, [captureZoomFlip]);

  // ---- search ---------------------------------------------------------------------------
  //
  // Lazy + incremental: the index is built per-page on first use and cached in
  // `indexesRef`. Subsequent searches reuse cached entries. The build loop
  // yields back to the event loop every SEARCH_CHUNK_PAGES pages so the
  // renderer (scrolling, UI interactions) stays responsive on a 500+ page
  // doc. `searchIndexProgress` reports { built, total } so the diagnostics
  // snapshot in tflexDiagnostics can show what's going on.
  //
  // DEF-050 (OCR + stale cache): OCR writes an invisible Tr=3 text layer
  // to the engine's copy of the doc â€” but the renderer's `doc` proxy is
  // unchanged, so any cached `PageTextIndex` entries built before OCR
  // still reflect pre-OCR content. The host registers an invalidator via
  // `registerSearchIndexInvalidator`; on OCR completion (or any other
  // mutation the host considers "text-content changed") it calls the
  // invalidator, which clears `indexesRef` and bumps
  // `searchInvalidationTick` (a dep of this effect). On the next run
  // we walk every page, call `pdf.js`'s `getTextContent()` afresh, and
  // rebuild the index â€” including any OCR-injected text items, since
  // pdf.js returns TextItem-like objects regardless of rendering mode.
  //
  // DEF-050 (hang after OCR): the original "stuck on Searching..."
  // symptom was caused by `pdf/ocrRasterize.ts` calling `doc.destroy()`
  // per page (terminating pdf.js's worker); subsequent `doc.getPage(...)`
  // calls in this loop rejected and left the UI stuck on "Searching..."
  // because no catch block existed. The fix lives in `ocrRasterize.ts`;
  // this loop is additionally hardened with a try/catch so any future
  // pdf.js failure surfaces as "No results" instead of a permanent
  // spinner.
  useEffect(() => {
    const token = ++searchTokenRef.current;
    const q = query.trim();
    if (q.length === 0) {
      setHits([]);
      setSearching(false);
      setActiveHitIndex(-1);
      setSearchIndexProgress(null);
      onSearchIndexProgressRef.current?.(null);
      return;
    }
    setSearching(true);
    setSearchIndexProgress({ built: 0, total: pageCount });
    onSearchIndexProgressRef.current?.({ built: 0, total: pageCount });
    // Search walks every page, calling doc.getPage() and getTextContent
    // for the un-indexed ones. Treat that as document activity so the
    // idle cleanup doesn't fire mid-index.
    idleCleanupRef.current?.noteActivity();
    let cancelled = false;
    const collected: SearchHit[] = [];
    const run = async (): Promise<void> => {
      let built = 0;
      const total = pageCount;
      try {
        for (let page = 1; page <= pageCount; page += 1) {
          let index = indexesRef.current.get(page);
          if (index === undefined) {
            const pdfPage = await doc.getPage(page);
            const textContent = await pdfPage.getTextContent();
            // pdf.js returns TextItem-like objects regardless of the
            // page's text rendering mode â€” visible text and OCR-injected
            // invisible text (Tr=3) share the same `{ str, transform, ... }`
            // shape. The map below collapses both to the same string
            // representation so `buildPageIndex` doesn't need to know
            // which mode produced each item.
            const items = textContent.items.map((item) =>
              "str" in item && typeof item.str === "string" ? item.str : "",
            );
            index = buildPageIndex(items);
            indexesRef.current.set(page, index);
            // Phase 86 — snapshot the page geometry in the SAME walk, keyed
            // and index-aligned so hitToOccurrence can address it.
            const pageHeightPt = pdfPage.view[3] - pdfPage.view[1];
            pageGeomRef.current.set(
              page,
              textItemsToGeomAligned(textContent.items, pageHeightPt),
            );
            built += 1;
          }
          collected.push(...findPageHits(index, page, q));
          if (cancelled || token !== searchTokenRef.current) {
            return;
          }
          if (page % SEARCH_CHUNK_PAGES === 0) {
            const snapshot = { built, total };
            setSearchIndexProgress(snapshot);
            onSearchIndexProgressRef.current?.(snapshot);
            // Still mid-walk â€” push the idle window out so cleanup doesn't
            // fire while the search loop is iterating pages.
            idleCleanupRef.current?.noteActivity();
            // DEF-303 â€” the window is minimised: park the walk here (it
            // resumes from this page on restore, progress and collected
            // hits intact) instead of rasterising the rest of the document
            // for a window nobody can see. No-op while the window is active.
            await waitForRenderActive();
            await new Promise<void>((r) => setTimeout(r, 0));
            if (cancelled || token !== searchTokenRef.current) {
              return;
            }
          }
        }
      } catch (err) {
        // DEF-050: any pdf.js failure (worker torn down, destroyed
        // doc, transient parse error) must clear "Searching..." so the
        // UI doesn't sit on an indefinite spinner. We surface the
        // collected hits up to the point of failure and report zero
        // progress so the status text shows "No results" rather than
        // claiming the loop is still mid-walk.
        if (!cancelled && token === searchTokenRef.current) {
          setHits(collected);
          setSearching(false);
          setActiveHitIndex(collected.length > 0 ? 0 : -1);
          setSearchIndexProgress({ built, total });
          onSearchIndexProgressRef.current?.({ built, total });
        }
        const message = err instanceof Error ? err.message : String(err);
        // Best-effort diagnostic; the toast surface is owned by the
        // host (`onToast`) and may not be wired for every DocumentView
        // instance. Swallow if absent.
        try {
          onToast?.("error", `Search failed: ${message}`);
        } catch {
          // ignore: onToast may not be provided
        }
        return;
      }
      if (!cancelled && token === searchTokenRef.current) {
        setHits(collected);
        setSearching(false);
        setActiveHitIndex(collected.length > 0 ? 0 : -1);
        const snapshot = { built, total };
        setSearchIndexProgress(snapshot);
        onSearchIndexProgressRef.current?.(snapshot);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [query, doc, pageCount, searchInvalidationTick]);

  // Reset the cached search index when the document changes (different `doc`
  // reference). The `doc` identity changes whenever a new PDF is opened.
  useEffect(() => {
    indexesRef.current = new Map();
    pageGeomRef.current = new Map();
  }, [doc]);

  // ---- idle document cleanup -----------------------------------------------
  //
  // pdf.js keeps per-document worker-side caches alive for the entire
  // lifetime of the `PDFDocumentProxy`:
  //
  //   - font cache (loaded TrueType / OpenType data, cmaps)
  //   - global image cache (decoded JPEG / JPX / JBig2 bitmaps)
  //   - pageDictCache / pageIndexCache / pageKidsCountCache
  //   - standardFontDataCache / builtInCMapCache / systemFontCache
  //
  // On long.pdf these dominate the renderer idle footprint (DEF-016
  // exit target: <=150 MB idle). `doc.cleanup()` flushes them all in
  // one async call, but only when no render is in flight â€” pdf.js
  // refuses cleanup during active renders.
  //
  // The coordinator is rebuilt per `doc` identity: a pending cleanup
  // against an obsolete document is cancelled when the user opens a
  // new tab, and a fresh coordinator is installed for the new
  // document.
  useEffect(() => {
    const coord = createIdleCleanupCoordinator(
      () => {
        // pdf.js cleanup is async. Swallow rejection â€” a failed
        // cleanup is a memory miss, not a correctness issue, and the
        // next idle window will try again.
        return Promise.resolve(doc.cleanup()).catch(() => undefined);
      },
      () => inFlightRendersRef.current > 0,
      { idleMs: DOC_IDLE_CLEANUP_MS },
    );
    idleCleanupRef.current = coord;
    // Reset the in-flight counter on document change so a counter
    // from the previous tab doesn't gate cleanup on the new one.
    inFlightRendersRef.current = 0;
    coord.requestCleanup();
    return () => {
      coord.cancel();
      idleCleanupRef.current = null;
    };
  }, [doc]);

  // ---- Forms / signatures (Phase 4) ----
  // Phase 4: derived per-page groups so each PageView's overlays only see
  // their own fields / placements (avoids re-rendering every page on
  // every fill or move).
  const formFieldsByPage = useMemo(() => {
    const map = new Map<number, FormField[]>();
    for (const f of formFields) {
      const list = map.get(f.page);
      if (list === undefined) {
        map.set(f.page, [f]);
      } else {
        list.push(f);
      }
    }
    return map;
  }, [formFields]);

  const signaturesByPage = useMemo(() => {
    const map = new Map<number, SignaturePlacement[]>();
    for (const p of signatures) {
      const list = map.get(p.page);
      if (list === undefined) {
        map.set(p.page, [p]);
      } else {
        list.push(p);
      }
    }
    return map;
  }, [signatures]);

  // Lookup map: saved signature id -> SavedSignature. The signatures
  // overlay reads from this so the SVG render path can resolve any
  // placement back to its source bytes / points / text.
  const savedSignatureMap = useMemo(() => {
    const map: Record<string, SavedSignature> = {};
    for (const s of savedSignatures) map[s.id] = s;
    return map;
  }, [savedSignatures]);

  const onFormValueChangeStable = useCallback(
    (id: string, value: string | string[]): void => {
      onFormValueChange?.(id, value);
    },
    [onFormValueChange],
  );
  const onFormListboxToggleStable = useCallback(
    (id: string, option: string): void => {
      onFormListboxToggle?.(id, option);
    },
    [onFormListboxToggle],
  );
  const onPlaceSignatureStable = useCallback(
    (signatureId: string, page: number, rect: SignaturePlacement["rect"]): void => {
      onPlaceSignature?.(signatureId, page, rect);
    },
    [onPlaceSignature],
  );
  const onMoveSignatureStable = useCallback(
    (placementId: string, rect: SignaturePlacement["rect"]): void => {
      onMoveSignature?.(placementId, rect);
    },
    [onMoveSignature],
  );
  const onDeleteSignatureStable = useCallback(
    (placementId: string): void => {
      onDeleteSignature?.(placementId);
    },
    [onDeleteSignature],
  );
  // B1 â€” stable wrapper for the host's "exit Sign mode" setter.
  // The pending action bar's Cancel button calls through this.
  const onCancelSignatureArmStable = useCallback((): void => {
    onCancelSignatureArm?.();
  }, [onCancelSignatureArm]);

  // Phase 10 â€” pass the edit state through to PageView with a
  // stable callback so child re-renders are isolated. The host
  // (App) owns the reducer + IPC.
  //
  // Phase 21 â€” the panel's CURRENT values (the selected box's actual
  // formatting, or the pending per-tool defaults when nothing is
  // selected) ride along as `textStyle`. The inline editor no longer
  // owns style controls: it reads this prop for its live preview AND
  // for the creation / run-edit payload, so a panel edit made with no
  // object selected is what the NEXT created box actually uses.
  const editProp = useMemo(() => {
    if (!editModeOpen || edit === null) return null;
    return {
      ...edit,
      textStyle: editTextStyleFromValues(textPanelTextValues),
      // Phase 26 â€” the panel's Text field drives Edit-mode text too: the
      // overlay reports its selected text target up, receives the live
      // session text for its run preview, and commits a run when the
      // session's token flips.
      onTextTargetChange: onEditTextTargetChange,
      textLive:
        textEdit !== null && textEdit.target.kind === "run" ? textEdit.text : null,
      textCommitToken,
      // Phase 37 (item 11) — the edit-flow action bar's Cancel discards the
      // live session instead of committing it.
      onDiscardTextEdit: discardTextSession,
      // Phase 51 item 12 — the on-canvas run editor is the SAME session as
      // the Inspector Text field: a keystroke routes through the host's
      // `handlePanelTextChange`, a blur through `commitTextSession`. No
      // second session/mechanism exists.
      onTextInput: handlePanelTextChange,
      onTextInputCommit: commitTextSession,
      spellCheck,
    };
  }, [
    editModeOpen,
    edit,
    textPanelTextValues,
    onEditTextTargetChange,
    textEdit,
    textCommitToken,
    discardTextSession,
    handlePanelTextChange,
    commitTextSession,
    spellCheck,
  ]);

  // B5 / B14 â€” when Edit mode opens, force the annotation tool
  // back to "select". The toolbar's `editBlocksTool` gate already
  // prevents arming shape / markup tools while Edit is open, but
  // it does NOT reset a tool that was already active when the
  // user opened Edit. Without this effect, the user could leave
  // a rectangle armed, open Edit mode, and the AnnotationOverlay
  // would still respond to shape drags â€” over the Edit overlay
  // (B14). Forcing the reducer to "select" on the rising edge
  // of `editModeOpen` keeps the AnnotationOverlay inert while
  // Edit is open.
  const prevEditModeOpenRef = useRef<boolean>(editModeOpen);
  useEffect(() => {
    if (editModeOpen && !prevEditModeOpenRef.current) {
      dispatchAnnTool({ type: "set-tool", tool: "select" });
    }
    prevEditModeOpenRef.current = editModeOpen;
  }, [editModeOpen]);

  // DEF-257 â€” opening Edit mode (and any later engine registry echo)
  // rehydrates the renderer's text-box mirror from the engine registry.
  // The mirror (`edit.state.textBoxes`) is what every page's EditOverlay
  // draws its `.edit-box` surfaces from; App adopts the engine list on
  // every state echo, but a re-open with no new echo left a committed box
  // in the engine and absent from the mirror â€” so it had no surface and
  // could not be selected or moved.
  //
  // `sameTextBoxes` keeps it idempotent â€” an unchanged registry
  // dispatches nothing, so no duplicate surfaces and no openTabs churn â€”
  // and an ABSENT or EMPTY `textBoxes` list (the engine reports `[]` for
  // a document with no boxes) leaves a renderer-local draft untouched.
  useEffect(() => {
    if (!editModeOpen || edit === null) return;
    const fromEngine = engineState.textBoxes;
    if (fromEngine === undefined || fromEngine.length === 0) return;
    const placements = engineTextBoxesToPlacements(fromEngine, edit.defaultFont);
    if (sameTextBoxes(edit.state.textBoxes, placements)) return;
    edit.onAction({ type: "replace-text-boxes", boxes: placements });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editModeOpen, engineState.textBoxes]);

  const hitsByPage = useMemo(() => {
    const map = new Map<number, SearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.page);
      if (list === undefined) {
        map.set(hit.page, [hit]);
      } else {
        list.push(hit);
      }
    }
    return map;
  }, [hits]);

  const activeHit =
    activeHitIndex >= 0 && activeHitIndex < hits.length ? hits[activeHitIndex] : null;

  const cycleHits = useCallback(
    (direction: 1 | -1) => {
      setActiveHitIndex((prev) => {
        if (hits.length === 0) {
          return -1;
        }
        const current = prev < 0 ? (direction === 1 ? -1 : 0) : prev;
        return direction === 1
          ? nextHitIndex(current, hits.length)
          : prevHitIndex(current, hits.length);
      });
    },
    [hits.length],
  );

  // ---- Phase 86 (FEA-038) — replace flow -----------------------------------
  //
  // The replace row reuses the SAME hits and nav; it only adds a rewrite pass.
  // Occurrences are built from the cached per-page index + aligned geometry
  // (both populated by the search walk above), then sent to the host hook in
  // ONE call for replace-all (one undo entry) or a single-occurrence call for
  // replace-one. On success the cached search text is stale, so the shared
  // invalidation tick forces the hits to rebuild.
  const occurrenceForHit = useCallback(
    (hit: SearchHit): ReplaceOccurrence | null =>
      hitToOccurrence(hit, indexesRef.current.get(hit.page), pageGeomRef.current.get(hit.page)),
    [],
  );

  const runReplace = useCallback(
    async (occurrences: ReplaceOccurrence[]): Promise<void> => {
      if (occurrences.length === 0) {
        setReplaceReport("No matches to replace.");
        return;
      }
      if (onReplaceText === undefined) {
        setReplaceReport("Replace requires the Phase 86 backend update.");
        onToast?.("error", "Replace requires the Phase 86 backend update.");
        return;
      }
      const result = await onReplaceText(buildReplacePayload(occurrences, replacement));
      if (!result.ok) {
        const message = describeEngineError(result.error.code, result.error.message);
        setReplaceReport(message);
        onToast?.("error", message);
        return;
      }
      setReplaceReport(
        formatReplaceReport(
          result.value.replaced,
          result.value.skipped,
          result.value.substitutedFonts,
        ),
      );
      // The engine rewrote the page text; the cached index holds the
      // pre-replace glyphs. Drop it so the next pass re-reads pdf.js.
      invalidateSearchIndex();
    },
    [onReplaceText, onToast, replacement, invalidateSearchIndex],
  );

  const handleReplaceOne = useCallback((): void => {
    const hit = activeHit;
    if (hit === null) {
      setReplaceReport("No active match to replace.");
      return;
    }
    const occ = occurrenceForHit(hit);
    if (occ === null) {
      setReplaceReport("Could not locate the active match's text.");
      return;
    }
    void runReplace([occ]);
  }, [activeHit, occurrenceForHit, runReplace]);

  const handleReplaceAll = useCallback((): void => {
    void runReplace(occurrencesForHits(hits, indexesRef.current, pageGeomRef.current));
  }, [hits, runReplace]);

  const onActiveHitTop = useCallback(
    (page: number, cssTop: number) => {
      const scroller = scrollerRef.current;
      if (scroller === null || firstPageSize === null) {
        return;
      }
      const pageTop = mixedSlotOffsetTop(
        pageToRow(page, columnsRef.current),
        rowGeomRef.current,
        contentTopPadRef.current,
      );
      const target = pageTop + cssTop - scroller.clientHeight / 2;
      scroller.scrollTo({ top: Math.max(target, 0), behavior: "smooth" });
    },
    [firstPageSize],
  );

  // ---- annotations (Phase 3) -----------------------------------------------
  // Hand the toolbar's actions straight through the reducer. The toolbar is
  // disabled when there is no document (always-disabled prop is false here
  // because a tab is mounted only when a document is open).
  /** Phase 28 â€” the toolbar's dropdown colour drives the ARMED tool
   *  only. The selected annotation's colour is owned by the in-canvas
   *  action bar's colour box (it patches THAT annotation live), so this
   *  no longer intercepts `set-color` to patch the selection. */
  const onAnnToolAction = useCallback(
    (a: AnnotationToolAction): void => {
      dispatchAnnTool(a);
    },
    [],
  );

  // When the rail's annotations panel jumps to an annotation, scroll to its
  // page and pulse a flash highlight on the matching overlay. The flash is
  // purely visual â€” it does not move focus or selection.
  const flashAnnotation = useCallback((id: string): void => {
    setFlashId(id);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashId(null);
      flashTimerRef.current = null;
    }, 1700);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  const onAnnJump = useCallback(
    (page: number, id: string): void => {
      jumpToPage(page, true);
      flashAnnotation(id);
    },
    [jumpToPage, flashAnnotation],
  );

  // Group annotations by page so each PageView only sees its own (avoids
  // re-rendering every page on every annotation create/edit).
  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of renderedAnnotations) {
      const list = map.get(a.page);
      if (list === undefined) {
        map.set(a.page, [a]);
      } else {
        list.push(a);
      }
    }
    return map;
  }, [renderedAnnotations]);

  // After a one-shot tool (textbox, note) commits, return to plain select so
  // the next page click doesn't accidentally open another editor.
  const onAnnFinishedOneShot = useCallback((): void => {
    dispatchAnnTool({ type: "set-tool", tool: "select" });
  }, []);

  // Phase 21 regression fix â€” a text-bearing annotation is selected the
  // instant it is placed, in the SAME batched update as the one-shot
  // disarm above. The panel then stays open on the selection branch
  // (`selectedAnnText`) instead of the armed-tool branch. Before this,
  // the disarm dropped the last open branch on placement: the panel
  // closed, reflowed the page 248px, and the user's follow-up click on
  // the annotation they had just placed landed on a moving origin.
  // Only the annotation text kinds take part â€” the panel is theirs;
  // shape / ink / arrow placement is unchanged.
  const onAnnCreate = useCallback(
    (ann: Annotation): void => {
      if (ann.kind === "textbox" || ann.kind === "note" || ann.kind === "callout") {
        setSelectedAnn(ann);
        // Phase 26 â€” a text element is placed EMPTY and its text is typed
        // in the panel's Text field. Remember it so an untouched
        // placement is dropped again when the session ends empty.
        if (ann.text === "") justPlacedTextRef.current = ann.id;
      }
      onCreateAnnotation?.(ann);
    },
    [onCreateAnnotation],
  );

  // ---- Bug 1 / cross-disarm: an external tool surface must disarm the ----
  // annotation creation tool. When Edit-content mode opens, the Sign tool
  // is armed, or the Stamp tool is armed, the page has (or is about to
  // have) a second pointer-active layer; leaving an annotation tool armed
  // meant the next page click could both create an annotation AND place a
  // signature / stamp / edit-box. The annotation tool state lives in this
  // component, so the transition into "some external tool is active" is
  // watched here and resets the tool to plain select. The ref keeps the
  // effect firing only on the rising edge, never on every re-render.
  const anyExternalToolActive =
    editModeOpen || armedSignatureId !== null || armedStamp !== null;
  const prevExternalToolActiveRef = useRef(anyExternalToolActive);
  useEffect(() => {
    const prev = prevExternalToolActiveRef.current;
    if (anyExternalToolActive && !prev) {
      dispatchAnnTool({ type: "set-tool", tool: "select" });
      // Phase 13 â€” hand (pan) mode is a viewer mode and loses to every
      // external tool surface: opening Edit / Sign / Stamp while pan is
      // armed drops pan first, so the two never share the pointer.
      setHandActive(false);
    }
    prevExternalToolActiveRef.current = anyExternalToolActive;
  }, [anyExternalToolActive]);

  // ---- Phase 13: hand (pan) mode disarm cascade --------------------------
  // Hand mode owns the scroller pointer, so on its rising edge every
  // other pointer-active surface is dismissed: armed annotation tools
  // go to select, Edit mode closes, the pending signature placement
  // and the armed stamp ghost drop. The ref keeps this on the rising
  // edge only (arming hand twice is a no-op).
  const prevHandActiveRef = useRef(handActive);
  useEffect(() => {
    const prev = prevHandActiveRef.current;
    if (handActive && !prev) {
      dispatchAnnTool({ type: "set-tool", tool: "select" });
      if (editModeOpen) onEditModeToggle?.();
      if (armedSignatureId !== null) onCancelSignatureArm?.();
      if (armedStamp !== null) onDisarmStamp?.();
    }
    prevHandActiveRef.current = handActive;
  }, [
    handActive,
    editModeOpen,
    armedSignatureId,
    armedStamp,
    onEditModeToggle,
    onCancelSignatureArm,
    onDisarmStamp,
  ]);

  // ---- Phase 13: grab-and-drag panning ------------------------------------
  // While hand mode is armed the scroller owns pointer presses: press
  // anywhere that is NOT interactive chrome (links, buttons, inputs â€”
  // isPanBlockingTarget bails first so their native click still lands),
  // capture the pointer, and invert the drag delta into scrollLeft /
  // scrollTop. preventDefault on the press keeps the text layer from
  // starting a selection mid-drag; it happens only AFTER the bail-out,
  // per the cross-bubbling contract (AGENTS.md).
  const onScrollerPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!handActive || e.button !== 0) return;
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    if (isPanBlockingTarget(e.target)) return;
    e.preventDefault();
    try {
      scroller.setPointerCapture(e.pointerId);
    } catch {
      // jsdom (and some odd drivers) have no pointer capture; panning
      // still works through the plain move/up handlers on the scroller.
    }
    panDragRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    };
    scroller.dataset.handDragging = "true";
  }, [handActive]);

  const onScrollerPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    const start = panDragRef.current;
    const scroller = scrollerRef.current;
    if (start === null || scroller === null) return;
    const next = panScrollPosition(start, e.clientX - start.clientX, e.clientY - start.clientY);
    scroller.scrollLeft = next.left;
    scroller.scrollTop = next.top;
  }, []);

  const onScrollerPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (panDragRef.current === null) return;
    panDragRef.current = null;
    const scroller = scrollerRef.current;
    if (scroller !== null) {
      delete scroller.dataset.handDragging;
      try {
        scroller.releasePointerCapture(e.pointerId);
      } catch {
        // The capture may already be gone (pointer left the window,
        // test harness without a real pointer). Nothing to restore.
      }
    }
  }, []);

  // ---- Phase 32 (chunk 2d): canvas page drag and drop ---------------------
  //
  // The rail path and this path share ONE document-aware drag model (the
  // PageDragContext). Here the drag SOURCE is a hover-revealed grip on the
  // page (`data-page-drag-handle`) - a dedicated affordance that never
  // collides with text selection or the annotation overlays - and the drop
  // TARGET is the whole page slot, with an insertion indicator between
  // pages (`data-drop-indicator`). Present only in Multi Mode: `pageDrag`
  // is null in single mode, so nothing here renders or fires.
  const drag = usePageDragOptional();
  const canvasDragOn = pageDrag !== null && drag !== null;
  const canvasTarget = canvasDragOn ? drag.target : null;
  // The hovered insertion slot in THIS document, or null when the drag is
  // not over this view.
  const canvasTargetHere =
    canvasDragOn && canvasTarget !== null && pageDrag !== null && canvasTarget.tabId === pageDrag.tabId
      ? canvasTarget
      : null;

  const onGripDragStart = (visiblePage: number) => (e: React.DragEvent<HTMLButtonElement>): void => {
    if (drag === null || pageDrag === null) return;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', String(visiblePage));
    drag.begin(buildDragSource(pageDrag.tabId, visiblePage, null));
  };
  const onGripDragEnd = (): void => {
    drag?.end();
  };
  const onCanvasDragOver = (visiblePage: number) => (e: React.DragEvent<HTMLDivElement>): void => {
    if (drag === null || pageDrag === null) return;
    if (drag.source === null) return;
    // The page slot is a drop target for any active drag (a same-document
    // drop resolves to the EXISTING reorder path; a cross-document drop to
    // the atomic engine call). preventDefault here only enables the drop -
    // it never swallows a pointer/click gesture.
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = canvasDropIsAfter(e.clientY, rect.top, rect.height);
    const mode = dropModeFromEvent(e);
    e.dataTransfer.dropEffect = dropEffectFor(mode);
    drag.hover({
      tabId: pageDrag.tabId,
      atIndex: canvasInsertIndex(visiblePage, pageCount, after),
      mode,
    });
  };
  const onCanvasDrop = (visiblePage: number) => (e: React.DragEvent<HTMLDivElement>): void => {
    if (drag === null || pageDrag === null) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = canvasDropIsAfter(e.clientY, rect.top, rect.height);
    const op = resolveDrop(
      drag.source,
      {
        tabId: pageDrag.tabId,
        atIndex: canvasInsertIndex(visiblePage, pageCount, after),
      },
      dropModeFromEvent(e),
      pageCount,
    );
    drag.end();
    if (op !== null) pageDrag.onDrop(op);
  };
  const onCanvasDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    const related = e.relatedTarget as Node | null;
    const scroller = scrollerRef.current;
    if (related !== null && scroller !== null && scroller.contains(related)) return;
    drag.hover(null);
  };

  // ---- keyboard: Ctrl+F opens search, Escape closes / disarms -------------
  //
  // Phase 36 (chunk 7) â€” in Multi Mode this pane's chrome facts are needed
  // before the keyboard handler: `inMultiPane` gates the per-pane floating
  // pills, and `paneOwnsKeys` scopes the document chords to the FOCUSED pane
  // (both panes are mounted and visible, so an ungated window handler would
  // open the search bar in BOTH).
  const inMultiPane = multiPane !== null;
  const paneOwnsKeys = !inMultiPane || paneFocused;

  // Bug 4 â€” Escape disarms ANY armed annotation tool first, then closes
  // search. Previously Escape only closed the search bar, so an armed
  // sticky-note / ink / shape tool stayed hot after the user pressed
  // Escape (the next page click created unexpected content).
  // Phase 13 â€” Escape also exits hand (pan) mode, ahead of the
  // annotation tool check: hand mode is the outermost viewer mode and
  // its toolbar gate makes the annotation buttons inert, so Escape
  // must leave pan first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Phase 36 (chunk 7) â€” in Multi Mode only the FOCUSED pane's view acts on
      // the document chord. Both panes are mounted and visible, so an ungated
      // handler would open the search bar in BOTH panes at once (and the
      // shared annotation fan-out already keeps the disarm coherent).
      if (!paneOwnsKeys) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        if (handActive) {
          e.preventDefault();
          setHandActive(false);
        } else if (annTool.tool !== "select") {
          e.preventDefault();
          dispatchAnnTool({ type: "set-tool", tool: "select" });
        } else if (searchOpen) {
          e.preventDefault();
          setSearchOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, annTool.tool, handActive, paneOwnsKeys]);

  // ---- persistence + diagnostics ------------------------------------------------------------
  useEffect(() => {
    onPersist({
      zoomMode: zoom.mode,
      manualScale: zoom.manualScale,
      currentPage,
      searchOpen,
      query,
      activeHitIndex,
    });
  }, [zoom, currentPage, searchOpen, query, activeHitIndex, onPersist]);

  useEffect(() => {
    onDiagnostics({
      pageCount,
      currentPage,
      zoom: Math.round(effectiveScale * 100) / 100,
      mode: zoom.mode,
      searchQuery: query,
      searchHits: hits.length,
      searchIndexProgress,
      // DEF-093 â€” expose the annotation tool through the diagnostics
      // surface. `"select"` is the renderer's "no tool" sentinel; map
      // it to `null` so e2e harnesses see the same shape every other
      // field uses (value or null, never undefined).
      activeTool: annTool.tool === "select" ? null : annTool.tool,
    });
  }, [
    pageCount,
    currentPage,
    effectiveScale,
    zoom.mode,
    query,
    hits.length,
    searchIndexProgress,
    annTool.tool,
    onDiagnostics,
  ]);

  const pageJump = useCallback(
    (input: string) => {
      const n = Number.parseInt(input, 10);
      if (Number.isFinite(n) && n >= 1 && n <= pageCount) {
        jumpToPage(n);
      }
    },
    [jumpToPage, pageCount],
  );

  const railError = useCallback(
    (msg: string) => {
      onToast?.("error", msg);
    },
    [onToast],
  );

  // Phase 33 â€” the rail slot's content. Multi Mode renders this pane's OWN
  // thumbnail strip, which the workspace places at `railSide` (pane A right,
  // pane B left) so the two strips meet side by side in the middle.
  //
  // Phase 36 (chunk 6) â€” SINGLE mode now renders the STAGES ContextPanel in
  // the rail's place (the concept's left context panel applies to SINGLE mode
  // only; Multi Mode keeps its Phase 32-34 centred pane strips). The panel
  // re-parents the rail's own ThumbnailRail + OutlinePanel, so the thumbnails,
  // drag-reorder, selection and outline are the same code paths; the dev flag
  // that mounted it alongside the rail in chunk 2 is retired.

  // ---- EDIT panel: the current page's modelled content -------------------
  // Built from the EXISTING edit model â€” the panel never reads it itself.
  const editContent = useMemo<ContextPanelEditContent[]>(() => {
    if (edit === null) return [];
    const boxes = edit.state.textBoxes.map((b) => ({
      id: b.id,
      kind: 'text' as const,
      label: b.text.trim() === '' ? 'Text box' : b.text.trim().slice(0, 48),
      page: b.page,
      selected: edit.state.selectedTextBox === b.id,
    }));
    const images = edit.state.placements.map((p) => ({
      id: p.id,
      kind: 'image' as const,
      label: 'Image',
      page: p.page,
      selected: edit.state.selectedImage?.id === p.id,
    }));
    return [...boxes, ...images];
  }, [edit]);

  const selectEditContent = useCallback(
    (id: string, kind: 'text' | 'image'): void => {
      if (edit === null) return;
      if (kind === 'text') edit.onAction({ type: 'select-text-box', textBoxId: id });
      else edit.onAction({ type: 'select-image', image: { id } });
    },
    [edit],
  );

  // ---- Inspector live selection: publish the text-object selection -------
  // The Inspector is mounted by the host, but the text selection + its
  // handlers live HERE (the edit model / text-edit session). The view
  // publishes a snapshot upward so the host can feed the Inspector's
  // EDIT/text section; there is NO second selection model â€” the snapshot IS
  // the existing selection's view.
  //
  // Phase 38 feature C — the Inspector is the ONLY text-manipulation surface
  // now, so the snapshot is published whenever a text surface is engaged:
  // with a selected target, and (with `text: null`) for an armed text tool
  // with nothing selected yet. That second case is what keeps the pre-
  // placement defaults reachable after the floating card was retired.
  const textSelection = useMemo<InspectorTextSelection | null>(() => {
    if (!textPanelSelectionActive) return null;
    return {
      targetKey: textTargetKeyNow ?? 'none',
      name:
        textTarget === null
          ? textPanelMode === 'annotation'
            ? 'Text annotation'
            : 'Text object'
          : textTarget.kind === 'annotation'
            ? 'Text annotation'
            : 'Text object',
      values: textPanelValues,
      defaults: textPanelDefaults,
      mode: textPanelMode,
      text: panelText,
      onPatch: handleTextPanelPatch,
      onTextChange: handlePanelTextChange,
      onTextCommit: commitTextSession,
      focusToken: textFocusToken,
      painterArmed: formatPainter !== null,
      painterHint,
      canPickUpPainter,
      onArmPainter: handleArmPainter,
      onCancelPainter: handleCancelPainter,
      spellCheck,
    };
    // `textPanelValues` is rebuilt each render by design (it merges the live
    // annotation style), so the snapshot identity is not the publish signal â€”
    // the effect below gates on the observable shape instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    textPanelSelectionActive,
    textTargetKeyNow,
    textTarget,
    textPanelMode,
    panelText,
    textPanelDefaults,
    textPanelValues,
    handleTextPanelPatch,
    handlePanelTextChange,
    commitTextSession,
    textFocusToken,
    formatPainter,
    painterHint,
    canPickUpPainter,
    handleArmPainter,
    handleCancelPainter,
    spellCheck,
  ]);

  const onTextSelectionChangeRef = useRef(onTextSelectionChange);
  onTextSelectionChangeRef.current = onTextSelectionChange;
  // The publisher's presence is part of the key: entering / leaving Multi Mode
  // flips the host callback on and off, and the selection must be (re)published
  // on the next change even when its own shape is unchanged.
  const textSelectionKey =
    textSelection === null
      ? ''
      : [
          onTextSelectionChange === undefined ? 'gone' : 'wired',
          textSelection.targetKey,
          textSelection.mode,
          textSelection.focusToken,
          textSelection.text ?? '',
          JSON.stringify(textSelection.values),
          textSelection.painterArmed ? 'armed' : 'idle',
          textSelection.painterHint ?? '',
          (textSelection.spellCheck?.enabled ?? false) ? 'spell-on' : 'spell-off',
          textSelection.spellCheck?.status ?? 'off',
        ].join('\u0000');
  const lastTextSelectionKeyRef = useRef<string | null>(null);
  // DEF-321 â€” a LAYOUT effect: the floating pop-out closes on the same commit
  // that the target appears, so the host's Inspector copy must be mounted in
  // the same paint or the selection would briefly have no properties UI at all.
  // Publishing after paint left exactly that one-frame gap.
  useLayoutEffect((): void => {
    if (lastTextSelectionKeyRef.current === textSelectionKey) return;
    lastTextSelectionKeyRef.current = textSelectionKey;
    onTextSelectionChangeRef.current?.(textSelection);
  });
  useEffect((): (() => void) => {
    return (): void => {
      // Withdraw the selection when this view unmounts (tab switch / close)
      // so the host's Inspector never shows a stale text object.
      onTextSelectionChangeRef.current?.(null);
    };
  }, []);

  // ---- Phase 36 (chunk 3a): the Action Dock + the page selection it reads --
  //
  // The SELECTION SET is owned here because two sibling surfaces consume it:
  // the PAGES ContextPanel writes it (the rail's multi-select gestures) and
  // the ActionDock reads it (State 2's selection override). Both get the same
  // array; nothing else holds it.
  const [pageSelection, setPageSelection] = useState<number[]>([]);

  // A delete (or any page-count change) can strand selected pages: prune to
  // the live range so the dock's `[N pages]` never counts a page that is gone.
  useEffect((): void => {
    setPageSelection((prev) => {
      if (prev.length === 0) return prev;
      const next = prunePageSelection({ pages: prev, anchor: null }, pageCount).pages;
      return next.length === prev.length ? prev : [...next];
    });
  }, [pageCount]);

  const clearPageSelection = useCallback((): void => setPageSelection([]), []);

  // ---- Phase 36 (chunk 3b / chunk 7): the annotations flyout + shared idle --
  //
  // The REVIEW dock's `annotate` primary toggles ONE flyout that hosts the
  // existing AnnotationToolbar. Phase 36 (chunk 7): in Multi Mode the shared
  // dock's Annotate verb routes to the FOCUSED pane's `annotate` command, so
  // exactly one flyout exists; it closes when the stage leaves REVIEW and when
  // this pane stops being the focused one.
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  useEffect((): void => {
    if (activeStage !== 'review') setFlyoutOpen(false);
  }, [activeStage]);
  const paneWasFocusedRef = useRef(paneFocused);
  useEffect((): void => {
    if (inMultiPane && paneWasFocusedRef.current && !paneFocused) setFlyoutOpen(false);
    paneWasFocusedRef.current = paneFocused;
  }, [inMultiPane, paneFocused]);

  // State 4 is shared chrome state: the ActionDock reports its idle flip here
  // so the floating pills fade WITH the dock, never on their own clock.
  const [dockIdle, setDockIdle] = useState(false);

  // State 2's bulk verbs â€” every one reuses an EXISTING multi-page path: the
  // engine's rotate op (one call per selected page), the delete-pages engine
  // op (which already takes a page array), and the host's existing extract
  // dialog entry. Section 3A ruling 9: Merge is NOT a dock verb (the PAGES
  // panel header's `ï¼‹ Combineâ€¦` owns it), so it is absent here.
  const dockBulk = useMemo<DockBulkActions>(
    () => ({
      onRotate: (pages): void => {
        for (const page of pages) onRotate?.({ kind: 'rotate', page, dir: 'cw' });
      },
      onExtract: (pages): void => {
        if (pages.length > 0) onExtractPages?.(pages[0]);
      },
      onDelete: (pages): void => {
        if (pages.length === 0) return;
        onDelete?.([...pages]);
        setPageSelection([]);
      },
    }),
    [onRotate, onExtractPages, onDelete],
  );

  // The dock's availability gate and action routing. This view runs the
  // view-level verbs (rotate, edit tools, annotation tools, pan, clear) and
  // defers the app-level ones (dialogs, OCR, export, sign, forms, ...) to the
  // host. An entry with no handler anywhere is DISABLED (never a silent no-op).
  const viewDockActions = useMemo<Record<string, () => void>>(
    () => ({
      rotateClockwise: (): void => onRotateClockwise?.(),
      rotateCounterClockwise: (): void => onRotateCounterClockwise?.(),
      editModeToggle: (): void => onEditModeToggle?.(),
      editToolOff: (): void => edit?.onAction({ type: 'set-tool', tool: 'off' }),
      editToolText: (): void => edit?.onAction({ type: 'set-tool', tool: 'text' }),
      editToolBox: (): void => edit?.onAction({ type: 'set-tool', tool: 'box' }),
      editToolImage: (): void => edit?.onAction({ type: 'set-tool', tool: 'image' }),
      handToggle: (): void => toggleHand(),
      clearPageSelection,
      annotate: (): void => setFlyoutOpen((v) => !v),
      // The toolbar's DELIVER verbs now run through the dock; this view still
      // owns its existing handlers (the same ones the toolbar's buttons called).
      optimize: (): void => onOptimize?.(),
      auditSpace: (): void => onAuditSpace?.(),
      annotationSelect: (): void => onAnnToolAction({ type: 'set-tool', tool: 'select' }),
      annotationHighlight: (): void => onAnnToolAction({ type: 'set-tool', tool: 'highlight' }),
      annotationUnderline: (): void => onAnnToolAction({ type: 'set-tool', tool: 'underline' }),
      annotationStrikeout: (): void => onAnnToolAction({ type: 'set-tool', tool: 'strikeout' }),
      annotationInk: (): void => onAnnToolAction({ type: 'set-tool', tool: 'ink' }),
      annotationTextbox: (): void => onAnnToolAction({ type: 'set-tool', tool: 'textbox' }),
      annotationRect: (): void => onAnnToolAction({ type: 'set-tool', tool: 'rect' }),
      annotationEllipse: (): void => onAnnToolAction({ type: 'set-tool', tool: 'ellipse' }),
      annotationArrow: (): void => onAnnToolAction({ type: 'set-tool', tool: 'arrow' }),
      annotationCallout: (): void => onAnnToolAction({ type: 'set-tool', tool: 'callout' }),
      annotationNote: (): void => onAnnToolAction({ type: 'set-tool', tool: 'note' }),
    }),
    [
      onRotateClockwise,
      onRotateCounterClockwise,
      onEditModeToggle,
      edit,
      toggleHand,
      clearPageSelection,
      onAnnToolAction,
      onOptimize,
      onAuditSpace,
    ],
  );

  // Phase 36 (chunk 4) â€” the Command Palette's view-command bridge.
  //
  // The palette is mounted once by App (it must work on the welcome screen and
  // must never mount twice in Multi Mode), but the view-level verbs live HERE.
  // Publishing the handlers this view already owns â€” the CanvasPills' zoom /
  // page stepping, the search toggle, the dock's own view verbs â€” keeps ONE
  // implementation of each command: the palette never re-implements zoom.
  const viewCommands = useMemo<Record<string, () => void>>(
    () => ({
      ...viewDockActions,
      zoomIn: (): void => zoomTo(1),
      zoomOut: (): void => zoomTo(-1),
      fitWidth: (): void => setMode('fit-width'),
      fitPage: (): void => setMode('fit-page'),
      find: (): void => setSearchOpen(true),
      // Page stepping composes the view's own `jumpToPage` (the same call the
      // rail thumbnails and the search hits use); the clamp keeps the ends.
      prevPage: (): void => jumpToPage(Math.max(1, currentPage - 1)),
      nextPage: (): void => jumpToPage(Math.min(pageCount, currentPage + 1)),
    }),
    [viewDockActions, zoomTo, setMode, jumpToPage, currentPage, pageCount],
  );

  const registerViewCommandsRef = useRef(registerViewCommands);
  registerViewCommandsRef.current = registerViewCommands;
  useEffect((): (() => void) | undefined => {
    const register = registerViewCommandsRef.current;
    if (register === undefined) return undefined;
    register(viewCommands);
    return (): void => register(null);
  }, [viewCommands]);

  const runDockTool = useCallback(
    (id: string): void => {
      const entry: ToolEntry | undefined = toolById(id);
      if (entry === undefined) return;
      const viewAction = viewDockActions[entry.action];
      if (viewAction !== undefined) {
        viewAction();
        return;
      }
      onDockToolAction?.(id);
    },
    [viewDockActions, onDockToolAction],
  );

  const dockAvailabilityArgs = useMemo(
    () => ({
      pageSelectionCount: pageSelection.length,
      editModeOpen,
      canUndo,
      canRedo,
      viewActions: viewDockActions,
      appEnabled: isDockToolEnabled,
    }),
    [pageSelection.length, editModeOpen, canUndo, canRedo, viewDockActions, isDockToolEnabled],
  );

  /** DEF-327 â€” the dock's live gate for one entry, from the ONE shared decision
   *  (`dockEnabledWithFallback`). Phase 37 (item 20) â€” a PINNED verb the pane
   *  does not specially govern (e.g. Watermark) yields `undefined` from
   *  `dockAvailabilityFor`; the dock then consults the app-level gate it already
   *  holds instead of coercing to "unavailable", or the verb greys out with
   *  "Open a document first" even with a document open. */
  const dockToolEnabled = useCallback(
    (entry: ToolEntry): boolean => dockEnabledWithFallback(entry, dockAvailabilityArgs),
    [dockAvailabilityArgs],
  );

  const dockDisabledReason = useCallback(
    (entry: ToolEntry): string | undefined => {
      if (dockToolEnabled(entry)) return undefined;
      // DEF-311 â€” leave the reason undefined so the dock uses the registry's
      // declared availability copy ("Run Recognize text first") instead of the
      // tool's description. Only the edit layer needs live copy: its gate is
      // Edit mode, not the entry's declared 'document' precondition.
      if (entry.action.startsWith('editTool')) return 'Turn on Edit content first';
      return undefined;
    },
    [dockToolEnabled],
  );

  /** DEF-327 â€” the SAME gate, published to the host so the Command Palette's
   *  rows for the dock's own verbs get the dock's verdict instead of a second
   *  guess. The pane's copy rides along so a disabled palette row shows the
   *  dock's reason ("Turn on Edit content first"), never the registry default. */
  const dockPaletteAvailability = useMemo<DockAvailability>(
    () => ({
      isToolEnabled: (entry): boolean | undefined =>
        dockAvailabilityFor(entry, dockAvailabilityArgs),
      disabledReasonFor: (entry): string | undefined => dockDisabledReason(entry),
    }),
    [dockAvailabilityArgs, dockDisabledReason],
  );

  // DEF-327 â€” publish the availability pair to the host (the same one-shot
  // registration shape as the view commands: `null` withdraws it on unmount, so
  // a closed pane's verdict never lingers in the palette). Re-registered
  // whenever the gate's inputs change, so the host's map always holds the
  // CURRENT verdict.
  const dockPaletteAvailabilityRef = useRef(dockPaletteAvailability);
  dockPaletteAvailabilityRef.current = dockPaletteAvailability;
  const registerDockAvailabilityRef = useRef(registerDockAvailability);
  registerDockAvailabilityRef.current = registerDockAvailability;
  useEffect((): (() => void) | undefined => {
    const register = registerDockAvailabilityRef.current;
    if (register === undefined) return undefined;
    const published = dockPaletteAvailabilityRef.current;
    register(published);
    return (): void => register(null);
  }, [dockPaletteAvailability]);

  const dockPinsSanitized = useMemo(() => sanitizeDockPins(dockPins), [dockPins]);

  // The dock is IDLE-suppressed while a tool is armed (sign / stamp / edit /
  // a hand pan) or a page drag is in flight. `edit` here is the edit-layer
  // model: its tool is 'off' when nothing is armed.
  const dockToolArmed =
    armedSignatureId !== null ||
    armedStamp !== null ||
    editModeOpen ||
    handActive ||
    annTool.tool !== 'select' ||
    (edit !== null && edit.state.tool !== 'off');
  const dockDragInProgress = drag !== null && drag.source !== null;

  const railNode = multiRail === null ? (
    // Phase 36 (chunk 6) â€” SINGLE mode's left slot is the STAGES ContextPanel.
    // It passes through EXACTLY the rail's own props (doc, engine state, the
    // current page, the per-page sizes, the jump/scroll sync, the op handlers,
    // the drag wiring and the organize-dialog entries) plus the stage panels'
    // host wiring. It owns no document state: the page selection, the edit
    // model, the annotations, the signatures and the OCR mirror all live in the
    // host and are threaded through.
    <ContextPanel
      stage={activeStage}
      doc={doc}
      currentPage={currentPage}
      defaultWidthPt={firstPageSize?.w ?? 612}
      defaultHeightPt={firstPageSize?.h ?? 792}
      // DEF-148 â€” the per-VISIBLE-page sizes the mounted PageViews
      // report. ThumbnailRail sizes each thumb wrap from ITS OWN page's
      // aspect ratio (never a single page-1-derived ratio), so a
      // per-page crop of page 1 no longer collapses pages 2..N into
      // the crop square.
      pageSizes={pageSizes}
      engineState={engineState}
      // DEF-139 â€” the thumb bitmap source must follow the same
      // slot -> proxy-page rule as the main view (visible order
      // when the proxy was rebuilt from getDocumentBytes).
      proxyVisibleOrder={proxyVisibleOrder}
      canUndo={canUndo}
      onOp={onRotate}
      onDelete={onDelete}
      onReorder={onReorder}
      onUndo={onUndo}
      onJump={(p): void => jumpToPage(p)}
      outline={outline}
      onError={railError}
      onMerge={onMerge}
      onExtractPages={onExtractPages}
      onInsertBlank={onInsertBlankPage}
      onReplacePages={onReplacePages}
      onDeletePage={onDeletePage}
      onRemoveBlankPages={onRemoveBlankPages}
      // Phase 32's cross-document drag wiring: single mode keeps the rail's
      // intra-document drag semantics (null), exactly as before.
      crossDoc={null}
      // Phase 36 (chunk 3a) â€” the thumbnail multi-select. The set is owned
      // here and consumed by the dock (State 2); the panel only writes it.
      pageSelection={pageSelection}
      onPageSelectionChange={setPageSelection}
      // Phase 16 â€” the collapse affordance, re-homed to the panel header. The
      // host (App) owns the value; the panel renders it and reports toggles.
      collapsed={pagesPanelCollapsed ?? false}
      onToggleCollapsed={onTogglePagesPanelCollapsed}
      // Phase 59 (item 7 follow-up) — the host-owned rail tab reaches the
      // Pages body, so the palette's "Page thumbnails" / "Bookmarks" rows
      // switch the panel and the panel's own outline toggle writes it back.
      railTab={railTab}
      onRailTabChange={onRailTabChange}
      // EDIT â€” the current page's modelled content + the recognition summary.
      editContent={editContent}
      onSelectEditContent={selectEditContent}
      // Phase 41 (item 2) — the retired edit toolbar's Default font control is
      // re-homed to this EDIT panel, so the capability is still settable with a
      // document open in EDIT.
      editDefaultFont={edit?.defaultFont}
      onEditDefaultFontChange={edit?.onDefaultFontChange ?? null}
      ocrStatus={ocrStatus}
      ocrHasRun={ocrHasRun}
      ocrSuspectCount={ocrSuspectCount}
      onRecognizeText={onRecognizeText}
      onOpenOcrSuspects={onOpenOcrSuspects}
      // REVIEW â€” the annotations list (the ONE home for it) plus the
      // saved-signatures section.
      annotations={annotations}
      onJumpToAnnotation={onAnnJump}
      onEditAnnotation={onEditAnnotation}
      onDeleteAnnotation={onDeleteAnnotation}
      bates={bates}
      watermarks={watermarks}
      signatures={signatures}
      onSelectReviewElement={onSelectReviewElement}
      onEditReviewElement={onEditReviewElement}
      onDeleteReviewElement={onDeleteReviewElement}
      reviewErrorFor={reviewErrorFor}
      savedSignatures={savedSignatures}
      armedSignatureId={armedSignatureId}
      onSignSignature={onSignSignature}
      onManageSignatures={onManageSignatures}
      // DELIVER â€” the pre-flight checklist reads the existing state only.
      fileSize={fileSize}
      formFieldCount={formFields.length}
      onOptimize={onOptimize}
      onCreateFromImages={onCreateFromImages}
    />
  ) : (
    <PaneThumbStrip
      pane={multiRail.pane}
      tabId={multiRail.tabId}
      title={multiRail.title}
      documentCount={multiRail.documentCount}
      onFocusPane={multiRail.onFocusPane}
      crossDoc={{ tabId: multiRail.tabId, onDrop: multiRail.onDrop }}
      doc={doc}
      pageCount={pageCount}
      currentPage={currentPage}
      defaultWidthPt={firstPageSize?.w ?? 612}
      defaultHeightPt={firstPageSize?.h ?? 792}
      pageSizes={pageSizes}
      engineState={engineState}
      proxyVisibleOrder={proxyVisibleOrder}
      canUndo={canUndo}
      onOp={onRotate}
      onDelete={onDelete}
      onReorder={onReorder}
      onUndo={onUndo}
      onJump={(p): void => jumpToPage(p)}
      // Phase 37 (chunk 5, item 19) — Multi Mode strips carry the SAME options
      // as the single-mode panel: the right-click menu's dialog entries, the
      // inline hover verbs (built inside the strip from onOp/onDelete + these),
      // and the multi-select set the focused pane's dock already consumes.
      onExtractPages={onExtractPages}
      onInsertBlank={onInsertBlankPage}
      onReplacePages={onReplacePages}
      onDeletePage={onDeletePage}
      pageSelection={pageSelection}
      onPageSelectionChange={setPageSelection}
    />
  );

  // ---- Phase 33 (chunk 4): the shared Multi Mode toolbar wiring ----------
  //
  // Values and commands live in refs so the controller registration is
  // stable (one per pane per mode session) while every read returns the
  // CURRENT state. In single mode `sharedTools` is null: no registration,
  // no effects, no change.
  //
  // Phase 36 (chunk 7) â€” the pane publishes its DOCK CONTEXT (not a toolbar
  // model): the ONE shared Action Dock renders the workspace's verbs from the
  // FOCUSED pane's entry, so the selection, the availability gates and the
  // idle suppression must all come from the pane that owns them.
  const dockContextRef = useRef<PaneDockContext | null>(null);
  dockContextRef.current = {
    pageSelection,
    clearPageSelection,
    bulk: dockBulk,
    isToolEnabled: dockToolEnabled,
    disabledReasonFor: dockDisabledReason,
    toolArmed: dockToolArmed,
    dragInProgress: dockDragInProgress,
  };

  useEffect((): (() => void) | undefined => {
    const shared = sharedTools;
    if (shared === null) return undefined;
    const offPane = shared.controller.registerPane(shared.pane, {
      dock: (): PaneDockContext | null => dockContextRef.current,
    });
    const offSink = shared.controller.registerAnnSink(shared.pane, rawDispatchAnnTool);
    return (): void => {
      offPane();
      offSink();
    };
  }, [sharedTools, rawDispatchAnnTool]);

  // Publish this pane's armed annotation tool so the shared dock can show the
  // FOCUSED pane's state (both panes converge through the fan-out above).
  useEffect((): void => {
    const shared = sharedTools;
    if (shared === null) return;
    shared.controller.publishAnn(shared.pane, annTool);
  }, [sharedTools, annTool]);

  // The shared dock re-reads this pane's context when anything it shows or
  // gates on changes (its selection, its gates, its armed / dragging flags).
  useEffect((): void => {
    const shared = sharedTools;
    if (shared === null) return;
    shared.controller.notifyPane();
  }, [sharedTools, pageSelection, editModeOpen, dockToolArmed, dockDragInProgress]);

  // Multi Mode suppresses this pane's own toolbar rows and its own dock (the
  // stage renders the ONE shared dock instead).
  const suppressToolbar = sharedTools !== null;

  return (
    // Phase 25 â€” `data-text-panel-open` is now a PURE STATE MARKER (the
    // panel's open/close truth for tests and e2e); it no longer drives any
    // layout. The old --tf-text-w grid column and its page reflow are gone:
    // the panel floats inside .workspace-main, so the page never moves.
    <div
      className="workspace"
      data-text-panel-open={textPanelOpen ? "true" : "false"}
      data-rail={showRail ? undefined : "none"}
      // Phase 33 â€” the rail side. The rail node is placed BEFORE the page
      // area on the left (single mode, unchanged) and AFTER it on the right
      // (Multi Mode's pane A), so the DOM order matches the geometry.
      data-rail-side={showRail ? railSide : undefined}
    >
      {showRail && railSide === "left" ? railNode : null}
      <div ref={mainRef} className="workspace-main">
        {/* Phase 36 (chunk 3b) â€” the per-view command toolbar ROW is RETIRED
            in SINGLE mode: every control it hosted is reachable from its new
            home (page nav + zoom/fit -> the floating CanvasPills; pan -> the
            pills' Hand control; find -> Ctrl+F / the palette; rotate, delete,
            merge, split -> the thumbnails' verbs / the PAGES dock / the
            palette; edit content -> the EDIT dock; optimize/audit -> the
            DELIVER dock; sign/forms/flatten/stamp/watermark -> the REVIEW dock;
            annotations -> the REVIEW dock's Annotate flyout; multi-mode -> the
            palette until the title-bar chunk). The reflowing grid rows collapse
            to 0, so the canvas keeps the reclaimed height with no dead space.
            Multi Mode renders ONE shared Action Dock (plus each pane's own
            pills and the one focused-pane flyout) in the stage; this view
            suppresses its rows and its own dock while `suppressToolbar`. */}
        <AnimatePresence>
          {searchOpen && (
            <SearchBar
              query={query}
              onQuery={setQuery}
              resultCount={hits.length}
              activeIndex={activeHitIndex}
              searching={searching}
              onNext={(): void => cycleHits(1)}
              onPrev={(): void => cycleHits(-1)}
              onClose={(): void => setSearchOpen(false)}
              replaceMode={replaceMode}
              replacement={replacement}
              replaceReport={replaceReport}
              onToggleReplace={(): void => setReplaceMode((v) => !v)}
              onReplacement={setReplacement}
              onReplaceOne={handleReplaceOne}
              onReplaceAll={handleReplaceAll}
            />
          )}
        </AnimatePresence>
        <div
          ref={scrollerRef}
          className={handActive ? "document-scroller document-scroller-hand" : "document-scroller"}
          data-hand={handActive ? "true" : "false"}
          data-page-drop-pane={canvasTargetHere !== null ? "true" : undefined}
          onScroll={onScroll}
          onPointerDown={onScrollerPointerDown}
          onPointerMove={onScrollerPointerMove}
          onPointerUp={onScrollerPointerUp}
          onPointerCancel={onScrollerPointerUp}
          onDragLeave={canvasDragOn ? onCanvasDragLeave : undefined}
        >
          <div className="document-content" data-page-layout={layoutMode}>
            {/* DEF-338 — a Multi Mode pane holds its first content render
                until it has a pane-constrained fit (see `paneFitPending`):
                rendering a slot/placeholder before the pane's own scroller
                box is measured paints the full-stage-width slab the operator
                reported. Single mode is never pending. */}
            {!paneFitPending && Array.from({ length: pageCount }, (_, i) => i + 1).map((visiblePage) => {
              // DEF-064 â€” after a delete / reorder the visual scroller
              // used to keep its original `doc.numPages` slots while
              // the rail correctly shrank to `engineState.pageCount`,
              // so the scroller showed phantom slots for the deleted
              // page. `pageCount` is now derived from the engine state
              // (see App.tsx -> DocumentView), so the slot count
              // agrees with the rail. The slot still has to map the
              // visible page (the user-facing index) to the source
              // page the underlying pdf.js document is asked to load:
              // after deleting visible page 3, the new visible
              // position 3 is the original source page 4. Without
              // this translation, every PageView after a delete
              // would render the same source page and the document
              // would appear unchanged. `visibleToSourcePage` is
              // the pure helper that does the translation (tested
              // independently in pageGeometry.test.ts).
              //
              // DEF-139 â€” the translation must respect which proxy
              // family the tab currently holds. `engineState.pageOrder`
              // entries are pdf-lib ORIGINAL page indices; they address
              // the ORIGINAL open bytes (identity file order) but NOT a
              // proxy rebuilt from `getDocumentBytes`, whose file pages
              // are the engine's VISIBLE order. After such a refresh
              // (`proxyVisibleOrder === true`) the slot asks the proxy
              // for `visiblePage` itself; before it (or after a refresh
              // failure) it keeps the pageOrder translation.
              const sourcePage = visibleToSourcePageForProxy(
                visiblePage,
                engineState.pageOrder,
                proxyVisibleOrder,
              );
              // DEF-057 â€” read the engine-applied quarter-turn rotation
              // for this visible page slot and thread it down to the
              // PageView. The engine's `rotations` array is indexed by
              // VISIBLE position (the same order DocumentView's slots
              // enumerate), so we use the visible page number to look
              // it up. The PageView applies the rotation to pdf.js's
              // viewport so the bitmap is rendered at the rotated
              // orientation. Without this, rotate ops updated
              // `engineState.rotations` but the main view kept
              // rendering the un-rotated bitmap (the side rail's
              // thumb CSS class flipped, the main view did not).
              const pageRotation = engineState.rotations[visiblePage - 1] ?? 0;
              const isMounted = mountedPages.has(visiblePage);
              // DEF-141 â€” per-page slot geometry. Each slot reserves
              // space for ITS OWN page (mixed-size document): a crop of
              // page 1 must not shrink pages 2..N. `pageLayouts.geom`
              // holds the rotation-aware CSS dims; `pageLayouts.pt` the
              // un-rotated pt dims PageView uses for its wrapper.
              const slotGeom = pageLayouts.geom[visiblePage - 1];
              const pagePt = pageLayouts.pt[visiblePage - 1];
              return (
                <div
                  key={visiblePage}
                  ref={(el) => registerSlot(visiblePage, el)}
                  className="page-slot"
                  data-page={visiblePage}
                  data-source-page={sourcePage}
                  onDragOver={canvasDragOn ? onCanvasDragOver(visiblePage) : undefined}
                  onDrop={canvasDragOn ? onCanvasDrop(visiblePage) : undefined}
                  // DEF-302 â€” the slot IS the page unit the zoom FLIP animates
                  // (paper background + content in one frame); clear the
                  // one-shot class/vars when its own animation lands. Guard
                  // with `isZoomFlipEnd` so a nested overlay's animationend
                  // (which bubbles here) cannot clear the FLIP early.
                  onAnimationEnd={(e) => {
                    if (isZoomFlipEnd(e, e.currentTarget)) clearZoomFlip(e.currentTarget);
                  }}
                  style={{
                    height:
                      slotGeom !== undefined && slotGeom.heightCss > 0
                        ? `${slotGeom.heightCss}px`
                        : 0,
                    width:
                      slotGeom !== undefined && slotGeom.widthCss > 0
                        ? `${slotGeom.widthCss}px`
                        : undefined,
                  }}
                >
                  {isMounted && (
                    <PageView
                      doc={doc}
                      // DEF-133 â€” thread BOTH page spaces into
                      // PageView. `page` is the VISIBLE index every
                      // overlay uses when it creates content
                      // (annotations / forms / signatures / stamps /
                      // text boxes all carry `page` in their
                      // engine payloads, and the engine interprets
                      // it against the CURRENT pageOrder). `sourcePage`
                      // is the index into the pdf.js proxy, which
                      // stays in SOURCE order after a delete /
                      // reorder / insert â€” only PageView's
                      // `doc.getPage(sourcePage)` render uses it.
                      page={visiblePage}
                      sourcePage={sourcePage}
                      widthPt={pagePt?.w ?? 612}
                      heightPt={pagePt?.h ?? 792}
                      cssScale={effectiveScale}
                      rotation={pageRotation}
                      shouldRender={true}
                      hits={hitsByPage.get(visiblePage) ?? EMPTY_HITS}
                      activeHit={activeHit?.page === visiblePage ? activeHit : null}
                      registerPage={NOOP_REGISTER}
                      onPageSize={onPageSize}
                      onActiveHitTop={onActiveHitTop}
                      annotations={annotationsByPage.get(visiblePage) ?? EMPTY_ANNOTATIONS}
                      annotationTool={annTool}
                      flashId={flashId}
                      liveAnnTextIds={liveAnnTextIds}
                      onCreateAnnotation={onAnnCreate}
                      onFinishedOneShot={onAnnFinishedOneShot}
                      // DEF-096 â€” committed note icons open their
                      // editor; Confirm/Delete route through these
                      // (same AnnotationPatch path as the panel).
                      onEditAnnotation={onEditAnnotation}
                      onDeleteAnnotation={onDeleteAnnotation}
                      // Phase 21 (annotations) â€” report the overlay's
                      // committed-annotation selection upward so the
                      // text-properties panel can reflect a selected
                      // annotation text object's actual colour.
                      onSelectAnnotation={onSelectAnnotation}
                      // Phase 26 â€” placing or clicking a text element
                      // focuses the panel's Text field (the single live
                      // text-editing surface; no in-canvas editor).
                      onTextFocusRequest={onAnnTextFocusRequest}
                      // Phase 28 â€” the selection bar's colour box reuses
                      // the toolbar's picker, so it needs the same
                      // preset bucket + saved custom presets.
                      annotationPaletteTheme={themeName === 'light' ? 'light' : 'dark'}
                      annotationPalette={
                        annotationPalette === undefined || annotationPalette === null
                          ? undefined
                          : {
                              light: annotationPalette.light ?? [],
                              dark: annotationPalette.dark ?? [],
                            }
                      }
                      onAnnotationPaletteChange={
                        onAnnotationPaletteChange === undefined
                          ? undefined
                          : (next): void => onAnnotationPaletteChange(next)
                      }
                      // Phase 28 â€” comment threads + the append op. The
                      // threads ride on the engine state mirror; the
                      // overlay draws one badge per commented element and
                      // the comment box for the selected annotation.
                      comments={engineState.comments}
                      onAddComment={onAddComment}
                      // Bug 1 â€” opening an edit toolbox disarms the
                      // annotation creation tool (select). Without
                      // this, an armed sticky-note / ink / shape
                      // tool stays hot while the toolbox is open,
                      // and the next page click both creates AND
                      // edits.
                      onDisarmAnnTool={onAnnFinishedOneShot}
                      onRenderStart={onPageRenderStart}
                      onRenderEnd={onPageRenderEnd}
                      formFields={formFieldsByPage.get(visiblePage) ?? EMPTY_FIELDS}
                      onFormValueChange={onFormValueChangeStable}
                      onFormListboxToggle={onFormListboxToggleStable}
                      signatures={signaturesByPage.get(visiblePage) ?? EMPTY_PLACEMENTS}
                      savedSignatures={savedSignatureMap}
                      armedSignatureId={armedSignatureId}
                      onPlaceSignature={onPlaceSignatureStable}
                      onMoveSignature={onMoveSignatureStable}
                      onDeleteSignature={onDeleteSignatureStable}
                      // B1 â€” exit Sign mode. Wired to the pending
                      // action bar's Cancel button (and to the
                      // overlay's Esc handler for a pending
                      // placement). Delete drops only the
                      // pending placement; Confirm commits and
                      // leaves the Sign tool armed for the next
                      // page click.
                      onCancelSignatureArm={onCancelSignatureArmStable}
                      // B10 â€” armed stamp ghost + click-to-embed.
                      // The stamp ghost follows the cursor on
                      // every page; clicking embeds the stamp at
                      // the click point.
                      armedStamp={armedStamp}
                      onPlaceStamp={onPlaceStamp}
                      redactArmed={redactArmed}
                      onApplyRedactions={onApplyRedactions}
                      markColor={markColor}
                      onMarkColorChange={onMarkColorChange}
                      stampAnnotations={stampAnnotations.filter(
                        (s) => s.page === visiblePage,
                      )}
                      // Bug 6 â€” stamp select/move/delete/retype
                      // handlers (the same page-level callbacks the
                      // user-facing stamp surfaces use).
                      onMoveStamp={onMoveStamp}
                      onDeleteStamp={onDeleteStamp}
                      onRetypeStamp={onRetypeStamp}
                      editModeOpen={editModeOpen}
                      edit={editProp}
                    />
                  )}
                  {canvasDragOn && isMounted && (
                    <button
                      type="button"
                      className="page-drag-handle"
                      data-page-drag-handle={visiblePage}
                      draggable
                      onDragStart={onGripDragStart(visiblePage)}
                      onDragEnd={onGripDragEnd}
                      aria-label={`Drag page ${visiblePage} to another document`}
                      title="Drag this page to another document (Ctrl to copy)"
                    >
                      <Icon icon={GripVertical} size="xs" />
                    </button>
                  )}
                  {canvasTargetHere !== null && canvasTargetHere.atIndex === visiblePage && (
                    <div
                      // DEF-290 â€” the first slot's line anchors flush inside
                      // the slot's top edge (mirrors the rail's first-slot
                      // handling) instead of the between-pages -9px offset,
                      // which fell above the scroller's visible top and was
                      // clipped.
                      className={
                        visiblePage === 1
                          ? "page-drop-indicator page-drop-indicator-before page-drop-indicator-first"
                          : "page-drop-indicator page-drop-indicator-before"
                      }
                      data-drop-indicator="before"
                      data-drop-page={visiblePage}
                      data-drop-copy={canvasTargetHere.mode === "copy" ? "true" : undefined}
                    >
                      {canvasTargetHere.mode === "copy" && (
                        <span className="page-drop-copy-hint">Copy</span>
                      )}
                    </div>
                  )}
                  {canvasTargetHere !== null &&
                    (canvasTargetHere.atIndex === visiblePage + 1 ||
                      (canvasTargetHere.atIndex === -1 && visiblePage === pageCount)) && (
                      <div
                        className="page-drop-indicator page-drop-indicator-after"
                        data-drop-indicator="after"
                        data-drop-page={visiblePage}
                        data-drop-copy={canvasTargetHere.mode === "copy" ? "true" : undefined}
                      >
                        {canvasTargetHere.mode === "copy" && (
                          <span className="page-drop-copy-hint">Copy</span>
                        )}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Phase 36 (chunk 5) â€” the floating All Tools badge is RETIRED. The
            Inspector is the workspace's right panel and needs no toggle, so
            no view renders a badge any more (DEF-284's single-badge rule is
            moot: there is no badge to duplicate). */}
        {/* Phase 38 feature C — the legacy floating text-properties card and
            its drag-to-move grip are RETIRED. The Inspector's text block is
            the ONLY text-manipulation surface; this view publishes the text
            snapshot upward (including the armed-tool defaults) and renders no
            properties UI of its own. */}
        {/* DEF-319 â€” the CANVAS-BOUND floating-chrome layer. The page/zoom
            pills, the annotations flyout and the Action Dock all live inside
            it, so they anchor to the VISIBLE canvas: the layer is inset on the
            right by the open Inspector's width (--tf-tools-inset), which is
            what keeps every pill control and dock verb hit-testable while the
            Inspector is open. With the Inspector closed the token is 0px and
            the layer is exactly .workspace-main, so the surfaces are
            pixel-identical to before. The layer is pointer-inert; the pills,
            the flyout and the dock opt back in. */}
        <div className="canvas-overlay" data-canvas-overlay>
        {/* Phase 78 (feature B) — the canvas TOP-RIGHT control cluster, the
            single anchor for the open-triggered notice "i" row, the Book View
            entry and the page-layout control. Phase 66 put Book View at the
            overlay's TOP-LEFT; Phase 78 moves it immediately LEFT of the
            page-layout control and parks the notice family immediately LEFT of
            Book View with a tight ~8px gap. The cluster is pointer-inert; each
            control opts back in (the buttons below and the notice icons in
            styles.css). It renders only when there is a control to show. */}
        <div className="canvas-top-right">
        {canvasNotices !== undefined && (
          <div className="canvas-notices">{canvasNotices}</div>
        )}
        {/* Phase 66 (chunk 1) — the Book View entry. It renders only when the
            host wires the verb and never in a Multi Mode pane; activating it
            makes the host swap this whole view for the read-only BookView, so
            it disappears along with the dock. Phase 78 moves it to the canvas
            top-right (immediately left of the page-layout control). */}
        {onOpenBookView !== undefined && !inMultiPane && (
          <button
            type="button"
            className="canvas-book-view"
            data-book-view-open
            aria-label="Book View"
            onClick={onOpenBookView}
          >
            <Icon icon={BookOpen} size="xs" />
            Book View
          </button>
        )}
        {/* Phase 40 (item 7) — the SINGLE-VIEW page-layout control. It sits at
            the canvas's top-right (inside the canvas-bound overlay, so the open
            Inspector's inset already keeps it off the panel) and never renders
            in a Multi Mode pane — the requirement is single-view only, and
            Multi Mode's layout is untouched. The pills live at the bottom and
            the dock is Multi Mode only, so the three surfaces cannot overlap.
            Phase 78 anchors it as the rightmost control of the top-right
            cluster. */}
        {!inMultiPane && (
          <PageLayoutControl value={pageLayout} onChange={onChangePageLayout} />
        )}
        </div>
        {/* Phase 36 (chunk 3b / chunk 7) â€” the floating page + zoom pills.
            SINGLE mode keeps their unchanged placement (page bottom-left, zoom
            bottom-right of the canvas). In MULTI MODE each pane carries its OWN
            pills inside its OWN canvas bounds, so page / zoom / pan act on the
            pane that owns them: they stack at the pane's OUTER edge (A left,
            B right) so the workspace's bottom-centre band stays clear for the
            ONE shared Action Dock. They re-parent the retired toolbar's
            handlers and aria-labels and fade with the dock's idle. */}
        {(inMultiPane || (!suppressToolbar && multiModeEnabled !== true)) &&
          !paneFirstFitHeld && (
          <CanvasPills
            page={currentPage}
            pageCount={pageCount}
            pageLabel={resolvePageLabel(currentPage, engineState.pageLabels)}
            pageReadout={pageReadout}
            zoomPercent={Math.round(effectiveScale * 100)}
            zoomMode={zoom.mode}
            onJump={pageJump}
            onZoomIn={(): void => zoomTo(1)}
            onZoomOut={(): void => zoomTo(-1)}
            onFitWidth={(): void => setMode('fit-width')}
            onFitPage={(): void => setMode('fit-page')}
            handActive={handActive}
            onHandToggle={toggleHand}
            idle={inMultiPane ? chromeIdle : dockIdle}
            pane={multiPane}
          />
        )}
        {/* Phase 36 (chunk 3b) â€” the ONE annotations flyout. The REVIEW dock's
            Annotate primary toggles it; it hosts the EXISTING AnnotationToolbar
            (re-parented), so the registry's annotation entries have exactly one
            home and the dock never renders a duplicate set.
            Phase 36 (chunk 7) â€” in Multi Mode it is ONE surface driven by the
            FOCUSED pane: only the focused pane's view mounts it (the dock's
            Annotate verb routes to the focused pane's `annotate` command), and
            a pane that loses focus closes it, so a focus switch can never leave
            two flyouts (or a stale one) on screen. */}
        {activeStage === 'review' &&
          (!suppressToolbar || (inMultiPane && paneFocused)) && (
          <AnnotationFlyout
            open={flyoutOpen}
            onClose={(): void => setFlyoutOpen(false)}
            ladder={dockLadder}
          >
            <AnnotationToolbar
              state={annTool}
              onAction={onAnnToolAction}
              editModeOpen={editModeOpen}
              handModeOpen={handActive}
              palette={
                annotationPalette === undefined || annotationPalette === null
                  ? undefined
                  : {
                      light: annotationPalette.light ?? [],
                      dark: annotationPalette.dark ?? [],
                    }
              }
              onPaletteChange={
                onAnnotationPaletteChange === undefined
                  ? undefined
                  : (next): void => onAnnotationPaletteChange(next)
              }
              /* Phase-15 â€” frosted is a dark acrylic variant, so the
                 annotation palette treats it as the 'dark' preset bucket
                 (the shared AnnotationColors contract has no frosted key). */
              theme={themeName === 'light' ? 'light' : 'dark'}
              annotationRecentTools={annotationRecentTools}
              onAnnotationRecentToolsChange={onAnnotationRecentToolsChange}
            />
          </AnnotationFlyout>
        )}
        {/* Phase 36 (chunk 3a / chunk 7) â€” the Action Dock. Mounted as an
            ADDITION at the bottom-centre of the canvas (the `.canvas-overlay`
            layer is the positioning context, DEF-319) so nothing else moves:
            the rail, the palette and the flyout all stay. It renders only when
            the host supplies a stage (every pre-chunk-3a mount omits it) and is
            suppressed in Multi Mode, where the ONE shared dock
            (`MultiActionDock`) floats at the workspace's bottom-centre instead â€”
            a per-pane dock would be a second surface. */}
        {activeStage !== undefined && !suppressToolbar && (
          <ActionDock
            activeStage={activeStage}
            pageSelection={pageSelection}
            onClearPageSelection={clearPageSelection}
            bulk={dockBulk}
            dockPins={dockPinsSanitized}
            dockUnpinned={dockUnpinned}
            ladder={dockLadder}
            onPinTool={(id): void => onDockPin?.(id)}
            onUnpinTool={(id): void => onDockUnpin?.(id)}
            onRunTool={runDockTool}
            isToolEnabled={dockToolEnabled}
            disabledReasonFor={dockDisabledReason}
            toolArmed={dockToolArmed}
            dragInProgress={dockDragInProgress}
            toolUsage={toolUsage}
            // DEF-358 — the dock's active treatment keys off the ACTUAL armed
            // edit-tool verb (text/box/image/off), not the retired `editMode`
            // toggle (Phase 37 removed that verb, so `['editMode']` never
            // matched a rendered verb and an armed tool looked unarmed).
            activeToolIds={
              editModeOpen && edit !== null && edit !== undefined
                ? [editDockVerbFor(edit.state.tool)]
                : []
            }
            onIdleChange={setDockIdle}
          />
        )}
        </div>
      </div>
      {/* Phase 33 â€” the rail's RIGHT-side slot (Multi Mode's pane A): the
          strip sits immediately after the page area, so A's strip and B's
          (on the left of its own page area) meet in the middle. */}
      {showRail && railSide === "right" ? railNode : null}
    </div>
  );
});

// Stable no-op for PageView's `registerPage` prop. With virtualization, slot
// mounting is driven by DocumentView's own IntersectionObserver; PageView no
// longer needs to register itself with the parent.
const NOOP_REGISTER = (): void => undefined;

// Stable empty annotations array â€” passed to PageView when a page has no
// annotations, so the prop's reference doesn't change between renders.
const EMPTY_ANNOTATIONS: Annotation[] = [];

// ---- Phase 26 â€” the panel Text field's target model -----------------------
/** A text target reported up by the Edit overlay (Phase 26 â€” the inline
 *  editor is retired, so Edit-mode text is edited in the panel's Text
 *  field). */
export type EditTextTarget =
  | { kind: "box"; id: string; isNew?: boolean }
  | {
      kind: "run";
      page: number;
      rect: { x: number; y: number; width: number; height: number };
      text: string;
    };

/** Everything the panel's Text field can edit. */
export type TextTarget = EditTextTarget | { kind: "annotation"; id: string };

/** Stable identity for a text target — used to tell "same target, next
 *  keystroke" (same session) from "new target" (commit the old session). */
export function textTargetKey(t: TextTarget | null): string | null {
  if (t === null) return null;
  if (t.kind === "run") {
    return `run:${t.page}:${t.rect.x}:${t.rect.y}:${t.rect.width}:${t.rect.height}`;
  }
  return `${t.kind}:${t.id}`;
}

// ---- Phase 80 (F2) — Format Painter target + apply decision ----------------
/** Phase 80 (F2 / DEF-474) — pick the Format Painter's apply target from the
 *  authoritative selection. Under the box tool the engine's selected box wins
 *  over the per-page overlay's last report, so a cross-page selection reads as
 *  a target change and applies in ONE action. A selected annotation wins;
 *  otherwise the reported target (a box or a raw run) is used. */
export function resolvePainterTarget(args: {
  selectedAnnText: boolean;
  selectedAnnotationId: string | null;
  boxToolActive: boolean;
  selectedBoxId: string | null;
  reported: EditTextTarget | null;
}): TextTarget | null {
  if (args.selectedAnnText && args.selectedAnnotationId !== null) {
    return { kind: "annotation", id: args.selectedAnnotationId };
  }
  if (args.boxToolActive && args.selectedBoxId !== null) {
    return { kind: "box", id: args.selectedBoxId };
  }
  return args.reported;
}

/** Phase 80 (F2 / DEF-476) — is the painter's box target a freshly placed
 *  box that exists only in the renderer registry? Derived from the
 *  AUTHORITATIVE reducer mirror (`selectedBoxId` + `selectedBoxIsNew`),
 *  which advances on the same render as the selection. The per-page
 *  overlay's `reported` target is consulted only as a defensive fallback:
 *  it lags the reducer by one commit (its effect runs after commit), so
 *  relying on it alone let a just-placed box slip through as an `apply`
 *  and consume the captured format against a box the engine never had. */
export function painterTargetIsTransientBox(args: {
  target: TextTarget | null;
  selectedBoxId: string | null;
  selectedBoxIsNew: boolean;
  reported: EditTextTarget | null;
  createdWhileArmed?: ReadonlySet<string>;
}): boolean {
  if (args.target === null || args.target.kind !== "box") return false;
  // Phase 80 (F2 / DEF-478) — a box created during this armed session stays
  // transient for the WHOLE session, including after commit clears `isNew`
  // and changes the key.
  if (args.createdWhileArmed?.has(args.target.id)) return true;
  if (
    args.selectedBoxId !== null &&
    args.selectedBoxId === args.target.id &&
    args.selectedBoxIsNew
  ) {
    return true;
  }
  return (
    args.reported !== null &&
    args.reported.kind === "box" &&
    args.reported.id === args.target.id &&
    args.reported.isNew === true
  );
}

/** The fail-loud hint shown while the painter is armed but the selection is
 *  not an applicable target. */
export const FORMAT_PAINTER_HINT =
  "Format Painter armed: select a text box or text annotation to apply.";

/** Phase 80 (F2) — the Format Painter apply decision, extracted so the
 *  DEF-474/475/476 behaviours are unit-testable without mounting the view. */
export type FormatPainterApplyDecision =
  | { kind: "idle" }
  | { kind: "clear-hint" }
  | { kind: "hint"; hint: string }
  | { kind: "apply" };

export function resolveFormatPainterApply(input: {
  armed: boolean;
  targetKey: string | null;
  armedKey: string | null;
  targetKind: "box" | "run" | "annotation" | null;
  targetIsTransient: boolean;
}): FormatPainterApplyDecision {
  if (!input.armed) return { kind: "idle" };
  // Back on (or still on) the arming source: never re-apply to it, but clear
  // any stale hint so a raw-run hint recovers (DEF-475).
  if (input.targetKey !== null && input.targetKey === input.armedKey) {
    return { kind: "clear-hint" };
  }
  if (
    input.targetKind === null ||
    input.targetKind === "run" ||
    input.targetIsTransient
  ) {
    return { kind: "hint", hint: FORMAT_PAINTER_HINT };
  }
  return { kind: "apply" };
}
const EMPTY_FIELDS: FormField[] = [];
const EMPTY_PLACEMENTS: SignaturePlacement[] = [];
