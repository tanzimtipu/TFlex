// Phase 10 — Edit-content tool state.
//
// The Edit mode is orthogonal to the annotation tool palette. When
// active, the user clicks on a text run to edit it inline, drags a
// new text box, or selects an image to move / resize / crop / replace.
// This module owns:
//   * the active edit tool kind (text / box / image) plus the "off"
//     state when the palette is closed
//   * the per-tab pending replacement image (the bytes the user
//     picked from a file dialog and hasn't applied yet)
//   * the per-tab edit selection (which image is currently being
//     moved / resized / cropped)
//
// The model is deliberately tiny and pure so unit tests can exercise
// reducer transitions without mounting React. Components consume the
// state via a small reducer + a few derived selectors.

import type {
  EditFont,
  EditColor,
  TextAlign,
  TextBoxStylePatch,
  TextListStyle,
} from "../../shared/types";

/** Tools available in Edit mode. The values match the wire-side
 *  payload kinds so the renderer can map directly: an `editTextRun`
 *  call carries a `rect` + `newText`, an `addTextBox` call carries a
 *  `rect` + `text`, an `editImage` call carries `oldRect` + `newRect`
 *  + image bytes. */
export type EditTool = "off" | "text" | "box" | "image";

/**
 * DEF-358 — the Edit tool's ACTION DOCK VERB id. After Phase 37 retired the
 * `editMode` dock verb, the dock's active treatment is driven by the verb
 * that IS actually rendered, so the armed state must be expressed as the
 * edit tool's own verb id, not the retired `editMode` toggle:
 *   text -> editText, box -> editTextBox, image -> editImage,
 *   off  -> editToolOff.
 * Pure, so the mapping is unit-testable without a mounted dock.
 */
export function editDockVerbFor(tool: EditTool): string {
  switch (tool) {
    case "text":
      return "editText";
    case "box":
      return "editTextBox";
    case "image":
      return "editImage";
    default:
      return "editToolOff";
  }
}

/** Style applied to a text-edit op. Read from `AppSettings.editDefaultFont`
 *  (preserved in the settings.json round-trip), the dialog can override
 *  it per-op. The inline editor shows the current style so the user
 *  knows what the engine will draw. */
export interface EditTextStyle {
  font: EditFont;
  /** pt. 8..72 covers the practical range; the engine clamps further. */
  size: number;
  color: EditColor;
  // Phase 21 — optional Word/Adobe-class fields. Absent means the
  // documented default (left / 1.2 / not-bold / no highlight / no list /
  // no indent / no baseline shift). Kept optional so every legacy
  // EditTextStyle literal (tests, older tabs, rasterize callers)
  // compiles unchanged; the text-properties panel reads through the
  // `textStyleValuesFromStyle` fallback helper.
  align?: TextAlign;
  lineHeight?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  baselineShift?: number;
  highlight?: EditColor;
  list?: TextListStyle;
  indent?: number;
  /** Phase 27 — character spacing (tracking) in points, emitted as `Tc`.
   *  Absent / 0 is the documented default (no extra tracking). */
  charSpacing?: number;
}

/** Build the default style from a font choice. Size defaults to 12 pt,
 *  color to black. The renderer's preferences sheet exposes a font
 *  picker; the default size / color here match what most editors ship. */
export function defaultEditTextStyle(font: EditFont): EditTextStyle {
  return {
    font,
    size: 12,
    color: { r: 0, g: 0, b: 0 },
  };
}

/** Merge a Phase-21 style patch into a local edit style (renderer mirror
 *  of the engine's preserve-if-valid semantics). Absent fields are kept;
 *  `highlight: null` REMOVES the band, a colour replaces it. */
