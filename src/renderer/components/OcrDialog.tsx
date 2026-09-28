// Phase 11 — OCR (recognize text) dialog.
//
// The dialog drives the per-page OCR pipeline end-to-end:
//
//   1. The user picks a language (allowlist), downsample DPI
//      (72..600), and scope (current page / all pages).
//   2. On confirm, the dialog asks the host for the active document
//      (pdf.js doc proxy + page count).
//   3. The dialog rasterises the in-scope pages at the chosen DPI
//      via `pdf/ocrRasterize.ts` (pdf.js DOM canvas, mirroring the
//      Phase 9 export rasterization path).
//   4. The per-page PNG bytes are bundled into a single
//      `OcrRecognizeOptions` payload and handed to the engine via
//      `runRecognize`. Progress events from the engine flow through
//      `onOcrProgress` while the recognition runs.
//
// The dialog surfaces a per-page progress bar fed by both the
// renderer's rasterisation step AND the engine's per-page progress
// events. Cancel is supported via an AbortController for the renderer
// rasterizer AND the host's `cancelOcr` (engine.ocrCancel) for the
// main-process recognition, which restores the pre-run bytes.
//
// The user's language + DPI choices persist in AppSettings so the
// dialog opens with the same values on next launch (same pattern as
// the Optimize / Export dialogs).
//
// "All pages" is the default scope; "Current page" is selectable.
// We don't accept an arbitrary page range — the OCR pipeline is
// slow and the dialog is meant to feel like a one-click action on
// the document the user is looking at.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_OCR_DOWNSAMPLE,
  DEFAULT_OCR_LANGUAGE,
  MAX_OCR_DOWNSAMPLE,
  MIN_OCR_DOWNSAMPLE,
  OCR_LANGUAGES,
  clampOcrDownsample,
} from "../state/preferences";
import { rasterizePagesForOcr, type OcrRasterizeFormField } from "../pdf/ocrRasterize";
import { useBackdropClose } from "./modalBackdrop";
import { AnimatePresence } from "motion/react";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";
import type {
  OcrLanguage,
  OcrPageImage,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
} from "../../shared/types";

export type OcrScope = "currentPage" | "allPages";

export interface OcrDialogConfirm {
  language: OcrLanguage;
  downsample: number;
  scope: OcrScope;
  /** Pages (1-based visible) the dialog actually rasterised and
   *  sent to the engine. Empty when the scope resolves to zero
   *  pages (e.g. "current page" with no active page). */
  pages: number[];
  /** Per-page PNG bytes the dialog produced. The host forwards
   *  them to the engine inside the OcrRecognizeOptions. */
  pageImages: OcrPageImage[];
  /** Low-confidence words from the recognition run, when the
   *  engine surfaced them. Empty array until the engine returns
   *  them post-run. */
  suspects: OcrSuspect[];
}

