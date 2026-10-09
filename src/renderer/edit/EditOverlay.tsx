// Phase 10 — per-page Edit-content overlay.
//
// One overlay handles all three Edit tools (text / box / image).
// The active tool is the `tool` prop; the component switches its
// pointer handlers and renders the right chrome. The state model
// lives in App.tsx (so the App can keep the placement list and
// selection across page scrolls); this component is mostly
// pointer + render glue.
//
// Interactions:
//   tool === 'text': click on a text item from pdf.js -> open
//                    the inline editor pre-filled with the run's
//                    text at the run's rect.
//   tool === 'box':  drag on the page to create a rect -> open
//                    the inline editor at the new rect with empty
//                    text.
//   tool === 'image':
//                    drag on the page to create a placement
//                    (opens a "Pick image" file picker); the new
//                    placement is added to the registry. Click on
//                    an existing placement -> select; the handles
//                    appear; drag the body to move, drag a handle
//                    to resize, or click "Crop" to enter crop
//                    mode (drag a sub-rect to commit). Click
//                    "Replace" to open the file picker again.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import type { TextItemGeom } from "../annotations/AnnotationOverlay";
import { overlayRectToCss } from "../annotations/geometry";
import {
  clamp,
  clampRectToPage,
  committedTextRunAt,
  defaultEditTextStyle,
  defaultTextBoxRect,
  isMaskedRunRect,
  type EditAction,
  type EditState,
  type EditTextStyle,
  type EditTool,
  type ImagePlacement,
  type TextBoxPlacement,
} from "./model";
import {
  cropImageRect,
  moveImageRect,
  rectsClose,
  resizeImageRect,
  type ImageResizeHandle,
} from "./geometry";
import { colorToHex, fontFamilyFor } from "./editColor";
import { ContextToolbox } from "../components/ContextToolbox";
import {
  ContentActionBar,
  SelectionChrome,
  type SelectionHandleCorner,
} from "../components/selectableContent";
import {
  CONTROL_BAR_HEIGHT,
  placeControlNearAnchor,
} from "../components/controlPlacement";
import { measureTextWidthCss } from "./rasterize";
import {
  LIVE_TEXT_DEFAULT_LINE_HEIGHT,
  layoutEditTextBox,
  layoutEditTextRun,
  liveTextBandStyle,
  liveTextBlockStyle,
  liveTextLineStyle,
} from "./liveText";
import { runSourceTextStyle } from "./textStyle";
import { SpellCheckTextarea } from "../spell/SpellCheckTextarea";
import type { SpellCheckState } from "../spell/useSpellCheck";

/** Phase 38 feature D — the descent pad (fraction of the run rect's height)
 *  by which the run cover is extended BELOW the run rect. `textItemsToGeom`
 *  anchors a run's rect bottom at the PDF baseline, so glyph descenders fall
 *  outside it; without the pad the original ink peeks out under the live
 *  preview ("the old text is slightly visible behind the selected text").
 *  The live preview uses the SAME padded rect so the new descenders render
 *  unclipped and are fully backed by the cover. */
export const RUN_COVER_DESCENT = 0.25;

/** TFL-686 — the equal breathing room (pt) added on every side of a run's
 *  glyph box for the dashed hover / selection surfaces. Hand-tuned against a
 *  real 12-20pt run: enough to read as a deliberate halo around the glyphs,
 *  small enough that two adjacent lines' boxes never touch. */
const HOVER_RECT_PAD_PT = 2;

/** TFL-688 (DEF-535) — the REAL descent of a run's rendered font, as a
 *  fraction of `item.height`. A raw pdf.js `TextItemGeom` is
 *  `baseline - height` -> `baseline`, and pdf.js reports `item.height` as the
 *  font's em box, so:
 *    - the rect's TOP sits `descent * height` ABOVE the rendered glyph box
 *      (the em-box ascent overshoots the ink top), and
 *    - the rendered span box's BOTTOM sits `descent * height` BELOW the
 *      baseline.
 *  The rendered `.textLayer span` box is therefore the raw run rect shifted
 *  DOWN by this descent (same height). `RUN_COVER_DESCENT` (0.25) is the
 *  white-cover pad, NOT the glyph band, and must not be reused here — that
 *  was DEF-535. Hand-set to the measured ~0.18-0.20 of a standard-font run;
 *  the hover helper cannot read per-run font metrics (TextItemGeom has none)
 *  without reaching outside its contract. */
const HOVER_GLYPH_DESCENT = 0.2;

/** TFL-686/TFL-688 — the dashed hover / selection rect for a text run. The
 *  raw `TextItemGeom` spans em-box-top -> baseline, whose top is ABOVE and
 *  whose bottom is AT the rendered glyph box; drawing there (or only padding
 *  the bottom by a guessed descent) reads top-heavy. This helper shifts the
 *  whole box DOWN by the run's real descent so the rendered glyph band —
 *  `rect.y + descent` -> `rect.y + height + descent`, the pdf.js span box —
 *  gets an EQUAL `HOVER_RECT_PAD_PT` of breathing room on all four sides.
 *  Geometry only: never use the result for an engine op (commits keep the raw
 *  run rect). */
export function symmetricHoverRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  const descent = rect.height * HOVER_GLYPH_DESCENT;
  return {
    x: rect.x - HOVER_RECT_PAD_PT,
    y: rect.y + descent - HOVER_RECT_PAD_PT,
    width: rect.width + HOVER_RECT_PAD_PT * 2,
    height: rect.height + HOVER_RECT_PAD_PT * 2,
  };
}

/** Extend a run rect to fully contain its glyph box (baseline -> descender).
 *  Phase 51 item 16 — a non-zero `baselineShift` (super/subscript, points)
 *  raises / lowers the live preview's glyphs; the cover must follow so the
 *  shifted text is never left straddling the cover's edge (which exposed a
 *  second copy of the run underneath). Positive shift extends the cover UP
 *  (smaller y), negative extends it DOWN. */
function runCoverRect(
  rect: { x: number; y: number; width: number; height: number },
  baselineShift = 0,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const top = baselineShift > 0 ? baselineShift : 0;
  const bottom = baselineShift < 0 ? -baselineShift : 0;
  return {
    x: rect.x,
    y: rect.y - top,
    width: rect.width,
    height: rect.height * (1 + RUN_COVER_DESCENT) + top + bottom,
  };
}

export interface EditOverlayProps {
  page: number;
  pageWidthPt: number;
  pageHeightPt: number;
  cssScale: number;
  /** Active tool. `off` makes the layer pointer-transparent. */
  tool: EditTool;
  /** Snapshot of the page's text items (pdf.js). Used by the text
   *  tool to detect which run the user clicked. */
  getTextItems: () => TextItemGeom[];
  /** Per-tab edit state — placements, selection, crop flag. */
  edit: EditState;
  dispatch: (action: EditAction) => void;
  /** Open the OS file picker for an image (PNG/JPEG). Returns
   *  null when the user cancels. */
  pickImage: () => Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null>;
  /** Default font for the next edit. Mirrors
   *  `AppSettings.editDefaultFont`. */
  defaultFont: EditTextStyle["font"];
  /** Commit a text-run edit. Called with the run's rect (page
   *  points, top-left origin) and the new text + style. A HOST that
   *  resolves the returned promise does so only after the engine
   *  mask + pdf.js proxy refresh have landed — the overlay keeps its
   *  white eraser cover over the original rect until then so the
   *  moved run never flashes a stale frame (Phase-C smooth commit).
   *  A `void` return (older hosts / tests) means "no timing
   *  contract" — the cover releases immediately. */
  onCommitTextEdit: (args: {
    rect: { x: number; y: number; width: number; height: number };
    newText: string;
    style: EditTextStyle;
    /** DEF-151 — the run's ORIGINAL rect (before the toolbox drag).
     *  Present only when committing a MOVE of an already-edited run;
     *  omitted for a plain in-place edit. */
    oldRect?: { x: number; y: number; width: number; height: number };
    /** DEF-232 — the page this overlay owns, i.e. the page the run
     *  actually lives on. The host MUST target the engine op at THIS
     *  page, never at the viewer's "current page" readout: at a scroll
     *  position where the page top is still below the chrome, the
     *  current-page heuristic reports the PREVIOUS page while the run
     *  under the cursor is on this one, and the mask/draw would land on
     *  the wrong page (silently losing the edit and corrupting the
     *  other page). */
    page: number;
  }) => void | Promise<void>;
  /** Commit a new text box. */
  onCommitTextBox: (args: {
    rect: { x: number; y: number; width: number; height: number };
    text: string;
    style: EditTextStyle;
    background: "white" | "none";
    /** DEF-232 sibling — the page this overlay owns. Same rule as the
     *  text-run commit: the host MUST target the engine op at THIS
     *  page, never at the viewer's current-page readout, which can
     *  report the previous page while this page's top is still below
     *  the chrome line. */
    page: number;
  }) => void;
  /** Commit an image edit. `bytes` are the transformed PNG/JPEG
   *  bytes the engine will draw. */
  onCommitImageEdit: (args: {
    op: "move" | "resize" | "replace" | "crop";
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
    bytes: Uint8Array;
    format: "png" | "jpeg";
    id: string;
    /** DEF-232 sibling — the page this overlay owns (see
     *  onCommitTextBox.page). */
    page: number;
  }) => void;
  /** DEF-127/127b — commit a COMMITTED text box's drag (move or
   *  resize). The host rasterises the box at `newRect` and re-bakes
   *  it through the existing `editImage` contract, so the baked
   *  text moves WITH the box (no decoupled local surface).
   *  DEF-155 — returns a promise that resolves once the engine
   *  mask + pdf.js proxy refresh have landed, so the overlay can
   *  keep its white eraser cover mounted until the OLD rect is
   *  clean (no stale frame after release). A `void` return (older
   *  wiring / tests) means "no timing contract" — the overlay then
   *  clears the eraser immediately. */
  onCommitTextBoxMove: (args: {
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
    text: string;
    style: EditTextStyle;
    background: "white" | "none";
    id: string;
    /** DEF-232 sibling — the page this overlay owns. Only the
     *  pre-registry fallback (editImage mask-and-redraw) targets a
     *  page; the registry path looks the box up by id. */
    page: number;
  }) => void | Promise<void>;
  /** DEF-135/136 — delete a COMMITTED text box through the engine's
   *  registry (engine.deleteTextBox). The placement toolbar's Delete
   *  button calls this; the host removes the box from the engine
   *  registry and the local mirror adopts the echoed list. */
  onDeleteTextBox?: (id: string) => void;
  /** Phase 21 — the panel-driven style for the inline editor. It is the
   *  selected box's actual formatting, or the pending per-tool defaults
   *  when nothing is selected; the editor renders NO style controls and
   *  commits this value straight through (criterion 3). Optional so a
   *  direct-mount host that predates the panel keeps the legacy
   *  `textTarget.style ?? default` fallback. */
  textStyle?: EditTextStyle;
  /** Phase 26 — report the selected text target (a committed box or a
   *  text run) up to the host, which focuses the panel's Text field.
   *  The inline editor is retired: Edit-mode text is edited in the panel,
   *  live, with one undo entry per session. */
  onTextTargetChange?: (target: EditTextTarget | null) => void;
  /** Phase 26 — the panel's LIVE text for the selected run, so the run's
   *  on-page preview follows every keystroke. */
  textLive?: string | null;
  /** Phase 26 — flips when the panel's edit session commits; the overlay
   *  then commits the run it owns (it knows the rect and keeps the white
   *  mask cover over the original until the engine refresh lands). */
  textCommitToken?: number;
  /** Phase 37 (item 11) — the action bar's Cancel: discard the panel's
   *  live text session WITHOUT committing (the host restores whatever the
   *  live keystrokes mutated). Optional so direct-mount hosts / tests that
   *  predate it keep working (Cancel then only reverts the pending move). */
  onDiscardTextEdit?: () => void;
  /** Phase 51 item 12 — a keystroke typed in the ON-CANVAS run editor. The
   *  host routes it to the SAME session its Inspector Text field edits
   *  (`handlePanelTextChange`), so typing in either surface updates the
   *  other with no second mechanism. Optional so direct-mount hosts/tests
   *  that predate it keep the static mirror. */
  onTextInput?: (text: string) => void;
  /** Phase 51 item 12 — end the shared session (the on-canvas editor's
   *  blur), routed to the host's `commitTextSession`. `relatedTarget` is the
   *  focus target receiving focus: when it is the Inspector field (or any
   *  panel control) the session stays open, so moving between the two
   *  surfaces never loses the draft. */
  onTextInputCommit?: (relatedTarget?: EventTarget | null) => void;
  /** Phase 82 — the offline spell-check state shared with the Inspector text
   *  field, threaded to the on-canvas run editor. Optional so direct-mount
   *  hosts/tests without the spell layer render with it off. */
  spellCheck?: SpellCheckState;
}