export function mergeTextBoxStyle(
  style: EditTextStyle,
  patch: TextBoxStylePatch,
): EditTextStyle {
  const next: EditTextStyle = { ...style };
  if (patch.font !== undefined) next.font = patch.font;
  if (patch.size !== undefined) next.size = patch.size;
  if (patch.color !== undefined) next.color = { ...patch.color };
  if (patch.bold !== undefined) next.bold = patch.bold;
  if (patch.italic !== undefined) next.italic = patch.italic;
  if (patch.underline !== undefined) next.underline = patch.underline;
  if (patch.baselineShift !== undefined) next.baselineShift = patch.baselineShift;
  // Phase 21 follow-up — `null` is an explicit REMOVAL: the local style
  // loses its highlight entirely (no white-sentinel band). A colour
  // replaces it; absent preserves it.
  if (patch.highlight === null) {
    delete next.highlight;
  } else if (patch.highlight !== undefined) {
    next.highlight = { ...patch.highlight };
  }
  if (patch.align !== undefined) next.align = patch.align;
  if (patch.lineHeight !== undefined) next.lineHeight = patch.lineHeight;
  if (patch.list !== undefined) next.list = patch.list;
  if (patch.indent !== undefined) next.indent = patch.indent;
  if (patch.charSpacing !== undefined) next.charSpacing = patch.charSpacing;
  return next;
}

/** Per-tab edit state. Lives in App.tsx's `openTabs[tabId]` so it
 *  survives a page scroll / tab focus change but resets when the
 *  user closes the document. The shape mirrors what the wire-side
 *  payloads need (no derived state). */
export interface EditState {
  /** Which tool the user is currently driving. `off` means the Edit
   *  overlay is dormant and pointer events pass through to the page
   *  (text selection, etc.). */
  tool: EditTool;
  /** Currently selected image placement (page + rect in page
   *  points). `null` when no placement is selected — the overlay
   *  then doesn't draw handles. */
  selectedImage: SelectedImage | null;
  /** Currently selected committed text box (B5). `null` when no
   *  box is selected. */
  selectedTextBox: string | null;
  /** Bytes the user picked from a file dialog for an in-flight
   *  "replace" op. The overlay's "Replace" button applies them
   *  through `engine.editImage(op: 'replace', ...)`. `null` when
   *  no replacement is armed. */
  pendingReplace: PendingImage | null;
  /** Per-tab registry of "edited image placements". The engine
   *  doesn't expose per-image rects in Phase 10 (the API only
   *  carries imageBytes for editing), so the renderer keeps a
   *  local list of the placements the user has created or
   *  edited. After every successful `editImage` the placement
   *  is updated here with the new rect + bytes, so the next
   *  edit (move/resize/crop) has the right starting point. */
  placements: ImagePlacement[];
  /** B5 — per-tab registry of committed text boxes (the boxes the
   *  user added via the "Add box" tool). The engine draws the box
   *  into its copy of the PDF but exposes no per-box rect, so the
   *  renderer keeps a local list — exactly like the image
   *  placements — so the committed boxes can be selected and their
   *  rect re-drawn at a new position (the box-tool move). */
  textBoxes: TextBoxPlacement[];
  /** True while the crop-drag is in progress. The overlay draws
   *  a marquee inside the selected placement; on pointerup the
   *  crop is committed through `engine.editImage(op: 'crop')`. */
  cropping: boolean;
  /** DEF-149 — the text-run edits the renderer committed on this
   *  tab (renderer-local; never reaches the wire). `engine.editTextRun`
   *  MASKS the old run (never removes it — DEF-116 documented), so
   *  pdf.js `getTextContent()` returns BOTH the masked old text and
   *  the new text at the same rect. When the user re-clicks an edited
   *  run, the hit-test must prefer the NEWEST committed text over the
   *  first (old) text item, otherwise the editor re-opens pre-filled
   *  with the stale original. Each commit pushes an entry here;
   *  `committedTextRunAt` looks the newest entry up by
   *  (page, click-point). Optional so legacy `EditState` literals
   *  (tests / older tabs) compile unchanged. */
  committedTextRuns?: CommittedTextRun[];
  /** TFL-776.6 (DEF-564) — bumped whenever an engine undo/redo changes the
   *  live/reverted set of text-run commits. The per-page EditOverlay watches
   *  this to dismiss its local run selection (a history change can delete or
   *  restore the selected run, so the stale run bar must not linger). Optional
   *  so legacy `EditState` literals compile unchanged. */
  historyEpoch?: number;
}

/** A renderer-side image placement. Tracks the rect, the page
 *  (1-based visible), the source bytes (so crop can read them
 *  without a network round-trip), and a stable id the overlay
 *  uses as the React key. The id is local to the tab; it never
 *  reaches the wire. */
export interface ImagePlacement {
  id: string;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  /** PNG or JPEG bytes — the most-recently-applied source. Crop
   *  and resize start from this; replace swaps it for the new
   *  file's bytes. */
  bytes: Uint8Array;
  format: "png" | "jpeg";
}

