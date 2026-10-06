// Phase 89 (FEA-033) — the "Bates numbering" dialog.
//
// The dialog configures a sequential Bates stamp (prefix, suffix, start
// number, zero-padding and page position) and the 1-based pages to stamp,
// previews the composed labels live from the shared `src/shared/bates`
// model, then hands the built `BatesSettings` payload to the host, which
// runs `engine.addBates` and returns an honest outcome (the stamped count
// and labels, or a readable error). The dialog owns no engine state and
// never reaches around the host callback.

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { Button } from "./Button";
import { DialogShell, type DialogAction } from "./DialogShell";
import {
  buildBatesLabel,
  formatBatesSeries,
  isBatesCoord,
  MAX_BATES_COORD,
} from "../../shared/bates";
import type {
  BatesDefaults,
  BatesInfo,
  BatesSettings,
  EditFont,
  WatermarkPosition,
} from "../../shared/types";

/** The nine grid slots, row-major. Drives the 3x3 position chooser. */
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
 *  PREVIEW_FRAME_W / 612 px. Mirrors the Phase 18 watermark preview. */
const PREVIEW_FRAME_W = 150;
const PREVIEW_FRAME_H = Math.round((PREVIEW_FRAME_W * 792) / 612);
const PT_TO_PREVIEW_PX = PREVIEW_FRAME_W / 612;

/** Parse one custom coordinate input. Returns null when the field is blank or
 *  not a finite number inside the sane bounds, so the caller reports the error. */
export function parseBatesCoord(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return isBatesCoord(n) ? n : null;
}

/** The outcome the host returns from a confirm. A void return (host not
 *  wired) leaves the dialog's report untouched. */
export type BatesConfirmOutcome =
  | { stamped: number[]; labels: string[] }
  | { error: string };

export interface BatesDialogProps {
  open: boolean;
  /** Total pages on the active doc. Drives the page-scope validation. */
  totalPages: number;
  /** 1-based visible page the user is on; seeds the range when the user
   *  narrows the scope. */
  currentPage: number;
  /** The remembered defaults (normalized by the host) seeded on open. */
  initialDefaults: BatesDefaults;
  /** The persisted edit font (`AppSettings.editDefaultFont`) baked into the
   *  stamp payload. Defaults to Helvetica when the host has not supplied one. */
  defaultFont?: EditFont;
  /** Phase 90 — when set, the dialog runs in update mode: it seeds the form
   *  from this already-applied run and emits its `id` as the second
   *  `onConfirm` argument so the host can call `engine.updateBates`. */
  editTarget?: BatesInfo;
  /** Fires when the user confirms. The host calls `engine.addBates` (or
   *  `engine.updateBates` when `editId` is supplied) and returns the outcome
   *  rendered in the report. */
  onConfirm: (
    settings: BatesSettings,
    editId?: string,
  ) => BatesConfirmOutcome | Promise<BatesConfirmOutcome | void> | void;
  onClose: () => void;
  /** True while the host's apply is in flight; disables the apply button. */
  busy?: boolean;
}

/** CSS placement for one grid slot on the preview frame. Mirrors the
 *  Phase 18 watermark grid so the preview tracks the engine's 10% margin. */
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

/** The ascending 1-based pages the current scope covers, or an empty list
 *  when the scope is invalid (so the apply button disables). */
export function batesPagesForScope(
  rangeAll: boolean,
  rangeFrom: number,
  rangeTo: number,
  totalPages: number,
): number[] {
  if (rangeAll) {
    if (totalPages < 1) return [];
    return Array.from({ length: totalPages }, (_v, i) => i + 1);
  }
  if (
    !Number.isInteger(rangeFrom) ||
    !Number.isInteger(rangeTo) ||
    rangeFrom < 1 ||
    rangeTo < rangeFrom ||
    rangeTo > totalPages
  ) {
    return [];
  }
  const out: number[] = [];
  for (let p = rangeFrom; p <= rangeTo; p += 1) out.push(p);
  return out;
}

