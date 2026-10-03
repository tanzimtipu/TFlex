// Phase 18 — Watermark tool dialog.
//
// Configure a text or image watermark (typography, color, opacity,
// position or explicit coordinates, tiling, page range), preview it
// live on a page-shaped frame, then confirm. The host calls
// `engine.addWatermark(docId, settings)` with the shared
// `WatermarkSettings` payload; the engine bakes the watermark into the
// selected pages' content streams. Each application is an individually
// addressable watermark (id `wm-N`): the dialog also lists the
// document's applied watermarks (`engine.getWatermarks`) and can remove
// one by id (`engine.deleteWatermark`).
//
// The dialog owns its own state and the live preview; it does NOT
// touch the engine. Image watermarks pick PNG/JPEG files in the
// renderer via `pickImageFilesInRenderer` (the renderer has no `fs`
// access — same pattern as Create-from-images).

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import { ImagePlus } from "lucide-react";
import { Icon } from "../icons/Icon";
import { DialogShell } from "./DialogShell";
import {
  pickImageFilesInRenderer,
  readFileBytes,
} from "../utils/pickImageFiles";
import type {
  EditColor,
  EditFont,
  WatermarkInfo,
  WatermarkPosition,
  WatermarkSettings,
  WatermarkType,
} from "../../shared/types";

/** The nine grid slots, row-major. Drives the 3x3 position picker. */
const POSITION_SLOTS: WatermarkPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

/** Frame width of the live preview in px. The frame keeps a
 *  Letter-page aspect (612x792 pt), so 1 pt maps to
 *  PREVIEW_FRAME_W / 612 px. */
const PREVIEW_FRAME_W = 150;
const PREVIEW_FRAME_H = Math.round((PREVIEW_FRAME_W * 792) / 612);
const PT_TO_PREVIEW_PX = PREVIEW_FRAME_W / 612;

/** Phase 45 (item 7) — the sane bounds for an explicit watermark placement, in
 *  PDF points (top-left origin). PDF user space is capped at 14400 units (200
 *  inches); the engine itself accepts any finite signed value
 *  (`normalizeWatermarkSettings`: x/y either present -> both required, finite),
 *  so the dialog screens out the obviously-wrong (blank, NaN, out-of-page)
 *  input before the payload reaches the engine. */
export const MIN_WATERMARK_COORD = 0;
export const MAX_WATERMARK_COORD = 14400;

/** Parse one custom coordinate input. Returns null when the field is blank or
 *  not a finite number inside the sane bounds, so the caller reports the error. */
export function parseWatermarkCoord(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < MIN_WATERMARK_COORD || n > MAX_WATERMARK_COORD) {
    return null;
  }
  return n;
}

/** Map the three bundled standard fonts to the closest CSS family for
 *  the live preview (the engine uses the pdf-lib standard fonts). */
const FONT_CSS: Record<EditFont, string> = {
  Helvetica: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  Times: "Georgia, 'Times New Roman', serif",
  Courier: "'Courier New', Courier, monospace",
  "Liberation Sans": "'Liberation Sans', Arial, sans-serif",
  "DejaVu Serif": "'DejaVu Serif', Georgia, serif",
  "DejaVu Sans Mono": "'DejaVu Sans Mono', Consolas, monospace",
};

const DEFAULT_COLOR: EditColor = { r: 0.635, g: 0.635, b: 0.667 }; // zinc-400

interface WatermarkDialogProps {
  open: boolean;
  /** Total pages on the active doc. Drives the page-range validation. */
  totalPages: number;
  /** 1-based visible page the user is on; seeds the range start when
   *  the user picks a custom range. */
  currentPage: number;
  /** Fires when the user confirms. The host calls
   *  `engine.addWatermark` with the shared settings payload. */
  onConfirm: (settings: WatermarkSettings) => void;
  onClose: () => void;
  /** The watermarks the engine reports for the active document
   *  (one record per applied watermark, ids like `wm-1`). Rendered
   *  in the "Applied watermarks" section when non-empty. */
  watermarks: WatermarkInfo[];
  /** Fires when the user deletes one applied watermark by id. The
   *  host calls `engine.deleteWatermark` with it. */
  onDeleteWatermark: (id: string) => void;
  /** DEF-219 — id whose delete is currently in flight. That row's
   *  Delete button is disabled (`aria-busy="true"`) until the host
   *  clears it, so a double click cannot fire a second delete for an
   *  already-deleted watermark. */
  busyWatermarkId?: string | null;
}