export interface SelectedImage {
  /** The placement id (matches `ImagePlacement.id`). The overlay
   *  looks the placement up in the registry to draw the handles
   *  + cropper. */
  id: string;
}

/** B5 — a committed text box the renderer mirrors locally so the
 *  "Add box" tool can select / move the box. The id is local to
 *  the tab; it never reaches the wire (the engine only knows the
 *  baked drawing). */
export interface TextBoxPlacement {
  id: string;
  /** 1-based visible page the box lives on. */
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
  style: EditTextStyle;
  background: "white" | "none";
  /** Phase 80 (F2 / DEF-476) — true while the box exists ONLY in the
   *  renderer registry (a freshly placed box the placement verb created
   *  but the engine has not confirmed through `addTextBox` yet). The
   *  reducer mirror carries the marker so the Format Painter's apply pass
   *  can recognize a transient box on the SAME render as the selection,
   *  without waiting for the per-page overlay's one-commit-late report.
   *  The engine echo rehydrates the mirror through `replace-text-boxes`,
   *  which never sets this flag, so it clears on commit. */
  isNew?: boolean;
}

/** DEF-149 — a text-run edit the renderer committed through
 *  `engine.editTextRun`. The engine masks (never removes) the old
 *  run, so a re-click on the edited run must match the NEWEST
 *  committed text at the click point, not the first (old) item. */
export interface CommittedTextRun {
  /** 1-based visible page the run lives on. */
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
  /** Phase 52 follow-up — for a MOVE commit, the run's ORIGINAL rect that
   *  the engine masked. The engine covers (never removes) the old text
   *  operators, so pdf.js still returns the original item on the refreshed
   *  page; recording the masked rect lets the UI ignore that phantom hit so
   *  hovering the empty old spot paints no selection box. Absent for an
   *  in-place edit (old == new, the spot still has visible text). */
  maskedRect?: { x: number; y: number; width: number; height: number };
  /** TFL-776.6 (DEF-564) — the engine undo depth this commit belongs to: the
   *  `undoCount` AFTER this commit's engine op applied. The renderer
   *  dispatches the commit BEFORE the op's counter is mirrored, so this is
   *  `undefined` while pending and stamped by the first history reconcile
   *  (`reconcile-text-run-history` phase `op`). A commit is live while
   *  `undoDepth <= currentUndoCount`; an engine undo past it marks it
   *  `reverted`. */
  undoDepth?: number;
  /** TFL-776.6 (DEF-564) — TRUE once an engine undo reverted this commit's
   *  op. The hit-test selectors skip reverted commits so an undone run
   *  delete (or move) stops suppressing the freshly restored run. Cleared
   *  again when the matching redo re-applies the op. */
  reverted?: boolean;
}

export interface PendingImage {
  page: number;
  oldRect: { x: number; y: number; width: number; height: number };
  newRect: { x: number; y: number; width: number; height: number };
  bytes: Uint8Array;
  format: "png" | "jpeg";
}

/** Initial state. The Edit palette is closed by default; opening
 *  it transitions `tool` from `'off'` to the last-used tool (kept
 *  outside the reducer so the open/close toggle is the only one
 *  that changes it). */
export const initialEditState: EditState = {
  tool: "off",
  selectedImage: null,
  selectedTextBox: null,
  pendingReplace: null,
  placements: [],
  textBoxes: [],
  cropping: false,
};

/** All reducer actions the edit overlay can dispatch. Each variant
 *  is the smallest possible move: the UI never dispatches two changes
 *  as a single action. */