// ---------------------------------------------------------------------------
// Editor state (local to the overlay). Two editors can be open at
// once in principle (text + image), but the tool picker at the App
// level keeps only one active at a time, so in practice this is one.

/** Phase 26 — a text target reported up to the host (the panel's Text
 *  field is the editor). A `box` target with `isNew` is a freshly
 *  dragged box that exists only in the renderer registry; the host
 *  commits it through `addTextBox` (one op) instead of `updateTextBox`. */
export interface EditTextTarget {
  kind: "box" | "run";
  /** Box id; empty for a run. */
  id: string;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  text: string;
  /** True while the box has not reached the engine registry yet. */
  isNew?: boolean;
}

interface BoxDragState {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface ImageDragState {
  kind: "create" | "move" | "resize";
  id?: string;
  handle?: ImageResizeHandle;
  origin: { x: number; y: number };
  startRect: { x: number; y: number; width: number; height: number };
}

/** B5 — in-flight drag on a committed text box. `kind` tells the
 *  pointer handlers whether the user is moving the box body or
 *  pulling a corner handle (resize). No engine op exists to move a
 *  baked box, so the drag is renderer-local: it updates the box's
 *  rect in the local registry and the overlay re-draws `.edit-box`
 *  at the new rect (the authorized at-minimum — see the B5 report
 *  for the persistence limit). */
interface TextBoxDragState {
  kind: "move" | "resize";
  id: string;
  handle?: ImageResizeHandle;
  origin: { x: number; y: number };
  startRect: { x: number; y: number; width: number; height: number };
}

interface CropDragState {
  /** Crop rect in the image's local coordinate system (0..1). */
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** Phase-C — paint barrier for the smooth-commit paths. After an
 *  engine edit resolves, wait two more animation frames so the
 *  pdf.js canvas repaint has actually painted before the white eraser
 *  cover unmounts (same DEF-155 "no stale frame window" contract as
 *  the box-move confirm). A watchdog timer guarantees the cover can
 *  never LEAK on a host whose requestAnimationFrame never fires
 *  (jsdom, headless screenshots) — a stuck cover would hide content
 *  forever, which is worse than a one-frame flash. */
function waitForPaintBarrier(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    window.setTimeout(finish, 200);
  });
}

