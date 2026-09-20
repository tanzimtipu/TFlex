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
import { TfBar } from "../components/motion/TfMotion";
import {
  ContentActionBar,
} from "../components/selectableContent";
import {
  fitTextBoxFontSizePx,
  measureTextWidthCss,
} from "./rasterize";

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
  const [boxDrag, setBoxDrag] = useState<BoxDragState | null>(null);
  const [imageDrag, setImageDrag] = useState<ImageDragState | null>(null);
  const [textBoxDrag, setTextBoxDrag] = useState<TextBoxDragState | null>(null);
  // DEF-152 — a real move drag on a committed box now parks a PENDING
  // move instead of committing on pointerup: the box's registry rect
  // follows the drag live, but the ENGINE move only happens when the
  // box's action bar Confirm is pressed (the bar now carries
  // Confirm / Edit / Delete). While pending, the white eraser cover
  // (DEF-155) stays mounted so the OLD baked rect never flashes
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
    rect: { x: number; y: number; width: number; height: number };
    text: string;
  } | null>(null);
  // DEF-153 — the text tool's SELECTED (movable) text run. Single
  // click selects the run + shows the Confirm/Edit/Delete bar;
  // double click opens the inline editor. The run's rect is the
  // move target; a drag parks a pending run move committed by the
  // bar's Confirm (onCommitTextEdit with oldRect).
  const [runSelection, setRunSelection] = useState<{
    rect: { x: number; y: number; width: number; height: number };
    text: string;
  } | null>(null);
  const [pendingRunMove, setPendingRunMove] = useState<{
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
    text: string;
  } | null>(null);
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
    setPendingTextBoxMove(null);
    setPendingRunEdit(null);
  }, [tool, page]);

  // DEF-149(b) / DEF-150 — every time the inline editor opens (the
  // `textTarget` identity changes) its drag offset resets to zero;
  // the drag offset only accumulates while that editor session is
  // open, so a fresh open never commits a stale position.
  useEffect(() => {
  }, [textTarget]);

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
        placement: { id, page, rect: { ...rect }, text: "", style: { ...style }, background: "white" },
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
    const target = textTarget;
    if (target === null || target.kind !== "run") return;
    const next = runLiveRef.current;
    if (next === null || next === target.text) return;
    setPendingRunEdit({ rect: { ...target.rect }, text: next });
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

  /** DEF-153 — SINGLE click on a text run SELECTS it and makes it
   *  movable (the Confirm / Edit action bar + move drag + hint);
   *  the inline editor opens on DOUBLE click (or the bar's Edit).
   *  The engine for both paths is the same hit-test: pick the run
   *  matching the newest committed text at the click point (DEFF-149(a)). */
  const runAtPoint = useCallback(
    (pt: { x: number; y: number }): TextItemGeom | null => {
      const items = getTextItems();
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
    [edit.committedTextRuns, page, getTextItems],
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
      const items = getTextItems();
      const hit = items.find(
        (it) =>
          x >= it.x - 2 &&
          x <= it.x + it.width + 2 &&
          y >= it.y - 2 &&
          y <= it.y + it.height + 2,
      );
      setHoverRect(hit === undefined ? null : { ...hit });
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
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (target !== null && typeof target.closest === "function") {
        const interactive = target.closest(
          ".edit-inline-editor, .edit-image-toolbar, .edit-image-placement, .edit-image-crop-overlay, .content-action-bar, button, input, textarea, select, [role='button'], .ann-editor, .ann-note, .sig-action-bar, .sig-pending",
        );
        if (interactive !== null) return;
      }
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
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [tool, cssScale, getTextItems, runAtPoint, pageWidthPt, pageHeightPt]);

  // Pointer handlers -----------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    // Don't start a drag from inside the editor.
    if ((e.target as HTMLElement).closest(".edit-inline-editor") !== null) return;
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
        setRunSelection({ rect: { ...chosen }, text: chosen.text });
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
        setRunSelection((prev) => (prev === null ? prev : { ...prev, rect: { ...d.startRect } }));
        return;
      }
      movedRef.current = true;
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
      return { ...pendingRunEdit.rect };
    }
    if (textTarget !== null && textTarget.kind === "box") {
      return { ...textTarget.rect };
    }
    if (textTarget !== null && textTarget.kind === "run" && textTarget.text.length > 0) {
      return { ...textTarget.rect };
    }
    return null;
  })();

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
      {tool === "text" && runSelection !== null && (
        <div
          className="edit-text-hover edit-textrun-selection"
          data-textrun-selection
          data-textrun-text={runSelection.text}
          style={overlayRectToCss(runSelection.rect, cssScale)}
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
              onConfirm={(): void => {
                if (pendingTextBoxMove === null) {
                  // No pending move — Confirm commits the selection
                  // (closes the bar; nothing else changed).
                  dispatch({ type: "select-text-box", textBoxId: null });
                  return;
                }
                if (pendingTextBoxMove.id !== box.id) return;
                // DEF-152 — Confirm commits the PENDING move through
                // the engine; the bar + eraser stay mounted until the
                // engine mask + proxy refresh resolve (DEF-155).
                void confirmPendingBoxMove();
              }}
              onEdit={(): void => {
                // Phase 26 — make this box the panel Text field's target
                // (the inline editor is retired).
                setTextTarget({
                  kind: "box",
                  id: box.id,
                  page,
                  rect: { ...box.rect },
                  text: box.text,
                });
              }}
              onDelete={(): void => {
                setPendingTextBoxMove(null);
                onDeleteTextBox?.(box.id);
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
          left={Math.max(0, Math.min(runSelection.rect.x * cssScale, pageWidthPt * cssScale - 240))}
          top={(runSelection.rect.y + runSelection.rect.height) * cssScale + 4}
          onConfirm={(): void => {
            if (pendingRunMove === null) {
              setRunSelection(null);
              setPendingRunMove(null);
              return;
            }
            const p = pendingRunMove;
            const style: EditTextStyle = {
              font: defaultFont,
              size: Math.round(p.oldRect.height * 0.8),
              color: { r: 0, g: 0, b: 0 },
            };
            const moved = !rectsClose(p.newRect, p.oldRect, 1);
            // Phase-C smooth commit — keep the white cover over the
            // run's ORIGINAL rect until the engine mask + proxy
            // refresh resolve (same timing contract as the editor
            // commit above). The selection closes immediately; the
            // cover releases when the host's promise lands.
            setPendingRunEdit({ rect: { ...p.oldRect }, text: p.text });
            const res = onCommitTextEdit({
              rect: { ...p.newRect },
              newText: p.text,
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
              run: { page, rect: { ...p.newRect }, text: p.text },
            });
            setRunSelection(null);
            setPendingRunMove(null);
          }}
          onEdit={(): void => {
            // Phase 26 — make this run the panel Text field's target
            // (the inline editor is retired).
            setTextTarget({
              kind: "run",
              id: "",
              page,
              rect: { ...runSelection.rect },
              text: runSelection.text,
            });
          }}
          onDelete={(): void => {
            const style: EditTextStyle = {
              font: defaultFont,
              size: Math.round(runSelection.rect.height * 0.8),
              color: { r: 0, g: 0, b: 0 },
            };
            onCommitTextEdit({
              rect: { ...runSelection.rect },
              newText: "",
              style,
              // DEF-232 — target the engine at THIS overlay's page.
              page,
            });
            setRunSelection(null);
            setPendingRunMove(null);
          }}
          confirmLabel="Confirm"
          editLabel="Edit"
          deleteLabel="Delete"
          confirmTitle="Confirm the move"
          editTitle="Edit text"
          deleteTitle="Delete text (mask)"
          confirmAria="Confirm text run move"
          editAria="Edit text run"
          deleteAria="Delete text run"
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
          position on every keystroke. No in-canvas editor exists. */}
      {tool === "text" && textTarget !== null && textTarget.kind === "run" &&
        textLive !== undefined && textLive !== null && textLive.length > 0 && (
          <div
            className="edit-run-live-preview"
            data-edit-run-preview
            aria-hidden
            style={{
              ...overlayRectToCss(textTarget.rect, cssScale),
              color: colorToHex((textStyle ?? defaultEditTextStyle(defaultFont)).color),
              fontSize: (textStyle ?? defaultEditTextStyle(defaultFont)).size * cssScale,
              fontFamily: fontFamilyFor((textStyle ?? defaultEditTextStyle(defaultFont)).font),
              letterSpacing: `${((textStyle ?? defaultEditTextStyle(defaultFont)).charSpacing ?? 0) * cssScale}px`,
              lineHeight: 1.2,
              whiteSpace: "pre-wrap",
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {textLive}
          </div>
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
  onPointerDownHandle: (e: ReactPointerEvent<HTMLDivElement>, handle: ImageResizeHandle) => void;
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
        <>
          {(["nw", "ne", "sw", "se"] as const).map((h) => (
            <div
              key={h}
              className={`edit-image-handle edit-image-handle-${h}`}
              data-handle={h}
              onPointerDown={(e): void => onPointerDownHandle(e, h)}
            />
          ))}
        </>
      )}
      {/* Marker rendered during a resize drag so the user sees
          a thin border without the dashed selected border being
          misleading. */}
      {isResizing && <div className="edit-image-placement-resizing" />}
    </div>
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
  onPointerDownHandle: (e: ReactPointerEvent<HTMLDivElement>, handle: ImageResizeHandle) => void;
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
  // height. The previous `box.style.size * cssScale` rendered a large
  // default font inside a small box with overflow:hidden, clipping the
  // committed text to the first couple of characters while the full
  // string stayed intact in the textLayer.
  const fittedFontSizePx = useMemo(() => {
    const boxWidthCss = box.rect.width * cssScale;
    const boxHeightCss = box.rect.height * cssScale;
    const fontFamily = fontFamilyFor(box.style.font);
    const charSpacingPx = (box.style.charSpacing ?? 0) * cssScale;
    return fitTextBoxFontSizePx({
      text: box.text,
      userSizePx: box.style.size * cssScale,
      // The mirror's padding is "2px 3px" (2 vertical, 3 horizontal).
      boxWidthPx: Math.max(1, boxWidthCss - 6),
      boxHeightPx: Math.max(1, boxHeightCss - 4),
      lineHeight: 1.2,
      // Phase 27 — tracking counts toward the wrap/fit width, mirroring
      // the engine's charSpacing-aware measurement.
      measure: (t, s): number =>
        measureTextWidthCss(t, fontFamily, s) +
        charSpacingPx * Math.max(0, Array.from(t).length - 1),
    });
  }, [box.text, box.style.font, box.style.size, box.style.charSpacing, box.rect.width, box.rect.height, cssScale]);
  return (
    <div
      className={
        selected
          ? "edit-box edit-box-selected"
          : "edit-box"
      }
      data-edit-box-id={box.id}
      data-edit-box-text={box.text}
      data-edit-box-font-size={String(Math.round(fittedFontSizePx * 100) / 100)}
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
          padding: "2px 3px",
          color: colorToHex(box.style.color),
          fontFamily: fontFamilyFor(box.style.font),
          fontSize: `${fittedFontSizePx}px`,
          letterSpacing: `${(box.style.charSpacing ?? 0) * cssScale}px`,
          lineHeight: 1.2,
          overflow: "hidden",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          pointerEvents: "none",
        }}
        aria-hidden
      >
        {box.text}
      </div>
      {selected &&
        (["nw", "ne", "sw", "se"] as const).map((h) => (
          <div
            key={h}
            className={`edit-box-handle edit-box-handle-${h}`}
            data-edit-box-handle={h}
            onPointerDown={(e): void => onPointerDownHandle(e, h)}
          />
        ))}
    </div>
  );
}

interface PlacementToolbarProps {
  placement: ImagePlacement;
  cropping: boolean;
  cssScale: number;
  pageWidthPt: number;
  onReplace: () => void;
  onCrop: () => void;
  onDelete: () => void;
}

/** DEF-135/136 + DEF-152 — placement toolbar for a SELECTED COMMITTED
 *  text box. Anchored just under the box (like the image
 *  PlacementToolbar) with three actions: Confirm commits a pending
 *  move (the box's drag used to commit implicitly on pointerup — now
 *  it parks a pending move that this button confirms), Edit reopens
 *  the inline editor with the box's committed content, Delete routes
 *  through `onDeleteTextBox` (the host's engine.deleteTextBox). The
 *  bar stops the pointerdown so a button press never starts a
 *  drag-to-create on the page behind it. The buttons reuse the
 *  SHARED content-action-bar chrome (DEF-153 consistency); the
 *  legacy `data-edit-box-action` attributes stay as stable
 *  selectors. */
interface TextBoxToolbarProps {
  box: TextBoxPlacement;
  cssScale: number;
  pageWidthPt: number;
  onConfirm: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TextBoxToolbar(props: TextBoxToolbarProps): ReactElement {
  const { box, cssScale, pageWidthPt, onConfirm, onEdit, onDelete } = props;
  // Position the toolbar just under the box, anchored to its left
  // edge. Clamp inside the page.
  const topPt = box.rect.y + box.rect.height + 4;
  const leftPt = box.rect.x;
  const topCss = topPt * cssScale;
  const leftCss = Math.max(0, Math.min(leftPt * cssScale, pageWidthPt * cssScale - 200));
  return (
    <TfBar
      className="content-action-bar edit-box-toolbar"
      data-edit-box-id={box.id}
      data-edit-box-toolbar
      style={{ left: leftCss, top: topCss }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      <button
        type="button"
        className="toolbox-action-btn toolbox-action-btn--confirm edit-box-toolbar-btn"
        onClick={onConfirm}
        data-edit-box-action="confirm"
        aria-label="Confirm move"
        title="Confirm the moved position"
      >
        Confirm
      </button>
      <button
        type="button"
        className="toolbox-action-btn edit-box-toolbar-btn"
        onClick={onEdit}
        data-edit-box-action="edit"
        aria-label="Edit text box"
        title="Edit text"
      >
        Edit
      </button>
      <button
        type="button"
        className="toolbox-action-btn toolbox-action-btn--delete edit-box-toolbar-btn edit-box-toolbar-btn-danger"
        onClick={onDelete}
        data-edit-box-action="delete"
        aria-label="Delete text box"
        title="Delete text box"
      >
        Delete
      </button>
    </TfBar>
  );
}

function PlacementToolbar(props: PlacementToolbarProps): ReactElement {
  const { placement, cropping, cssScale, pageWidthPt, onReplace, onCrop, onDelete } = props;
  // Position the toolbar just under the placement, anchored to the
  // placement's left edge. Clamp inside the page.
  const topPt = placement.rect.y + placement.rect.height + 4;
  const leftPt = placement.rect.x;
  const topCss = topPt * cssScale;
  const leftCss = Math.max(0, Math.min(leftPt * cssScale, pageWidthPt * cssScale - 220));
  return (
    <TfBar
      className="edit-image-toolbar"
      data-placement-id={placement.id}
      style={{ left: leftCss, top: topCss }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      <button
        type="button"
        className="toolbox-action-btn edit-image-toolbar-btn"
        onClick={onReplace}
        aria-label="Replace image"
        title="Replace image"
      >
        Replace
      </button>
      <button
        type="button"
        className={cropping ? "toolbox-action-btn edit-image-toolbar-btn edit-image-toolbar-btn-active" : "toolbox-action-btn edit-image-toolbar-btn"}
        onClick={onCrop}
        aria-label="Crop image"
        title="Crop image"
        data-crop-toggle
      >
        Crop
      </button>
      <button
        type="button"
        className="toolbox-action-btn toolbox-action-btn--delete edit-image-toolbar-btn edit-image-toolbar-btn-danger"
        onClick={onDelete}
        aria-label="Remove image"
        title="Remove from edit list"
      >
        Remove
      </button>
    </TfBar>
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
