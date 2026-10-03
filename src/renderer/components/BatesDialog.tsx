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
import { AnimatePresence } from "motion/react";
import { Hash, X } from "lucide-react";
import { Icon } from "../icons/Icon";
import { useBackdropClose } from "./modalBackdrop";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";
import {
  buildBatesLabel,
  formatBatesSeries,
} from "../../shared/bates";
import type {
  BatesDefaults,
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
  /** Fires when the user confirms. The host calls `engine.addBates` and
   *  returns the outcome rendered in the report. */
  onConfirm: (
    settings: BatesSettings,
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
    onConfirm,
    onClose,
    busy = false,
  } = props;
  const [prefix, setPrefix] = useState(initialDefaults.prefix);
  const [suffix, setSuffix] = useState(initialDefaults.suffix);
  const [startNumber, setStartNumber] = useState(initialDefaults.startNumber);
  const [padding, setPadding] = useState(initialDefaults.padding);
  const [position, setPosition] = useState<WatermarkPosition>(initialDefaults.position);
  const [rangeAll, setRangeAll] = useState(true);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(1);
  const [report, setReport] = useState<string | null>(null);
  const [reportError, setReportError] = useState(false);
  const [applying, setApplying] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const focusedOnceRef = useRef<boolean>(false);
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
    setPrefix(initialDefaults.prefix);
    setSuffix(initialDefaults.suffix);
    setStartNumber(initialDefaults.startNumber);
    setPadding(initialDefaults.padding);
    setPosition(initialDefaults.position);
    setRangeAll(true);
    setRangeFrom(clampedPage);
    setRangeTo(clampedPage);
    setReport(null);
    setReportError(false);
    setApplying(false);
  }, [open, initialDefaults, currentPage, totalPages]);

  // Focus the first interactive control on the rising edge of `open` and
  // wire Escape-to-close (same contract as the other dialogs).
  useEffect(() => {
    if (!open) {
      focusedOnceRef.current = false;
      return;
    }
    if (focusedOnceRef.current) return;
    focusedOnceRef.current = true;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask((): void => {
      const first = dialogRef.current?.querySelector<HTMLElement>("button, input, [tabindex]");
      first?.focus();
    });
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const backdrop = useBackdropClose(onClose, busy);

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

  const onApply = async (): Promise<void> => {
    if (applyDisabled) return;
    setApplying(true);
    setReport(null);
    setReportError(false);
    const result = await onConfirm(settings);
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

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop} data-bates-dialog>
          <TfDialog
            ref={(el): void => {
              dialogRef.current = el;
            }}
            className="modal-dialog dialog modal-dialog-tool"
            onClick={(e): void => e.stopPropagation()}
            onPointerDown={(e): void => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bates-dialog-title"
          >
            <div className="modal-header">
              <h2 id="bates-dialog-title" className="modal-title">
                <Icon icon={Hash} size="sm" /> Bates numbering
              </h2>
              <button
                type="button"
                className="modal-close"
                onClick={onClose}
                aria-label="Close dialog"
              >
                <Icon icon={X} size="sm" />
              </button>
            </div>
            <div className="modal-body">
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
                <div className="watermark-position-grid" role="group" aria-label="Stamp position">
                  {POSITION_SLOTS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={position === slot ? "watermark-slot watermark-slot-active" : "watermark-slot"}
                      onClick={(): void => setPosition(slot)}
                      aria-pressed={position === slot}
                      aria-label={slot}
                      title={slot}
                      data-bates-position={slot}
                    >
                      <span className="watermark-slot-dot" />
                    </button>
                  ))}
                </div>
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
                <div className="watermark-preview-frame" style={{ position: "relative" }}>
                  <span
                    className="watermark-preview-content"
                    style={slotStyle(position, { fontSize: 12, whiteSpace: "nowrap" })}
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
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={(): void => {
                  void onApply();
                }}
                disabled={applyDisabled}
                data-bates-apply
              >
                {applying || busy ? "Applying\u2026" : "Apply numbering"}
              </button>
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}