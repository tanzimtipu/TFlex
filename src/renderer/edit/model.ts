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

import type { EditFont, EditColor } from "../../shared/types";

/** Tools available in Edit mode. The values match the wire-side
 *  payload kinds so the renderer can map directly: an `editTextRun`
 *  call carries a `rect` + `newText`, an `addTextBox` call carries a
 *  `rect` + `text`, an `editImage` call carries `oldRect` + `newRect`
 *  + image bytes. */
export type EditTool = "off" | "text" | "box" | "image";

/** Style applied to a text-edit op. Read from `AppSettings.editDefaultFont`
 *  (preserved in the settings.json round-trip), the dialog can override
 *  it per-op. The inline editor shows the current style so the user
 *  knows what the engine will draw. */
export interface EditTextStyle {
  font: EditFont;
  /** pt. 8..72 covers the practical range; the engine clamps further. */
  size: number;
  color: EditColor;
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
  | { type: "set-cropping"; cropping: boolean }
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
    case "set-cropping":
      return { ...state, cropping: action.cropping };
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