export type EditAction =
  | { type: "set-tool"; tool: EditTool }
  | { type: "select-image"; image: SelectedImage | null }
  | { type: "set-image-rect"; id: string; rect: ImagePlacement["rect"] }
  | { type: "arm-replace"; pending: PendingImage | null }
  | { type: "upsert-placement"; placement: ImagePlacement }
  | { type: "delete-placement"; id: string }
  | { type: "select-text-box"; textBoxId: string | null }
  | { type: "set-text-box-rect"; id: string; rect: TextBoxPlacement["rect"] }
  | { type: "upsert-text-box"; placement: TextBoxPlacement }
  | { type: "delete-text-box"; id: string }
  | { type: "replace-text-boxes"; boxes: TextBoxPlacement[] }
  | { type: "patch-text-box-style"; id: string; patch: TextBoxStylePatch }
  | { type: "set-cropping"; cropping: boolean }
  | { type: "push-text-run-commit"; run: CommittedTextRun }
  /** TFL-776.6 (DEF-564) — reconcile the renderer-only `committedTextRuns`
   *  with the engine's undo/redo stacks. `phase`:
   *   - `op`   — a new engine op just applied (`undoCount` is its post-op
   *              depth); stamp any pending commits with it and drop reverted
   *              commits whose redo branch this new op overwrote.
   *   - `undo` — the engine reverted the op at depth `undoCount + 1`; mark
   *              that commit reverted so the restored run is live again.
   *   - `redo` — the engine re-applied the op at depth `undoCount`; clear
   *              its `reverted` flag so the delete suppresses again. */
  | { type: "reconcile-text-run-history"; undoCount: number; phase: "op" | "undo" | "redo" }
  | { type: "reset" };

/** Reducer for the per-tab edit state. Pure — no side effects, no
 *  engine calls; the components call engine methods on receipt of
 *  a user gesture and then dispatch the result (e.g. select-image
 *  after the engine accepts the move). */