interface OcrDialogProps {
  open: boolean;
  /** Total page count of the active document. */
  totalPages: number;
  /** The 1-based visible page the user is currently looking at.
   *  Used by the "Current page" scope. */
  currentPage: number;
  /** The active document's current form-field values (name + kind +
   *  value) from the host's per-tab forms state. The dialog seeds
   *  pdf.js's AnnotationStorage with these before rasterising so
   *  typed form values ("John Doe") and checkbox/radio selections
   *  are baked into the OCR bitmaps (DEF-112). */
  formFields: readonly OcrRasterizeFormField[];
  /** Mirrors AppSettings.ocrLanguage. Re-seeds on open. */
  initialLanguage: OcrLanguage;
  /** Mirrors AppSettings.ocrDownsample. Re-seeds on open. */
  initialDownsample: number;
  /** Fires whenever the user changes language / DPI. The host
   *  persists the choice through the preferences reducer. */
  onLanguageChange?: (lang: OcrLanguage) => void;
  onDownsampleChange?: (dpi: number) => void;
  /** Resolve the active pdf.js document proxy. Returns null when
   *  no document is open (the host should not open the dialog in
   *  that case, but we guard anyway). */
  resolveActiveDoc: () => import("pdfjs-dist").PDFDocumentProxy | null;
  /** Subscribe to OCR progress events from the engine. Returns
   *  an unsubscribe function the dialog calls on close / cancel. */
  subscribeOcrProgress: (cb: (p: OcrProgress) => void) => () => void;
  /** Run the OCR engine action. Returns the engine's
   *  EngineState echo, OR an error string. The host wires this
   *  to `engine.ocrRecognize` for the active doc. Phase 51 (item 9): the
   *  optional `signal` lets the host skip its post-run side effects once the
   *  user cancelled (the engine call itself is not abortable — see the
   *  cancel note in this component). */
  runOcr: (
    options: OcrRecognizeOptions,
    signal?: AbortSignal,
  ) => Promise<
    | { ok: true; suspects: OcrSuspect[] }
    | { cancelled: true }
    | { error: string }
  >;
  /** Phase 51 (item 9) — flag the in-flight engine recognition for
   *  cancellation. The host wires this to `engine.ocrCancel(docId)`.
   *  Main restores the pre-run bytes (no partial text layer, no
   *  modified flag) and resolves the pending `runOcr` promise with
   *  `{ cancelled: true }`. Optional so a caller without a cancel
   *  channel still leaves the running state cleanly. */
  cancelOcr?: () => void;
  /** Fires when the run completes successfully. The host closes
   *  the dialog and shows the toasts list; the dialog itself has
   *  already routed the engine call. */
  onConfirm: (result: OcrDialogConfirm) => void;
  onClose: () => void;
}

interface RunProgress {
  /** Total pages in scope. */
  total: number;
  /** Page counter — pages finished or in progress. During the
   *  rasterisation step it counts completed renders; when the
   *  recognition phase starts it is reset to zero and refilled
   *  from the engine's per-page events. */
  completed: number;
  /** Currently running page label, 1-based; null when idle. */
  currentPage: number | null;
  /** Engine's phase for the current page (when reported). */
  phase: 'recognizing' | 'writing' | null;
}

export { DEFAULT_OCR_LANGUAGE, DEFAULT_OCR_DOWNSAMPLE, MIN_OCR_DOWNSAMPLE, MAX_OCR_DOWNSAMPLE, OCR_LANGUAGES, clampOcrDownsample };

/** Friendly label for each ISO-639 code in the picker. English is
 *  the default; the other labels are the canonical endonym so a
 *  Japanese user sees 日本語 instead of "Japanese". */
const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
  eng: 'English',
  deu: 'Deutsch',
  fra: 'Français',
  spa: 'Español',
  ita: 'Italiano',
  por: 'Português',
  rus: 'Русский',
  chi_sim: '简体中文',
  jpn: '日本語',
};

