// Phase 57 (feature B, part 2) — Export / Import form data (FDF | XFDF).
//
// The user picks a format, then exports the ACTIVE document's AcroForm
// field values to an FDF/XFDF data file, or imports an FDF/XFDF file into
// the document's matching fields. This dialog is the UI shell: it owns no
// engine state, calls the host's `runExport` / `runImport` (which talk to
// `window.tflex.exportFormData` / `importFormData` and the OS save/open
// dialogs) and renders the returned report.
//
// Structure mirrors FillFromCsvDialog (same TfDialog/TfBackdrop shell,
// backdrop-close guard, Escape handling). FDF/XFDF here carries FORM DATA,
// distinct from the Phase-12 comment FDF verbs.

import { useEffect, useRef, useState, type ReactElement } from "react";
import { AnimatePresence } from "motion/react";
import { FileDown, Upload, X } from "lucide-react";
import { Icon } from "../icons/Icon";
import type { FormDataImportReport } from "../../shared/types";
import { useBackdropClose } from "./modalBackdrop";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";

export type FormDataFormat = "fdf" | "xfdf";

export interface FormDataIoDialogProps {
  open: boolean;
  mode: "export" | "import";
  /** Pop the OS open dialog for an FDF/XFDF file. Returns the picked
   *  path, or null when the user cancelled. */
  pickFormDataFile: () => Promise<string | null>;
  /** Export the active document's form values. Returns the saved path +
   *  the exported field count, an explicit `cancelled` result when the user
   *  dismissed the OS save dialog, or a readable error string. */
  runExport: (
    format: FormDataFormat,
  ) => Promise<
    { path: string; count: number } | { cancelled: true } | { error: string }
  >;
  /** Import an FDF/XFDF file into the active document. Returns the
   *  matched/unmatched/empty report + the file path, or an error. */
  runImport: (
    format: FormDataFormat,
    path: string,
  ) => Promise<{ report: FormDataImportReport; path: string } | { error: string }>;
  /** Fired ONCE on a successful run so the host can refresh form state and
   *  toast the count. */
  onApplied: (
    applied:
      | { kind: "export"; path: string; count: number }
      | { kind: "import"; report: FormDataImportReport; path: string },
  ) => void;
  onClose: () => void;
}

/** One report list with its heading. Renders "None" when empty so a blank
 *  list is never mistaken for "still loading". `note` states a caveat the
 *  list must always carry (the unmatched list warns no field is created). */