export function editReducer(state: EditState, action: EditAction): EditState {
  switch (action.type) {
    case "set-tool":
      // Closing the palette clears the pending selection + crop
      // state so a fresh open starts from a known state.
      if (action.tool === "off") {
        return {
          ...initialEditState,
          // Preserved across close: the placements list keeps
          // the user's edits visible after they re-open the
          // palette (matches the annotation overlay's "selection
          // is preserved until tool change" pattern). The
          // committed text-box list is preserved the same way
          // (B5).
          placements: state.placements,
          textBoxes: state.textBoxes,
        };
      }
      return { ...state, tool: action.tool, cropping: false };
    case "select-image":
      return {
        ...state,
        selectedImage: action.image,
        cropping: false,
      };
    case "set-image-rect": {
      const idx = state.placements.findIndex((p) => p.id === action.id);
      if (idx === -1) return state;
      const next = state.placements.slice();
      const target = next[idx];
      if (target === undefined) return state;
      next[idx] = { ...target, rect: action.rect };
      return { ...state, placements: next };
    }
    case "arm-replace":
      return { ...state, pendingReplace: action.pending };
    case "upsert-placement": {
      const idx = state.placements.findIndex((p) => p.id === action.placement.id);
      if (idx === -1) {
        return { ...state, placements: [...state.placements, action.placement] };
      }
      const next = state.placements.slice();
      next[idx] = action.placement;
      return { ...state, placements: next };
    }
    case "delete-placement": {
      const next = state.placements.filter((p) => p.id !== action.id);
      const stillSelected = state.selectedImage?.id === action.id ? null : state.selectedImage;
      return { ...state, placements: next, selectedImage: stillSelected };
    }
    case "select-text-box":
      return { ...state, selectedTextBox: action.textBoxId, cropping: false };
    case "set-text-box-rect": {
      const idx = state.textBoxes.findIndex((b) => b.id === action.id);
      if (idx === -1) return state;
      const next = state.textBoxes.slice();
      const target = next[idx];
      if (target === undefined) return state;
      next[idx] = { ...target, rect: action.rect };
      return { ...state, textBoxes: next };
    }
    case "upsert-text-box": {
      const idx = state.textBoxes.findIndex((b) => b.id === action.placement.id);
      if (idx === -1) {
        return { ...state, textBoxes: [...state.textBoxes, action.placement] };
      }
      const next = state.textBoxes.slice();
      next[idx] = action.placement;
      return { ...state, textBoxes: next };
    }
    case "delete-text-box": {
      const next = state.textBoxes.filter((b) => b.id !== action.id);
      const stillSelected = state.selectedTextBox === action.id ? null : state.selectedTextBox;
      return { ...state, textBoxes: next, selectedTextBox: stillSelected };
    }
    case "replace-text-boxes": {
      // DEF-135/136 — adopt the engine's authoritative registry list
      // verbatim (the mirror effect dispatches this after every
      // state-returning op that echoes `EngineState.textBoxes`). The
      // engine is the source of truth for which boxes exist and where
      // they are; the local list is only a renderer mirror.
      const stillSelected =
        action.boxes.some((b) => b.id === state.selectedTextBox)
          ? state.selectedTextBox
          : null;
      return { ...state, textBoxes: action.boxes, selectedTextBox: stillSelected };
    }
    case "patch-text-box-style": {
      // Phase 21 — merge a text-properties panel patch into the local
      // mirror so the renderer stays in sync before (and after) the
      // engine echo. The engine remains the source of truth; the App
      // mirror effect adopts the echoed TextBoxModel list verbatim.
      const idx = state.textBoxes.findIndex((b) => b.id === action.id);
      if (idx === -1) return state;
      const next = state.textBoxes.slice();
      const target = next[idx];
      if (target === undefined) return state;
      next[idx] = { ...target, style: mergeTextBoxStyle(target.style, action.patch) };
      return { ...state, textBoxes: next };
    }
    case "set-cropping":
      return { ...state, cropping: action.cropping };
    case "push-text-run-commit": {
      // DEF-149 — record the newest committed text-run edit. The
      // renderer commits text WITH the engine; on a later re-click
      // the hit-test prefers this run's text over the masked old
      // run still present in the content stream. Latest-wins, kept
      // bounded (a per-tab shallow cap).
      const previous = state.committedTextRuns ?? [];
      const list = previous.length >= 64 ? previous.slice(previous.length - 63) : previous.slice();
      list.push(action.run);
      return { ...state, committedTextRuns: list };
    }
    case "reconcile-text-run-history": {
      // TFL-776.6 (DEF-564) — keep the renderer-only commit registry in step
      // with the engine history. Pure bookkeeping: it never touches an engine
      // op or the wire; it only re-marks which commits are live.
      const list = state.committedTextRuns;
      if (list === undefined || list.length === 0) return state;
      const u = action.undoCount;
      let changed = false;
      const next: CommittedTextRun[] = [];
      for (const commit of list) {
        let entry = commit;
        // Stamp a pending commit. Its op is the most recent one, so for an
        // `undo` the op being reverted sits one depth ABOVE the post-undo
        // count; for `op`/`redo` the post count IS the op's depth.
        if (entry.undoDepth === undefined) {
          entry = { ...entry, undoDepth: action.phase === "undo" ? u + 1 : u };
          changed = true;
        }
        const depth = entry.undoDepth as number;
        if (action.phase === "op") {
          // A new op clears the redo stack: drop reverted commits at or above
          // its depth, whose redo entry was overwritten by this new op.
          if (entry.reverted === true && depth >= u) {
            changed = true;
            continue;
          }
        } else if (action.phase === "undo") {
          // The op at depth u + 1 was reverted; its commit is no longer live.
          if (depth === u + 1 && entry.reverted !== true) {
            entry = { ...entry, reverted: true };
            changed = true;
          }
        } else if (action.phase === "redo" && depth === u && entry.reverted === true) {
          // The op at depth u was re-applied; its commit is live again.
          entry = { ...entry, reverted: false };
          changed = true;
        }
        next.push(entry);
      }
      if (!changed) return state;
      // An undo/redo that changed the live/reverted set must also signal the
      // overlay to drop its local run selection (the selected run may have
      // just been deleted/restored under it).
      const bumpEpoch = action.phase === "undo" || action.phase === "redo";
      return {
        ...state,
        committedTextRuns: next,
        ...(bumpEpoch ? { historyEpoch: (state.historyEpoch ?? 0) + 1 } : {}),
      };
    }
    case "reset":
      return initialEditState;
  }
}

// ---------------------------------------------------------------------------
// Selectors (pure helpers; the React components call these inline)
//
// These are intentionally not memoized — they're O(1) / O(n) over a
// handful of items and the React tree already caches the parent
// component's render. Tests exercise them directly so the wire
// shape stays documented.

/** True when the Edit overlay should be pointer-active. With the
 *  tool off, the layer is invisible and pointer-transparent so the
 *  user can still select text. With a tool set, the overlay claims
 *  pointer events on its surface. */
export function editOverlayActive(tool: EditTool): boolean {
  return tool !== "off";
}

/** Compute a default size for a freshly-dragged text box. Sized
 *  to the visible page (in points) so the user has a meaningful
 *  starting footprint and can resize the corner handles if they
 *  want it bigger. */