export function OcrDialog(props: OcrDialogProps): ReactElement | null {
  const {
    open,
    totalPages,
    currentPage,
    formFields,
    initialLanguage,
    initialDownsample,
    onLanguageChange,
    onDownsampleChange,
    resolveActiveDoc,
    subscribeOcrProgress,
    runOcr,
    cancelOcr,
    onConfirm,
    onClose,
  } = props;
  const [language, setLanguage] = useState<OcrLanguage>(initialLanguage);
  const [downsample, setDownsample] = useState<number>(initialDownsample);
  const [scope, setScope] = useState<OcrScope>('allPages');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress>({
    total: 0,
    completed: 0,
    currentPage: null,
    phase: null,
  });
  const [error, setError] = useState<string | null>(null);
  /** Phase 51 (item 9) — true once the user cancelled the current run. The
   *  dialog leaves the running state IMMEDIATELY (the rasterizer stops between
   *  pages and every post-await result is discarded) and shows a truthful
   *  "Cancelled" notice so the next Run starts from a clean state. */
  const [cancelled, setCancelled] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const progressUnsubRef = useRef<(() => void) | null>(null);

  /** Phase 51 (item 9) — the single cancel path used by the Cancel
   *  button, the header X while running, and Esc. It flags main's
   *  in-flight recognition for cancellation (so the engine restores the
   *  pre-run bytes instead of committing a partial text layer), aborts
   *  the renderer-side rasterizer, and leaves the running state at once.
   *  The pending `runOcr` promise is then discarded by the post-await
   *  checks in `onConfirmClick` (or arrives as `{ cancelled: true }`),
   *  so no result is applied and the document stays unchanged. */
  const cancelRun = useCallback((): void => {
    cancelOcr?.();
    abortRef.current?.abort();
    setRunning(false);
    setCancelled(true);
  }, [cancelOcr]);

  // Reset state every time the dialog re-opens. The language / DPI
  // mirrors persist in AppSettings; the dialog re-seeds from
  // those values on open so the user sees the same choices they
  // made last time. Run state MUST NOT survive across opens — the
  // active doc may have changed in the meantime.
  useEffect(() => {
    if (!open) return;
    setLanguage(initialLanguage);
    setDownsample(initialDownsample);
    setScope('allPages');
    setRunning(false);
    setProgress({ total: 0, completed: 0, currentPage: null, phase: null });
    setError(null);
    setCancelled(false);
    // Cancel any in-flight run from a previous open (defensive —
    // the dialog should not be re-opened mid-run, but if it is,
    // we tear down the old abort controller).
    abortRef.current?.abort();
    abortRef.current = null;
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
  }, [open, initialLanguage, initialDownsample]);

  // Subscribe to engine progress while the dialog is open. We only
  // apply the listener while running so we don't accumulate
  // no-op subscriptions across opens.
  useEffect(() => {
    if (!open || !running) return undefined;
    const unsub = subscribeOcrProgress((p) => {
      // The engine reports per-page progress for the active doc.
      // `completed` was reset to zero when rasterisation finished,
      // so refill it here: the reported page counts as in progress,
      // and keeping the higher of that and the last value means a
      // late 'writing' event for an earlier page can't drag the
      // bar backwards.
      setProgress((prev) => ({
        ...prev,
        currentPage: p.page,
        phase: p.phase,
        completed: Math.min(Math.max(prev.completed, p.page), prev.total),
      }));
    });
    progressUnsubRef.current = unsub;
    return (): void => {
      unsub();
      if (progressUnsubRef.current === unsub) {
        progressUnsubRef.current = null;
      }
    };
  }, [open, running, subscribeOcrProgress]);

  // Esc closes; focus the first interactive control ONLY on open.
  // B13 — the previous implementation also depended on `running`,
  // so a long-running OCR's progress update flipped the dep and
  // the effect re-ran `first?.focus()`, stealing focus from the
  // user mid-interaction. Worse, the focus selector matched the
  // first `input, button, [tabindex]` — the language `<select>` is
  // itself an `input`, so a fresh focus call while the user was
  // hovering over a different `<select>` (e.g. page-scope)
  // shifted focus to the language dropdown and dismissed the
  // popup the user was actively engaging with. We now only run
  // the focus call when `open` flips true (and only on the rising
  // edge — not when it goes false), so a state change deep inside
  // the dialog never steals focus.
  const focusedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    if (!open) {
      focusedOnceRef.current = false;
      return;
    }
    if (focusedOnceRef.current) return;
    focusedOnceRef.current = true;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (running) {
          cancelRun();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    // Defer the focus call to the next microtask so React has
    // finished its commit phase. Without this, a synchronous
    // focus() inside the effect races with the parent click event
    // that opened the dialog, and the focus can land on the wrong
    // element (especially if the opening click landed on a button
    // that just transitioned to disabled state).
    queueMicrotask((): void => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'input, button, [tabindex]',
      );
      first?.focus();
    });
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, running, cancelRun]);

  // Tear down the abort controller + progress subscription when
  // the dialog closes (defensive — the run-finished effect below
  // also runs cleanup, but if the dialog is dismissed mid-run
  // via the X button, we want a clean teardown).
  useEffect(() => {
    if (open) return undefined;
    // If the dialog was dismissed while a run was in flight, flag the
    // engine so it restores the pre-run bytes rather than committing a
    // partial text layer. `abortRef` is non-null only while a run is
    // active, which keeps this from touching an unrelated batch run.
    if (abortRef.current !== null) cancelOcr?.();
    abortRef.current?.abort();
    abortRef.current = null;
    progressUnsubRef.current?.();
    progressUnsubRef.current = null;
    return undefined;
  }, [open, cancelOcr]);

  const valid = useMemo<boolean>(() => {
    if (!open) return false;
    if (running) return false;
    if (totalPages <= 0) return false;
    if (scope === 'currentPage' && (currentPage < 1 || currentPage > totalPages)) return false;
    if (!OCR_LANGUAGES.includes(language)) return false;
    if (
      !Number.isFinite(downsample) ||
      downsample < MIN_OCR_DOWNSAMPLE ||
      downsample > MAX_OCR_DOWNSAMPLE
    ) {
      return false;
    }
    return true;
  }, [open, running, totalPages, scope, currentPage, language, downsample]);

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop; blocked entirely while OCR is running.
  const backdrop = useBackdropClose(onClose, running);

  

  const onConfirmClick = async (): Promise<void> => {
    if (!valid) return;
    setRunning(true);
    setError(null);
    setCancelled(false);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // Step 1: resolve the pdf.js doc and the in-scope page list.
      const doc = resolveActiveDoc();
      if (doc === null) {
        setError('No active document.');
        setRunning(false);
        return;
      }
      const pages = scope === 'allPages'
        ? Array.from({ length: totalPages }, (_, i) => i + 1)
        : [currentPage];
      if (pages.length === 0) {
        setError('No pages in scope.');
        setRunning(false);
        return;
      }
      setProgress({
        total: pages.length,
        completed: 0,
        currentPage: pages[0] ?? null,
        phase: 'recognizing',
      });
      // Step 2: rasterise every page at the chosen DPI. The
      // per-page progress callback advances the bar by one slot
      // per completed render so the user sees real progress even
      // when the engine's per-page events haven't fired yet.
      const pageImages = await rasterizePagesForOcr({
        doc,
        pages,
        dpi: downsample,
        formFields,
        onProgress: (page): void => {
          setProgress((prev) => ({
            ...prev,
            currentPage: page,
            completed: Math.min(prev.completed + 1, prev.total),
          }));
        },
        signal: ac.signal,
      });
      if (ac.signal.aborted) {
        setRunning(false);
        return;
      }
      // Rasterisation finished: reset the counter so the bar
      // starts low again when the recognition phase begins. The
      // engine's per-page events (subscribed in the effect above)
      // refill it from zero, instead of the bar sitting at 100%
      // for the entire recognition run.
      setProgress((prev) => ({
        ...prev,
        completed: 0,
        phase: 'recognizing',
      }));
      // Step 3: send the rasterised pages to the engine. The
      // engine runs tesseract, writes the invisible text layer
      // onto each page, and pushes per-page progress events
      // through the listener we subscribed in the effect above.
      // Phase 51 (item 9): a cancelled run resolves either as our
      // abort (signal) or as the engine's `{ cancelled: true }`
      // (mapped from `error.code === 'cancelled'`) — both are the
      // expected cancellation, never an error.
      const engineResult = await runOcr(
        {
          language,
          downsample,
          pageImages,
        },
        ac.signal,
      );
      if (ac.signal.aborted || 'cancelled' in engineResult) {
        // Expected cancellation, never an error toast: show the
        // truthful "Cancelled" notice so the user knows the run did
        // not apply and can Run again.
        setCancelled(true);
        setRunning(false);
        return;
      }
      if ('error' in engineResult) {
        setError(engineResult.error);
        setRunning(false);
        return;
      }
      setRunning(false);
      onConfirm({
        language,
        downsample,
        scope,
        pages,
        pageImages,
        suspects: engineResult.suspects,
      });
    } catch (e) {
      // Aborted runs surface as a friendly toast in the host — no
      // error to display in the dialog itself.
      if (ac.signal.aborted) {
        setRunning(false);
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setRunning(false);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  };

  // Phase 51 (item 9) — cancel must visibly stop the run. `cancelRun`
  // (defined above) flags main's in-flight recognition so the engine
  // restores the pre-run bytes, aborts the renderer-side rasterizer, and
  // leaves the running state immediately. Every post-await check in
  // `onConfirmClick` discards a late result, so the document is unchanged
  // and the next Run starts from a clean controller.

  const progressFraction = progress.total > 0
    ? Math.max(0, Math.min(1, progress.completed / progress.total))
    : 0;
  const progressPercent = Math.round(progressFraction * 100);

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop}>
      <TfDialog
        className="modal-dialog dialog ocr-dialog modal-dialog-tool"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ocr-dialog-title"
      >
        <div className="modal-header">
          <h2 id="ocr-dialog-title" className="modal-title">
            Recognize text (OCR)
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={running ? cancelRun : onClose}
            aria-label={running ? 'Cancel OCR' : 'Close dialog'}
            title={running ? 'Cancel OCR' : 'Close'}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Adds a searchable text layer to this scanned document so search
            and copy-text work as on a normal PDF. The original page image
            stays untouched.
          </p>

          <label className="modal-field">
            <span>Language</span>
            <select
              className="modal-input"
              value={language}
              onChange={(e): void => {
                const next = e.target.value as OcrLanguage;
                if (OCR_LANGUAGES.includes(next)) {
                  setLanguage(next);
                  onLanguageChange?.(next);
                }
              }}
              disabled={running}
              data-ocr-language
              aria-label="OCR language"
            >
              {OCR_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {OCR_LANGUAGE_LABELS[code]} ({code})
                </option>
              ))}
            </select>
            <span className="modal-hint">
              Only <code>eng</code> is bundled by default; other languages
              require their traineddata file in <code>assets/tessdata/</code>.
            </span>
          </label>

          <label className="modal-field">
            <span>Render DPI ({downsample})</span>
            <input
              type="range"
              min={MIN_OCR_DOWNSAMPLE}
              max={MAX_OCR_DOWNSAMPLE}
              step={1}
              value={downsample}
              onChange={(e): void => {
                const next = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(next)) {
                  setDownsample(clampOcrDownsample(next));
                }
              }}
              onMouseUp={(): void => onDownsampleChange?.(downsample)}
              onTouchEnd={(): void => onDownsampleChange?.(downsample)}
              disabled={running}
              data-ocr-dpi
              aria-label="OCR render DPI"
              className="modal-range"
            />
            <span className="modal-hint">
              {MIN_OCR_DOWNSAMPLE} (screen) to {MAX_OCR_DOWNSAMPLE} (print).
              Higher DPI improves accuracy at the cost of slower recognition.
            </span>
          </label>

          <fieldset className="modal-position ocr-scope">
            <legend>Scope</legend>
            <label>
              <input
                type="radio"
                name="ocr-scope"
                checked={scope === 'currentPage'}
                onChange={(): void => setScope('currentPage')}
                disabled={running}
                data-ocr-scope="currentPage"
              />
              <span>Current page ({currentPage})</span>
            </label>
            <label>
              <input
                type="radio"
                name="ocr-scope"
                checked={scope === 'allPages'}
                onChange={(): void => setScope('allPages')}
                disabled={running}
                data-ocr-scope="allPages"
              />
              <span>All pages ({totalPages})</span>
            </label>
          </fieldset>

          {running && (
            <div className="modal-status ocr-progress" aria-live="polite" data-ocr-progress>
              <div className="ocr-progress-header">
                <span>
                  {progress.phase === 'writing'
                    ? 'Writing text layer…'
                    : 'Recognizing…'}
                  {progress.currentPage !== null && (
                    <> page {progress.currentPage} of {progress.total}</>
                  )}
                </span>
                <span className="ocr-progress-percent">{progressPercent}%</span>
              </div>
              <div className="ocr-progress-track" aria-hidden>
                <div
                  className="ocr-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                  data-ocr-progress-fill
                />
              </div>
            </div>
          )}

          {error !== null && (
            <div className="modal-status optimize-error" role="alert" data-ocr-error>
              <span>{error}</span>
            </div>
          )}

          {/* Phase 51 (item 9) — a truthful "Cancelled" state: the run left the
              running state and no result is applied, so the user knows the
              Cancel took effect and can Run again. */}
          {cancelled && !running && error === null && (
            <div className="modal-status" role="status" data-ocr-cancelled>
              <span>Cancelled. Run OCR again when you are ready.</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {running ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={cancelRun}
              data-ocr-cancel
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              data-ocr-close
            >
              Close
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!valid}
            onClick={(): void => {
              void onConfirmClick();
            }}
            data-ocr-confirm
          >
            {running ? 'Running…' : 'Recognize text'}
          </button>
        </div>
      </TfDialog>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}