function ReportList(props: {
  label: string;
  items: readonly string[];
  testId: string;
  itemId: string;
  note?: string;
}): ReactElement {
  const { label, items, testId, itemId, note } = props;
  return (
    <div className="form-data-list">
      <div className="form-data-list-label">{label}</div>
      {note !== undefined && <p className="form-data-list-note">{note}</p>}
      {items.length === 0 ? (
        <div className="form-data-list-empty" data-testid={`${testId}-empty`}>
          None
        </div>
      ) : (
        <ul className="form-data-list-items" data-testid={testId}>
          {items.map((name) => (
            <li key={name} className="form-data-list-item" data-testid={itemId}>
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The import outcome, rendered in full: the updated count and the three
 *  name lists. Exported so it can be unit-tested on its own. */
export function FormDataImportResult(props: {
  report: FormDataImportReport;
}): ReactElement {
  const { report } = props;
  return (
    <div className="form-data-report" data-form-data-report>
      <p className="form-data-imported" data-form-data-imported>
        {report.matched.length} field{report.matched.length === 1 ? "" : "s"} updated.
      </p>
      <ReportList
        label="Fields updated"
        items={report.matched}
        testId="form-data-matched"
        itemId="form-data-matched-item"
      />
      <ReportList
        label="Names not in this document"
        items={report.unmatched}
        testId="form-data-unmatched"
        itemId="form-data-unmatched-item"
        note="These names do not match a field in this document; no field was created for them."
      />
      <ReportList
        label="Fields with no data"
        items={report.empty}
        testId="form-data-empty"
        itemId="form-data-empty-item"
      />
    </div>
  );
}

export function FormDataIoDialog(
  props: FormDataIoDialogProps,
): ReactElement | null {
  const { open, mode, pickFormDataFile, runExport, runImport, onApplied, onClose } = props;
  const [format, setFormat] = useState<FormDataFormat>("xfdf");
  const [path, setPath] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<{ path: string; count: number } | null>(null);
  const [report, setReport] = useState<FormDataImportReport | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormat("xfdf");
    setPath(null);
    setRunning(false);
    setError(null);
    setExported(null);
    setReport(null);
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

  // Backdrop close only when the interaction started on the backdrop.
  const backdrop = useBackdropClose(onClose, running);

  const onPick = async (): Promise<void> => {
    setError(null);
    try {
      const picked = await pickFormDataFile();
      if (picked === null) return;
      setPath(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRunExport = async (): Promise<void> => {
    setRunning(true);
    setError(null);
    setExported(null);
    try {
      const res = await runExport(format);
      if ("cancelled" in res) {
        // The user dismissed the OS save dialog: a silent no-op, no error
        // box, no success state, no toast.
        setRunning(false);
        return;
      }
      if ("error" in res) {
        setError(res.error);
        setRunning(false);
        return;
      }
      setExported(res);
      setRunning(false);
      onApplied({ kind: "export", path: res.path, count: res.count });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  };

  const onRunImport = async (): Promise<void> => {
    if (path === null) return;
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const res = await runImport(format, path);
      if ("error" in res) {
        setError(res.error);
        setRunning(false);
        return;
      }
      setReport(res.report);
      setRunning(false);
      onApplied({ kind: "import", report: res.report, path: res.path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  };

  const title = mode === "export" ? "Export form data" : "Import form data";

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="modal-backdrop"
          {...backdrop}
          data-form-data-dialog
        >
          <TfDialog
            className="modal-dialog dialog"
            ref={dialogRef}
            onClick={(e): void => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="form-data-dialog-title"
          >
            <div className="modal-header">
              <h2 id="form-data-dialog-title" className="modal-title">
                {title}
              </h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon modal-close"
                onClick={onClose}
                aria-label="Close dialog"
                title="Close dialog"
              >
                <Icon icon={X} size="sm" />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-help">
                {mode === "export"
                  ? "Save the active document\u2019s form field values to a data file. The document itself is not changed."
                  : "Apply field values from a data file to the active document. Each name is matched to an existing form field; a name that does not match is reported, never created."}
              </p>

              <div
                className="form-data-format"
                role="group"
                aria-label="Form-data format"
              >
                <button
                  type="button"
                  className={
                    format === "xfdf"
                      ? "btn btn-primary form-data-format-btn"
                      : "btn btn-secondary form-data-format-btn"
                  }
                  aria-pressed={format === "xfdf"}
                  onClick={(): void => setFormat("xfdf")}
                  data-testid="form-data-format-xfdf"
                >
                  XFDF
                </button>
                <button
                  type="button"
                  className={
                    format === "fdf"
                      ? "btn btn-primary form-data-format-btn"
                      : "btn btn-secondary form-data-format-btn"
                  }
                  aria-pressed={format === "fdf"}
                  onClick={(): void => setFormat("fdf")}
                  data-testid="form-data-format-fdf"
                >
                  FDF
                </button>
              </div>

              {mode === "import" && (
                <div className="modal-status form-data-file">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={running}
                    onClick={(): void => {
                      void onPick();
                    }}
                    data-testid="form-data-import-pick"
                  >
                  <Icon icon={Upload} size="sm" />
                    Choose form-data file{"\u2026"}
                  </button>
                  {path !== null && (
                    <span
                      className="form-data-file-name"
                      data-form-data-file
                      title={path}
                    >
                      {path}
                    </span>
                  )}
                </div>
              )}

              {error !== null && (
                <div
                  className="modal-status optimize-error"
                  role="alert"
                  data-form-data-error
                >
                  <span>{error}</span>
                </div>
              )}

              {exported !== null && (
                <div className="form-data-export-result" data-form-data-export-result>
                  <p className="form-data-exported" data-form-data-exported>
                    {exported.count} field{exported.count === 1 ? "" : "s"} exported to{" "}
                    <span title={exported.path}>{exported.path}</span>.
                  </p>
                </div>
              )}

              {report !== null && <FormDataImportResult report={report} />}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                data-testid="form-data-close"
              >
                Close
              </button>
              {mode === "export" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={running}
                  onClick={(): void => {
                    void onRunExport();
                  }}
                  data-testid="form-data-export-run"
                >
                  <Icon icon={FileDown} size="sm" />
                  {running ? "Exporting\u2026" : "Export form data"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={running || path === null}
                  onClick={(): void => {
                    void onRunImport();
                  }}
                  data-testid="form-data-import-run"
                >
                  <Icon icon={Upload} size="sm" />
                  {running ? "Importing\u2026" : `Import form data`}
                </button>
              )}
            </div>
          </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
