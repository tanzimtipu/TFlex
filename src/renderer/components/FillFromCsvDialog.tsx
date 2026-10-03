// Phase 53 (feature G mode 2) — Fill form fields from CSV.
//
// The user picks a .csv, confirms, and the engine maps each CSV header
// onto an AcroForm field of the ACTIVE document (exact match first, then
// case-insensitive) and writes the values. This dialog is the UI shell:
// it owns no engine state, calls the host's `runCsvFill` (which talks to
// `window.tflex.convert.csvToDocumentFields`) and renders the returned
// `CsvFieldMappingResult` — the filled count, the three field lists and
// every warning.
//
// Structure mirrors CommentImportDialog (same TfDialog/TfBackdrop shell,
// backdrop-close guard, Escape handling).

import { useEffect, useRef, useState, type ReactElement } from "react";
import { AnimatePresence } from "motion/react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { Icon } from "../icons/Icon";
import type { CsvFieldMappingResult } from "../../shared/convert";
import { useBackdropClose } from "./modalBackdrop";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";

export interface FillFromCsvApplied {
  /** The picked CSV path. */
  path: string;
  /** Fields whose value was written. */
  filled: number;
}

export interface FillFromCsvDialogProps {
  open: boolean;
  /** Pop the OS open dialog for a spreadsheet. Returns the picked path,
   *  or null when the user cancelled. */
  pickCsvFile: () => Promise<string | null>;
  /** Run the engine mapping against the active document. Returns the
   *  mapping result, or a readable error string. */
  runCsvFill: (
    path: string,
  ) => Promise<{ result: CsvFieldMappingResult } | { error: string }>;
  /** Fired ONCE on a successful fill so the host can refresh form state
   *  and toast the count. */
  onApplied: (applied: FillFromCsvApplied) => void;
  onClose: () => void;
}

/** One field-name list with its heading. Renders "None" when empty so a
 *  blank list is never mistaken for "still loading". */
function FieldList(props: {
  label: string;
  items: readonly string[];
  testId: string;
  itemId: string;
}): ReactElement {
  const { label, items, testId, itemId } = props;
  return (
    <div className="fill-csv-list">
      <div className="fill-csv-list-label">{label}</div>
      {items.length === 0 ? (
        <div className="fill-csv-list-empty" data-testid={`${testId}-empty`}>
          None
        </div>
      ) : (
        <ul className="fill-csv-list-items" data-testid={testId}>
          {items.map((name) => (
            <li key={name} className="fill-csv-list-item" data-testid={itemId}>
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The engine's outcome, rendered in full: the filled count, the matched
 *  fields, the unmatched headers, the fields that got no data, and every
 *  warning. Exported so it can be unit-tested on its own. */
export function FillFromCsvResult(props: {
  result: CsvFieldMappingResult;
}): ReactElement {
  const { result } = props;
  return (
    <div className="fill-csv-result" data-fill-csv-result>
      <p className="fill-csv-filled" data-fill-csv-filled>
        {result.filled} field{result.filled === 1 ? "" : "s"} filled.
      </p>
      <FieldList
        label="Matched fields"
        items={result.matched}
        testId="fill-csv-matched"
        itemId="fill-csv-matched-item"
      />
      <FieldList
        label="CSV headers with no matching field"
        items={result.unmatchedHeaders}
        testId="fill-csv-unmatched"
        itemId="fill-csv-unmatched-item"
      />
      <FieldList
        label="Fields that received no data"
        items={result.missingFields}
        testId="fill-csv-missing"
        itemId="fill-csv-missing-item"
      />
      {result.warnings.length > 0 && (
        <div className="fill-csv-warnings">
          <div className="fill-csv-list-label">Warnings</div>
          <ul className="fill-csv-list-items" data-testid="fill-csv-warnings">
            {result.warnings.map((warning) => (
              <li
                key={warning.code}
                className="fill-csv-list-item"
                data-testid="fill-csv-warning"
              >
                {warning.message}
                {warning.detail !== undefined ? ` (${warning.detail})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function FillFromCsvDialog(
  props: FillFromCsvDialogProps,
): ReactElement | null {
  const { open, pickCsvFile, runCsvFill, onApplied, onClose } = props;
  const [path, setPath] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvFieldMappingResult | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setPath(null);
    setRunning(false);
    setError(null);
    setResult(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "button, input, [tabindex]",
    );
    first?.focus();
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // B3/B6 — backdrop close only when the interaction started on the backdrop.
  const backdrop = useBackdropClose(onClose, running);

  const onChoose = async (): Promise<void> => {
    setError(null);
    try {
      const picked = await pickCsvFile();
      if (picked === null) return;
      setPath(picked);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  };

  const onConfirm = async (): Promise<void> => {
    if (path === null) return;
    setRunning(true);
    setError(null);
    try {
      const res = await runCsvFill(path);
      if ("error" in res) {
        setError(res.error);
        setRunning(false);
        return;
      }
      setResult(res.result);
      setRunning(false);
      onApplied({ path, filled: res.result.filled });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setRunning(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="modal-backdrop"
          {...backdrop}
          data-fill-csv-dialog
        >
          <TfDialog
            className="modal-dialog dialog"
            ref={dialogRef}
            onClick={(e): void => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fill-csv-dialog-title"
          >
            <div className="modal-header">
              <h2 id="fill-csv-dialog-title" className="modal-title">
                Fill form fields from CSV
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
                Each CSV header is matched to a form field name — exact
                first, then case-insensitive. The matching column value is
                written into the field; nothing else about the document
                changes.
              </p>

              <div className="modal-status fill-csv-file">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={running}
                  onClick={(): void => {
                    void onChoose();
                  }}
                  data-fill-csv-pick
                >
                  <Icon icon={FileSpreadsheet} size="sm" />
                  Choose CSV file…
                </button>
                {path !== null && (
                  <span
                    className="fill-csv-file-name"
                    data-fill-csv-file
                    title={path}
                  >
                    {path}
                  </span>
                )}
              </div>

              {error !== null && (
                <div
                  className="modal-status optimize-error"
                  role="alert"
                  data-fill-csv-error
                >
                  <span>{error}</span>
                </div>
              )}

              {result !== null && <FillFromCsvResult result={result} />}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
              {result === null ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={running || path === null}
                  onClick={(): void => {
                    void onConfirm();
                  }}
                  data-fill-csv-confirm
                >
                  <Icon icon={Upload} size="sm" />
                  {running ? "Filling…" : "Fill form fields"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onClose}
                  data-fill-csv-done
                >
                  Done
                </button>
              )}
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