export function defaultTextBoxRect(
  at: { x: number; y: number },
  pageWidthPt: number,
  pageHeightPt: number,
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(180, Math.max(120, pageWidthPt * 0.25));
  const height = Math.min(48, Math.max(36, pageHeightPt * 0.06));
  return {
    x: clamp(at.x, 0, Math.max(0, pageWidthPt - width)),
    y: clamp(at.y, 0, Math.max(0, pageHeightPt - height)),
    width,
    height,
  };
}

/** Clamp a value to [lo, hi]. Public so the resize math (which
 *  walks this in tight loops) can stay allocation-free. */
export function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** DEF-149 — find the NEWEST committed text run whose rect contains
 *  `pt` on `page`. pdf.js returns the masked OLD run first and the
 *  engine-committed NEW run later at the same rect; iterating the
 *  list backwards returns the last (newest) commit for the click
 *  point, so the text tool prefers it over the stale original.
 *  Returns null when no commit covers the point. */
export function committedTextRunAt(
  commits: CommittedTextRun[] | undefined,
  page: number,
  pt: { x: number; y: number },
): string | null {
  const list = commits ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const r = list[i];
    if (r === undefined) continue;
    if (r.page !== page) continue;
    // TFL-776.6 (DEF-564) — an undone commit's text is no longer the engine's
    // latest at this rect; ignore it so the hit-test falls back to the live
    // text item (the restored original after an undo).
    if (r.reverted === true) continue;
    if (
      pt.x >= r.rect.x &&
      pt.x <= r.rect.x + r.rect.width &&
      pt.y >= r.rect.y &&
      pt.y <= r.rect.y + r.rect.height
    ) {
      return r.text;
    }
  }
  return null;
}

/** Phase 52 follow-up — true when `rect` (a text-layer item's geometry in
 *  top-left page points) is the masked ORIGINAL of a run that was MOVED
 *  away. pdf.js keeps returning the old run's text item because the engine
 *  masks it with a white rect but never removes the text operators; the
 *  hover / re-select hit-test must ignore that phantom so the empty old
 *  position paints no box. Geometry match (not mere overlap) keeps the
 *  legitimate moved copy at its new rect selectable. */
export function isMaskedRunRect(
  commits: CommittedTextRun[] | undefined,
  page: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const list = commits ?? [];
  for (const c of list) {
    if (c.page !== page) continue;
    // TFL-776.6 (DEF-564) — a commit whose op was undone must stop
    // suppressing: after undo the engine restores the run's text operators at
    // this exact geometry, and the restored run must be hoverable/selectable.
    if (c.reverted === true) continue;
    const m = c.maskedRect;
    if (m === undefined) continue;
    if (
      Math.abs(rect.x - m.x) <= 2 &&
      Math.abs(rect.y - m.y) <= 2 &&
      Math.abs(rect.width - m.width) <= 2 &&
      Math.abs(rect.height - m.height) <= 2
    ) {
      return true;
    }
  }
  return false;
}

/** Clamp a rect so it stays inside the page and has a positive
 *  size. Negative sizes (from a drag that flipped horizontally)
 *  are normalized to the origin's top-left with a positive
 *  width / height. */
export function clampRectToPage(
  rect: { x: number; y: number; width: number; height: number },
  pageWidthPt: number,
  pageHeightPt: number,
): { x: number; y: number; width: number; height: number } {
  const x = clamp(rect.x, 0, pageWidthPt);
  const y = clamp(rect.y, 0, pageHeightPt);
  const width = clamp(rect.width, 1, pageWidthPt - x);
  const height = clamp(rect.height, 1, pageHeightPt - y);
  return { x, y, width, height };
}

/** DEF-135/136 — convert the engine's text-box registry entries
 *  (shared `TextBoxModel`, Phase 14 contract) into the renderer's
 *  `TextBoxPlacement` mirror shape. The engine is the source of
 *  truth: its `id` is kept verbatim (move / delete go back to the
 *  engine keyed by it), and its hex color string (`#rrggbb`) is
 *  parsed back to the editor's `EditColor`. Missing optional fields
 *  fall back to the tab's default font (size 12, black) so a
 *  re-opened editor always shows a sensible style. */