export function EditOverlay(props: EditOverlayProps): ReactElement | null {
  const {
    page,
    pageWidthPt,
    pageHeightPt,
    cssScale,
    tool,
    getTextItems,
    edit,
    dispatch,
    pickImage,
    defaultFont,
    onCommitTextEdit,
    onCommitImageEdit,
    onCommitTextBoxMove,
    onDeleteTextBox,
    textStyle,
    onTextTargetChange,
    onDiscardTextEdit,
    onTextInput,
    onTextInputCommit,
    spellCheck,
  } = props;

  // Phase 26 — the SELECTED text target (a committed box or a text run).
  // The inline editor is retired; the target is reported up so the
  // panel's Text field can edit it live. For a run the target carries
  // the run's rect (the engine mask/draw geometry) and its committed
  // text; for a box the id + registry rect.
  const [textTarget, setTextTarget] = useState<EditTextTarget | null>(null);
  /** Phase 26 — the last live text the panel reported for the selected
   *  run, kept in a ref so the commit that follows the session's token
   *  flip still has it (the host clears its draft in the same commit). */
  const runLiveRef = useRef<string | null>(null);
  if (props.textLive !== undefined && props.textLive !== null && textTarget?.kind === "run") {
    runLiveRef.current = props.textLive;
  }
  /** DEF-537 — a plain Confirm on a run dismisses the selection (clearing
   *  `textTarget`) BEFORE the host's commit token flips. The token effect
   *  then read a null target and silently dropped the live edit. The Confirm
   *  handler parks the run target HERE when a live edit exists, so the token
   *  effect can still commit it exactly once after the clear. */
  const pendingRunCommitTargetRef = useRef<EditTextTarget | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDragState | null>(null);
  const [imageDrag, setImageDrag] = useState<ImageDragState | null>(null);
  const [textBoxDrag, setTextBoxDrag] = useState<TextBoxDragState | null>(null);
  // DEF-152 — a real move drag on a committed box now parks a PENDING
  // move instead of committing on pointerup: the box's registry rect
  // follows the drag live, but the ENGINE move only happens when the
  // box's action bar Confirm is pressed (Phase 37 item 11: the bar
  // carries Confirm / Delete / Cancel). While pending, the white eraser
  // cover (DEF-155) stays mounted so the OLD baked rect never flashes
  // before the confirmed engine mask + proxy refresh land.
  const [pendingTextBoxMove, setPendingTextBoxMove] = useState<{
    id: string;
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
    text: string;
    style: EditTextStyle;
    background: "white" | "none";
  } | null>(null);
  // Phase-C — an in-flight TEXT-RUN commit: the engine is masking the
  // ORIGINAL rect and the proxy refresh has not landed yet, so the
  // white eraser cover must stay over the run's original rect until
  // `onCommitTextEdit`'s returned promise resolves (smooth commit —
  // the original never flashes back after the toolbox closes). The
  // box analogue is `pendingTextBoxMove`; this drives the same cover
  // for the run path and also keeps the cover mounted while the
  // toolbox is OPEN over a run (the "content stays on the page"
  // complaint — the run is lifted into the toolbox, not left behind).
  const [pendingRunEdit, setPendingRunEdit] = useState<{
    /** The run's ORIGINAL baked rect — the white eraser covers it while
     *  the engine mask + proxy refresh are in flight. */
    coverRect: { x: number; y: number; width: number; height: number };
    /** TFL-1431 — the run's DESTINATION rect: the live preview keeps
     *  painting the moved run here for the whole in-flight commit
     *  window, so Confirm settles at the NEW position with no stale
     *  frame (equals `coverRect` for a plain in-place edit). */
    previewRect: { x: number; y: number; width: number; height: number };
    text: string;
    /** The style the commit is baking (the live preview mirrors it so
     *  nothing shifts when the engine result lands). */
    style: EditTextStyle;
  } | null>(null);
  // DEF-153 — the text tool's SELECTED (movable) text run. Single
  // click selects the run + shows the Confirm / Delete / Cancel bar
  // (Phase 37 item 11); the panel's Text field edits it live. The run's
  // rect is the move target; a drag parks a pending run move committed
  // by the bar's Confirm (onCommitTextEdit with oldRect).
  const [runSelection, setRunSelection] = useState<{
    rect: { x: number; y: number; width: number; height: number };
    text: string;
  } | null>(null);
  const [pendingRunMove, setPendingRunMove] = useState<{
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
    text: string;
  } | null>(null);
  /** Phase 51 item 7 — the run's rect at the START of an in-flight move drag.
   *  The white cover must stay over this OLD baked rect while the preview / blue
   *  box follow the cursor; `runSelection.rect` is the moving one. */
  const [runDragFromRect, setRunDragFromRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  /** Phase 51 item 12 — double-clicking a selected run lifts it into the
   *  ON-CANVAS editor (a textarea bound to the SAME host session as the
   *  Inspector Text field). Off by default so a single click still selects
   *  + arms the Inspector field and the run stays draggable. */
  const [canvasEditRun, setCanvasEditRun] = useState(false);
  // Phase 26 — the cursor-attached "Double click to edit" hint is gone
  // (there is no in-canvas editor to open).
  // True when the last box/run pointerup was a REAL drag — the
  // follow-up click must not reopen the editor / reselect.
  const movedRef = useRef(false);
  /** Ref mirror of `runSelection` so the window-level hover listener
   *  can track the cursor hint without re-registering on every
   *  selection change. */
  const runSelectionRef = useRef<{
    rect: { x: number; y: number; width: number; height: number };
    text: string;
  } | null>(null);
  runSelectionRef.current = runSelection;
  /** DEF-153 — in-flight text-run move drag (client origin + the
   *  run's start rect). Drives the run's selection rect through
   *  onPointerMove; pointerup parks a pending run move. */
  const runDragRef = useRef<{
    originX: number;
    originY: number;
    startRect: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [cropDrag, setCropDrag] = useState<CropDragState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Force a re-render after async image-byte operations; the
  // placement list lives in `edit` so the only thing that needs
  // a nudge is the local drag state.
  const [dragTick, setDragTick] = useState(0);

  // TFL-776.6 (DEF-564) — an engine undo/redo can delete or restore the run
  // this overlay has selected, leaving a stale run bar / preview over a rect
  // the engine no longer matches. Dismiss the local run session whenever the
  // reconciled history epoch advances so the bar never outstays its run
  // (A6's redo probe reads hover=0 once the stale selection is gone).
  const historyEpoch = edit.historyEpoch ?? 0;
  useEffect(() => {
    setRunSelection(null);
    setPendingRunMove(null);
    setPendingRunEdit(null);
    setRunDragFromRect(null);
    setCanvasEditRun(false);
    setTextTarget(null);
  }, [historyEpoch]);

  // Text-run hover hint: when the text tool is active, underline the
  // run under the cursor so the user can see what's clickable. We
  // track the hover index in a ref + a state tick to avoid
  // re-rendering on every move.
  //
  // DEF-061 — every hook (useState / useEffect) MUST be called
  // before any early return. Earlier versions of this file declared
  // `hoverRect` after the `if (tool === "off") return null;` branch,
  // so on a render that hit the early return React saw fewer hooks
  // than the previous render and threw #310 ("Rendered fewer hooks
  // than expected"). Both `hoverRect` and its pointermove effect are
  // declared here, above the early return, so the hook count is
  // stable across tool/visibility transitions.
  const [hoverRect, setHoverRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Reset all transient state when the tool changes (so a stray
  // drag from one tool doesn't bleed into the next).
  useEffect(() => {
    setTextTarget(null);
    setBoxDrag(null);
    setImageDrag(null);
    setTextBoxDrag(null);
    setCropDrag(null);
    setRunSelection(null);
    setPendingRunMove(null);
    setRunDragFromRect(null);
    setPendingTextBoxMove(null);
    setPendingRunEdit(null);
    setCanvasEditRun(false);
  }, [tool, page]);

  // DEF-149(b) / DEF-150 — every time the inline editor opens (the
  // `textTarget` identity changes) its drag offset resets to zero;
  // the drag offset only accumulates while that editor session is
  // open, so a fresh open never commits a stale position.
  useEffect(() => {
  }, [textTarget]);

  // Phase 117 — a cancelled pointer (OS gesture steal / capture loss) or
  // Escape during ANY local edit drag ends it cleanly: every live preview
  // is restored to the gesture's start rect (so the reducer carries no
  // in-flight mutation), the drag state is dropped, and NOTHING is
  // committed. The engine ops only ever run on a real pointerup.
  const cancelEditDrag = useCallback((): void => {
    if (imageDrag !== null) {
      if (imageDrag.id !== undefined) {
        dispatch({ type: "set-image-rect", id: imageDrag.id, rect: { ...imageDrag.startRect } });
      }
      setImageDrag(null);
    }
    if (textBoxDrag !== null) {
      dispatch({ type: "set-text-box-rect", id: textBoxDrag.id, rect: { ...textBoxDrag.startRect } });
      setTextBoxDrag(null);
    }
    if (boxDrag !== null) setBoxDrag(null);
    if (cropDrag !== null) {
      setCropDrag(null);
      if (edit.cropping) dispatch({ type: "set-cropping", cropping: false });
    }
    const runDrag = runDragRef.current;
    if (runDrag !== null) {
      runDragRef.current = null;
      setRunDragFromRect(null);
      setRunSelection((prev) => (prev === null ? prev : { ...prev, rect: { ...runDrag.startRect } }));
    }
  }, [imageDrag, textBoxDrag, boxDrag, cropDrag, edit.cropping, dispatch]);

  const editDragActive =
    imageDrag !== null ||
    textBoxDrag !== null ||
    boxDrag !== null ||
    cropDrag !== null ||
    runDragFromRect !== null;
  useEffect(() => {
    if (!editDragActive) return undefined;
    const onCancel = (): void => cancelEditDrag();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !e.isComposing) cancelEditDrag();
    };
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [editDragActive, cancelEditDrag]);

  // Helpers ----------------------------------------------------------------

  const pagePoint = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
      const root = rootRef.current;
      if (root === null) return { x: 0, y: 0 };
      const rect = root.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / cssScale,
        y: (e.clientY - rect.top) / cssScale,
      };
    },
    [cssScale],
  );

  const placementsForPage = edit.placements.filter((p) => p.page === page);
  const selectedPlacement = edit.selectedImage !== null
    ? placementsForPage.find((p) => p.id === edit.selectedImage?.id) ?? null
    : null;
  const boxesForPage = edit.textBoxes.filter((b) => b.page === page);
  // DEF-135/136 — the committed box currently selected on THIS page
  // (drives the placement toolbar with Edit / Delete).
  const selectedBox =
    edit.selectedTextBox !== null
      ? boxesForPage.find((b) => b.id === edit.selectedTextBox) ?? null
      : null;
  void dragTick; // referenced to keep React happy

  /** Phase 26 — place a new Edit-mode text box. The box goes into the
   *  renderer registry immediately (empty text) and becomes the panel's
   *  text target: the user types in the panel's Text field, the page
   *  mirror follows live, and the session commits ONE engine op
   *  (`addTextBox` with the final text, or nothing when it stays empty).
   *  No in-canvas editor mounts. */
  const placeNewTextBox = useCallback(
    (rect: { x: number; y: number; width: number; height: number }): void => {
      const id = crypto.randomUUID();
      const style = textStyle ?? defaultEditTextStyle(defaultFont);
      dispatch({
        type: "upsert-text-box",
        placement: { id, page, rect: { ...rect }, text: "", style: { ...style }, background: "white", isNew: true },
      });
      dispatch({ type: "select-text-box", textBoxId: id });
      setTextTarget({ kind: "box", id, page, rect: { ...rect }, text: "", isNew: true });
    },
    [dispatch, page, textStyle, defaultFont],
  );

  /** Phase 26 — report the selected text target up (the host focuses the
   *  panel's Text field) and clear it when nothing is selected. */
  const targetKey =
    textTarget === null
      ? null
      : `${textTarget.kind}:${textTarget.id}:${textTarget.page}:${textTarget.rect.x}:${textTarget.rect.y}`;
  useEffect(() => {
    onTextTargetChange?.(textTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  /** Phase 26 — the panel's edit session committed: commit the RUN this
   *  overlay owns (it knows the rect and keeps the white mask cover over
   *  the original until the engine refresh lands). Boxes are committed
   *  by the host (addTextBox / updateTextBox). */
  const textLive = props.textLive ?? null;
  const commitToken = props.textCommitToken ?? 0;
  const prevCommitTokenRef = useRef(commitToken);
  useEffect(() => {
    if (commitToken === prevCommitTokenRef.current) return;
    prevCommitTokenRef.current = commitToken;
    // DEF-537 — fall back to the run target a plain Confirm parked before it
    // cleared `textTarget`, so a Confirm commit is not lost to the clear.
    const target = textTarget ?? pendingRunCommitTargetRef.current;
    pendingRunCommitTargetRef.current = null;
    if (target === null || target.kind !== "run") return;
    const next = runLiveRef.current;
    if (next === null || next === target.text) return;
    const commitStyle = textStyle ?? defaultEditTextStyle(defaultFont);
    setPendingRunEdit({
      coverRect: { ...target.rect },
      previewRect: { ...target.rect },
      text: next,
      style: commitStyle,
    });
    const result = onCommitTextEdit({
      rect: { ...target.rect },
      newText: next,
      style: textStyle ?? defaultEditTextStyle(defaultFont),
      page: target.page,
    });
    if (result !== undefined) {
      void result
        .then(() => waitForPaintBarrier())
        .then(() => setPendingRunEdit(null))
        .catch(() => setPendingRunEdit(null));
    } else {
      setPendingRunEdit(null);
    }
    dispatch({ type: "push-text-run-commit", run: { rect: { ...target.rect }, text: next, page } });
    setRunSelection(null);
    setTextTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitToken]);

  /** DEF-152 — revert an unconfirmed box move: the registry rect
   *  returns to the engine's last committed position (the draft was
   *  renderer-local the whole time). */
  const revertPendingBoxMove = (): void => {
    if (pendingTextBoxMove === null) return;
    const p = pendingTextBoxMove;
    dispatch({ type: "set-text-box-rect", id: p.id, rect: { ...p.oldRect } });
    setPendingTextBoxMove(null);
  };

  /** DEF-152/155 — commit the unconfirmed box move through the
   *  engine (moveTextBox). The pending state — and with it the white
   *  eraser cover over the OLD rect — stays mounted until the host's
   *  engine mask + pdf.js proxy refresh resolve, so the moved box
   *  never flashes a stale frame at its original position. The
   *  selection closes together with the pending clear (after the
   *  refresh for real hosts, synchronously for void callbacks). */
  const confirmPendingBoxMove = async (): Promise<void> => {
    if (pendingTextBoxMove === null) return;
    const p = pendingTextBoxMove;
    const result = onCommitTextBoxMove({
      oldRect: { ...p.oldRect },
      newRect: { ...p.newRect },
      text: p.text,
      style: p.style,
      background: p.background,
      id: p.id,
      // DEF-232 sibling — target the pre-registry fallback at THIS
      // overlay's page.
      page,
    });
    if (result !== undefined) {
      // The host resolved the engine mask + proxy refresh; wait two
      // more frames so the pdf.js canvas paint also lands before the
      // eraser unmounts (DEF-155 — no stale frame at the old rect).
      await result;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    setPendingTextBoxMove(null);
    dispatch({ type: "select-text-box", textBoxId: null });
  };

  // Click on a text run (text tool) ---------------------------------------

  /** Phase 52 follow-up — the text-layer items the hit-test may consider.
   *  The engine masks a MOVED run's old rect with a white rect but leaves
   *  its text operators in the content stream, so pdf.js still returns the
   *  phantom item after the proxy refresh. Drop those masked originals so
   *  neither hover nor a re-select can paint a box on the empty old spot. */
  const textItemsForInteraction = useCallback(
    (): TextItemGeom[] => {
      const items = getTextItems();
      const commits = edit.committedTextRuns;
      if (commits === undefined || commits.length === 0) return items;
      return items.filter((it) => !isMaskedRunRect(commits, page, it));
    },
    [edit.committedTextRuns, getTextItems, page],
  );

  /** DEF-153 — SINGLE click on a text run SELECTS it and makes it
   *  movable (the Confirm / Edit action bar + move drag + hint);
   *  the inline editor opens on DOUBLE click (or the bar's Edit).
   *  The engine for both paths is the same hit-test: pick the run
   *  matching the newest committed text at the click point (DEFF-149(a)). */
  const runAtPoint = useCallback(
    (pt: { x: number; y: number }): TextItemGeom | null => {
      const items = textItemsForInteraction();
      // Collect every run whose rect contains the click point (a
      // small tolerance keeps a click on the line's vertical center
      // forgiving). Overlapping runs (masked old + engine-committed
      // new text sharing a rect) both match here.
      const matches: TextItemGeom[] = [];
      for (const item of items) {
        if (pt.x < item.x - 2) continue;
        if (pt.x > item.x + item.width + 2) continue;
        if (pt.y < item.y - 2) continue;
        if (pt.y > item.y + item.height + 2) continue;
        matches.push(item);
      }
      if (matches.length === 0) return null;
      // DEF-149(a) — `engine.editTextRun` MASKS the old run but never
      // removes it, so pdf.js's getTextContent() returns BOTH the old
      // run and the new run at the same rect (the OLD one appears
      // FIRST in the stream). Blindly taking `matches[0]` re-opens the
      // editor pre-filled with the stale original. Prefer the run
      // whose text equals the latest COMMITTED text for this
      // (page, click-point) — the actual text the engine drew last —
      // and only fall back to the first hit for unedited runs.
      const committedText = committedTextRunAt(edit.committedTextRuns, page, pt);
      let chosen = matches[0];
      if (chosen === undefined) return null;
      if (committedText !== null) {
        const preferred = matches.find((m) => m.text === committedText);
        if (preferred !== undefined) {
          chosen = preferred;
        }
      }
      return { ...chosen };
    },
    [edit.committedTextRuns, page, textItemsForInteraction],
  );

  // Text-run hover hint + B6 click handling. When the text tool is
  // active, underline the run under the cursor so the user can see
  // what's clickable, and open the inline editor on click. Both
  // listeners live at WINDOW level (the hover on pointermove, the
  // click on a capture-phase pointerdown) so a sibling layer that
  // swallows the pointerdown for the neutral select tool cannot
  // block the editor from mounting (B6).
  //
  // DEF-061 — every hook (useState / useEffect) MUST be called
  // before any early return. This effect sits after `onClickTextRun`
  // (which its deps reference — the deps array is evaluated during
  // render, so referencing a later `const` would throw a TDZ
  // ReferenceError) but still before the `if (tool === "off")
  // return null;` branch, so the hook count stays stable across
  // tool/visibility transitions.
  useEffect(() => {
    if (tool !== "text") {
      setHoverRect(null);
      return;
    }
    const onMove = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      const items = textItemsForInteraction();
      const hit = items.find(
        (it) =>
          x >= it.x - 2 &&
          x <= it.x + it.width + 2 &&
          y >= it.y - 2 &&
          y <= it.y + it.height + 2,
      );
      setHoverRect(hit === undefined ? null : symmetricHoverRect(hit));
      // DEF-153 — while a run is selected the cursor-attached hint
      // follows the pointer.
      if (runSelectionRef.current !== null) {
      }
    };
    window.addEventListener("pointermove", onMove);
    // B6 — text-run CLICK. The hover hint above works because it
    // listens at window level; the layer's own onPointerDown never
    // fired on a plain click in the installed app — a sibling
    // (the pdf.js textLayer's pointer-events: auto spans, or the
    // annotation layer) swallowed the pointerdown before it
    // reached the edit-layer, so the inline editor never mounted.
    // The same window-level pattern fixes the click: a capture-
    // phase pointerdown listener computes the page point and opens
    // the editor directly, exactly like the hover listener does
    // for the cursor position. Guards (AGENTS.md cross-bubbling
    // rule): bail out when the event target sits inside any
    // interactive control (the editor itself, an image placement /
    // toolbar, or a native control), and only treat left-button
    // presses inside the page bounds as text-run clicks. The
    // layer's own onPointerDown text branch stays as a fallback —
    // both paths converge on the same onClickTextRun and are
    // idempotent.
    const interactiveSelector =
      ".edit-inline-editor, .edit-image-toolbar, .edit-image-placement, .edit-image-crop-overlay, .content-action-bar, button, input, textarea, select, [role='button'], .ann-editor, .ann-note, .sig-action-bar, .sig-pending";
    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      const el = target as Element | null;
      return (
        el !== null &&
        typeof el.closest === "function" &&
        el.closest(interactiveSelector) !== null
      );
    };
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      if (isInteractiveTarget(e.target)) return;
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      if (x < 0 || y < 0 || x > pageWidthPt || y > pageHeightPt) return;
      const pt = { x, y };
      // DEF-153 — single click SELECTS the run (movable selection +
      // Confirm / Edit bar + hint); it no longer opens the editor.
      const chosen = runAtPoint(pt);
      if (chosen === null) {
        setRunSelection(null);
        setPendingRunMove(null);
        return;
      }
      movedRef.current = false;
      setPendingRunMove(null);
      setRunSelection({ rect: { ...chosen }, text: chosen.text });
      // Phase 26 — a selected run is a panel Text-field target: the
      // field shows the run's text and typing repaints it on the page.
      setTextTarget({
        kind: "run",
        id: "",
        page,
        rect: { ...chosen },
        text: chosen.text,
      });
    };
    // DEF-370 — selecting a run happens on pointerdown, and the panel's
    // focus effect then focuses the Inspector Text field. The browser's
    // DEFAULT mousedown action (which moves focus to the page/body) runs
    // after that and immediately blurs the field, so typing does not land.
    // Suppress the native focus steal, but ONLY when this press actually
    // selects a run: the interactive-ancestor guard keeps every control
    // (action bar, editor, native input) on its normal focus path, and an
    // empty-page press still blurs + commits the session as before. This is
    // a narrow preventDefault on the compat mousedown event, never a
    // catch-all, so the cross-bubbling rules are preserved.
    const onDownMouse = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      if (isInteractiveTarget(e.target)) return;
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      if (x < 0 || y < 0 || x > pageWidthPt || y > pageHeightPt) return;
      if (runAtPoint({ x, y }) === null) return;
      e.preventDefault();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("mousedown", onDownMouse, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("mousedown", onDownMouse, true);
    };
  }, [tool, cssScale, textItemsForInteraction, runAtPoint, pageWidthPt, pageHeightPt]);

  // Pointer handlers -----------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    // Don't start a drag from inside the editor.
    if ((e.target as HTMLElement).closest(".edit-inline-editor") !== null) return;
    // Phase 51 item 12 — a press inside the on-canvas run editor is caret
    // placement, never a re-select / drag.
    if ((e.target as HTMLElement).closest("[data-edit-run-editor]") !== null) return;
    if (edit.cropping) {
      // The crop overlay handles its own pointer events; bail
      // before the main layer starts anything.
      return;
    }
    const pt = pagePoint(e);
    if (pt.x < 0 || pt.y < 0 || pt.x > pageWidthPt || pt.y > pageHeightPt) return;
    // Bug 9 — pointer capture is only meaningful for drag tools
    // (box / image), where it keeps the live drag preview
    // updating even when the cursor strays off the page. For
    // the text tool the gesture is a single click with no
    // follow-up drag; capturing the pointer here would redirect
    // the editor's own pointer events away from its handler
    // (the textarea's caret placement and the toolbar's
    // focus-guard both rely on the native event flow), so the
    // click would visually do nothing. Skip capture for text.
    if (tool !== "text") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    if (tool === "text") {
      // DEF-153 — a click on a text run SELECTS it (movable + the
      // Confirm / Delete bar). Phase 26 — the selection is also the
      // panel Text-field target: the field shows the run's text and
      // typing repaints the run on the page. The layer fallback also
      // starts the run's move-drag (the browser's native text drag
      // would otherwise select text instead of moving the run).
      const chosen = runAtPoint(pt);
      if (chosen !== null) {
        movedRef.current = false;
        setPendingRunMove(null);
        // A fresh selection closes any on-canvas editor for a previous run.
        setCanvasEditRun(false);
        setRunSelection({ rect: { ...chosen }, text: chosen.text });
        setRunDragFromRect({ ...chosen });
        setTextTarget({
          kind: "run",
          id: "",
          page,
          rect: { ...chosen },
          text: chosen.text,
        });
        e.currentTarget.setPointerCapture?.(e.pointerId);
        runDragRef.current = {
          originX: e.clientX,
          originY: e.clientY,
          startRect: { ...chosen },
        };
      } else {
        setRunSelection(null);
        setPendingRunMove(null);
        setRunDragFromRect(null);
        setCanvasEditRun(false);
        setTextTarget(null);
      }
      return;
    }
    if (tool === "box") {
      // B5 — did the user press on an already-committed text box?
      // If so, select it and start a move drag on it. Otherwise
      // deselect and start a drag-to-create (Phase 26 — the box is
      // placed empty and the panel's Text field takes the text).
      const hit = hitTextBox(boxesForPage, pt);
      if (hit !== null) {
        dispatch({ type: "select-text-box", textBoxId: hit.id });
        // Phase 37 (item 11) — selecting a box IS the text-manipulation
        // panel's entry point (the bar's Edit verb is gone): make the box
        // the panel's Text target right away.
        setTextTarget({ kind: "box", id: hit.id, page, rect: { ...hit.rect }, text: hit.text });
        movedRef.current = false;
        // DEF-152 — pressing another box reverts any unconfirmed
        // move of a different box (the engine never received it).
        if (pendingTextBoxMove !== null && pendingTextBoxMove.id !== hit.id) {
          revertPendingBoxMove();
        }
        setTextBoxDrag({
          kind: "move",
          id: hit.id,
          origin: { x: e.clientX, y: e.clientY },
          startRect: { ...hit.rect },
        });
        return;
      }
      // Press on the empty page: an unconfirmed move is reverted
      // before the drag-to-create starts (fail-safe — the engine
      // never saw it).
      if (pendingTextBoxMove !== null) {
        revertPendingBoxMove();
      }
      setRunSelection(null);
      setPendingRunMove(null);
      dispatch({ type: "select-text-box", textBoxId: null });
      setTextTarget(null);
      setBoxDrag({ from: pt, to: pt });
      e.preventDefault();
      return;
    }
    if (tool === "image") {
      // Did the user click on an existing placement? If so, start
      // a move drag on it. Otherwise start a "create" drag that
      // prompts for a file on commit.
      const hit = hitPlacement(placementsForPage, pt);
      if (hit !== null) {
        dispatch({ type: "select-image", image: { id: hit.id } });
        setImageDrag({
          kind: "move",
          id: hit.id,
          origin: { x: e.clientX, y: e.clientY },
          startRect: { ...hit.rect },
        });
        return;
      }
      dispatch({ type: "select-image", image: null });
      setImageDrag({
        kind: "create",
        origin: { x: e.clientX, y: e.clientY },
        startRect: { x: pt.x, y: pt.y, width: 0, height: 0 },
      });
      e.preventDefault();
      return;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    // DEF-153 — an in-flight text-run move drag follows the cursor
    // (the run's selection rect moves; the engine op waits for the
    // bar's Confirm).
    if (tool === "text" && runDragRef.current !== null) {
      const d = runDragRef.current;
      const dx = (e.clientX - d.originX) / cssScale;
      const dy = (e.clientY - d.originY) / cssScale;
      const next = moveImageRect(d.startRect, { x: dx, y: dy }, pageWidthPt, pageHeightPt);
      setRunSelection((prev) => (prev === null ? prev : { ...prev, rect: next }));
      return;
    }
    if (imageDrag !== null) {
      const dx = (e.clientX - imageDrag.origin.x) / cssScale;
      const dy = (e.clientY - imageDrag.origin.y) / cssScale;
      if (imageDrag.kind === "create") {
        const from = { x: imageDrag.startRect.x, y: imageDrag.startRect.y };
        const to = pagePoint(e);
        const x = Math.min(from.x, to.x);
        const y = Math.min(from.y, to.y);
        const width = Math.abs(to.x - from.x);
        const height = Math.abs(to.y - from.y);
        setImageDrag({
          ...imageDrag,
          startRect: { x, y, width, height },
        });
        return;
      }
      if (imageDrag.kind === "move" && imageDrag.id !== undefined) {
        const next = moveImageRect(
          imageDrag.startRect,
          { x: dx, y: dy },
          pageWidthPt,
          pageHeightPt,
        );
        dispatch({ type: "set-image-rect", id: imageDrag.id, rect: next });
        return;
      }
      if (imageDrag.kind === "resize" && imageDrag.id !== undefined && imageDrag.handle !== undefined) {
        const next = resizeImageRect(
          imageDrag.startRect,
          imageDrag.handle,
          { x: dx, y: dy },
          pageWidthPt,
          pageHeightPt,
        );
        dispatch({ type: "set-image-rect", id: imageDrag.id, rect: next });
        return;
      }
    }
    if (textBoxDrag !== null) {
      const dx = (e.clientX - textBoxDrag.origin.x) / cssScale;
      const dy = (e.clientY - textBoxDrag.origin.y) / cssScale;
      if (textBoxDrag.kind === "move") {
        const next = moveImageRect(
          textBoxDrag.startRect,
          { x: dx, y: dy },
          pageWidthPt,
          pageHeightPt,
        );
        dispatch({ type: "set-text-box-rect", id: textBoxDrag.id, rect: next });
        return;
      }
      if (textBoxDrag.kind === "resize" && textBoxDrag.handle !== undefined) {
        const next = resizeImageRect(
          textBoxDrag.startRect,
          textBoxDrag.handle,
          { x: dx, y: dy },
          pageWidthPt,
          pageHeightPt,
        );
        dispatch({ type: "set-text-box-rect", id: textBoxDrag.id, rect: next });
        return;
      }
    }
    // DEF-153 — while a box is selected/movable the cursor-attached
    // hint follows the pointer even when no drag is in flight.
    if (selectedBox !== null && textTarget === null) {
      return;
    }
    if (boxDrag !== null) {
      setBoxDrag({ from: boxDrag.from, to: pagePoint(e) });
      return;
    }
    if (cropDrag !== null) {
      setCropDrag({ ...cropDrag, to: pagePoint(e) });
      return;
    }
  };

  const onPointerUp = async (e: ReactPointerEvent<HTMLDivElement>): Promise<void> => {
    if (imageDrag !== null) {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (imageDrag.kind === "create") {
        // Drag-to-create: the user drew a rect; ask for an image
        // and commit the placement.
        const rect = clampRectToPage(imageDrag.startRect, pageWidthPt, pageHeightPt);
        setImageDrag(null);
        if (rect.width < 8 || rect.height < 8) {
          return; // ignore tiny drags
        }
        const picked = await pickImage();
        if (picked === null) return;
        const id = crypto.randomUUID();
        const placement: ImagePlacement = {
          id,
          page,
          rect,
          bytes: picked.bytes,
          format: picked.format,
        };
        dispatch({ type: "upsert-placement", placement });
        // Commit the engine op (replace because the original rect
        // is empty — there's no old image to mask).
        onCommitImageEdit({
          op: "replace",
          oldRect: rect,
          newRect: rect,
          bytes: picked.bytes,
          format: picked.format,
          id,
          // DEF-232 sibling — target the engine at THIS overlay's page.
          page,
        });
        return;
      }
      if (imageDrag.kind === "move" && imageDrag.id !== undefined) {
        const id = imageDrag.id;
        const oldRect = imageDrag.startRect;
        setImageDrag(null);
        const placementNow = edit.placements.find((p) => p.id === id);
        if (placementNow === undefined) return;
        const newRect = placementNow.rect;
        if (rectsClose(newRect, oldRect)) return;
        onCommitImageEdit({
          op: "move",
          oldRect,
          newRect,
          bytes: placementNow.bytes,
          format: placementNow.format,
          id,
          // DEF-232 sibling — target the engine at THIS overlay's page.
          page,
        });
        return;
      }
      if (imageDrag.kind === "resize" && imageDrag.id !== undefined) {
        const id = imageDrag.id;
        const oldRect = imageDrag.startRect;
        setImageDrag(null);
        const placementNow = edit.placements.find((p) => p.id === id);
        if (placementNow === undefined) return;
        const newRect = placementNow.rect;
        if (rectsClose(newRect, oldRect)) return;
        onCommitImageEdit({
          op: "resize",
          oldRect,
          newRect,
          bytes: placementNow.bytes,
          format: placementNow.format,
          id,
          // DEF-232 sibling — target the engine at THIS overlay's page.
          page,
        });
        return;
      }
    }
    if (textBoxDrag !== null) {
      // DEF-127/127b + DEF-152 — a committed text box drag ends in
      // one of two ways:
      //   - the rect actually moved: park a PENDING move (registry
      //     rect follows live; the ENGINE move only fires when the
      //     box's action-bar Confirm is pressed). The white eraser
      //     cover over the OLD rect stays mounted while pending
      //     (DEF-155).
      //   - the gesture was a click (no meaningful movement): keep
      //     the selection + bar (the edit toolbox opens on double
      //     click or the bar's Edit — DEF-153).
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      const id = textBoxDrag.id;
      const current = edit.textBoxes.find((b) => b.id === id);
      const startRect = { ...textBoxDrag.startRect };
      const kind = textBoxDrag.kind;
      setTextBoxDrag(null);
      if (current === undefined) return;
      const moved = !rectsClose(current.rect, startRect, 2);
      if (!moved) {
        movedRef.current = false;
        // Restore the registry rect to the committed position so
        // pointer jitter can't nudge the box.
        const committed = { ...startRect };
        dispatch({ type: "set-text-box-rect", id, rect: committed });
        return;
      }
      movedRef.current = true;
      const oldRect =
        kind === "resize"
          ? { ...startRect }
          : pendingTextBoxMove?.id === id
            ? { ...pendingTextBoxMove.oldRect }
            : { ...startRect };
      setPendingTextBoxMove({
        id,
        oldRect,
        newRect: { ...current.rect },
        text: current.text,
        style: current.style,
        background: current.background,
      });
      return;
    }
    if (tool === "text" && runDragRef.current !== null) {
      // DEF-153 — a text-run move drag ends as a PENDING run move
      // (committed by the run's Confirm bar); a click keeps the
      // selection.
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      const d = runDragRef.current;
      runDragRef.current = null;
      const newRect = runSelection !== null ? { ...runSelection.rect } : { ...d.startRect };
      const moved = !rectsClose(newRect, d.startRect, 2);
      if (!moved) {
        movedRef.current = false;
        setRunDragFromRect(null);
        setRunSelection((prev) => (prev === null ? prev : { ...prev, rect: { ...d.startRect } }));
        return;
      }
      movedRef.current = true;
      setRunDragFromRect(null);
      setPendingRunMove({
        oldRect: { ...d.startRect },
        newRect,
        text: runSelection?.text ?? "",
      });
      return;
    }
    if (boxDrag !== null) {
      const from = boxDrag.from;
      const to = pagePoint(e);
      setBoxDrag(null);
      const x = Math.min(from.x, to.x);
      const y = Math.min(from.y, to.y);
      const width = Math.abs(to.x - from.x);
      const height = Math.abs(to.y - from.y);
      if (width < 16 || height < 16) {
        // Treat as a single click -> default-size box at the
        // click point.
        placeNewTextBox(defaultTextBoxRect(from, pageWidthPt, pageHeightPt));
        return;
      }
      placeNewTextBox(
        clampRectToPage({ x, y, width, height }, pageWidthPt, pageHeightPt),
      );
      return;
    }
    if (cropDrag !== null && selectedPlacement !== null) {
      const crop = cropImageRect(
        selectedPlacement.rect,
        {
          x: clamp(Math.min(cropDrag.from.x, cropDrag.to.x) - selectedPlacement.rect.x, 0, selectedPlacement.rect.width) /
            Math.max(1, selectedPlacement.rect.width),
          y: clamp(Math.min(cropDrag.from.y, cropDrag.to.y) - selectedPlacement.rect.y, 0, selectedPlacement.rect.height) /
            Math.max(1, selectedPlacement.rect.height),
          width: Math.abs(cropDrag.to.x - cropDrag.from.x) /
            Math.max(1, selectedPlacement.rect.width),
          height: Math.abs(cropDrag.to.y - cropDrag.from.y) /
            Math.max(1, selectedPlacement.rect.height),
        },
      );
      setCropDrag(null);
      dispatch({ type: "set-cropping", cropping: false });
      const oldRect = selectedPlacement.rect;
      const newRect = crop;
      onCommitImageEdit({
        op: "crop",
        oldRect,
        newRect,
        bytes: selectedPlacement.bytes,
        format: selectedPlacement.format,
        id: selectedPlacement.id,
        // DEF-232 sibling — target the engine at THIS overlay's page.
        page,
      });
      return;
    }
  };

  // Image-action buttons (replace / crop / delete) -----------------------

  const onClickReplace = useCallback(async (): Promise<void> => {
    if (selectedPlacement === null) return;
    const picked = await pickImage();
    if (picked === null) return;
    const oldRect = selectedPlacement.rect;
    const newRect = selectedPlacement.rect;
    onCommitImageEdit({
      op: "replace",
      oldRect,
      newRect,
      bytes: picked.bytes,
      format: picked.format,
      id: selectedPlacement.id,
      // DEF-232 sibling — target the engine at THIS overlay's page.
      page,
    });
    // Update the local registry so the next crop / resize reads
    // the new bytes.
    dispatch({
      type: "upsert-placement",
      placement: {
        ...selectedPlacement,
        bytes: picked.bytes,
        format: picked.format,
      },
    });
  }, [selectedPlacement, pickImage, onCommitImageEdit, dispatch]);

  const onClickDelete = useCallback((): void => {
    if (selectedPlacement === null) return;
    dispatch({ type: "delete-placement", id: selectedPlacement.id });
  }, [selectedPlacement, dispatch]);

  const onClickCrop = useCallback((): void => {
    dispatch({ type: "set-cropping", cropping: !edit.cropping });
  }, [edit.cropping, dispatch]);

  // Render ----------------------------------------------------------------

  if (tool === "off") {
    return null;
  }

  // For the text tool, render the layer transparent over the page so
  // clicks land here first; the layer's pointer-events flip on
  // for the duration of the edit.
  const layerClass = "edit-layer edit-layer-active";
  const cursor = tool === "text" || tool === "box" || tool === "image" ? "crosshair" : undefined;

  // Image-create preview: the in-flight rect while the user is
  // dragging out a new image.
  const createPreviewRect =
    imageDrag !== null && imageDrag.kind === "create"
      ? clampRectToPage(imageDrag.startRect, pageWidthPt, pageHeightPt)
      : null;
  const boxPreviewRect =
    boxDrag !== null
      ? clampRectToPage(
          {
            x: Math.min(boxDrag.from.x, boxDrag.to.x),
            y: Math.min(boxDrag.from.y, boxDrag.to.y),
            width: Math.abs(boxDrag.to.x - boxDrag.from.x),
            height: Math.abs(boxDrag.to.y - boxDrag.from.y),
          },
          pageWidthPt,
          pageHeightPt,
        )
      : null;

  // DEF-145/155 — the white eraser cover rect: the OLD baked rect of a
  // committed box while it is being moved OR its move is pending.
  // Phase-C — the cover also runs while the panel's Text field has
  // LIFTED committed content off the page (a selected box, a text run
  // under edit) and while an engine commit is still masking the
  // original (pendingTextBoxMove / pendingRunEdit). The original baked
  // copy NEVER sits beside the edited copy as a stationary duplicate —
  // it is hidden until the commit lands or the edit cancels.
  const eraserRect = ((): { x: number; y: number; width: number; height: number } | null => {
    if (tool === "box" && textBoxDrag !== null && textBoxDrag.kind === "move") {
      return { ...textBoxDrag.startRect };
    }
    if (pendingTextBoxMove !== null) {
      return { ...pendingTextBoxMove.oldRect };
    }
    if (pendingRunEdit !== null) {
      return runCoverRect(pendingRunEdit.coverRect, pendingRunEdit.style.baselineShift ?? 0);
    }
    if (textTarget !== null && textTarget.kind === "box") {
      return { ...textTarget.rect };
    }
    if (textTarget !== null && textTarget.kind === "run" && textTarget.text.length > 0) {
      // Phase 38 feature D — extend below the baseline so the run's
      // descenders are covered too (no ghost ink under the live preview).
      // Phase 51 items 7/15/16 — the cover stays over the OLD baked rect
      // while a move is in flight or pending (the preview / blue box follow
      // the cursor instead), so no copy is left at the original position; the
      // baseline shift extends the cover so super/subscript cannot expose one.
      const oldRect =
        pendingRunMove?.oldRect ?? runDragFromRect ?? textTarget.rect;
      return runCoverRect(oldRect, textStyle?.baselineShift ?? 0);
    }
    return null;
  })();

  // Phase 37 (item 12) — the text the RunLivePreview paints over the eraser.
  // A live panel session wins; otherwise the selected run's committed text
  // is shown, so selecting text never hides it (the eraser above masks the
  // baked run and this is what replaces it).
  const runPreviewText =
    tool === "text" && textTarget !== null && textTarget.kind === "run"
      ? textLive !== null && textLive.length > 0
        ? textLive
        : textTarget.text
      : null;

  // Phase 51 item 12 — the padded cover / editor rect for the selected run,
  // driven by the LIVE drag rect when a move is in flight (item 7).
  const runLiveRect =
    tool === "text" && textTarget !== null && textTarget.kind === "run"
      ? runCoverRect(runSelection?.rect ?? textTarget.rect, textStyle?.baselineShift ?? 0)
      : null;

  // TFL-1431 — the in-flight commit's live preview. The selected-run preview
  // above unmounts the moment `textTarget` clears on Confirm, which left the
  // moved run blank at its NEW rect until the host's whole-document re-parse
  // landed (the "stale artifact then delayed reposition"). Keep the moved run
  // painted at the DESTINATION rect for the whole commit window, in the same
  // padded geometry + style the commit is baking; the eraser above covers the
  // ORIGINAL rect for the same duration.
  const pendingRunPreview =
    pendingRunEdit !== null && pendingRunEdit.text.length > 0
      ? {
          rect: runCoverRect(pendingRunEdit.previewRect, pendingRunEdit.style.baselineShift ?? 0),
          text: pendingRunEdit.text,
          style: pendingRunEdit.style,
        }
      : null;

  // Phase 48 (item 3) — the text-run action bar is placed under the run
  // and clamped into the page view on both axes (was bottom-edge
  // unclamped).
  const runBarPlacement =
    runSelection === null
      ? null
      : placeControlNearAnchor({
          anchor: {
            left: runSelection.rect.x * cssScale,
            top: runSelection.rect.y * cssScale,
            bottom: (runSelection.rect.y + runSelection.rect.height) * cssScale,
          },
          size: { width: 240, height: CONTROL_BAR_HEIGHT },
          viewport: { width: pageWidthPt * cssScale, height: pageHeightPt * cssScale },
        });

  return (
    <div
      ref={rootRef}
      className={layerClass}
      data-page={page}
      data-tool={tool}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e): void => {
        void onPointerUp(e);
      }}
    >
      {tool === "text" && hoverRect !== null && (
        <div
          className="edit-text-hover"
          style={overlayRectToCss(hoverRect, cssScale)}
        />
      )}

      {/* DEF-153 — the SELECTED (movable) text run: an outlined
          surface at the run's rect + the Confirm/Edit/Delete bar. */}
      {tool === "text" && runSelection !== null && !canvasEditRun && (
        <div
          className="edit-text-hover edit-textrun-selection"
          data-textrun-selection
          data-textrun-text={runSelection.text}
          style={overlayRectToCss(symmetricHoverRect(runSelection.rect), cssScale)}
          onDoubleClick={(e): void => {
            // Phase 51 item 12 — a double-click lifts the run into the
            // on-canvas editor (the Inspector Text field stays available and
            // edits the same session).
            e.stopPropagation();
            setCanvasEditRun(true);
          }}
        />
      )}

      {tool === "box" && boxPreviewRect !== null && (
        <div
          className="edit-box-preview"
          style={overlayRectToCss(boxPreviewRect, cssScale)}
        />
      )}

      {/* DEF-145/155 — while a COMMITTED box is being moved OR its
          move is pending (unconfirmed), the page canvas underneath
          still paints the pre-move baked text at the ORIGINAL rect
          (the pdf.js proxy is only refreshed after the confirmed
          engine move lands). Cover that stale copy with an opaque
          white rect exactly matching the drag's start rect — the
          same white-mask the engine applies to the old position on
          re-bake — so the box appears to move as a single unit with
          no residual text at the old spot. The cover stays mounted
          until the Confirm's engine mask + proxy refresh RESOLVE (no
          stale frame window at release — DEF-155). */}
      {eraserRect !== null && (
        <div
          className="edit-box-eraser"
          data-edit-box-eraser
          style={{
            position: "absolute",
            left: eraserRect.x * cssScale,
            top: eraserRect.y * cssScale,
            width: eraserRect.width * cssScale,
            height: eraserRect.height * cssScale,
            background: "#ffffff",
            pointerEvents: "none",
          }}
          aria-hidden
        />
      )}

      {tool === "box" && boxesForPage.map((b) => (
        <TextBoxView
          key={b.id}
          box={b}
          cssScale={cssScale}
          selected={edit.selectedTextBox === b.id}
          onPointerDownHandle={(e, handle): void => {
            // B5 — corner-handle drag resizes the committed box.
            e.stopPropagation();
            e.preventDefault();
            (e.target as Element).setPointerCapture(e.pointerId);
            setTextBoxDrag({
              kind: "resize",
              id: b.id,
              handle,
              origin: { x: e.clientX, y: e.clientY },
              startRect: { ...b.rect },
            });
            dispatch({ type: "select-text-box", textBoxId: b.id });
          }}
        />
      ))}

      {/* DEF-135/136 + DEF-152 — placement toolbar for a SELECTED
          committed box: Confirm (commits a pending move) + Edit
          (makes the box the panel Text field's target) + Delete
          (engine.deleteTextBox through the host). The bar stops
          pointerdown so a button press never starts a new
          drag-to-create on the page behind it. */}
      <AnimatePresence>
        {tool === "box" &&
          selectedBox !== null &&
          (() => {
            const box = selectedBox;
            return (
            <TextBoxToolbar
              box={box}
              cssScale={cssScale}
              pageWidthPt={pageWidthPt}
              pageHeightPt={pageHeightPt}
              onConfirm={(): void => {
                if (pendingTextBoxMove === null) {
                  // No pending move — Confirm commits the selection
                  // (closes the bar; the panel's live session commits
                  // through the target clear).
                  dispatch({ type: "select-text-box", textBoxId: null });
                  setTextTarget(null);
                  return;
                }
                if (pendingTextBoxMove.id !== box.id) return;
                // DEF-152 — Confirm commits the PENDING move through
                // the engine; the bar + eraser stay mounted until the
                // engine mask + proxy refresh resolve (DEF-155).
                void confirmPendingBoxMove();
                setTextTarget(null);
              }}
              onDelete={(): void => {
                setPendingTextBoxMove(null);
                // Phase 37 (item 11) — discarding the live session restores
                // whatever the panel's keystrokes had mutated in the registry.
                onDiscardTextEdit?.();
                setTextTarget(null);
                onDeleteTextBox?.(box.id);
              }}
              onCancel={(): void => {
                // Phase 37 (item 11) — Cancel reverts the renderer-local
                // pending move (the engine never received it), discards any
                // live panel session, and dismisses the selection.
                revertPendingBoxMove();
                onDiscardTextEdit?.();
                setTextTarget(null);
                dispatch({ type: "select-text-box", textBoxId: null });
              }}
            />
          );
          })()}
        </AnimatePresence>

      {/* DEF-153 — the text-run selection bar: Confirm (commits a
          pending run move through engine.editTextRun with the OLD
          rect so the run RELOCATES), Edit (opens the inline
          editor), Delete (masks the run — the contract's only
          text-removal path). Single click selected the run; this
          bar + the hint + the move drag are the "movable" half. */}
      <AnimatePresence>
      {tool === "text" && runSelection !== null && (
        <ContentActionBar
          className="content-action-bar edit-textrun-bar"
          dataBar="textrun"
          left={runBarPlacement?.left ?? 0}
          top={runBarPlacement?.top ?? 0}
          onConfirm={(): void => {
            if (pendingRunMove === null) {
              // Phase 51 item 13 — a plain Confirm (no move) dismisses the
              // selection; clearing the target lets the host commit any live
              // panel session at the run's CURRENT rect. Never repositions.
              // DEF-537 — park the run target when a live edit exists so the
              // token-triggered commit still has it after this clear.
              // DEF-541 — a whitespace-only run never commits, so do not park
              // it: a stale parked target could later be read by the token
              // effect and commit an aborted whitespace edit.
              const t = textTarget;
              const live = runLiveRef.current;
              if (
                t !== null &&
                t.kind === "run" &&
                live !== null &&
                live !== t.text &&
                live.trim() !== ""
              ) {
                pendingRunCommitTargetRef.current = t;
              }
              setCanvasEditRun(false);
              setRunSelection(null);
              setPendingRunMove(null);
              setTextTarget(null);
              return;
            }
            const p = pendingRunMove;
            // Phase 38 feature D — the commit uses the run's SOURCE style
            // derivation (rect height -> size), the same one the live preview
            // renders, so nothing shrinks when the edit is baked.
            const style: EditTextStyle = runSourceTextStyle(p.oldRect.height, defaultFont);
            const moved = !rectsClose(p.newRect, p.oldRect, 1);
            // Phase 51 item 12 — the move commit carries the LIVE session
            // text (typed in the Inspector field or the on-canvas editor),
            // falling back to the selection's text when no session is open.
            const live = runLiveRef.current;
            const newText = live !== null && live.length > 0 ? live : p.text;
            // Phase-C smooth commit — keep the white cover over the
            // run's ORIGINAL rect until the engine mask + proxy
            // refresh resolve (same timing contract as the editor
            // commit above). The selection closes immediately; the
            // cover releases when the host's promise lands.
            // TFL-1431 — carry the DESTINATION rect too: the live preview
            // keeps painting the moved run there for the whole in-flight
            // window, so Confirm settles at the NEW position with no blank
            // frame while the host re-parses.
            setPendingRunEdit({
              coverRect: { ...p.oldRect },
              previewRect: { ...p.newRect },
              text: newText,
              style,
            });
            const res = onCommitTextEdit({
              rect: { ...p.newRect },
              newText,
              style,
              ...(moved ? { oldRect: { ...p.oldRect } } : {}),
              // DEF-232 — target the engine at THIS overlay's page.
              page,
            });
            if (res !== undefined) {
              void res
                .then(() => waitForPaintBarrier())
                .then(() => {
                  setPendingRunEdit(null);
                })
                .catch(() => {
                  setPendingRunEdit(null);
                });
            } else {
              window.setTimeout(() => setPendingRunEdit(null), 0);
            }
            dispatch({
              type: "push-text-run-commit",
              // Phase 52 follow-up — a MOVE records the masked ORIGINAL rect
              // so the hit-test can ignore the phantom text item pdf.js still
              // returns there after the refresh.
              run: {
                page,
                rect: { ...p.newRect },
                text: newText,
                ...(moved ? { maskedRect: { ...p.oldRect } } : {}),
              },
            });
            // Phase 51 items 7/13/15/16 — the move is committed; drop the
            // live session (the payload already carries its text) and CLEAR
            // the target so the eraser + run preview unmount. Otherwise the
            // preview keeps painting the text at the OLD rect forever (the
            // duplicate on Confirm / on a second move) and a later style
            // patch would re-commit at that stale rect.
            onDiscardTextEdit?.();
            setCanvasEditRun(false);
            setRunSelection(null);
            setPendingRunMove(null);
            setTextTarget(null);
          }}
          onDelete={(): void => {
            const style: EditTextStyle = runSourceTextStyle(runSelection.rect.height, defaultFont);
            onCommitTextEdit({
              rect: { ...runSelection.rect },
              newText: "",
              style,
              // DEF-232 — target the engine at THIS overlay's page.
              page,
            });
            // TFL-776.1 — the delete MASKS the run's rect but never removes its
            // text operators, so pdf.js still returns the phantom item at the
            // vacated spot after the proxy refresh. Register the vacated rect
            // exactly like the MOVE path's masked original so the hit-test
            // (`isMaskedRunRect`) ignores it for both hover and click.
            dispatch({
              type: "push-text-run-commit",
              run: {
                page,
                rect: { ...runSelection.rect },
                text: "",
                maskedRect: { ...runSelection.rect },
              },
            });
            onDiscardTextEdit?.();
            setCanvasEditRun(false);
            setRunSelection(null);
            setPendingRunMove(null);
            setTextTarget(null);
          }}
          onCancel={(): void => {
            // Phase 37 (item 11) — Cancel reverts the renderer-local pending
            // move (the engine never saw it), discards any live panel
            // session, and dismisses the selection + panel target. Same
            // dismiss semantics as a press on the empty page.
            onDiscardTextEdit?.();
            setPendingRunEdit(null);
            setPendingRunMove(null);
            setCanvasEditRun(false);
            setRunSelection(null);
            setTextTarget(null);
          }}
          confirmLabel="Confirm"
          deleteLabel="Delete"
          cancelLabel="Cancel"
          confirmTitle="Confirm the move"
          deleteTitle="Delete text (mask)"
          cancelTitle="Cancel (revert the move)"
          confirmAria="Confirm text run move"
          deleteAria="Delete text run"
          cancelAria="Cancel text run changes"
          cancelAfterDelete
          dataActionPrefix="textrun"
        />
      )}
      </AnimatePresence>

      {tool === "image" && (
        <>
          {placementsForPage.map((p) => (
            <PlacementView
              key={p.id}
              placement={p}
              cssScale={cssScale}
              selected={edit.selectedImage?.id === p.id}
              isResizing={
                imageDrag !== null && imageDrag.kind === "resize" && imageDrag.id === p.id
              }
              onPointerDownHandle={(e, handle): void => {
                e.stopPropagation();
                e.preventDefault();
                (e.target as Element).setPointerCapture(e.pointerId);
                setImageDrag({
                  kind: "resize",
                  id: p.id,
                  handle,
                  origin: { x: e.clientX, y: e.clientY },
                  startRect: { ...p.rect },
                });
                dispatch({ type: "select-image", image: { id: p.id } });
                setDragTick((v) => v + 1);
              }}
            />
          ))}
          {createPreviewRect !== null && (
            <div
              className="edit-image-create-preview"
              style={overlayRectToCss(createPreviewRect, cssScale)}
            />
          )}
          <AnimatePresence>
          {selectedPlacement !== null && (
            <PlacementToolbar
              placement={selectedPlacement}
              cropping={edit.cropping}
              cssScale={cssScale}
              pageWidthPt={pageWidthPt}
              pageHeightPt={pageHeightPt}
              onReplace={(): void => {
                void onClickReplace();
              }}
              onCrop={onClickCrop}
              onDelete={onClickDelete}
            />
          )}
        </AnimatePresence>
          {edit.cropping && selectedPlacement !== null && (
            <CropOverlay
              imageRect={selectedPlacement.rect}
              crop={cropDrag}
              cssScale={cssScale}
              onPointerDown={(e): void => {
                e.stopPropagation();
                e.preventDefault();
                (e.target as Element).setPointerCapture(e.pointerId);
                const pt = pagePoint(e);
                setCropDrag({
                  from: { x: pt.x, y: pt.y },
                  to: { x: pt.x, y: pt.y },
                });
              }}
              onPointerMove={(e): void => {
                if (cropDrag === null) return;
                const pt = pagePoint(e);
                setCropDrag({ ...cropDrag, to: { x: pt.x, y: pt.y } });
              }}
              onPointerUp={(e): void => {
                (e.target as Element).releasePointerCapture?.(e.pointerId);
                // Defer the commit to the layer's onPointerUp,
                // which is wired through the same handler. We just
                // keep the cropDrag state around.
              }}
            />
          )}
        </>
      )}
      {/* Phase 26 — the selected text RUN's live preview: the panel's
          Text field is the editor, so the run's rect is masked (the
          eraser above) and the session text is painted at the run's
          position on every keystroke.
          Phase 37 (item 12) — the preview must ALWAYS back the mask: a
          bare selection (no panel session yet) falls back to the run's
          committed text, so the selected text stays VISIBLE instead of
          a white hole. */}
      {runPreviewText !== null && runPreviewText.length > 0 && canvasEditRun && runLiveRect !== null ? (
          /* Phase 51 item 12 — the run is being edited ON the canvas: the
             textarea is the visible surface (no static preview behind it, so
             the text is never painted twice) and it edits the SAME session as
             the Inspector Text field. */
          <RunCanvasEditor
            rect={runLiveRect}
            text={runPreviewText}
            style={textStyle ?? defaultEditTextStyle(defaultFont)}
            cssScale={cssScale}
            onChange={onTextInput}
            onCommit={onTextInputCommit}
            onDiscard={onDiscardTextEdit}
            spellCheck={spellCheck}
          />
        ) : runPreviewText !== null && runPreviewText.length > 0 && runLiveRect !== null ? (
          <RunLivePreview
            rect={runLiveRect}
            text={runPreviewText}
            style={textStyle ?? defaultEditTextStyle(defaultFont)}
            cssScale={cssScale}
          />
        ) : null}
      {/* TFL-1431 — the run commit is in flight: the selected-run preview
          above is gone (its target cleared on Confirm), but the moved run must
          stay painted at its DESTINATION rect until the host's commit promise
          + paint barrier resolve, so Confirm settles at the NEW position with
          no stale/blank frame. The eraser above covers the ORIGINAL rect for
          the same window. */}
      {pendingRunPreview !== null && (
        <RunLivePreview
          rect={pendingRunPreview.rect}
          text={pendingRunPreview.text}
          style={pendingRunPreview.style}
          cssScale={cssScale}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-views

function hitPlacement(
  placements: ImagePlacement[],
  pt: { x: number; y: number },
): ImagePlacement | null {
  // Hit-test in reverse so the most-recently-added placement wins
  // when two overlap.
  for (let i = placements.length - 1; i >= 0; i -= 1) {
    const p = placements[i];
    if (p === undefined) continue;
    if (
      pt.x >= p.rect.x &&
      pt.x <= p.rect.x + p.rect.width &&
      pt.y >= p.rect.y &&
      pt.y <= p.rect.y + p.rect.height
    ) {
      return p;
    }
  }
  return null;
}

/** B5 — hit-test for a committed text box. Same reverse-iteration
 *  rule as `hitPlacement` (most-recently-added wins on overlap). */
function hitTextBox(
  boxes: TextBoxPlacement[],
  pt: { x: number; y: number },
): TextBoxPlacement | null {
  for (let i = boxes.length - 1; i >= 0; i -= 1) {
    const b = boxes[i];
    if (b === undefined) continue;
    if (
      pt.x >= b.rect.x &&
      pt.x <= b.rect.x + b.rect.width &&
      pt.y >= b.rect.y &&
      pt.y <= b.rect.y + b.rect.height
    ) {
      return b;
    }
  }
  return null;
}

interface PlacementViewProps {
  placement: ImagePlacement;
  cssScale: number;
  selected: boolean;
  isResizing: boolean;
  onPointerDownHandle: (
    e: ReactPointerEvent<HTMLSpanElement>,
    handle: SelectionHandleCorner,
  ) => void;
}

function PlacementView(props: PlacementViewProps): ReactElement {
  const { placement, cssScale, selected, isResizing, onPointerDownHandle } = props;
  const style: CSSProperties = {
    position: "absolute",
    left: placement.rect.x * cssScale,
    top: placement.rect.y * cssScale,
    width: placement.rect.width * cssScale,
    height: placement.rect.height * cssScale,
  };
  return (
    <div
      className={
        selected
          ? "edit-image-placement edit-image-placement-selected"
          : "edit-image-placement"
      }
      data-placement-id={placement.id}
      style={style}
    >
      <img
        className="edit-image-placement-img"
        src={bytesToObjectURL(placement.bytes, placement.format)}
        alt=""
        draggable={false}
      />
      {selected && (
        // Phase 117 (chunk D) — the image selection chrome is the ONE shared
        // `SelectionChrome` (same boundary + handles as every other kind);
        // `data-handle` survives on each handle as the stable selector.
        // A rotate handle is deliberately NOT rendered: the engine exposes no
        // object-rotation op (only per-page quarter turns).
        <SelectionChrome
          left={0}
          top={0}
          width={placement.rect.width * cssScale}
          height={placement.rect.height * cssScale}
          kind="image"
          state="selected"
          handles
          handleDataAttr="data-handle"
          onHandlePointerDown={(e, h): void => {
            e.stopPropagation();
            onPointerDownHandle(e, h);
          }}
        />
      )}
      {/* Marker rendered during a resize drag so the user sees
          a thin border without the dashed selected border being
          misleading. */}
      {isResizing && <div className="edit-image-placement-resizing" />}
    </div>
  );
}

/** Phase 26 / DEF-266 — the selected text RUN's live preview. The panel's
 *  Text field is the editor, so the run's rect is masked (the eraser in the
 *  parent) and the session text is painted at the run's position on every
 *  keystroke. DEF-263/266 — it renders the SAME full style set as the box
 *  mirror (bold, italic, underline, super/sub, highlight, alignment, the
 *  STORED line step, list prefixes and indent), per line, so a style control
 *  composed on the run is visible live, not only after save+reopen. The
 *  engine draws a run's explicit lines unchanged (no word-wrap, no auto-fit),
 *  so the preview splits on explicit newlines and keeps the run's size. */
interface RunLivePreviewProps {
  rect: { x: number; y: number; width: number; height: number };
  text: string;
  style: EditTextStyle;
  cssScale: number;
}

function RunLivePreview(props: RunLivePreviewProps): ReactElement {
  const { rect, text, style, cssScale } = props;
  const layout = useMemo(
    () =>
      layoutEditTextRun({
        text,
        widthPx: Math.max(1, rect.width * cssScale),
        userSizePx: style.size * cssScale,
        indentPx: (style.indent ?? 0) * cssScale,
        list: style.list ?? "none",
      }),
    [text, rect.width, style.size, style.indent, style.list, cssScale],
  );
  return (
    <div
      className="edit-run-live-preview"
      data-edit-run-preview
      aria-hidden
      style={{
        ...overlayRectToCss(rect, cssScale),
        paddingLeft: `${layout.indentPx}px`,
        overflow: "hidden",
        pointerEvents: "none",
        ...liveTextBlockStyle({ style, cssScale, fontSizePx: layout.fontSizePx }),
      }}
    >
      {layout.lines.map((line) => (
        <div
          key={line.key}
          className="edit-run-line"
          data-edit-run-line={String(line.index)}
          style={{
            whiteSpace: "nowrap",
            ...liveTextLineStyle({ style, layout, isLast: line.isLast }),
          }}
        >
          <span
            className="edit-run-line-band"
            style={liveTextBandStyle({ style, cssScale })}
          >
            {line.prefix !== "" && (
              <span className="edit-run-line-prefix">{line.prefix}</span>
            )}
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

interface RunCanvasEditorProps {
  rect: { x: number; y: number; width: number; height: number };
  text: string;
  style: EditTextStyle;
  cssScale: number;
  onChange?: (text: string) => void;
  onCommit?: (relatedTarget?: EventTarget | null) => void;
  /** DEF-540 — the host's explicit discard. Escape is the keyboard abort for
   *  a live text session, so the on-canvas editor routes it here (never to the
   *  blur commit) before releasing focus. */
  onDiscard?: () => void;
  spellCheck?: SpellCheckState;
}

/** Phase 51 item 12 — the ON-CANVAS text editor for a selected run. It is a
 *  second SURFACE of the SAME host text session as the Inspector Text field
 *  (its keystrokes call the host's `handlePanelTextChange`, its blur calls
 *  `commitTextSession`), not a second mechanism: typing in either updates the
 *  other, and switching focus between them keeps the session alive
 *  (`isTextPanelFocusTarget` accepts `[data-edit-run-editor]`). It paints the
 *  run's own font / size / colour / weight / decoration over the white cover,
 *  so the text is shown exactly once. Phase 82 — it also carries the shared
 *  offline spell-check surface. */
function RunCanvasEditor(props: RunCanvasEditorProps): ReactElement {
  const { rect, text, style, cssScale, onChange, onCommit, onDiscard, spellCheck } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const fontSizePx = Math.max(1, style.size) * cssScale;
  const lineHeight = style.lineHeight ?? LIVE_TEXT_DEFAULT_LINE_HEIGHT;
  const spellState: Omit<SpellCheckState, "setEnabled"> =
    spellCheck ?? { enabled: false, status: "off", dictionary: null, error: null };
  return (
    <SpellCheckTextarea
      className="edit-run-editor"
      textareaAttrs={{ "data-edit-run-editor": "", "data-edit-run-editor-text": text }}
      ariaLabel="Edit text"
      value={text}
      spellCheck={spellState}
      inputRef={ref}
      style={{
        position: "absolute",
        left: rect.x * cssScale,
        top: rect.y * cssScale,
        width: rect.width * cssScale,
        height: rect.height * cssScale,
        background: "#ffffff",
        color: colorToHex(style.color),
        caretColor: colorToHex(style.color),
        fontFamily: fontFamilyFor(style.font),
        fontSize: `${fontSizePx}px`,
        fontWeight: style.bold === true ? 700 : 400,
        fontStyle: style.italic === true ? "italic" : "normal",
        textDecoration: style.underline === true ? "underline" : "none",
        letterSpacing: `${(style.charSpacing ?? 0) * cssScale}px`,
        lineHeight: `${fontSizePx * lineHeight}px`,
        paddingLeft: `${(style.indent ?? 0) * cssScale}px`,
        // DEF-373 — the run editor's border / radius / outline / resize /
        // overflow / white-space live in `.edit-run-editor` (styles.css), NOT
        // here: an inline `border: ... solid transparent` outranks the
        // `.edit-run-editor:focus { border-color: var(--accent) }` rule, so
        // focus never painted the accent. The stylesheet now drives exactly
        // one rounded border (transparent at rest, accent on focus).
      }}
      onPointerDown={(e): void => {
        e.stopPropagation();
      }}
      onChange={(next): void => onChange?.(next)}
      onCommit={(relatedTarget): void => onCommit?.(relatedTarget)}
      onKeyDown={(e): void => {
        if (e.key === "Escape") {
          // DEF-540 — Escape is the keyboard abort: discard the live session
          // explicitly instead of blurring into the commit gesture.
          e.preventDefault();
          onDiscard?.();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

interface TextBoxViewProps {
  box: TextBoxPlacement;
  cssScale: number;
  selected: boolean;
  /** DEF-150(a) — CSS-px drag offset of the box's floating editor
   *  (non-null only while THAT box's editor is open). The mirror is
   *  drawn at rect + offset so the box visibly moves with the
   *  toolbox mid-drag; the registry rect is untouched until the
   *  user confirms. Null = the box is not being drag-previewed. */
  dragOffsetCss?: { x: number; y: number } | null;
  onPointerDownHandle: (
    e: ReactPointerEvent<HTMLSpanElement>,
    handle: SelectionHandleCorner,
  ) => void;
}

/** B5 + DEF-127 — a committed text box's selection + drag surface.
 *  It draws the box's BAKED CONTENT as a live mirror — the white
 *  background fill (when the box was added with one) and the wrapped
 *  text in the box's font/size/color — so a drag visibly carries the
 *  whole box (text included), not an empty blue outline. The
 *  DEF-127b complaint ("moving a text box moves only an empty blue
 *  .edit-box local surface — the baked text stays put") had two
 *  halves: this mirror fixes the visual half (the text follows the
 *  drag), and the pointerup commit re-bakes the box at the new rect
 *  through `onCommitTextBoxMove` so the engine's copy follows too.
 *  Both inner layers are pointer-transparent — the surface itself
 *  stays the drag + handle target. */
function TextBoxView(props: TextBoxViewProps): ReactElement {
  const { box, cssScale, selected, dragOffsetCss = null, onPointerDownHandle } = props;
  const style: CSSProperties = {
    position: "absolute",
    left: box.rect.x * cssScale + (dragOffsetCss?.x ?? 0),
    top: box.rect.y * cssScale + (dragOffsetCss?.y ?? 0),
    width: box.rect.width * cssScale,
    height: box.rect.height * cssScale,
  };
  // DEF-146 — the mirror font auto-fits the box (engine/rasterizer
  // parity): wrap at the box width, shrink so every line fits the box
  // height. DEF-263 — the layout now also reads the STORED line-height,
  // indent, list prefix and tracking, exactly like the engine's
  // `drawTextBoxes`, so the fitted size and the wrapped lines match what
  // save bakes.
  const fontFamily = fontFamilyFor(box.style.font);
  const charSpacingPx = (box.style.charSpacing ?? 0) * cssScale;
  const layout = useMemo(
    () =>
      layoutEditTextBox({
        text: box.text,
        // The mirror's padding is "3px" on every side (TFL-686 — equal
        // breathing room around the glyphs, matching the run hover box).
        widthPx: Math.max(1, box.rect.width * cssScale - 6),
        heightPx: Math.max(1, box.rect.height * cssScale - 6),
        userSizePx: box.style.size * cssScale,
        indentPx: (box.style.indent ?? 0) * cssScale,
        lineHeight: box.style.lineHeight ?? LIVE_TEXT_DEFAULT_LINE_HEIGHT,
        list: box.style.list ?? "none",
        charSpacingPx,
        measure: (t, s): number => measureTextWidthCss(t, fontFamily, s),
      }),
    [
      box.text,
      box.style.font,
      box.style.size,
      box.style.indent,
      box.style.lineHeight,
      box.style.list,
      box.rect.width,
      box.rect.height,
      cssScale,
      fontFamily,
      charSpacingPx,
    ],
  );
  return (
    <div
      className={
        selected
          ? "edit-box edit-box-selected"
          : "edit-box"
      }
      data-edit-box-id={box.id}
      data-edit-box-text={box.text}
      data-edit-box-font-size={String(Math.round(layout.fontSizePx * 100) / 100)}
      style={style}
    >
      {box.background === "white" && (
        <div
          className="edit-box-fill"
          style={{ position: "absolute", inset: 0, background: "#ffffff", pointerEvents: "none" }}
          aria-hidden
        />
      )}
      <div
        className="edit-box-text"
        data-edit-box-text-mirror={box.text}
        style={{
          position: "absolute",
          inset: 0,
          padding: "3px 3px",
          // DEF-263 — the stored indent insets the content box: every line
          // starts at the indented edge (the engine's `contentX`).
          paddingLeft: `${3 + layout.indentPx}px`,
          overflow: "hidden",
          pointerEvents: "none",
          ...liveTextBlockStyle({
            style: box.style,
            cssScale,
            fontSizePx: layout.fontSizePx,
          }),
        }}
        aria-hidden
      >
        {layout.lines.map((line) => (
          <div
            key={line.key}
            className="edit-box-line"
            data-edit-box-line={String(line.index)}
            style={{
              whiteSpace: "nowrap",
              ...liveTextLineStyle({ style: box.style, layout, isLast: line.isLast }),
            }}
          >
            <span
              className="edit-box-line-band"
              style={liveTextBandStyle({ style: box.style, cssScale })}
            >
              {line.prefix !== "" && (
                <span className="edit-box-line-prefix">{line.prefix}</span>
              )}
              {line.text}
            </span>
          </div>
        ))}
      </div>
      {selected && (
        // Phase 117 (chunk D) — the committed text box's selection chrome is
        // the ONE shared `SelectionChrome`; `data-edit-box-handle` survives on
        // each handle as the stable selector. No rotate handle: the engine has
        // no object-rotation op (only per-page quarter turns).
        <SelectionChrome
          left={0}
          top={0}
          width={box.rect.width * cssScale}
          height={box.rect.height * cssScale}
          kind="textBox"
          state="selected"
          handles
          handleDataAttr="data-edit-box-handle"
          onHandlePointerDown={(e, h): void => {
            e.stopPropagation();
            onPointerDownHandle(e, h);
          }}
        />
      )}
    </div>
  );
}

interface PlacementToolbarProps {
  placement: ImagePlacement;
  cropping: boolean;
  cssScale: number;
  pageWidthPt: number;
  /** Phase 48 (item 3) — page height, for the bottom-edge clamp. */
  pageHeightPt: number;
  onReplace: () => void;
  onCrop: () => void;
  onDelete: () => void;
}

/** DEF-135/136 + DEF-152 — placement toolbar for a SELECTED COMMITTED
 *  text box. Anchored just under the box (like the image
 *  PlacementToolbar) with three actions: Confirm commits a pending
 *  move (the box's drag used to commit implicitly on pointerup — now
 *  it parks a pending move that this button confirms), Delete routes
 *  through `onDeleteTextBox` (the host's engine.deleteTextBox), and
 *  Phase 37 (item 11) Cancel reverts the pending move / discards the
 *  live session. The old Edit verb is gone: selecting the box already
 *  makes it the panel Text target. The bar stops the pointerdown so a
 *  button press never starts a drag-to-create on the page behind it.
 *  The buttons reuse the SHARED content-action-bar chrome (DEF-153
 *  consistency); the legacy `data-edit-box-action` attributes stay as
 *  stable selectors. */
interface TextBoxToolbarProps {
  box: TextBoxPlacement;
  cssScale: number;
  pageWidthPt: number;
  /** Phase 48 (item 3) — page height, so the bar clamps into the
   *  page's bottom edge instead of rendering below it. */
  pageHeightPt: number;
  onConfirm: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

function TextBoxToolbar(props: TextBoxToolbarProps): ReactElement {
  const { box, cssScale, pageWidthPt, pageHeightPt, onConfirm, onDelete, onCancel } = props;
  // TFL-987 — adopt the shared ContextToolbox primitive. The bar anchors in
  // the PAGE VIEW's coordinate space (so it clamps into the page edge and
  // flips above/below at exactly the same threshold as the legacy bar), so
  // we pass the page-view box plus the historical fixed size. Cancel is an
  // existing revert action, so ContextToolbox also wires Escape through
  // onClose (no new transaction cancel is invented).
  // Phase 117 (chunk D) — the primary row is Confirm + Cancel + Delete.
  // TFL-1573 — the red Delete is now a direct sibling of Confirm (the More
  // control was removed) so no extra click layer stands between the user and
  // the destructive verb. Every `data-edit-box-action` selector survives.
  return (
    <ContextToolbox
      open
      anchor={{
        left: box.rect.x * cssScale,
        top: box.rect.y * cssScale,
        bottom: (box.rect.y + box.rect.height) * cssScale,
        right: (box.rect.x + box.rect.width) * cssScale,
      }}
      ariaLabel="Text box actions"
      onClose={onCancel}
      className="content-action-bar edit-box-toolbar"
      coordinateSpace="page-view"
      size={{ width: 200, height: CONTROL_BAR_HEIGHT }}
      viewport={{ width: pageWidthPt * cssScale, height: pageHeightPt * cssScale }}
      dataAttributes={{ "data-edit-box-id": box.id, "data-edit-box-toolbar": "true" }}
    >
      <button
        type="button"
        className="btn btn-primary toolbox-action-btn toolbox-action-btn--confirm edit-box-toolbar-btn"
        onClick={onConfirm}
        data-edit-box-action="confirm"
        aria-label="Confirm move"
        title="Confirm the moved position"
      >
        Confirm
      </button>
      <button
        type="button"
        className="btn btn-secondary toolbox-action-btn toolbox-action-btn--cancel edit-box-toolbar-btn"
        onClick={onCancel}
        data-edit-box-action="cancel"
        aria-label="Cancel text box changes"
        title="Cancel (revert the move)"
      >
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-danger toolbox-action-btn toolbox-action-btn--delete edit-box-toolbar-btn edit-box-toolbar-btn-danger"
        onClick={onDelete}
        data-edit-box-action="delete"
        data-content-action="editbox-delete"
        aria-label="Delete text box"
        title="Delete text box"
      >
        Delete
      </button>
    </ContextToolbox>
  );
}

function PlacementToolbar(props: PlacementToolbarProps): ReactElement {
  const { placement, cropping, cssScale, pageWidthPt, pageHeightPt, onReplace, onCrop, onDelete } = props;
  // TFL-987 — adopt the shared ContextToolbox primitive in the PAGE VIEW's
  // coordinate space, preserving the legacy clamp and above/below flip
  // exactly. There is no cancel/revert action on this bar, so no onClose is
  // wired and ContextToolbox owns Escape only when the host supplies one.
  // Phase 117 (chunk D) — Replace + Crop + Remove are all in the primary row.
  // TFL-1573 — the red Remove is now a direct sibling of Replace/Crop (the
  // More control was removed) so no extra click layer stands between the user
  // and the destructive verb.
  return (
    <ContextToolbox
      open
      anchor={{
        left: placement.rect.x * cssScale,
        top: placement.rect.y * cssScale,
        bottom: (placement.rect.y + placement.rect.height) * cssScale,
        right: (placement.rect.x + placement.rect.width) * cssScale,
      }}
      ariaLabel="Image placement actions"
      className="edit-image-toolbar"
      coordinateSpace="page-view"
      size={{ width: 220, height: CONTROL_BAR_HEIGHT }}
      viewport={{ width: pageWidthPt * cssScale, height: pageHeightPt * cssScale }}
      dataAttributes={{ "data-placement-id": placement.id }}
    >
      <button
        type="button"
        className="btn btn-secondary toolbox-action-btn edit-image-toolbar-btn"
        onClick={onReplace}
        aria-label="Replace image"
        title="Replace image"
      >
        Replace
      </button>
      <button
        type="button"
        className={cropping ? "btn btn-toggle toolbox-action-btn edit-image-toolbar-btn edit-image-toolbar-btn-active" : "btn btn-toggle toolbox-action-btn edit-image-toolbar-btn"}
        onClick={onCrop}
        aria-label="Crop image"
        title="Crop image"
        aria-pressed={cropping}
        data-crop-toggle
      >
        Crop
      </button>
      <button
        type="button"
        className="btn btn-danger toolbox-action-btn toolbox-action-btn--delete edit-image-toolbar-btn edit-image-toolbar-btn-danger"
        onClick={onDelete}
        data-content-action="image-delete"
        aria-label="Remove image"
        title="Remove from edit list"
      >
        Remove
      </button>
    </ContextToolbox>
  );
}

interface CropOverlayProps {
  imageRect: { x: number; y: number; width: number; height: number };
  crop: CropDragState | null;
  cssScale: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

function CropOverlay(props: CropOverlayProps): ReactElement {
  const { imageRect, crop, cssScale, onPointerDown, onPointerMove, onPointerUp } = props;
  const style: CSSProperties = {
    position: "absolute",
    left: imageRect.x * cssScale,
    top: imageRect.y * cssScale,
    width: imageRect.width * cssScale,
    height: imageRect.height * cssScale,
  };
  let marqueeStyle: CSSProperties | null = null;
  if (crop !== null) {
    const x = Math.min(crop.from.x, crop.to.x);
    const y = Math.min(crop.from.y, crop.to.y);
    const w = Math.abs(crop.to.x - crop.from.x);
    const h = Math.abs(crop.to.y - crop.from.y);
    marqueeStyle = {
      left: (x - imageRect.x) * cssScale,
      top: (y - imageRect.y) * cssScale,
      width: w * cssScale,
      height: h * cssScale,
    };
  }
  return (
    <div
      className="edit-image-crop-overlay"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e): void => {
        onPointerUp(e);
      }}
    >
      {marqueeStyle !== null && <div className="edit-image-crop-marquee" style={marqueeStyle} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: bytes -> object URL (memoized per placement so the same
// placement doesn't churn through createObjectURL on every render).
//
// The URL is valid until the placement is removed (the GC will
// reclaim it then). createObjectURL leaks otherwise — the test
// suite would surface this as a growing `URL.createObjectURL` call
// count. We use a module-level cache keyed by the bytes' identity
// (we never have two distinct placements with the same bytes in
// practice; even if we did, reusing the URL is safe).

const urlCache = new WeakMap<Uint8Array, string>();

function bytesToObjectURL(bytes: Uint8Array, format: "png" | "jpeg"): string {
  const existing = urlCache.get(bytes);
  if (existing !== undefined) return existing;
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: format === "png" ? "image/png" : "image/jpeg",
  });
  const url = URL.createObjectURL(blob);
  urlCache.set(bytes, url);
  return url;
}