function hexToColor(hex: string): EditColor {
  const n = parseInt(hex.slice(1, 7), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function colorToHex(c: EditColor): string {
  const h = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** CSS placement for one grid slot on the preview frame (percent
 *  insets from the frame edges; the frame is `position: relative`).
 *  The engine uses a 10% margin, the preview 8% so the content
 *  visibly clears the frame edge. */
function slotStyle(slot: WatermarkPosition, extra: CSSProperties): CSSProperties {
  const s: CSSProperties = { ...extra };
  switch (slot) {
    case "top-left":
      s.top = "8%";
      s.left = "8%";
      break;
    case "top-center":
      s.top = "8%";
      s.left = "50%";
      s.transform = "translateX(-50%)";
      break;
    case "top-right":
      s.top = "8%";
      s.right = "8%";
      break;
    case "center-left":
      s.top = "50%";
      s.left = "8%";
      s.transform = "translateY(-50%)";
      break;
    case "center":
      s.top = "50%";
      s.left = "50%";
      s.transform = "translate(-50%, -50%)";
      break;
    case "center-right":
      s.top = "50%";
      s.right = "8%";
      s.transform = "translateY(-50%)";
      break;
    case "bottom-left":
      s.bottom = "8%";
      s.left = "8%";
      break;
    case "bottom-center":
      s.bottom = "8%";
      s.left = "50%";
      s.transform = "translateX(-50%)";
      break;
    case "bottom-right":
      s.bottom = "8%";
      s.right = "8%";
      break;
  }
  return s;
}

export function WatermarkDialog(props: WatermarkDialogProps): ReactElement {
  const {
    open,
    totalPages,
    currentPage,
    onConfirm,
    onClose,
    watermarks,
    onDeleteWatermark,
    busyWatermarkId = null,
  } = props;
  const [type, setType] = useState<WatermarkType>("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [font, setFont] = useState<EditFont>("Helvetica");
  const [size, setSize] = useState(48);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [color, setColor] = useState<EditColor>(DEFAULT_COLOR);
  const [opacity, setOpacity] = useState(0.5);
  const [position, setPosition] = useState<WatermarkPosition>("center");
  const [customXY, setCustomXY] = useState(false);
  const [xInput, setXInput] = useState("");
  const [yInput, setYInput] = useState("");
  const [tile, setTile] = useState(false);
  const [rangeAll, setRangeAll] = useState(true);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(1);
  const [imageBytes, setImageBytes] = useState<Uint8Array | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed on open: fresh defaults, range seeds from the current page
  // (the natural pick is "watermark the page I'm on" when the user
  // narrows the range).
  useEffect(() => {
    if (!open) return;
    setType("text");
    setText("CONFIDENTIAL");
    setFont("Helvetica");
    setSize(48);
    setBold(false);
    setItalic(false);
    setUnderline(false);
    setColor(DEFAULT_COLOR);
    setOpacity(0.5);
    setPosition("center");
    setCustomXY(false);
    setXInput("");
    setYInput("");
    setTile(false);
    setRangeAll(true);
    setRangeFrom(Math.max(1, Math.min(currentPage, Math.max(1, totalPages))));
    setRangeTo(Math.max(1, Math.min(currentPage, Math.max(1, totalPages))));
    setError(null);
  }, [open, currentPage, totalPages]);

  // Revoke the object URL for the picked image on replace / unmount.
  useEffect(() => {
    return () => {
      if (imageUrl !== null) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const onPickImage = (): void => {
    void (async (): Promise<void> => {
      try {
        const picked = await pickImageFilesInRenderer();
        const file = picked.files[0];
        if (file === undefined) return; // cancelled
        const bytes = await readFileBytes(file);
        if (bytes.byteLength === 0) {
          setError("The picked image is empty.");
          return;
        }
        setImageBytes(bytes);
        setImageName(file.name);
        if (typeof URL.createObjectURL === "function") {
          setImageUrl(URL.createObjectURL(file));
        }
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Could not read the image: ${msg}`);
      }
    })();
  };

  /** Phase 45 (item 7) — ticking "Custom position (X, Y)" disables the
   *  predefined grid (visibly disabled, never hidden) and enables the two
   *  coordinate inputs. Tiling and an explicit placement are mutually
   *  exclusive, so ticking custom clears tiling. `position` is never cleared,
   *  so unticking restores the previously selected grid slot. */
  const onToggleCustomXY = (checked: boolean): void => {
    setCustomXY(checked);
    if (checked) {
      setTile(false);
      // Seed a neutral 1-inch (72pt) placement so the ticked state is
      // immediately valid and previewable instead of blank fields.
      setXInput((v): string => (v.trim() === "" ? "72" : v));
      setYInput((v): string => (v.trim() === "" ? "72" : v));
      setError(null);
    }
  };

  const onConfirmClick = (): void => {
    setError(null);
    if (type === "text" && text.trim().length === 0) {
      setError("Enter the watermark text.");
      return;
    }
    const image = imageBytes;
    if (type === "image" && image === null) {
      setError("Pick an image (PNG or JPEG) to watermark with.");
      return;
    }
    let range: [number, number] | undefined;
    if (!rangeAll) {
      if (!(rangeFrom >= 1 && rangeTo >= rangeFrom)) {
        setError("The page range start must be at least 1 and the end at least the start.");
        return;
      }
      if (totalPages > 0 && rangeTo > totalPages) {
        setError(`The page range end cannot exceed the document's ${totalPages} pages.`);
        return;
      }
      range = [rangeFrom, rangeTo];
    }
    // DEF-217 — the dialog is deliberately stricter than the engine's
    // authoritative 1..2000 accepted range: a tiny font size (DEF-217's
    // unbounded tile loop) or an absurd drawn height must never reach
    // the engine from this dialog. Applies to both the text font size
    // and the image drawn height.
    if (!Number.isFinite(size) || size < 4 || size > 2000) {
      setError("The watermark size must be between 4 and 2000 points.");
      return;
    }
    const settings: WatermarkSettings = {
      type,
      opacity,
    };
    if (tile) {
      settings.tile = true;
      // Position and explicit x/y are ignored by the engine when tiling.
    } else if (customXY) {
      // Phase 45 (item 7) — the tick is the ONLY source of explicit coords:
      // both are required and must be finite points inside the sane bounds.
      const x = parseWatermarkCoord(xInput);
      const y = parseWatermarkCoord(yInput);
      if (x === null || y === null) {
        setError(
          `The custom X and Y must be numbers between ${MIN_WATERMARK_COORD} and ${MAX_WATERMARK_COORD} points.`,
        );
        return;
      }
      settings.x = x;
      settings.y = y;
    } else {
      settings.position = position;
    }
    if (type === "text") {
      settings.text = text.trim();
      settings.font = font;
      settings.size = size;
      settings.bold = bold;
      settings.italic = italic;
      settings.underline = underline;
      settings.color = color;
    } else {
      // Re-check inside the branch: TS only narrows `image` through a
      // direct test here (the up-front guard already returns for the
      // null-image case, this just satisfies the type checker).
      if (image === null) {
        setError("Pick an image (PNG or JPEG) to watermark with.");
        return;
      }
      settings.imageBytes = image;
      if (size > 0) settings.size = size;
    }
    if (range !== undefined) settings.range = range;
    onConfirm(settings);
  };

  return (
    <DialogShell
      open={open}
      title="Watermark"
      titleId="watermark-dialog-title"
      onClose={onClose}
      size="tool"
      data-watermark-dialog
      draggable={{ controlsSelector: "button, input, select, textarea, [role='button']" }}
      actions={[
        { key: "cancel", label: "Cancel", variant: "secondary", onClick: onClose },
        Object.assign(
          {
            key: "confirm",
            label: "Apply watermark",
            variant: "primary" as const,
            onClick: onConfirmClick,
            default: true,
          },
          { "data-watermark-confirm": true },
        ),
      ]}
    >
              <p className="modal-help">
                Overlay text or an image across the selected pages. The
                watermark is baked into the page content (undo removes it).
              </p>

              {/* Phase 45 item 6 — two columns so the dialog reads square
                  instead of a tall slab: fields on the left, live preview
                  and the applied list on the right. Collapses to one column
                  when the box is narrow. */}
              <div className="watermark-cols">
              <div className="watermark-col-fields">

              <fieldset className="modal-position">
                <legend>Content</legend>
                <label className="stamp-option">
                  <input
                    type="radio"
                    name="watermark-type"
                    checked={type === "text"}
                    onChange={(): void => setType("text")}
                    data-watermark-type="text"
                  />
                  <span className="stamp-option-text">
                    <span className="stamp-option-label">Text</span>
                    <span className="stamp-option-desc">
                      Draw a text string with the bundled standard fonts.
                    </span>
                  </span>
                </label>
                <label className="stamp-option">
                  <input
                    type="radio"
                    name="watermark-type"
                    checked={type === "image"}
                    onChange={(): void => setType("image")}
                    data-watermark-type="image"
                  />
                  <span className="stamp-option-text">
                    <span className="stamp-option-label">Image</span>
                    <span className="stamp-option-desc">
                      Embed a PNG or JPEG across the pages.
                    </span>
                  </span>
                </label>
              </fieldset>

              {type === "text" ? (
                <>
                  <label className="modal-field">
                    <span>Text</span>
                    <input
                      className="modal-input"
                      type="text"
                      value={text}
                      onChange={(e): void => setText(e.target.value)}
                      data-watermark-text
                    />
                  </label>
                  <div className="modal-row">
                    <label className="modal-field">
                      <span>Font</span>
                      <select
                        className="modal-input"
                        value={font}
                        onChange={(e): void => setFont(e.target.value as EditFont)}
                        data-watermark-font
                      >
                        <option value="Helvetica">Helvetica</option>
                        <option value="Times">Times</option>
                        <option value="Courier">Courier</option>
                      </select>
                    </label>
                    <label className="modal-field">
                      <span>Size (pt)</span>
                      <input
                        className="modal-input"
                        type="number"
                        min={4}
                        max={2000}
                        value={size}
                        onChange={(e): void => setSize(Number(e.target.value))}
                        data-watermark-size
                      />
                    </label>
                    <label className="modal-field">
                      <span>Color</span>
                      <input
                        className="watermark-color-input"
                        type="color"
                        value={colorToHex(color)}
                        onChange={(e): void => setColor(hexToColor(e.target.value))}
                        data-watermark-color
                      />
                    </label>
                  </div>
                  <div className="modal-row">
                    <label className="watermark-check">
                      <input
                        type="checkbox"
                        checked={bold}
                        onChange={(e): void => setBold(e.target.checked)}
                        data-watermark-bold
                      />
                      <span>Bold</span>
                    </label>
                    <label className="watermark-check">
                      <input
                        type="checkbox"
                        checked={italic}
                        onChange={(e): void => setItalic(e.target.checked)}
                        data-watermark-italic
                      />
                      <span>Italic</span>
                    </label>
                    <label className="watermark-check">
                      <input
                        type="checkbox"
                        checked={underline}
                        onChange={(e): void => setUnderline(e.target.checked)}
                        data-watermark-underline
                      />
                      <span>Underline</span>
                    </label>
                  </div>
                </>
              ) : (
                <div className="modal-field">
                  <span>Image</span>
                  <div className="modal-row">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onPickImage}
                      data-watermark-image-pick
                    >
                      <Icon icon={ImagePlus} size="sm" />
                      {imageName !== "" ? "Change image" : "Choose image"}
                    </button>
                    {imageName !== "" && (
                      <span className="watermark-image-name" data-watermark-image-name>
                        {imageName}
                      </span>
                    )}
                  </div>
                  <label className="modal-field">
                    <span>Height (pt, blank = 33% of page width)</span>
                    <input
                      className="modal-input"
                      type="number"
                      min={4}
                      max={2000}
                      value={size}
                      onChange={(e): void => setSize(Number(e.target.value))}
                      data-watermark-size
                    />
                  </label>
                </div>
              )}

              <label className="modal-field">
                <span>Opacity (%)</span>
                <input
                  className="modal-input"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(opacity * 100)}
                  onChange={(e): void => setOpacity(Number(e.target.value) / 100)}
                  data-watermark-opacity
                />
                <span className="modal-hint">
                  {Math.round(opacity * 100)}%
                </span>
              </label>

              <fieldset className="modal-position">
                <legend>Position</legend>
                {/* Phase 45 (item 7) — the custom-position tick sits WITH the
                    grid: ticking it disables (dims, never hides) the nine
                    predefined slots and enables the X/Y inputs. Unticking
                    restores the grid and its remembered selection. */}
                <label className="watermark-check">
                  <input
                    type="checkbox"
                    checked={customXY}
                    onChange={(e): void => onToggleCustomXY(e.target.checked)}
                    data-watermark-custom-xy
                  />
                  <span>Custom position (X, Y)</span>
                </label>
                <div className="watermark-position-grid" role="group" aria-label="Grid position">
                  {POSITION_SLOTS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={position === slot ? "watermark-slot watermark-slot-active" : "watermark-slot"}
                      onClick={(): void => setPosition(slot)}
                      aria-pressed={position === slot}
                      aria-label={slot}
                      title={customXY ? "Disabled while Custom position (X, Y) is ticked" : slot}
                      disabled={customXY}
                      data-watermark-position={slot}
                    >
                      <span className="watermark-slot-dot" />
                    </button>
                  ))}
                </div>
                <div className="modal-row">
                  <label className="modal-field">
                    <span>X (pt)</span>
                    <input
                      className="modal-input"
                      type="number"
                      min={MIN_WATERMARK_COORD}
                      max={MAX_WATERMARK_COORD}
                      step={1}
                      value={xInput}
                      disabled={!customXY}
                      onChange={(e): void => setXInput(e.target.value)}
                      data-watermark-x
                    />
                  </label>
                  <label className="modal-field">
                    <span>Y (pt)</span>
                    <input
                      className="modal-input"
                      type="number"
                      min={MIN_WATERMARK_COORD}
                      max={MAX_WATERMARK_COORD}
                      step={1}
                      value={yInput}
                      disabled={!customXY}
                      onChange={(e): void => setYInput(e.target.value)}
                      data-watermark-y
                    />
                  </label>
                  <label className="watermark-check">
                    <input
                      type="checkbox"
                      checked={tile}
                      onChange={(e): void => setTile(e.target.checked)}
                      disabled={customXY}
                      data-watermark-tile
                    />
                    <span>Tile across the page</span>
                  </label>
                </div>
                {customXY && (
                  <span className="modal-hint" data-watermark-custom-hint>
                    The preview places the watermark's top-left corner at X, Y
                    (measured from the page's top-left).
                  </span>
                )}
              </fieldset>

              <fieldset className="modal-position">
                <legend>Pages</legend>
                <label className="watermark-check">
                  <input
                    type="checkbox"
                    checked={rangeAll}
                    onChange={(e): void => setRangeAll(e.target.checked)}
                    data-watermark-range-all
                  />
                  <span>All pages</span>
                </label>
                <div className="modal-row">
                  <label className="modal-field">
                    <span>From</span>
                    <input
                      className="modal-input"
                      type="number"
                      min={1}
                      value={rangeFrom}
                      disabled={rangeAll}
                      onChange={(e): void => setRangeFrom(Number(e.target.value))}
                      data-watermark-range-from
                    />
                  </label>
                  <label className="modal-field">
                    <span>To</span>
                    <input
                      className="modal-input"
                      type="number"
                      min={1}
                      value={rangeTo}
                      disabled={rangeAll}
                      onChange={(e): void => setRangeTo(Number(e.target.value))}
                      data-watermark-range-to
                    />
                  </label>
                </div>
              </fieldset>

              </div>
              <div className="watermark-col-side">
              <section className="watermark-preview-wrap" aria-label="Watermark preview">
                <header className="watermark-preview-header">
                  <span className="stamp-preview-title">Preview</span>
                </header>
                <WatermarkPreview
                    type={type}
                    text={text}
                    font={font}
                    size={size}
                    bold={bold}
                    italic={italic}
                    color={color}
                    opacity={opacity}
                    position={position}
                    customXY={customXY}
                    customX={parseWatermarkCoord(xInput)}
                    customY={parseWatermarkCoord(yInput)}
                    tile={tile}
                    imageUrl={imageUrl}
                  />
              </section>

              {error !== null && (
                <div className="modal-status optimize-error" role="alert">
                  <span>{error}</span>
                </div>
              )}

              {watermarks.length > 0 && (
                <section className="watermark-applied" aria-label="Applied watermarks">
                  <h3 className="prefs-section-title">Applied watermarks</h3>
                  <div className="watermark-applied-list">
                    {watermarks.map((record) => {
                      const busy = busyWatermarkId === record.id;
                      return (
                        <div
                          key={record.id}
                          className="watermark-applied-row modal-row"
                          data-watermark-applied={record.id}
                        >
                          <span>{record.id}</span>
                          <span>{record.type === "text" ? record.text : "Image"}</span>
                          <span>Pages {record.pages.join(", ")}</span>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            data-watermark-delete={record.id}
                            disabled={busy}
                            aria-busy={busy}
                            onClick={(): void => onDeleteWatermark(record.id)}
                          >
                            Delete
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <span className="modal-hint">
                    Deleting removes that watermark from the document (undo restores it).
                  </span>
                </section>
              )}
              </div>
              </div>
    </DialogShell>
  );
}

/** Live, CSS-based preview of the watermark on a page-shaped frame.
 *  The frame keeps the Letter aspect (612x792 pt); content is placed
 *  by the same slot / size / opacity rules the engine applies, so the
 *  preview tracks every control change in real time. */
function WatermarkPreview(props: {
  type: WatermarkType;
  text: string;
  font: EditFont;
  size: number;
  bold: boolean;
  italic: boolean;
  color: EditColor;
  opacity: number;
  position: WatermarkPosition;
  /** Phase 45 (item 7) — explicit placement mode + values, or null when the
   *  field is blank / invalid (the grid slot then drives the preview). */
  customXY: boolean;
  customX: number | null;
  customY: number | null;
  tile: boolean;
  imageUrl: string | null;
}): ReactElement {
  const {
    type,
    text,
    font,
    size,
    bold,
    italic,
    color,
    opacity,
    position,
    customXY,
    customX,
    customY,
    tile,
    imageUrl,
  } = props;

  const contentStyle: CSSProperties = { opacity };
  if (type === "text") {
    const fontSize = Math.max(7, (size || 48) * PT_TO_PREVIEW_PX);
    Object.assign(contentStyle, {
      color: `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`,
      fontFamily: FONT_CSS[font],
      fontSize,
      fontWeight: bold ? 700 : 400,
      fontStyle: italic ? "italic" : "normal",
      whiteSpace: "nowrap",
    });
  }

  const renderContent = (style?: CSSProperties): ReactElement => {
    const s = style === undefined ? contentStyle : { ...contentStyle, ...style };
    if (type === "text") {
      return (
        <span className="watermark-preview-content" style={s} data-watermark-preview-text>
          {text.trim() === "" ? "(empty text)" : text}
        </span>
      );
    }
    if (imageUrl === null) {
      return (
        <span className="watermark-preview-content watermark-preview-missing" style={s} data-watermark-preview-missing>
          (no image picked)
        </span>
      );
    }
    const heightPx =
      size > 0 ? Math.max(8, size * PT_TO_PREVIEW_PX) : Math.round(PREVIEW_FRAME_W * 0.33);
    return (
      <img
        className="watermark-preview-content watermark-preview-image"
        style={{ ...s, height: heightPx, maxWidth: "90%" }}
        src={imageUrl}
        alt="Watermark image preview"
        data-watermark-preview-image
      />
    );
  };

  if (tile) {
    // Staggered grid, same character as the engine's tile layout.
    const cells: CSSProperties[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        cells.push({
          position: "absolute",
          top: `${8 + row * 38}%`,
          left: col === 0 ? (row % 2 === 0 ? "10%" : "22%") : "55%",
          opacity: opacity,
        });
      }
    }
    return (
      <div
        className="watermark-preview-frame"
        style={{ width: PREVIEW_FRAME_W, height: PREVIEW_FRAME_H }}
        data-watermark-preview="tile"
      >
        {cells.map((style, i) => (
          <div key={i} style={style}>
            {renderContent()}
          </div>
        ))}
      </div>
    );
  }

  const customPlaced = customXY && customX !== null && customY !== null;

  return (
    <div
      className="watermark-preview-frame"
      style={{ width: PREVIEW_FRAME_W, height: PREVIEW_FRAME_H }}
      data-watermark-preview="single"
    >
      {renderContent(
        customPlaced
          ? { left: customX * PT_TO_PREVIEW_PX, top: customY * PT_TO_PREVIEW_PX }
          : slotStyle(position, {}),
      )}
    </div>
  );
}