export function BatesDialog(props: BatesDialogProps): ReactElement {
  const {
    open,
    totalPages,
    currentPage,
    initialDefaults,
    defaultFont,
    editTarget,
    onConfirm,
    onClose,
    busy = false,
  } = props;
  const [prefix, setPrefix] = useState(initialDefaults.prefix);
  const [suffix, setSuffix] = useState(initialDefaults.suffix);
  const [startNumber, setStartNumber] = useState(initialDefaults.startNumber);
  const [padding, setPadding] = useState(initialDefaults.padding);
  const [position, setPosition] = useState<WatermarkPosition>(initialDefaults.position);
  const [customXY, setCustomXY] = useState(false);
  const [xInput, setXInput] = useState("");
  const [yInput, setYInput] = useState("");
  const [rangeAll, setRangeAll] = useState(true);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(1);
  const [report, setReport] = useState<string | null>(null);
  const [reportError, setReportError] = useState(false);
  const [applying, setApplying] = useState(false);
  const seededForOpenRef = useRef<boolean>(false);

  // Re-seed on the rising edge of `open` from the remembered defaults; the
  // range seeds from the current page (the natural pick is "stamp the page
  // I'm on" when the user narrows the scope), clamped to the document. The
  // rising-edge guard matters because the host persists the chosen defaults
  // on apply, which changes `initialDefaults`' object identity; without it
  // that identity change would re-seed the still-open dialog and wipe the
  // post-apply report and the user's page scope.
  useEffect(() => {
    if (!open) {
      seededForOpenRef.current = false;
      return;
    }
    if (seededForOpenRef.current) return;
    seededForOpenRef.current = true;
    const clampedPage = Math.max(1, Math.min(currentPage, Math.max(1, totalPages)));
    if (editTarget !== undefined) {
      // Update mode: seed from the applied run. Explicit coords are seeded
      // only when both are finite; otherwise the grid slot maths applies.
      setPrefix(editTarget.prefix);
      setSuffix(editTarget.suffix);
      setStartNumber(editTarget.startNumber);
      setPadding(editTarget.padding);
      setPosition(editTarget.position);
      const hasXY = isBatesCoord(editTarget.x) && isBatesCoord(editTarget.y);
      setCustomXY(hasXY);
      setXInput(hasXY ? String(editTarget.x) : "");
      setYInput(hasXY ? String(editTarget.y) : "");
      const runPages = editTarget.pages;
      if (runPages.length > 0) {
        setRangeAll(false);
        setRangeFrom(runPages[0]);
        setRangeTo(runPages[runPages.length - 1]);
      } else {
        setRangeAll(true);
        setRangeFrom(clampedPage);
        setRangeTo(clampedPage);
      }
    } else {
      setPrefix(initialDefaults.prefix);
      setSuffix(initialDefaults.suffix);
      setStartNumber(initialDefaults.startNumber);
      setPadding(initialDefaults.padding);
      setPosition(initialDefaults.position);
      setCustomXY(false);
      setXInput("");
      setYInput("");
      setRangeAll(true);
      setRangeFrom(clampedPage);
      setRangeTo(clampedPage);
    }
    setReport(null);
    setReportError(false);
    setApplying(false);
  }, [open, initialDefaults, editTarget, currentPage, totalPages]);

  const pages = batesPagesForScope(rangeAll, rangeFrom, rangeTo, totalPages);
  const valid = pages.length > 0 && Number.isInteger(startNumber) && startNumber >= 1;
  const applyDisabled = busy || applying || !valid;

  const settings: BatesSettings = {
    pages,
    prefix,
    suffix,
    startNumber,
    padding,
    position,
    font: defaultFont ?? "Helvetica",
  };
  const nextLabel = buildBatesLabel(prefix, startNumber, padding, suffix);
  const series = formatBatesSeries(settings);

  const parsedX = parseBatesCoord(xInput);
  const parsedY = parseBatesCoord(yInput);

  /** Phase 90 — ticking "Custom position (X, Y)" disables the predefined
   *  grid and enables the two coordinate inputs. The selected slot is never
   *  cleared, so unticking restores the previously selected grid position. */
  const onToggleCustomXY = (checked: boolean): void => {
    setCustomXY(checked);
    if (checked) {
      setXInput((v): string => (v.trim() === "" ? "72" : v));
      setYInput((v): string => (v.trim() === "" ? "72" : v));
      setReport(null);
      setReportError(false);
    }
  };

  const onApply = async (): Promise<void> => {
    if (applyDisabled) return;
    let payload: BatesSettings = settings;
    if (customXY) {
      // The tick is the ONLY source of explicit coords: both are required
      // and must be finite points inside the sane bounds.
      const x = parseBatesCoord(xInput);
      const y = parseBatesCoord(yInput);
      if (x === null || y === null) {
        setReport(
          `The custom X and Y must be numbers between 0 and ${MAX_BATES_COORD} points.`,
        );
        setReportError(true);
        return;
      }
      payload = { ...settings, x, y };
    }
    setApplying(true);
    setReport(null);
    setReportError(false);
    const result = await onConfirm(payload, editTarget?.id);
    setApplying(false);
    if (result === undefined) return;
    if ("error" in result) {
      setReport(result.error);
      setReportError(true);
      return;
    }
    const n = result.stamped.length;
    const labelList = result.labels.join(", ");
    setReport(
      labelList === ""
        ? `${n} ${n === 1 ? "page" : "pages"} stamped.`
        : `${n} ${n === 1 ? "page" : "pages"} stamped: ${labelList}`,
    );
  };

  const actions: DialogAction[] = [
    {
      key: "cancel",
      label: "Cancel",
      variant: "secondary",
      onClick: onClose,
    },
    Object.assign(
      {
        key: "apply",
        label:
          applying || busy
            ? "Applying…"
            : editTarget !== undefined
              ? "Update numbering"
              : "Apply numbering",
        variant: "primary" as const,
        onClick: (): void => {
          void onApply();
        },
        disabled: applyDisabled,
        default: true,
      },
      { "data-bates-apply": true },
    ),
  ];

  return (
    <DialogShell
      open={open}
      title="Bates numbering"
      titleId="bates-dialog-title"
      icon={<Icon name="bates" size="sm" />}
      size="tool"
      onClose={onClose}
      blockBackdropClose={busy}
      actions={actions}
      data-bates-dialog
      data-bates-mode={editTarget !== undefined ? "update" : "apply"}
    >
              <p className="modal-help">
                Stamp sequential Bates numbers across the selected pages. The
                numbers are baked into the page content (undo removes them).
              </p>

              <div className="modal-row">
                <label className="modal-field">
                  <span>Prefix</span>
                  <input
                    className="modal-input"
                    type="text"
                    value={prefix}
                    onChange={(e): void => setPrefix(e.target.value)}
                    data-bates-prefix
                  />
                </label>
                <label className="modal-field">
                  <span>Suffix</span>
                  <input
                    className="modal-input"
                    type="text"
                    value={suffix}
                    onChange={(e): void => setSuffix(e.target.value)}
                    data-bates-suffix
                  />
                </label>
              </div>

              <div className="modal-row">
                <label className="modal-field">
                  <span>Start number</span>
                  <input
                    className="modal-input"
                    type="number"
                    min={1}
                    value={startNumber}
                    onChange={(e): void => setStartNumber(Number(e.target.value))}
                    data-bates-start
                  />
                </label>
                <label className="modal-field">
                  <span>Padding (digits)</span>
                  <input
                    className="modal-input"
                    type="number"
                    min={1}
                    max={64}
                    value={padding}
                    onChange={(e): void => setPadding(Number(e.target.value))}
                    data-bates-padding
                  />
                </label>
              </div>

              <fieldset className="modal-position">
                <legend>Position</legend>
                <label className="watermark-check">
                  <input
                    type="checkbox"
                    checked={customXY}
                    onChange={(e): void => onToggleCustomXY(e.target.checked)}
                    data-bates-custom-xy
                  />
                  <span>Custom position (X, Y)</span>
                </label>
                <div className="watermark-position-grid" role="group" aria-label="Stamp position">
                  {POSITION_SLOTS.map((slot) => (
                    <Button
                      key={slot}
                      type="button"
                      intent="tertiary"
                      kind="exclusive-selection"
                      density="compact"
                      className={position === slot ? "watermark-slot watermark-slot-active btn-icon" : "watermark-slot btn-icon"}
                      onClick={(): void => setPosition(slot)}
                      aria-pressed={position === slot}
                      aria-label={slot}
                      title={customXY ? "Disabled while Custom position (X, Y) is ticked" : slot}
                      disabled={customXY}
                      data-bates-position={slot}
                    >
                      <span className="watermark-slot-dot" />
                    </Button>
                  ))}
                </div>
                <div className="modal-row">
                  <label className="modal-field">
                    <span>X (pt)</span>
                    <input
                      className="modal-input"
                      type="number"
                      min={0}
                      max={MAX_BATES_COORD}
                      step={1}
                      value={xInput}
                      disabled={!customXY}
                      onChange={(e): void => setXInput(e.target.value)}
                      data-bates-x
                    />
                  </label>
                  <label className="modal-field">
                    <span>Y (pt)</span>
                    <input
                      className="modal-input"
                      type="number"
                      min={0}
                      max={MAX_BATES_COORD}
                      step={1}
                      value={yInput}
                      disabled={!customXY}
                      onChange={(e): void => setYInput(e.target.value)}
                      data-bates-y
                    />
                  </label>
                </div>
                {customXY && (
                  <span className="modal-hint" data-bates-custom-hint>
                    The preview places the label's top-left corner at X, Y
                    (measured from the page's top-left).
                  </span>
                )}
              </fieldset>

              <fieldset className="modal-position" data-bates-pages>
                <legend>Pages</legend>
                <label className="watermark-check">
                  <input
                    type="checkbox"
                    checked={rangeAll}
                    onChange={(e): void => setRangeAll(e.target.checked)}
                    data-bates-range-all
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
                      max={Math.max(1, totalPages)}
                      value={rangeFrom}
                      disabled={rangeAll}
                      onChange={(e): void => setRangeFrom(Number(e.target.value))}
                      data-bates-range-from
                    />
                  </label>
                  <label className="modal-field">
                    <span>To</span>
                    <input
                      className="modal-input"
                      type="number"
                      min={1}
                      max={Math.max(1, totalPages)}
                      value={rangeTo}
                      disabled={rangeAll}
                      onChange={(e): void => setRangeTo(Number(e.target.value))}
                      data-bates-range-to
                    />
                  </label>
                </div>
                {!rangeAll && !valid && (
                  <span className="modal-hint">
                    Enter a range from 1 to {Math.max(1, totalPages)}, start at or before the end.
                  </span>
                )}
              </fieldset>

              <section className="watermark-preview-wrap" aria-label="Bates label preview">
                <header className="watermark-preview-header">
                  <span className="stamp-preview-title">Preview</span>
                </header>
                <div
                  className="watermark-preview-frame"
                  style={{ width: PREVIEW_FRAME_W, height: PREVIEW_FRAME_H }}
                >
                  <span
                    className="watermark-preview-content"
                    style={
                      customXY && parsedX !== null && parsedY !== null
                        ? {
                            left: parsedX * PT_TO_PREVIEW_PX,
                            top: parsedY * PT_TO_PREVIEW_PX,
                            fontSize: "var(--fs-sm)",
                            whiteSpace: "nowrap",
                          }
                        : slotStyle(position, { fontSize: "var(--fs-sm)", whiteSpace: "nowrap" })
                    }
                    data-bates-preview
                  >
                    {nextLabel}
                  </span>
                </div>
                <span className="modal-hint" data-bates-preview-range>
                  {series.length === 0
                    ? "No pages selected."
                    : series.length === 1
                      ? `First: ${series[0]}`
                      : `First: ${series[0]} / Last: ${series[series.length - 1]} (${series.length} pages)`}
                </span>
              </section>

              <div
                className={reportError ? "modal-status optimize-error" : "modal-status"}
                role={reportError ? "alert" : "status"}
                data-bates-report
              >
                {report ?? "Not applied yet."}
              </div>
    </DialogShell>
  );
}