export function engineTextBoxesToPlacements(
  boxes: ReadonlyArray<{
    id: string;
    page: number;
    rect: { x: number; y: number; width: number; height: number };
    text: string;
    font?: EditFont;
    size?: number;
    color?: string;
    background?: "white" | "none";
    // Phase 21 — the engine's TextBoxModel carries the optional
    // Word/Adobe-class fields; the mirror passes them straight through
    // so the text-properties panel can show the box's ACTUAL values.
    align?: TextAlign;
    lineHeight?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    baselineShift?: number;
    highlight?: EditColor;
    list?: TextListStyle;
    indent?: number;
  }>,
  defaultFont: EditFont,
): TextBoxPlacement[] {
  return boxes.map((b) => ({
    id: b.id,
    page: b.page,
    rect: { ...b.rect },
    text: b.text,
    style: {
      font: b.font ?? defaultFont,
      size: b.size ?? 12,
      color: hexToEditColor(b.color),
      ...(b.align !== undefined ? { align: b.align } : {}),
      ...(b.lineHeight !== undefined ? { lineHeight: b.lineHeight } : {}),
      ...(b.bold !== undefined ? { bold: b.bold } : {}),
      ...(b.italic !== undefined ? { italic: b.italic } : {}),
      ...(b.underline !== undefined ? { underline: b.underline } : {}),
      ...(b.baselineShift !== undefined ? { baselineShift: b.baselineShift } : {}),
      ...(b.highlight !== undefined ? { highlight: { ...b.highlight } } : {}),
      ...(b.list !== undefined ? { list: b.list } : {}),
      ...(b.indent !== undefined ? { indent: b.indent } : {}),
    },
    background: b.background ?? "none",
  }));
}

/** Parse a `#rrggbb` color string into the editor's `EditColor`
 *  ({r,g,b} in [0,1]). Falls back to black on any malformed input so
 *  the mirror never produces an invalid color object. */
export function hexToEditColor(hex: string | undefined): EditColor {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/** DEF-135/136 — content-equality for two text-box lists. The engine
 *  echoes a fresh array (new identity) on every state round-trip even
 *  when nothing about the boxes changed; the App mirror effect uses
 *  this to skip the reducer dispatch (and the resulting openTabs
 *  object churn) when the boxes are identical. Follows the
 *  `sameFormFields` pattern from forms/model.ts. */
export function sameTextBoxes(
  a: ReadonlyArray<TextBoxPlacement>,
  b: ReadonlyArray<TextBoxPlacement>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.id !== y.id || x.page !== y.page || x.text !== y.text || x.background !== y.background) {
      return false;
    }
    const xr = x.rect;
    const yr = y.rect;
    if (xr.x !== yr.x || xr.y !== yr.y || xr.width !== yr.width || xr.height !== yr.height) {
      return false;
    }
    if (x.style.font !== y.style.font || x.style.size !== y.style.size) {
      return false;
    }
    const xc = x.style.color;
    const yc = y.style.color;
    if (xc.r !== yc.r || xc.g !== yc.g || xc.b !== yc.b) {
      return false;
    }
    // Phase 21 — the panel-visible style fields. Without these the App
    // mirror would skip a style-patch echo (same rect/text/colour) and
    // the panel would keep showing the stale formatting.
    if ((x.style.bold ?? false) !== (y.style.bold ?? false)) return false;
    if ((x.style.italic ?? false) !== (y.style.italic ?? false)) return false;
    if ((x.style.underline ?? false) !== (y.style.underline ?? false)) return false;
    if ((x.style.align ?? "left") !== (y.style.align ?? "left")) return false;
    if ((x.style.list ?? "none") !== (y.style.list ?? "none")) return false;
    if ((x.style.lineHeight ?? 1.2) !== (y.style.lineHeight ?? 1.2)) return false;
    if ((x.style.baselineShift ?? 0) !== (y.style.baselineShift ?? 0)) return false;
    if ((x.style.indent ?? 0) !== (y.style.indent ?? 0)) return false;
    if (!sameOptionalColor(x.style.highlight, y.style.highlight)) return false;
    // Phase 80 (F2 / DEF-476) — a renderer-only placement must not compare
    // equal to the engine's committed entry for the same box, else the
    // mirror effect would skip the `replace-text-boxes` that clears the
    // transient marker once the engine echo lands.
    if ((x.isNew ?? false) !== (y.isNew ?? false)) return false;
  }
  return true;
}

/** Colour equality where absent and absent match, and a present colour
 *  matches component-for-component. */
function sameOptionalColor(a: EditColor | undefined, b: EditColor | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}
