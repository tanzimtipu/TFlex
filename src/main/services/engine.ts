import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { beginText, concatTransformationMatrix, decodePDFRawStream, degrees, drawObject, endText, fill, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObjectCopier, PDFRawStream, PDFRef, PDFStream, PDFString, rectangle, rgb, setCharacterSpacing, setFillingRgbColor, setFontAndSize, setGraphicsState, setTextMatrix, showText, StandardFontEmbedder, StandardFonts, TextRenderingMode, setTextRenderingMode, pushGraphicsState, popGraphicsState, translate, rotateRadians, skewRadians, setLineWidth, setDashPattern, moveTo, lineTo, closePath, type PDFOperator, type PDFObject, type PDFImage, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { err, ok, type Result } from '../../shared/result';
import {
  RedactionUnsupportedError,
  removeRedactedGlyphs,
  type RedactionAdvanceResolver,
} from '../../shared/redaction';
import type {
  AddStampPayload,
  AddTextBoxPayload,
  AnnModel,
  AnnRect,
  ApplyRedactionsPayload,
  CommentEntry,
  CommentThread,
  CreateAnnotationPayload,
  CropEntry,
  DocxImageEntry,
  DocumentProtection,
  DocumentProtectionState,
  EditAnnotationPayload,
  EditFont,
  EditImagePayload,
  EditTextRunPayload,
  EncryptDocumentOptions,
  EngineError,
  EngineOpenError,
  EngineState,
  ExportPageEntry,
  ExportPagesPayload,
  FillFormFieldPayload,
  FormDataImportReport,
  FormField,
  FormFillReport,
  MovePagesBetweenDocsPayload,
  MovePagesBetweenDocsResult,
  MoveSignaturePayload,
  OcrProgress,
  OcrRecognizeOptions,
  OcrCancelResult,
  OcrSuspect,
  OpEntry,
  OptimizePreset,
  OcrPageFailure,
  PageLabelEntry,
  Pdf3dContent,
  PdfCadMetadata,
  PdfLayer,
  PlaceSignaturePayload,
  RedactionApplyResult,
  SignaturePlacement,
  SpaceAudit,
  TextAlign,
  TextBoxModel,
  TextBoxStylePatch,
  TextListStyle,
  TextPage,
  WatermarkInfo,
  WatermarkSettings,
} from '../../shared/types';
import {
  cloneAnnotations,
  createAnnotation,
  deleteAnnotation,
  dropPageAnnotations,
  editAnnotation,
  parseAnnotationsFromDoc,
  serializeAnnotations,
} from './annotations';
import {
  exportFdf as exportFdfBytes,
  exportFormFdf,
  exportFormXfdf,
  parseFdf,
  parseFormFdf,
  parseFormXfdf,
  type FormValueEntry,
} from './fdf';
import { embedEditFont } from './fonts';
import { formatErrorMessage } from './error-text';
import {
  classifyPasswordError,
  encryptPdfBytes,
  readProtectionState,
} from './encryption';
import {
  applyPageLabels,
  carryOutlines,
  cropPagesInDoc,
  writeOutline,
} from './page-organize';
import { normalizeOutline, MAX_OUTLINE_DEPTH, type OutlineEntry } from '../../shared/outline';
import {
  fillFormField,
  findOrphanWidgets,
  flattenForm,
  getFormFields,
  restoreFormFieldsFromSnapshot,
  snapshotAllFormFields,
  type FormSnapshotEntry,
} from './forms';
import { auditSpace as auditSpacePdf } from './optimize';
import { carryAcroForm, carryAcroFormInto, fillFormNatively } from './form-fill';
import { OcrService, selectLowConfidence, type RawOcrWord, SUSPECT_CONFIDENCE_THRESHOLD } from './ocr';
import {
  DEFAULT_SETTINGS,
  DEFAULT_WATERMARK_COLOR,
  DEFAULT_WATERMARK_OPACITY,
  DEFAULT_WATERMARK_TEXT_SIZE,
  MAX_WATERMARK_PLACEMENTS_PER_PAGE,
  MAX_WATERMARKS_PER_DOC,
  normalizeRedactionColor,
  OCR_LANGUAGES,
  STAMP_IDS,
  normalizeWatermarkSettings,
} from './settings';
import {
  DEFAULT_TEXT_LINE_HEIGHT,
  EDIT_FONTS,
  isEditFont,
  validateTextBoxStylePatch,
  validateTextStyleFields,
} from './text-style';

// ---------------------------------------------------------------------------
// Internal document state
// ---------------------------------------------------------------------------

interface Snapshot {
  order: number[];
  deleted: boolean[];
  rotations: number[];
  annotations: AnnModel[][];
  placedSignatures: SignaturePlacement[];
  /** Phase 14 / DEF-135 / DEF-136 — text-box registry captured for undo of
   *  addTextBox/moveTextBox/deleteTextBox. Cloned the same way as
   *  placedSignatures (deep per-entry rect). */
  textBoxes?: TextBoxModel[];
  /** Snapshot of form field values for undo. Keyed by field id. */
  formFields?: FormField[];
  /** Rich form snapshot for rebuilding fields after flatten (DEF-028). */
  snapFormFields?: FormSnapshotEntry[];
  /** Phase 10 — serialized pdfDoc bytes captured before a content-editing
   *  op (editTextRun/addTextBox/editImage). Only Phase 10 ops mutate
   *  page content streams directly, so only they capture this; other
   *  ops leave it undefined and restoreSnapshot skips the pdfDoc reset. */
  pdfBytes?: Uint8Array;
  /** Phase 12 — logical page labels captured for undo of renumberPages. */
  pageLabels?: PageLabelEntry[];
  /** Phase 28 — comment threads captured for undo of addComment /
   *  deleteAnnotation (which drops the deleted annotation's thread). */
  comments?: CommentThread[];
  /** DEF-292 — set ONLY on the undo/redo entries a cross-document move
   *  pushes. It pairs this snapshot with the other document's snapshot and
   *  a shared `jointId`, so undoing/redoing from EITHER document reverts/
   *  re-applies BOTH sides as one action. Present on both stack entries. */
  joint?: JointSnapshotRef;
}

/** DEF-292 — the other half of a joint cross-document-move undo/redo entry.
 *  `otherSnapshot` is always a PLAIN snapshot (its own `joint` is undefined),
 *  so the two entries reference each other without nesting deeper. */
interface JointSnapshotRef {
  jointId: string;
  otherDocId: string;
  otherSnapshot: Snapshot;
}

/** DEF-292 — monotonic id shared by the two halves of one joint move. */
let jointSeq = 0;

function nextJointId(): string {
  jointSeq += 1;
  return `joint-${jointSeq}`;
}

interface EngineDoc {
  pdfDoc: PDFDocument;
  order: number[];
  deleted: boolean[];
  rotations: number[];
  annotations: AnnModel[][];
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  path: string;
  modified: boolean;
  placedSignatures: SignaturePlacement[];
  /** Phase 14 / DEF-135 / DEF-136 — text boxes held in the engine-side
   *  placement registry. Boxes are NOT baked into the page at add time;
   *  they are drawn once at their FINAL rect at save time (serializeDoc),
   *  so moving a box never masks the content under its old rect. */
  textBoxes: TextBoxModel[];
  /** Phase 11 — words recognised by the most recent `ocrRecognize` call,
   *  stored so `ocrSuspects` can return the low-confidence subset without
   *  re-running tesseract. Each entry is in the VISIBLE page space. */
  lastOcrWords?: StoredOcrWord[];
  /** Phase 12 — logical page labels set by `renumberPages`, in visible
   *  order. Applied to the serialized document's /PageLabels number tree so
   *  a viewer shows the custom labels instead of raw page numbers. */
  pageLabels?: PageLabelEntry[];
  /** Phase 28 — one comment thread per annotated element that has comments.
   *  Persisted into the output PDF's catalog (`/TFlexComments`) at save time
   *  and re-parsed on load, so threads survive save/reopen. */
  comments: CommentThread[];
  /** Phase 52 — the source document's encryption state, read from the raw
   *  bytes at load. `null` for an unencrypted document. Display-only: the
   *  engine never enforces the permission flags. */
  protection: DocumentProtectionState | null;
  /** Phase 59 item 4 — the per-field report from the most recent native fill
   *  (a per-field fill or the save-time pass). Attached to every built
   *  EngineState as `formFillReport`, so the renderer can show the outcome
   *  without a separate channel. */
  lastFormFillReport?: FormFillReport[];
}

/** Phase 11 — a recognised word persisted on the doc for suspects. `page`
 *  is the 1-based VISIBLE page; `rect` is top-left origin, PDF points. */
interface StoredOcrWord {
  text: string;
  confidence: number;
  page: number;
  rect: AnnRect;
}

// ---------------------------------------------------------------------------
// Phase 18 / DEF-216 — watermark identity
// ---------------------------------------------------------------------------

/** First line of every watermark content stream (a PDF comment, invisible
 *  to renderers): `%TFLEX-WATERMARK ` + base64url JSON payload. The payload
 *  carries the watermark id, its type/text, the 1-based visible page it was
 *  applied to, and the resource names (without leading '/') it uses on that
 *  page. This marker is the SINGLE SOURCE OF TRUTH for watermark identity —
 *  there is no in-memory registry, so identity survives a save/reopen
 *  round-trip and undo/restore of the doc bytes. */
const WATERMARK_MARKER_PREFIX = '%TFLEX-WATERMARK ';

interface WatermarkMarker {
  id: string;
  type: 'text' | 'image';
  text: string;
  page: number;
  /** Font resource name on this page (text watermarks). */
  font?: string;
  /** Image XObject name on this page (image watermarks). */
  img?: string;
  /** ExtGState (opacity) resource name on this page. */
  gs?: string;
}

/** Parse the watermark marker from a content stream's raw bytes. Returns
 *  null when the stream carries no (or an undecodable) marker. */
function readWatermarkMarker(contents: Uint8Array): WatermarkMarker | null {
  const text = Buffer.from(contents).toString('latin1');
  if (!text.startsWith(WATERMARK_MARKER_PREFIX)) return null;
  const rest = text.slice(WATERMARK_MARKER_PREFIX.length);
  const newline = rest.indexOf('\n');
  const payload = newline === -1 ? rest : rest.slice(0, newline);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof parsed.id !== 'string' || parsed.id.length === 0) return null;
  return {
    id: parsed.id,
    type: parsed.type === 'image' ? 'image' : 'text',
    text: typeof parsed.text === 'string' ? parsed.text : '',
    page: typeof parsed.page === 'number' ? parsed.page : 0,
    font: typeof parsed.font === 'string' ? parsed.font : undefined,
    img: typeof parsed.img === 'string' ? parsed.img : undefined,
    gs: typeof parsed.gs === 'string' ? parsed.gs : undefined,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class EngineService {
  private docs = new Map<string, EngineDoc>();

  /**
   * Phase 52 — session-only password cache. When a password opens an
   * encrypted document it is remembered here, keyed by doc id, so a later
   * (re)load for the same doc does not re-prompt. It is MAIN-process memory
   * only: it is never written to `settings.json`, never logged or traced,
   * never synced, and never returned over IPC. It is cleared when the
   * document is (re)loaded and by `closeDocument`.
   */
  private docPasswords = new Map<string, string>();

  /** Phase 11 — OCR service (tesseract.js). Optional: an engine built
   *  without it simply refuses `ocrRecognize` with `engine-error`. The
   *  main process constructs one with the bundled `assets/tessdata`
   *  langPath so recognition is fully offline. */
  constructor(private readonly ocr: OcrService | null = null) {}

  /** Phase 51 — per-doc OCR cancel flag. A running `_ocrRecognizeImpl`
   *  registers a fresh token here and removes it when it settles; `ocrCancel`
   *  flips `cancelled` directly (never queued) so it can interrupt a run
   *  mid-await. Because the token is run-scoped and deleted on settle, a
   *  cancel with no in-flight run is a no-op and can never bleed into a
   *  later run. */
  private ocrRuns = new Map<string, { cancelled: boolean }>();

  // Per-document promise queue serialises every state-touching operation
  // (applyOp, undo, redo, merge, split, save, saveAs, loadDocument,
  // loadDocumentBytes, createAnnotation, editAnnotation, deleteAnnotation,
  // getFormFields, fillFormField, flattenForms, placeSignature, moveSignature,
  // deleteSignature, and getState). getState must go through the queue too, so
  // a state read issued after in-flight mutations returns the state AFTER those
  // mutations have been applied, never a stale pre-mutation snapshot.
  // Each operation chains on the previous one; the queue never breaks
  // because rejected tasks are caught so the chain stays alive.
  private _queues = new Map<string, Promise<any>>();

  /**
   * Enqueue an async function for a given docId.  Returns a promise that
   * resolves with fn's return value once all previously-queued work for
   * that docId has completed.
   */
  private _enqueue<T>(docId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this._queues.get(docId) ?? Promise.resolve();
    const task = prev.then(() => fn());
    this._queues.set(docId, task.catch(() => {}));
    return task;
  }

  // -----------------------------------------------------------------------
  // loadDocument
  // -----------------------------------------------------------------------
  async loadDocument(
    docId: string,
    filePath: string,
    password?: string,
  ): Promise<Result<ArrayBuffer, EngineOpenError>> {
    return this._enqueue(docId, () => this._loadDocumentImpl(docId, filePath, password));
  }

  private async _loadDocumentImpl(
    docId: string,
    filePath: string,
    password?: string,
  ): Promise<Result<ArrayBuffer, EngineOpenError>> {
    // A cached session password is the fallback when the caller supplies
    // none; the cache entry is cleared as soon as the doc is replaced.
    const effectivePassword = password ?? this.docPasswords.get(docId);
    this.docPasswords.delete(docId);
    if (this.docs.has(docId)) {
      this.docs.delete(docId);
    }
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      return err('open-error', `could not read: ${filePath}`);
    }
    const bytes = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const registered = await this._registerDocument(
      docId,
      new Uint8Array(bytes),
      filePath,
      effectivePassword,
    );
    if (!registered.ok) return registered;
    return ok(bytes);
  }

  // -----------------------------------------------------------------------
  // loadDocumentBytes — bytes-only, no path.  Samples use this so the real
  // engine drives rotation/delete/undo/saveAs/annotations.  Save is disabled
  // until saveAs because there is no on-disk origin.
  // -----------------------------------------------------------------------
  async loadDocumentBytes(
    docId: string,
    bytes: Uint8Array,
    password?: string,
  ): Promise<Result<ArrayBuffer, EngineOpenError>> {
    return this._enqueue(docId, () => this._loadDocumentBytesImpl(docId, bytes, password));
  }

  private async _loadDocumentBytesImpl(
    docId: string,
    bytes: Uint8Array,
    password?: string,
  ): Promise<Result<ArrayBuffer, EngineOpenError>> {
    const effectivePassword = password ?? this.docPasswords.get(docId);
    this.docPasswords.delete(docId);
    if (this.docs.has(docId)) {
      this.docs.delete(docId);
    }
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const registered = await this._registerDocument(docId, view, '', effectivePassword);
    if (!registered.ok) return registered;
    // Return the original bytes so the renderer can feed them to PDF.js.
    const buf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
    return ok(buf);
  }

  /**
   * Phase 52 — parse `bytes` with the optional `password` (an empty string is
   * passed when the caller has none, which the fork supports: owner-restricted
   * files need no prompt) and register the document. Password failures are
   * typed (`need-password` / `incorrect-password`) so the renderer can prompt
   * and retry; every other failure is `open-error`.
   */
  private async _registerDocument(
    docId: string,
    bytes: Uint8Array,
    filePath: string,
    password: string | undefined,
  ): Promise<Result<null, EngineOpenError>> {
    try {
      const pdfDoc = await PDFDocument.load(bytes, {
        password: password ?? '',
        // ADV-125 / DEF-425 — keep /XFA so `hasXFA()` is truthful and the
        // XFA report branch can fire. Without this the fork strips /XFA at
        // parse time and an XFA-only form looks form-less.
        preserveXFA: true,
      });
      const count = pdfDoc.getPageCount();
      // DEF-032: reject 0-page documents at load time
      if (count === 0) {
        return err(
          'open-error',
          filePath.length > 0 ? `PDF has 0 pages: ${filePath}` : 'PDF has 0 pages',
        );
      }
      const annotations = parseAnnotationsFromDoc(pdfDoc);
      const placedSignatures = parseSignaturesFromDoc(pdfDoc);
      const textBoxes = parseTextBoxesFromDoc(pdfDoc);
      const comments = parseCommentsFromDoc(pdfDoc);
      const rotations = parseRotationsFromDoc(pdfDoc, count);
      // The fork drops /Encrypt once decrypted; `isDecrypted` is the signal
      // that the source was encrypted, at which point the raw bytes still
      // carry the encryption dictionary we report to the UI.
      const protection = pdfDoc.context.isDecrypted
        ? await readProtectionState(bytes)
        : null;
      const doc: EngineDoc = {
        pdfDoc,
        order: Array.from({ length: count }, (_, i) => i),
        deleted: Array.from({ length: count }, () => false),
        rotations,
        annotations,
        undoStack: [],
        redoStack: [],
        path: filePath,
        modified: false,
        placedSignatures,
        textBoxes,
        comments,
        protection,
      };
      this.docs.set(docId, doc);
      if (protection !== null) {
        this.docPasswords.set(docId, password ?? '');
      }
      return ok(null);
    } catch (e) {
      const passwordCode = classifyPasswordError(e);
      if (passwordCode !== null) {
        const where = filePath.length > 0 ? `: ${filePath}` : '';
        return err(
          passwordCode,
          passwordCode === 'need-password'
            ? `password required${where}`
            : `incorrect password${where}`,
        );
      }
      const detail = formatErrorMessage(e);
      return err(
        'open-error',
        filePath.length > 0
          ? `could not parse PDF: ${filePath} (${detail})`
          : `could not parse PDF bytes (${detail})`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // getDocumentProtection — Phase 52. The source document's encryption state
  // read at load (algorithm/revision/CFM + permission flags), or null for an
  // unencrypted document. Display-only; never enforced.
  // -----------------------------------------------------------------------
  async getDocumentProtection(
    docId: string,
  ): Promise<Result<DocumentProtection, EngineError>> {
    return this._enqueue(docId, () => this._getDocumentProtectionImpl(docId));
  }

  private async _getDocumentProtectionImpl(
    docId: string,
  ): Promise<Result<DocumentProtection, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    return ok(doc.protection);
  }

  // -----------------------------------------------------------------------
  // encryptDocument — Phase 52 feature D. Serialize the current document to
  // plain bytes, then produce an encrypted copy (AES-256 default / AES-128).
  // Returns the produced bytes for the existing save/export flow to write.
  // The live engine document is NOT mutated and stays decrypted, so its own
  // save remains a plain file.
  // -----------------------------------------------------------------------
  async encryptDocument(
    docId: string,
    options: EncryptDocumentOptions,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this._enqueue(docId, () => this._encryptDocumentImpl(docId, options));
  }

  private async _encryptDocumentImpl(
    docId: string,
    options: EncryptDocumentOptions,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const plainBytes = await serializeDoc(doc);
      const encrypted = await encryptPdfBytes(plainBytes, options);
      const ab = encrypted.buffer.slice(
        encrypted.byteOffset,
        encrypted.byteOffset + encrypted.byteLength,
      ) as ArrayBuffer;
      return ok(ab);
    } catch (e) {
      return err('engine-error', `encrypt failed: ${formatErrorMessage(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // closeDocument — Phase 52. Drops the document and clears its session
  // password so a closed document can never leave a password in memory.
  // -----------------------------------------------------------------------
  async closeDocument(docId: string): Promise<void> {
    return this._enqueue(docId, async () => {
      this.docPasswords.delete(docId);
      this.docs.delete(docId);
    });
  }

  // -----------------------------------------------------------------------
  // applyOp
  // -----------------------------------------------------------------------
  async applyOp(
    docId: string,
    op: OpEntry,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._applyOpImpl(docId, op));
  }

  private async _applyOpImpl(
    docId: string,
    op: OpEntry,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const snapshot = snapshotDoc(doc);
    const result = applyOpToDoc(doc, op);
    if (!result.ok) {
      return result;
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // undo
  // -----------------------------------------------------------------------
  async undo(docId: string): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._undoImpl(docId));
  }

  private async _undoImpl(docId: string): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    if (doc.undoStack.length === 0) {
      return err('nothing-to-undo', 'undo stack is empty');
    }
    const prev = doc.undoStack[doc.undoStack.length - 1];
    // DEF-292: a joint cross-document-move entry reverts BOTH documents in
    // one action; handled separately so the two stacks stay in sync.
    if (prev.joint) {
      return this._undoJoint(docId, doc, prev);
    }
    doc.undoStack.pop();
    // Phase 10: if the snapshot we're restoring captured pdfDoc bytes,
    // the current (post-edit) state also needs a pdf snapshot so a
    // subsequent redo can restore the edited content.
    const current = prev.pdfBytes
      ? await snapshotDocWithPdf(doc)
      : snapshotDoc(doc);
    doc.redoStack.push(current);
    await restoreSnapshot(doc, prev);
    doc.modified = doc.undoStack.length > 0
      ? true
      : false;
    return ok(buildState(doc));
  }

  /**
   * DEF-292 — undo one joint cross-document-move entry. Reverts BOTH
   * documents (the moved pages return to their source at their original
   * index and leave the target) and pushes a matching joint entry onto
   * EACH document's redo stack, so redo from either side re-applies both.
   *
   * Divergence rule: the other document must still be open AND its undo
   * stack top must be this entry's counterpart (same `jointId`). Otherwise
   * NOTHING is mutated and a typed `engine-error` is returned — never a
   * one-sided restore, so a page can never be lost.
   */
  private async _undoJoint(
    docId: string,
    doc: EngineDoc,
    prev: Snapshot,
  ): Promise<Result<EngineState, EngineError>> {
    const joint = prev.joint!;
    const other = this.docs.get(joint.otherDocId);
    if (other === undefined) {
      return err(
        'engine-error',
        `cannot undo cross-document move: document ${joint.otherDocId} is no longer open`,
      );
    }
    const otherTop = other.undoStack[other.undoStack.length - 1];
    if (otherTop === undefined || otherTop.joint?.jointId !== joint.jointId) {
      return err(
        'engine-error',
        'cannot undo cross-document move: the other document has diverged',
      );
    }
    // Capture both current (post-move) states so a redo from either side can
    // re-apply the move.
    const current = await snapshotDocWithPdf(doc);
    const otherCurrent = await snapshotDocWithPdf(other);
    doc.redoStack.push({
      ...current,
      joint: { jointId: joint.jointId, otherDocId: joint.otherDocId, otherSnapshot: otherCurrent },
    });
    other.redoStack.push({
      ...otherCurrent,
      joint: { jointId: joint.jointId, otherDocId: docId, otherSnapshot: current },
    });
    doc.undoStack.pop();
    other.undoStack.pop();
    await restoreSnapshot(doc, prev);
    await restoreSnapshot(other, joint.otherSnapshot);
    doc.modified = doc.undoStack.length > 0;
    other.modified = other.undoStack.length > 0;
    return ok(pairedState(joint.otherDocId, doc, other));
  }

  // -----------------------------------------------------------------------
  // redo
  // -----------------------------------------------------------------------
  async redo(docId: string): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._redoImpl(docId));
  }

  private async _redoImpl(docId: string): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    if (doc.redoStack.length === 0) {
      return err('nothing-to-redo', 'redo stack is empty');
    }
    const next = doc.redoStack[doc.redoStack.length - 1];
    // DEF-292: a joint cross-document-move redo re-applies BOTH documents.
    if (next.joint) {
      return this._redoJoint(docId, doc, next);
    }
    doc.redoStack.pop();
    // Phase 10: mirror undo — capture pdfBytes for current if the redo
    // target has them.
    const current = next.pdfBytes
      ? await snapshotDocWithPdf(doc)
      : snapshotDoc(doc);
    doc.undoStack.push(current);
    await restoreSnapshot(doc, next);
    doc.modified = true;
    return ok(buildState(doc));
  }

  /**
   * DEF-292 — redo one joint cross-document-move entry. Symmetric to
   * `_undoJoint`: re-applies the move on BOTH documents and pushes a
   * matching joint entry back onto EACH undo stack. Same divergence rule —
   * if the other document is gone or its redo stack top is not this
   * entry's counterpart, nothing is mutated and a typed error is returned.
   */
  private async _redoJoint(
    docId: string,
    doc: EngineDoc,
    next: Snapshot,
  ): Promise<Result<EngineState, EngineError>> {
    const joint = next.joint!;
    const other = this.docs.get(joint.otherDocId);
    if (other === undefined) {
      return err(
        'engine-error',
        `cannot redo cross-document move: document ${joint.otherDocId} is no longer open`,
      );
    }
    const otherTop = other.redoStack[other.redoStack.length - 1];
    if (otherTop === undefined || otherTop.joint?.jointId !== joint.jointId) {
      return err(
        'engine-error',
        'cannot redo cross-document move: the other document has diverged',
      );
    }
    // Capture both current (pre-move) states so a subsequent undo from
    // either side can revert the move.
    const current = await snapshotDocWithPdf(doc);
    const otherCurrent = await snapshotDocWithPdf(other);
    doc.undoStack.push({
      ...current,
      joint: { jointId: joint.jointId, otherDocId: joint.otherDocId, otherSnapshot: otherCurrent },
    });
    other.undoStack.push({
      ...otherCurrent,
      joint: { jointId: joint.jointId, otherDocId: docId, otherSnapshot: current },
    });
    doc.redoStack.pop();
    other.redoStack.pop();
    await restoreSnapshot(doc, next);
    await restoreSnapshot(other, joint.otherSnapshot);
    doc.modified = true;
    other.modified = true;
    return ok(pairedState(joint.otherDocId, doc, other));
  }

  // -----------------------------------------------------------------------
  // merge
  // -----------------------------------------------------------------------
  async merge(
    docId: string,
    otherPaths: string[],
    position: 'before' | 'after',
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._mergeImpl(docId, otherPaths, position));
  }

  private async _mergeImpl(
    docId: string,
    otherPaths: string[],
    position: 'before' | 'after',
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const snapshot = snapshotDoc(doc);
    try {
      const mergedDoc = await PDFDocument.create();
      const otherDocs: PDFDocument[] = [];
      for (const p of otherPaths) {
        const buf = await readFile(p);
        otherDocs.push(await PDFDocument.load(buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer, { preserveXFA: true }));
      }

      const survivingIndices = doc.order.filter((_, i) => !doc.deleted[doc.order[i]]);
      const surviving = survivingIndices.map((origIdx) => ({
        origIdx,
        rotation: doc.rotations[origIdx],
      }));

      const newOrder: number[] = [];
      let otherPageCount = 0;

      if (position === 'before') {
        for (const otherDoc of otherDocs) {
          const pages = await mergedDoc.copyPages(otherDoc, otherDoc.getPageIndices());
          for (const p of pages) {
            mergedDoc.addPage(p);
          }
          for (let i = 0; i < otherDoc.getPageCount(); i++) {
            newOrder.push(-1);
            otherPageCount++;
          }
        }
      }

      for (const { origIdx, rotation } of surviving) {
        const [copied] = await mergedDoc.copyPages(doc.pdfDoc, [origIdx]);
        if (rotation !== 0) {
          copied.setRotation(degrees(rotation * 90));
        }
        mergedDoc.addPage(copied);
        newOrder.push(origIdx);
      }

      if (position === 'after') {
        for (const otherDoc of otherDocs) {
          const pages = await mergedDoc.copyPages(otherDoc, otherDoc.getPageIndices());
          for (const p of pages) {
            mergedDoc.addPage(p);
          }
          for (let i = 0; i < otherDoc.getPageCount(); i++) {
            newOrder.push(-1);
            otherPageCount++;
          }
        }
      }

      const newCount = mergedDoc.getPageCount();
      // Build new annotations: -1 entries (other-doc pages) get empty arrays
      const newAnnotations: AnnModel[][] = [];
      for (const origIdx of newOrder) {
        if (origIdx >= 0 && doc.annotations[origIdx] !== undefined) {
          newAnnotations[newAnnotations.length] = cloneAnnotations([doc.annotations[origIdx]])[0];
        } else {
          newAnnotations[newAnnotations.length] = [];
        }
      }

      // Signature placements: update page numbers for surviving pages
      // after merge. Pages inserted before shift all placements down.
      const newPlacedSignatures: SignaturePlacement[] = [];
      if (position === 'before') {
        // All original page placements shift down by otherPageCount
        for (const sp of doc.placedSignatures) {
          newPlacedSignatures.push({ ...sp, page: sp.page + otherPageCount, rect: { ...sp.rect } });
        }
      } else {
        // No shift for 'after' merges
        for (const sp of doc.placedSignatures) {
          newPlacedSignatures.push({ ...sp, rect: { ...sp.rect } });
        }
      }

      // ADV-121 / DEF-421 — CARRY (not recreate) the AcroForm of every source
      // document into the merged output, exactly as the save path does.
      // carryAcroFormInto deep-copies each source /AcroForm object graph with
      // one page-map-seeded copier, keeps every widget's real /Rect, and
      // appends the incoming /Fields into the destination tree (renaming a
      // colliding field and its widgets deterministically, reported in
      // `collisions`). Recreating fields with addToPage (the old DEF-029 path)
      // reset every widget to pdf-lib's default box and destroyed the form.
      try {
        const mainPageMap = new Map<number, number>();
        for (let i = 0; i < newOrder.length; i++) {
          if (newOrder[i] >= 0) mainPageMap.set(newOrder[i], i);
        }
        carryAcroFormInto(doc.pdfDoc, mergedDoc, mainPageMap);

        let otherOffset = position === 'before' ? 0 : doc.order.length;
        for (const otherDoc of otherDocs) {
          const otherPageMap = new Map<number, number>();
          for (let i = 0; i < otherDoc.getPageCount(); i++) {
            otherPageMap.set(i, otherOffset + i);
          }
          carryAcroFormInto(otherDoc, mergedDoc, otherPageMap);
          otherOffset += otherDoc.getPageCount();
        }
      } catch {
        // A malformed form must never block a merge; the merge proceeds
        // without that source's form.
      }

      // ADV-165 / DEF-495 — CARRY the outline of every source into the merged
      // output. Object-number ref tags are NOT unique across PDFDocuments
      // (each context numbers objects from 1), so build one map per source
      // (source page ref tag -> merged page ref) and let carryOutlines remap
      // only within that source's own outline. Mirrors the replacePages carry
      // below. Best-effort: a malformed outline must never block a merge.
      try {
        const mainMap = new Map<string, PDFRef>();
        for (let i = 0; i < newOrder.length; i++) {
          if (newOrder[i] >= 0) {
            mainMap.set(
              doc.pdfDoc.getPage(newOrder[i]).ref.tag,
              mergedDoc.getPage(i).ref,
            );
          }
        }
        const outlineSources: Array<{ doc: PDFDocument; map: Map<string, PDFRef> }> = [
          { doc: doc.pdfDoc, map: mainMap },
        ];
        // Other docs occupy merged indices starting at 0 for 'before' and at
        // the surviving-main-page count for 'after' (mirrors carryAcroFormInto).
        let otherOffset = position === 'before' ? 0 : surviving.length;
        for (const otherDoc of otherDocs) {
          const otherMap = new Map<string, PDFRef>();
          for (let i = 0; i < otherDoc.getPageCount(); i++) {
            otherMap.set(
              otherDoc.getPage(i).ref.tag,
              mergedDoc.getPage(otherOffset + i).ref,
            );
          }
          outlineSources.push({ doc: otherDoc, map: otherMap });
          otherOffset += otherDoc.getPageCount();
        }
        carryOutlines(mergedDoc, outlineSources);
      } catch {
        // Outline carry is best-effort — never block a merge on it.
      }

      doc.pdfDoc = mergedDoc;
      doc.order = Array.from({ length: newCount }, (_, i) => i);
      doc.deleted = Array.from({ length: newCount }, () => false);
      doc.rotations = Array.from({ length: newCount }, () => 0);
      doc.annotations = newAnnotations;
      doc.placedSignatures = newPlacedSignatures;
      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      return err('engine-error', `merge failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // split
  // -----------------------------------------------------------------------
  async split(
    docId: string,
    range: [number, number],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this._enqueue(docId, () => this._splitImpl(docId, range));
  }

  private async _splitImpl(
    docId: string,
    range: [number, number],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const [start, end] = range;
    const surviving = doc.order.length;
    if (start < 0 || end >= surviving || start > end) {
      return err('engine-error', `split range [${start},${end}] out of bounds for ${surviving} pages`);
    }
    // DEF-012: guard against splitting all pages (would leave 0-page source)
    if (start === 0 && end === surviving - 1) {
      return err('empty-range', 'cannot split all pages — the source document would become empty');
    }
    const snapshot = snapshotDoc(doc);
    try {
      const splitDoc = await PDFDocument.create();
      const splitAnns: AnnModel[][] = [];
      for (let vi = start; vi <= end; vi++) {
        const origIdx = doc.order[vi];
        const [copied] = await splitDoc.copyPages(doc.pdfDoc, [origIdx]);
        const rotation = doc.rotations[origIdx];
        if (rotation !== 0) {
          copied.setRotation(degrees(rotation * 90));
        }
        splitDoc.addPage(copied);
        // Capture split-page annotations for the split doc
        const pageAnns = doc.annotations[origIdx];
        splitAnns[splitAnns.length] = pageAnns !== undefined
          ? cloneAnnotations([pageAnns])[0]
          : [];
      }

      // Remove split pages from current doc
      doc.order.splice(start, end - start + 1);
      // Rebuild annotations mapping to remaining order
      const newAnnotations: AnnModel[][] = [];
      for (const origIdx of doc.order) {
        const pageAnns = doc.annotations[origIdx];
        newAnnotations[origIdx] = pageAnns !== undefined ? pageAnns : [];
      }
      doc.annotations = newAnnotations;

      // Rebuild deleted/rotations to match the new order
      const newDeleted = Array.from({ length: doc.pdfDoc.getPageCount() }, () => true);
      const newRotations = Array.from({ length: doc.pdfDoc.getPageCount() }, () => 0);
      for (const origIdx of doc.order) {
        newDeleted[origIdx] = false;
        newRotations[origIdx] = doc.rotations[origIdx];
      }
      doc.deleted = newDeleted;
      doc.rotations = newRotations;

      // Update signature placements: remove placements on split pages,
      // shift down placements on pages after the split range
      const removedCount = end - start + 1;
      const newPlaced: SignaturePlacement[] = [];
      for (const sp of doc.placedSignatures) {
        const spPage1 = sp.page; // 1-based
        if (spPage1 >= start + 1 && spPage1 <= end + 1) {
          // Placement was on a split page — drop it
          continue;
        }
        if (spPage1 > end + 1) {
          // Placement was after the split — shift page number up
          newPlaced.push({ ...sp, page: spPage1 - removedCount, rect: { ...sp.rect } });
        } else {
          newPlaced.push({ ...sp, rect: { ...sp.rect } });
        }
      }
      doc.placedSignatures = newPlaced;

      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;

      // Serialize split doc with annotations
      // Note: split doc doesn't get signature placements (those stay with source)
      await serializeAnnotations(splitDoc, splitAnns, Array.from({ length: splitAnns.length }, (_, i) => i));
      stampBrandMetadata(splitDoc);
      const bytes = await splitDoc.save();
      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (e) {
      return err('engine-error', `split failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // extract
  // -----------------------------------------------------------------------
  async extract(
    docId: string,
    pages: number[],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const surviving = doc.order.length;
    for (const p of pages) {
      if (p < 0 || p >= surviving) {
        return err('engine-error', `extract page ${p} out of bounds for ${surviving} pages`);
      }
    }
    try {
      const extractDoc = await PDFDocument.create();
      const extractAnns: AnnModel[][] = [];
      for (const vi of pages) {
        const origIdx = doc.order[vi];
        const [copied] = await extractDoc.copyPages(doc.pdfDoc, [origIdx]);
        const rotation = doc.rotations[origIdx];
        if (rotation !== 0) {
          copied.setRotation(degrees(rotation * 90));
        }
        extractDoc.addPage(copied);
        const pageAnns = doc.annotations[origIdx];
        extractAnns[extractAnns.length] = pageAnns !== undefined
          ? cloneAnnotations([pageAnns])[0]
          : [];
      }

      // Serialize annotations on the extract doc
      await serializeAnnotations(extractDoc, extractAnns, Array.from({ length: extractAnns.length }, (_, i) => i));
      stampBrandMetadata(extractDoc);
      const bytes = await extractDoc.save();
      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (e) {
      return err('engine-error', `extract failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // save
  // -----------------------------------------------------------------------
  async save(docId: string): Promise<Result<string, EngineError>> {
    return this._enqueue(docId, () => this._saveImpl(docId));
  }

  private async _saveImpl(docId: string): Promise<Result<string, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const bytes = await serializeDoc(doc);
      await writeFile(doc.path, Buffer.from(bytes));
      doc.modified = false;
      doc.undoStack = [];
      doc.redoStack = [];
      return ok(doc.path);
    } catch (e) {
      return err('engine-error', `save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // saveAs — writes to a new path; updates doc.path
  // -----------------------------------------------------------------------
  async saveAs(docId: string, newPath: string): Promise<Result<string, 'cancelled' | 'write-error'>> {
    return this._enqueue(docId, () => this._saveAsImpl(docId, newPath));
  }

  private async _saveAsImpl(docId: string, newPath: string): Promise<Result<string, 'cancelled' | 'write-error'>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('cancelled', `unknown document: ${docId}`);
    }
    try {
      const bytes = await serializeDoc(doc);
      await writeFile(newPath, Buffer.from(bytes));
      doc.path = newPath;
      doc.modified = false;
      doc.undoStack = [];
      doc.redoStack = [];
      return ok(newPath);
    } catch (e) {
      return err('write-error', `saveAs failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // getState
  // -----------------------------------------------------------------------
  async getState(docId: string): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._getStateImpl(docId));
  }

  private async _getStateImpl(docId: string): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // isModified — DEF-085 (Bug 4): cheap dirty-check the renderer calls
  // before closing a tab to decide whether to prompt "save unsaved
  // changes?". Goes through the per-doc queue so the returned flag
  // reflects every prior queued mutation; an unknown docId resolves to
  // engine-error (the renderer only calls this for an open doc).
  // -----------------------------------------------------------------------
  async isModified(
    docId: string,
  ): Promise<Result<boolean, EngineError>> {
    return this._enqueue(docId, () => this._isModifiedImpl(docId));
  }

  private async _isModifiedImpl(
    docId: string,
  ): Promise<Result<boolean, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    return ok(doc.modified);
  }

  // -----------------------------------------------------------------------
  // getDocumentBytes — Phase 11. Returns the current serialized document
  // (the same bytes a save would write: page order, rotations, annotations,
  // forms, signatures and any content-stream edits like the OCR text layer)
  // so the renderer can rebuild its PDF.js proxy after a mutation that the
  // original load bytes no longer reflect. Read-only: it does NOT touch
  // `modified` or the undo stacks, so a subsequent save still persists.
  // Goes through the per-doc queue so it observes every prior mutation.
  // -----------------------------------------------------------------------
  async getDocumentBytes(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this._enqueue(docId, () => this._getDocumentBytesImpl(docId));
  }

  private async _getDocumentBytesImpl(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const bytes = await serializeDoc(doc);
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      return ok(ab);
    } catch (e) {
      return err('engine-error', `getDocumentBytes failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Annotations — create / edit / delete
  // -----------------------------------------------------------------------

  async createAnnotation(
    docId: string,
    payload: CreateAnnotationPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._createAnnotationImpl(docId, payload));
  }

  private async _createAnnotationImpl(
    docId: string,
    payload: CreateAnnotationPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const snapshot = snapshotDoc(doc);
    const result = createAnnotation(doc.annotations, doc.order, payload);
    if (!result.ok) {
      return result;
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  async editAnnotation(
    docId: string,
    annId: string,
    payload: EditAnnotationPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._editAnnotationImpl(docId, annId, payload));
  }

  private async _editAnnotationImpl(
    docId: string,
    annId: string,
    payload: EditAnnotationPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const snapshot = snapshotDoc(doc);
    const result = editAnnotation(doc.annotations, annId, payload);
    if (!result.ok) {
      return result;
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  async deleteAnnotation(
    docId: string,
    annId: string,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._deleteAnnotationImpl(docId, annId));
  }

  private async _deleteAnnotationImpl(
    docId: string,
    annId: string,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const snapshot = snapshotDoc(doc);
    const result = deleteAnnotation(doc.annotations, annId);
    if (!result.ok) {
      return result;
    }
    // Phase 28 — deleting an annotation drops its comment thread. The
    // snapshot above still carries the thread, so undo restores both.
    doc.comments = doc.comments.filter((t) => t.annotationId !== annId);
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // Phase 28 — comment threads: one op for the first comment and replies
  // -----------------------------------------------------------------------

  async addComment(
    docId: string,
    annotationId: string,
    text: string,
    author?: string,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._addCommentImpl(docId, annotationId, text, author));
  }

  private async _addCommentImpl(
    docId: string,
    annotationId: string,
    text: string,
    author?: string,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    // A comment on a missing annotation fails loud (typed engine-error).
    if (!hasAnnotation(doc, annotationId)) {
      return err('engine-error', `unknown annotation: ${annotationId}`);
    }
    const validated = validateCommentText(text);
    if (!validated.ok) {
      return err('engine-error', validated.reason);
    }
    const snapshot = snapshotDoc(doc);
    const entry: CommentEntry = {
      id: `cmt-${randomUUID()}`,
      author: normalizeCommentAuthor(author),
      text: validated.text,
      createdAt: Date.now(),
    };
    // First call for an annotation creates the thread; every later call
    // appends a reply entry (oldest-first order preserved).
    const thread = doc.comments.find((t) => t.annotationId === annotationId);
    if (thread !== undefined) {
      thread.entries.push(entry);
    } else {
      doc.comments.push({ annotationId, entries: [entry] });
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // Phase 4: Forms — getFormFields / fillFormField / flattenForms
  // -----------------------------------------------------------------------

  async getFormFields(
    docId: string,
  ): Promise<Result<FormField[], EngineError>> {
    return this._enqueue(docId, () => this._getFormFieldsImpl(docId));
  }

  private async _getFormFieldsImpl(
    docId: string,
  ): Promise<Result<FormField[], EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const rawFields = getFormFields(doc.pdfDoc);
      // DEF-031: remap page numbers to visible positions
      const remapped = remapFormFieldPages(rawFields, doc.order);
      return ok(remapped);
    } catch (e) {
      return err('engine-error', `getFormFields failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async fillFormField(
    docId: string,
    payload: FillFormFieldPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._fillFormFieldImpl(docId, payload));
  }

  private async _fillFormFieldImpl(
    docId: string,
    payload: FillFormFieldPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    // ADV-124 / DEF-424 — an orphan widget is not reachable from the AcroForm
    // /Fields tree, so a native fill can never write it. Return a truthful
    // `orphan-unfilled` report row and leave the document UNMODIFIED (no undo
    // entry, no `modified` flag) instead of claiming a fill that never
    // happened.
    if (payload.id.startsWith('orphan-')) {
      doc.lastFormFillReport = orphanUnfilledReport(doc.pdfDoc, payload.id);
      return ok(buildState(doc));
    }
    const snapshot = snapshotDoc(doc);
    try {
      // Phase 59 item 4 — fill natively: set the field value and regenerate
      // appearances with the bundled Unicode font, returning a per-field
      // report. A multi-widget button group is filled at the dict level
      // (the typed check() API cannot reach a non-first on-value).
      const values = new Map<string, string | string[]>();
      values.set(payload.id, payload.value);
      let font: Awaited<ReturnType<typeof embedEditFont>>;
      try {
        font = await embedEditFont(doc.pdfDoc, 'DejaVu Serif', false, false);
      } catch {
        // No bundled Unicode font available: fall back to the typed API
        // (groups still work through fillFormField's dict-level path).
        fillFormField(doc.pdfDoc, payload.id, payload.value);
        doc.lastFormFillReport = undefined;
        doc.undoStack.push(snapshot);
        doc.redoStack = [];
        doc.modified = true;
        return ok(buildState(doc));
      }
      doc.lastFormFillReport = fillFormNatively(doc.pdfDoc, font, values);
    } catch (e) {
      return err('engine-error', `fillFormField failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  async flattenForms(
    docId: string,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._flattenFormsImpl(docId));
  }

  private async _flattenFormsImpl(
    docId: string,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    // DEF-403: flattenForm mutates the pdfDoc (bakes widget appearances into
    // page content and removes the AcroForm), so the snapshot MUST capture the
    // serialized bytes for undo to reload the unflattened document.
    const snapshot = await snapshotDocWithPdf(doc);
    try {
      flattenForm(doc.pdfDoc);
    } catch (e) {
      return err('engine-error', `flattenForms failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // Phase 4: Signatures — place / move / delete
  // -----------------------------------------------------------------------

  async placeSignature(
    docId: string,
    payload: PlaceSignaturePayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._placeSignatureImpl(docId, payload));
  }

  private async _placeSignatureImpl(
    docId: string,
    payload: PlaceSignaturePayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    // DEF-027: guard placement on 0-page doc
    if (doc.order.length === 0) {
      return err('out-of-range', `cannot place signature on a document with 0 pages`);
    }
    // Validate page is within range (1-based)
    if (payload.page < 1 || payload.page > doc.order.length) {
      return err('out-of-range', `page ${payload.page} out of range [1,${doc.order.length}]`);
    }
    const snapshot = snapshotDoc(doc);
    const placement: SignaturePlacement = {
      id: payload.id,
      signatureId: payload.signatureId,
      page: payload.page,
      rect: { ...payload.rect },
      pngBytes: payload.pngBytes,
    };
    doc.placedSignatures.push(placement);
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  async moveSignature(
    docId: string,
    payload: MoveSignaturePayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._moveSignatureImpl(docId, payload));
  }

  private async _moveSignatureImpl(
    docId: string,
    payload: MoveSignaturePayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const idx = doc.placedSignatures.findIndex((sp) => sp.id === payload.id);
    if (idx === -1) {
      return err('not-found', `placed signature ${payload.id} not found`);
    }
    const snapshot = snapshotDoc(doc);
    doc.placedSignatures[idx] = {
      ...doc.placedSignatures[idx],
      page: payload.page,
      rect: { ...payload.rect },
    };
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  async deleteSignature(
    docId: string,
    sigPlacementId: string,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._deleteSignatureImpl(docId, sigPlacementId));
  }

  private async _deleteSignatureImpl(
    docId: string,
    sigPlacementId: string,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const idx = doc.placedSignatures.findIndex((sp) => sp.id === sigPlacementId);
    if (idx === -1) {
      return err('not-found', `placed signature ${sigPlacementId} not found`);
    }
    const snapshot = snapshotDoc(doc);
    doc.placedSignatures.splice(idx, 1);
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // Phase 8: Optimize — reduce file size / audit space
  // -----------------------------------------------------------------------

  /**
   * Generate an optimized copy of the current document state as bytes.
   * The preset controls compression level:
   *   'none'    — linearized output (no object streams), largest file
   *   'compact' — compressed with object streams (default pdf-lib behaviour)
   *   'max'     — compressed + metadata stripped, smallest file
   *
   * The operation is read-only: it does not modify the engine's document
   * state, undo stack, or modified flag. It sends the serialised bytes
   * back so the caller can decide whether to save them.
   */
  async optimize(
    docId: string,
    preset: OptimizePreset,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this._enqueue(docId, () => this._optimizeImpl(docId, preset));
  }

  private async _optimizeImpl(
    docId: string,
    preset: OptimizePreset,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const bytes = await serializeDocOptimized(doc, preset);
      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (e) {
      return err('engine-error', `optimize failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Walk the current PDFDocument's indirect objects and return a size
   * breakdown by element type (images, fonts, content streams, metadata,
   * other). The operation is read-only and does not queue behind
   * mutations — it can run in parallel with other operations on the
   * same docId since it only reads the PDFDocument context.
   */
  async auditSpace(
    docId: string,
  ): Promise<Result<SpaceAudit, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const audit = auditSpacePdf(doc.pdfDoc);
      return ok(audit);
    } catch (e) {
      return err('engine-error', `auditSpace failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 9: createFromImages — synthesize a PDF from image buffers
  // -----------------------------------------------------------------------
  async createFromImages(
    docId: string,
    imageBuffers: Uint8Array[],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this._enqueue(docId, () => this._createFromImagesImpl(docId, imageBuffers));
  }

  private async _createFromImagesImpl(
    docId: string,
    imageBuffers: Uint8Array[],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    if (imageBuffers.length === 0) {
      return err('empty-range', 'no images provided');
    }
    try {
      const out = await PDFDocument.create();
      for (const buf of imageBuffers) {
        const isPng = detectImageFormat(buf) === 'png';
        const image = isPng
          ? await out.embedPng(buf)
          : await out.embedJpg(buf);
        const dims = image.scale(1);
        const page = out.addPage([dims.width, dims.height]);
        page.drawImage(image, { x: 0, y: 0, width: dims.width, height: dims.height });
      }
      // Phase 49 — brand the newly produced PDF's Producer/Creator as Jovrel.
      stampBrandMetadata(out);
      const bytes = await out.save();

      // Replace the doc entry for this docId with the newly created PDF
      const newDoc: EngineDoc = {
        pdfDoc: out,
        order: Array.from({ length: out.getPageCount() }, (_, i) => i),
        deleted: Array.from({ length: out.getPageCount() }, () => false),
        rotations: Array.from({ length: out.getPageCount() }, () => 0),
        annotations: Array.from({ length: out.getPageCount() }, () => []),
        undoStack: [],
        redoStack: [],
        path: '',
        modified: true,
        placedSignatures: [],
        textBoxes: [],
        comments: [],
        protection: null,
      };
      this.docs.set(docId, newDoc);

      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (e) {
      return err('engine-error', `createFromImages failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 9: createFromClipboard — synthesize a PDF from clipboard content
  // -----------------------------------------------------------------------
  async createFromClipboard(
    docId: string,
    content: Uint8Array | string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this._enqueue(docId, () => this._createFromClipboardImpl(docId, content));
  }

  private async _createFromClipboardImpl(
    docId: string,
    content: Uint8Array | string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    try {
      const out = await PDFDocument.create();

      if (typeof content === 'string') {
        // Text content — render as a text page
        const page = out.addPage([612, 792]); // Letter size
        const lines = content.split('\n');
        const fontSize = 12;
        const lineHeight = fontSize * 1.2;
        const margin = 72;
        let y = 792 - margin;
        let currentPage = page;

        for (const line of lines) {
          if (y < margin) {
            currentPage = out.addPage([612, 792]);
            y = 792 - margin;
          }
          currentPage.drawText(line, { x: margin, y, size: fontSize });
          y -= lineHeight;
        }
      } else {
        // Image content — embed into a page
        const isPng = detectImageFormat(content) === 'png';
        const image = isPng
          ? await out.embedPng(content)
          : await out.embedJpg(content);
        const dims = image.scale(1);
        const page = out.addPage([dims.width, dims.height]);
        page.drawImage(image, { x: 0, y: 0, width: dims.width, height: dims.height });
      }

      // Phase 49 — brand the newly produced PDF's Producer/Creator as Jovrel.
      stampBrandMetadata(out);
      const bytes = await out.save();

      const newDoc: EngineDoc = {
        pdfDoc: out,
        order: Array.from({ length: out.getPageCount() }, (_, i) => i),
        deleted: Array.from({ length: out.getPageCount() }, () => false),
        rotations: Array.from({ length: out.getPageCount() }, () => 0),
        annotations: Array.from({ length: out.getPageCount() }, () => []),
        undoStack: [],
        redoStack: [],
        path: '',
        modified: true,
        placedSignatures: [],
        textBoxes: [],
        comments: [],
        protection: null,
      };
      this.docs.set(docId, newDoc);

      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (e) {
      return err('engine-error', `createFromClipboard failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 9: insertBlankPage — insert a blank page at a given position
  // -----------------------------------------------------------------------
  async insertBlankPage(
    docId: string,
    afterIndex: number,
    widthPx: number,
    heightPx: number,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._insertBlankPageImpl(docId, afterIndex, widthPx, heightPx));
  }

  private async _insertBlankPageImpl(
    docId: string,
    afterIndex: number,
    widthPx: number,
    heightPx: number,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    // B15 — guard out-of-range. afterIndex is the 0-based visible index
    // AFTER which the blank page is inserted. DEF-114: -1 and
    // doc.order.length both append after the last page (-1 is the
    // renderer's "end"/"append" sentinel, matching insertFromPdf's -1
    // semantics). DEF-129: -2 is the PREPEND sentinel — the new blank
    // page becomes the FIRST visible page (pageOrder[0]); the renderer's
    // InsertPagesDialog maps "insert before page 1" (position 0 in blank
    // mode) to afterIndex = -2 via
    //   `afterIndex = position === 0 ? -2 : position - 1`.
    // 0..n-1 inserts after that page; n appends. Values outside
    // [-2, doc.order.length] (or non-finite) come from a renderer that
    // derived the position from a stale current page after the doc
    // shrank; the previous code silently clamped them, which landed the
    // blank page at an unexpected position and the renderer then rendered
    // a page-out-of-range / black canvas. Reject with a clean out-of-range
    // so the renderer surfaces a toast instead of a broken view.
    if (!Number.isFinite(afterIndex) || afterIndex < -2 || afterIndex > doc.order.length) {
      return err(
        'out-of-range',
        `insertBlankPage afterIndex ${afterIndex} out of range [-2,${doc.order.length}]`,
      );
    }
    // B15 — blank page dimensions are PDF points. Reject non-finite or
    // non-positive sizes: a 0/negative MediaBox produces a degenerate page
    // that PDF.js renders as a black/invalid canvas ("blank page black").
    if (!Number.isFinite(widthPx) || widthPx <= 0 ||
        !Number.isFinite(heightPx) || heightPx <= 0) {
      return err(
        'out-of-range',
        `insertBlankPage dimensions ${widthPx}x${heightPx} must be finite positive numbers`,
      );
    }
    // DEF-130: capture the pre-insert pdfDoc bytes so a subsequent undo
    // can revert the pdfDoc (restoreSnapshot reloads it via
    // tryRestorePdfBytes). The previous code used snapshotDoc (no
    // pdfBytes), so undo reverted doc.order/doc.rotations but left the
    // inserted page in the pdfDoc. A re-insert then added ANOTHER page
    // at a higher origIdx than the rotations array had a slot for, so
    // serializeDoc read `doc.rotations[origIdx]` === undefined and
    // passed undefined*90 -> NaN to degrees(), which threw
    // "degreeAngle must be of type number, but was actually of type
    // NaN" out of getDocumentBytes. Capturing the bytes here lets
    // undo revert the pdfDoc to the exact pre-insert page count.
    const snapshot = await snapshotDocWithPdf(doc);

    try {
      // Create a blank page and add it to the pdfDoc. B15: pdf-lib's
      // addPage creates a page with an EMPTY content stream, which PDF.js
      // renders transparent — in a dark-themed viewer the page container's
      // background shows through and the "blank page" looks black. Fill
      // the page with an explicit white rectangle so it renders white
      // regardless of the viewer chrome. The fill is real content and
      // survives the save round-trip (serializeDoc copyPages carries it).
      const blankPage = doc.pdfDoc.addPage([widthPx, heightPx]);
      blankPage.drawRectangle({
        x: 0,
        y: 0,
        width: widthPx,
        height: heightPx,
        color: rgb(1, 1, 1),
      });
      const blankOrigIdx = doc.pdfDoc.getPageCount() - 1; // last added page

      // Extend the arrays for the new page
      doc.deleted.push(false);
      doc.rotations.push(0);
      doc.annotations.push([]);

      // Determine insertion position in visible order.
      // DEF-114: afterIndex is the 0-based visible index AFTER which the
      // blank page is inserted. The renderer's InsertPagesDialog sends
      // afterIndex = -1 for "end"/"append"; the previous code treated -1
      // as "insert before page 1" (insertAt = 0), so the blank page landed
      // at the FRONT instead of the end. -1 now appends after the last
      // page (matching insertFromPdf's -1 = append semantics); an explicit
      // afterIndex === doc.order.length also appends.
      // DEF-129: afterIndex === -2 is the PREPEND sentinel — the new blank
      // page becomes the FIRST visible page (pageOrder[0]). The renderer
      // maps "insert before page 1" (position 0 in blank mode) to -2; the
      // originals follow unchanged ([0..n-1] shifted right by one).
      let insertAt: number;
      if (afterIndex === -2) {
        insertAt = 0; // prepend — new blank page is the first visible page
      } else if (afterIndex < 0) {
        insertAt = doc.order.length; // -1: append after the last page
      } else {
        insertAt = afterIndex + 1; // 0..n-1: after that page; n: append (clamped)
      }
      const clamped = Math.min(insertAt, doc.order.length);
      doc.order.splice(clamped, 0, blankOrigIdx);

      // Shift placed signatures: pages at or after clamped get +1
      const clamped1 = clamped + 1; // 1-based
      for (const sp of doc.placedSignatures) {
        if (sp.page >= clamped1) {
          sp.page = sp.page + 1;
        }
      }

      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      // DEF-130: if the insert itself failed after we already added the
      // page to the pdfDoc, revert the pdfDoc to the pre-insert bytes so
      // a retry starts from a clean state (no leftover half-added page).
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `insertBlankPage failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 9: insertFromPdf — insert pages from another PDF at a position
  // -----------------------------------------------------------------------
  async insertFromPdf(
    docId: string,
    otherBytes: Uint8Array,
    position: number,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._insertFromPdfImpl(docId, otherBytes, position));
  }

  private async _insertFromPdfImpl(
    docId: string,
    otherBytes: Uint8Array,
    position: number,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }

    let otherDoc: PDFDocument;
    try {
      otherDoc = await PDFDocument.load(otherBytes, { preserveXFA: true });
    } catch (e) {
      return err('engine-error', `insertFromPdf: could not parse other PDF: ${e instanceof Error ? e.message : String(e)}`);
    }

    const otherCount = otherDoc.getPageCount();
    if (otherCount === 0) {
      return err('empty-range', 'insertFromPdf: source PDF has 0 pages');
    }

    // DEF-130: capture the pre-insert pdfDoc bytes so a subsequent undo
    // can revert the pdfDoc (same fix as insertBlankPage). The previous
    // snapshotDoc (no pdfBytes) left the inserted pages in the pdfDoc
    // after undo, so a re-insert grew the pdfDoc past the rotations
    // array and serializeDoc read undefined -> NaN.
    const snapshot = await snapshotDocWithPdf(doc);

    try {
      const otherIndices = otherDoc.getPageIndices();
      const copiedPages = await doc.pdfDoc.copyPages(otherDoc, otherIndices);

      // Determine insertion position: position is 0-based visible index
      // -1 means append at end
      const insertAt = position < 0 || position > doc.order.length
        ? doc.order.length
        : position;

      // Insert pages into pdfDoc and track their original indices
      const newOrigIndices: number[] = [];
      for (const copied of copiedPages) {
        doc.pdfDoc.addPage(copied);
        newOrigIndices.push(doc.pdfDoc.getPageCount() - 1);
      }

      // Extend arrays for the new pages
      for (let i = 0; i < otherCount; i++) {
        doc.deleted.push(false);
        doc.rotations.push(0);
        doc.annotations.push([]);
      }

      // Insert into visible order
      doc.order.splice(insertAt, 0, ...newOrigIndices);

      // Shift placed signatures: pages at or after insertAt get +otherCount
      const insertAt1 = insertAt + 1; // 1-based
      for (const sp of doc.placedSignatures) {
        if (sp.page >= insertAt1) {
          sp.page = sp.page + otherCount;
        }
      }

      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      // DEF-130: revert the pdfDoc on failure so a retry starts clean.
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `insertFromPdf failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 32 — cross-document page move/copy (Multi Mode)
  // -----------------------------------------------------------------------

  /**
   * Move or copy pages between two OPEN documents as ONE atomic operation.
   *
   * QUEUE ORDERING: a cross-document op serialises against TWO per-document
   * queues. The pair is always acquired in a DETERMINISTIC order —
   * lexicographically by docId — so two opposite-direction moves (A->B and
   * B->A issued concurrently) both take the same first queue and cannot
   * deadlock by each holding one queue and waiting for the other. The
   * second queue is then acquired inside the first, so the two docs are
   * locked for the whole operation.
   *
   * `pages` are 0-based VISIBLE-order indices in the source (indices into
   * the source's `pageOrder`); `atIndex` is the insertion index in the
   * target's visible order, with `-1` = append (the `insertFromPdf`
   * convention). Annotations on the moved pages travel with them, and the
   * moved page keeps its current rotation. Returns BOTH documents' states.
   */
  async movePagesBetweenDocs(
    payload: MovePagesBetweenDocsPayload,
  ): Promise<Result<MovePagesBetweenDocsResult, EngineError>> {
    const { fromDocId, toDocId } = payload;
    // Validate the same-document case BEFORE acquiring any queue: enqueuing
    // the same docId twice would chain the inner task on the outer one and
    // deadlock (the outer task never resolves until the inner does, and the
    // inner waits on the outer). Returning early also keeps an invalid
    // request off both queues.
    if (fromDocId === toDocId) {
      return err('same-document', 'source and target document are the same');
    }
    const [first, second] = fromDocId < toDocId
      ? [fromDocId, toDocId]
      : [toDocId, fromDocId];
    return this._enqueue(first, () =>
      this._enqueue(second, () => this._movePagesBetweenDocsImpl(payload)),
    );
  }

  private async _movePagesBetweenDocsImpl(
    payload: MovePagesBetweenDocsPayload,
  ): Promise<Result<MovePagesBetweenDocsResult, EngineError>> {
    const { fromDocId, toDocId, pages, atIndex, mode } = payload;

    // ---- validation, before ANY mutation ----
    // (fromDocId === toDocId is rejected in movePagesBetweenDocs, before the
    // queues are acquired — see the deadlock note there.)
    const fromDoc = this.docs.get(fromDocId);
    if (fromDoc === undefined) {
      return err('not-found', `unknown document: ${fromDocId}`);
    }
    const toDoc = this.docs.get(toDocId);
    if (toDoc === undefined) {
      return err('not-found', `unknown document: ${toDocId}`);
    }
    if (mode !== 'move' && mode !== 'copy') {
      return err('engine-error', `mode must be 'move' or 'copy', got ${String(mode)}`);
    }
    if (!Array.isArray(pages) || pages.length === 0) {
      return err('empty-range', 'pages must be a non-empty array');
    }
    const fromCount = fromDoc.order.length;
    for (const p of pages) {
      if (!Number.isInteger(p) || p < 0 || p >= fromCount) {
        return err('out-of-range', `page ${p} out of range [0,${fromCount - 1}]`);
      }
    }
    if (mode === 'move' && pages.length >= fromCount) {
      // Mirror applyOpToDoc's "cannot delete the last remaining page": a
      // move must leave the source with at least one page.
      return err(
        'empty-range',
        `cannot move every page: source must keep at least one of ${fromCount}`,
      );
    }
    if (
      atIndex !== -1 &&
      (!Number.isInteger(atIndex) || atIndex < 0 || atIndex > toDoc.order.length)
    ) {
      return err('out-of-range', `atIndex ${atIndex} out of range [-1,${toDoc.order.length}]`);
    }

    // ---- snapshot BOTH docs (visible-order arrays + pdfDoc bytes) ----
    // The rollback below reloads each pdfDoc from its captured bytes, so the
    // byte snapshot is mandatory: snapshotDocWithPdf swallows a serialization
    // failure, so refuse up front rather than risk a half-applied move.
    const fromSnap = await snapshotDocWithPdf(fromDoc);
    const toSnap = await snapshotDocWithPdf(toDoc);
    if (fromSnap.pdfBytes === undefined || toSnap.pdfBytes === undefined) {
      return err('engine-error', 'movePagesBetweenDocs: could not snapshot document bytes');
    }
    // undoStack/redoStack/modified are not part of Snapshot — copy them so a
    // failed move restores each doc state-for-state (copies, not references:
    // the try block pushes onto the live stacks).
    const fromStacks = {
      undo: [...fromDoc.undoStack],
      redo: [...fromDoc.redoStack],
      modified: fromDoc.modified,
    };
    const toStacks = {
      undo: [...toDoc.undoStack],
      redo: [...toDoc.redoStack],
      modified: toDoc.modified,
    };

    // Original (pdfDoc) indices of the pages to transfer, in source order.
    const origIdxs = pages.map((vi) => fromDoc.order[vi]);

    try {
      const insertAt = atIndex < 0 ? toDoc.order.length : atIndex;
      // 1) insert into the target (copies pages + carries rotation and
      //    annotations). Extracted as a protected seam so tests can inject a
      //    failure AFTER the target is partially mutated.
      await this._insertMovedPagesInto(toDoc, fromDoc, origIdxs, insertAt);

      // 2) for a move, remove the pages from the source. Delete from the
      //    HIGHEST visible index first so the remaining indices stay valid;
      //    dedupe so a repeated index cannot drop an unintended page.
      if (mode === 'move') {
        const visibleToDelete = [...new Set(pages)].sort((a, b) => b - a);
        for (const vi of visibleToDelete) {
          const del = applyOpToDoc(fromDoc, { kind: 'delete', page: vi });
          if (!del.ok) {
            throw new Error(`source delete failed: ${del.error.message}`);
          }
        }
      }

      // Success: record ONE joint undo action. A MOVE pushes a paired entry
      // onto EACH document's undo stack (same jointId, each referencing the
      // other's pre-move snapshot) so undoing from either side reverts both.
      // A COPY leaves the source untouched, so it gets no snapshot and stays
      // unmodified (no spurious unsaved prompt on a document whose content
      // did not change).
      if (mode === 'move') {
        const jointId = nextJointId();
        fromDoc.undoStack.push({
          ...fromSnap,
          joint: { jointId, otherDocId: toDocId, otherSnapshot: toSnap },
        });
        fromDoc.redoStack = [];
        fromDoc.modified = true;
        toDoc.undoStack.push({
          ...toSnap,
          joint: { jointId, otherDocId: fromDocId, otherSnapshot: fromSnap },
        });
        toDoc.redoStack = [];
        toDoc.modified = true;
      } else {
        toDoc.undoStack.push(toSnap);
        toDoc.redoStack = [];
        toDoc.modified = true;
      }
      return ok({ from: buildState(fromDoc), to: buildState(toDoc) });
    } catch (e) {
      // Atomic rollback: restore BOTH docs (arrays + pdfDoc bytes) and their
      // stacks/flags so a failed move is indistinguishable from no move.
      await restoreSnapshot(fromDoc, fromSnap);
      await restoreSnapshot(toDoc, toSnap);
      fromDoc.undoStack = fromStacks.undo;
      fromDoc.redoStack = fromStacks.redo;
      fromDoc.modified = fromStacks.modified;
      toDoc.undoStack = toStacks.undo;
      toDoc.redoStack = toStacks.redo;
      toDoc.modified = toStacks.modified;
      return err(
        'engine-error',
        `movePagesBetweenDocs failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Phase 32 — copy `origIdxs` (pdfDoc indices in `fromDoc`) into `toDoc`
   * at visible index `insertAt`, carrying each page's rotation and its
   * annotations. Protected so a unit test can override it to throw AFTER
   * the target has been partially mutated, proving the cross-document move
   * rolls back atomically.
   */
  protected async _insertMovedPagesInto(
    toDoc: EngineDoc,
    fromDoc: EngineDoc,
    origIdxs: number[],
    insertAt: number,
  ): Promise<void> {
    const copied = await toDoc.pdfDoc.copyPages(fromDoc.pdfDoc, origIdxs);
    const newOrigIdxs: number[] = [];
    for (let i = 0; i < copied.length; i++) {
      const page = copied[i];
      const srcOrigIdx = origIdxs[i];
      // Bake the source page's CURRENT visible rotation onto the copy.
      // copyPages also pulls the source leaf's raw /Rotate down, so set the
      // tracked value unconditionally (including 0) to override it; the
      // target's own rotations slot stays 0 so serializeDoc does not apply
      // it a second time.
      const rawRot = fromDoc.rotations[srcOrigIdx];
      const norm = Number.isFinite(rawRot)
        ? ((Math.round(rawRot) % 4) + 4) % 4
        : 0;
      page.setRotation(degrees(norm * 90));
      toDoc.pdfDoc.addPage(page);
      const newOrigIdx = toDoc.pdfDoc.getPageCount() - 1;
      newOrigIdxs.push(newOrigIdx);
      toDoc.deleted.push(false);
      toDoc.rotations.push(0);
      toDoc.annotations.push([]);
    }
    // Insert into the target's visible order at the requested position.
    toDoc.order.splice(insertAt, 0, ...newOrigIdxs);
    // Carry annotations with their page: clone from the source registry and
    // re-target each model's 1-based visible `page` to its new position.
    for (let i = 0; i < newOrigIdxs.length; i++) {
      const srcAnns = fromDoc.annotations[origIdxs[i]];
      if (srcAnns === undefined || srcAnns.length === 0) continue;
      const newVisible = insertAt + i + 1; // 1-based
      toDoc.annotations[newOrigIdxs[i]] = cloneAnnotations([srcAnns])[0].map((a) => ({
        ...a,
        page: newVisible,
      }));
    }
  }

  // -----------------------------------------------------------------------
  // Phase 9: exportText — extract per-page text from the document
  // -----------------------------------------------------------------------
  async exportText(
    docId: string,
  ): Promise<Result<TextPage[], EngineError>> {
    return this._enqueue(docId, () => this._exportTextImpl(docId));
  }

  private async _exportTextImpl(
    docId: string,
  ): Promise<Result<TextPage[], EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }

    try {
      // Serialize the document to bytes and extract text from the raw PDF.
      // This is more reliable than trying to access content streams through
      // pdf-lib's internal API, which may not expose the resolved streams.
      //
      // DEF-085 (Bug 5): save() with the default `useObjectStreams: true`
      // packs the catalog, pages tree and page objects into a compressed
      // /Type /ObjStm object. extractTextFromRawPdf's regex parser walks
      // the cross-reference table and top-level `N G obj` headers; it cannot
      // see objects that live inside an ObjStm, so every page's /Contents
      // ref resolved to nothing and exportText silently returned '' for
      // every page (the existing engine test only asserted
      // `typeof text === 'string'`, so the regression slipped through). The
      // flat save keeps every object as a direct `N G obj` so the parser
      // can walk from /Root -> /Pages -> /Kids -> page -> /Contents ->
      // FlateDecode stream -> Tj/TJ text operators. createDocxFromDoc
      // already used `useObjectStreams: false` for the same reason; this
      // brings exportText in line.
      const bytes = await doc.pdfDoc.save({ useObjectStreams: false });
      const pages: TextPage[] = [];
      const pageCount = doc.pdfDoc.getPageCount();

      for (let i = 0; i < pageCount; i++) {
        const text = extractTextFromRawPdf(bytes, i);
        pages.push({ pageIndex: i + 1, text });
      }

      return ok(pages);
    } catch (e) {
      return err('engine-error', `exportText failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 9: createDocxFromImages — assemble a .docx from rasterised pages
  // -----------------------------------------------------------------------
  async createDocxFromImages(
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    try {
      if (entries.length === 0) {
        return err('empty-range', 'no image entries provided');
      }
      const docxBytes = buildDocxFromImages(entries);
      return ok(docxBytes);
    } catch (e) {
      return err('engine-error', `createDocxFromImages failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // DEF-060: createDocxFromDoc — assemble a .docx from the loaded document's
  // own text. Reuses the exportText machinery (extractTextFromRawPdf) to pull
  // per-page text from the engine's pdfDoc; text-bearing pages become real
  // w:p/w:r/w:t paragraphs (editable in Word), text-free pages fall back to
  // an inline image (wp:inline) from the matching DocxImageEntry pngBuffer.
  // The renderer rasterises every page ahead of time so the fallback always
  // has pixels even when a page is image-only / scanned.
  // -----------------------------------------------------------------------
  async createDocxFromDoc(
    docId: string,
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    return this._enqueue(docId, () => this._createDocxFromDocImpl(docId, entries));
  }

  private async _createDocxFromDocImpl(
    docId: string,
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    if (!Array.isArray(entries) || entries.length === 0) {
      return err('empty-range', 'no image entries provided');
    }
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      // Serialize with useObjectStreams:false so every object (catalog, pages,
      // page, content stream) appears as a direct "N G obj" in the raw bytes.
      // The exportText machinery's regex parseXref cannot see objects that
      // live inside a compressed ObjStm (pdf-lib's default save groups the
      // catalog/pages/page objects into one), so a default save makes
      // extractTextFromRawPdf return '' for every page. The flat layout keeps
      // the content stream itself FlateDecode-compressed — decodeStream
      // handles that — only the object wrapping is flattened. This is a
      // read-only extraction pass; the engine's pdfDoc is not mutated.
      //
      // The saved bytes preserve the ORIGINAL pdfDoc page order (save does not
      // apply doc.order/deletions), so extractTextFromRawPdf is indexed by the
      // ORIGINAL page index. We iterate doc.order (visible pages) and map each
      // visible position to its original index so the .docx reflects what the
      // user actually sees (deleted pages dropped, reorders honoured). The
      // renderer's DocxImageEntry.pageNumber is 1-based VISIBLE, matching the
      // exportText / EngineState.pageOrder convention.
      const bytes = await doc.pdfDoc.save({ useObjectStreams: false });
      const visibleCount = doc.order.length;
      const entryByPage = new Map<number, DocxImageEntry>();
      for (const e of entries) {
        if (e && typeof e.pageNumber === 'number') {
          entryByPage.set(e.pageNumber, e);
        }
      }
      // DEF-111: honor the selected page set. The renderer's
      // DocxExportDialog exports only the user-chosen range and sends one
      // DocxImageEntry per selected page (entry.pageNumber is 1-based
      // VISIBLE). The previous loop iterated `0..visibleCount` over the
      // WHOLE document, so a single-page selection still exported every
      // page. Iterate only the entries' page numbers (sorted ascending,
      // de-duplicated via the entryByPage map) so selecting page 1
      // exports exactly 1 page.
      const pages: DocxDocPage[] = [];
      const selectedPages = Array.from(entryByPage.keys()).sort((a, b) => a - b);
      for (const pn of selectedPages) {
        // pn is 1-based visible; map to the 0-based visible index.
        const vi = pn - 1;
        if (!Number.isFinite(vi) || vi < 0 || vi >= visibleCount) {
          // Out-of-range page number — skip rather than emit a bogus page.
          continue;
        }
        const entry = entryByPage.get(pn);
        if (entry === undefined) continue;
        const origIdx = doc.order[vi];
        const raw = extractTextFromRawPdf(bytes, origIdx);
        if (raw.trim().length > 0) {
          pages.push({ kind: 'text', text: raw });
        } else {
          pages.push({ kind: 'image', entry });
        }
      }
      const docxBytes = buildDocxFromDoc(pages);
      return ok(docxBytes);
    } catch (e) {
      return err('engine-error', `createDocxFromDoc failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async exportPages(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], EngineError>> {
    return this._enqueue(docId, () => this._exportPagesImpl(docId, payload));
  }

  private async _exportPagesImpl(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }

    const pageCount = doc.order.length;
    const allIndices = Array.from({ length: pageCount }, (_, i) => i);

    let selectedIndices: number[];
    if (payload.range !== undefined) {
      const [start, end] = payload.range;
      // range is 1‑based inclusive
      if (start < 1 || end > pageCount || start > end) {
        return err('out-of-range', `range [${start},${end}] out of bounds for ${pageCount} pages`);
      }
      selectedIndices = allIndices.slice(start - 1, end);
    } else {
      selectedIndices = allIndices;
    }

    if (selectedIndices.length === 0) {
      return err('empty-range', 'no pages to export');
    }

    try {
      const entries: ExportPageEntry[] = [];
      for (const vi of selectedIndices) {
        const origIdx = doc.order[vi];

        const singleDoc = await PDFDocument.create();
        const [copied] = await singleDoc.copyPages(doc.pdfDoc, [origIdx]);
        const rotation = doc.rotations[origIdx];
        if (rotation !== 0) {
          copied.setRotation(degrees(rotation * 90));
        }
        singleDoc.addPage(copied);

        const size = copied.getSize(); // Reads size after rotation is applied

        // Phase 49 — brand the exported single-page PDF's Producer/Creator.
        stampBrandMetadata(singleDoc);
        const bytes = await singleDoc.save();
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

        entries.push({
          pageIndex: vi + 1, // 1‑based
          buffer: new Uint8Array(ab),
          format: payload.format,
          width: size.width,
          height: size.height,
        });
      }
      return ok(entries);
    } catch (e) {
      return err('engine-error', `exportPages failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 10: Edit content — editTextRun / addTextBox / editImage
  // -----------------------------------------------------------------------

  /**
   * Phase 10 — edit an existing text run in place. The run's `rect` is
   * masked with a white filled rectangle (covering the old glyphs) and
   * `newText` is drawn at the rect's top-left baseline with the chosen
   * font/size/color. The old text remains in the content stream but is
   * visually hidden; this is the documented Phase 10 approach (true
   * in-place content-stream editing is not feasible with pdf-lib).
   *
   * Font metrics are NOT preserved from the original run — the new text
   * uses a pdf-lib StandardFont (Helvetica/Times/Courier). Embedded
   * subset fonts in the source cannot be matched. See the Phase 10
   * report for this feasibility limit.
   */
  async editTextRun(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._editTextRunImpl(docId, payload));
  }

  private async _editTextRunImpl(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const pageResult = resolveVisiblePage(doc, payload.page);
    if (!pageResult.ok) return pageResult;

    // Phase 21 — validate the new style fields BEFORE touching the document
    // (a supplied-but-invalid field rejects with a typed engine-error, never a
    // silent drop). Legacy calls with no style fields take the byte-compatible
    // single-line path below.
    const styleResult = validateTextStyleFields(payload);
    if (!styleResult.ok) {
      return err('engine-error', `editTextRun: ${styleResult.reason}`);
    }
    const style = styleResult.value;
    const fontName = payload.font ?? 'Helvetica';
    if (!isEditFont(fontName)) {
      return err(
        'engine-error',
        `editTextRun: unsupported font ${JSON.stringify(fontName)}; supported families are ${EDIT_FONTS.join(', ')}`,
      );
    }

    const snapshot = await snapshotDocWithPdf(doc);
    try {
      const page = doc.pdfDoc.getPage(pageResult.value);
      const pageHeight = page.getSize().height;
      const { x, y } = payload.rect;

      const font = await embedEditFont(doc.pdfDoc, fontName, !!style.bold, !!style.italic);
      const size = payload.size ?? 12;
      const color = payload.color ?? { r: 0, g: 0, b: 0 };
      const safe = sanitizeForStandardFont(payload.newText);

      // DEF-151 — when the renderer commits a MOVE it passes `oldRect`
      // (the ORIGINAL run's position) alongside the moved `rect`. The
      // engine must erase the original run by masking `oldRect` (so the
      // old glyphs do not survive beside the moved copy) and draw the
      // new text at `rect` (the moved position). When `oldRect` is
      // absent (a plain in-place edit), keep the original behaviour:
      // mask `rect` + draw at `rect`.
      const maskRect = payload.oldRect ?? payload.rect;

      // DEF-221 — the mask covers the old run's INK box plus a small
      // SYMMETRIC pad (PAD points on all four sides), and nothing more.
      // It must never reach into a neighbouring text band. An earlier
      // DEF-124 widening extended the top by the NEW font's ascent and
      // the bottom by its descent, which grew the mask far beyond the
      // old run's ink box and erased the line above (qa measured the
      // band above the run going dark 3,287 -> 0).
      //
      // INK-BOX CONTRACT: the renderer's `oldRect` (from
      // `textItemsToGeom`, PageView.tsx:201-226) is `y = pageHeight - f
      // - h, height = h`, where `f` is pdf.js's baseline and `h` is
      // `item.height` = the font SIZE (em box). That rect's TOP sits
      // ~0.25 h ABOVE the ink top (a standard-font ascent is ~0.72-0.75
      // h) and its BOTTOM sits exactly at the baseline, i.e. ~0.2 h
      // above the descender bottoms. A mask anchored to that rect
      // therefore clipped the descenders of the line above (baseline
      // ~1.2 h higher, descenders reaching ~0.25 h below its baseline
      // into the mask's top band) and left the old run's own descenders
      // uncovered. qa's retest measured the band above still erased
      // 3,287 -> 2,921 and 6 descender pixels surviving on the old rect
      // (baked after save+reopen). Anchor the mask to the ink box by
      // shifting it DOWN 0.25 h (em-box top -> ink top); the height and
      // the symmetric PAD stay unchanged. The renderer rect semantics
      // are deliberately NOT changed (a blanket change would shift
      // highlight/markup quads). The mask-and-redraw approach is the
      // documented v1 limitation (DEF-116 REJECTED), so the old text
      // operators stay in the content stream and this mask is the only
      // cover. The new text is still drawn at `rect` with the existing
      // `pageHeight - y - size` baseline compensation, so its baseline
      // is unchanged.
      const PAD = 2;
      const inkShift = maskRect.height > 0 ? maskRect.height * 0.25 : 0;
      const maskX = maskRect.x - PAD;
      const maskW = maskRect.width + 2 * PAD;
      const maskTop = maskRect.y + inkShift - PAD;
      const maskBottom = maskRect.y + maskRect.height + inkShift + PAD;
      const maskH = maskBottom - maskTop;

      // Mask the old run region with a white rectangle (PDF coords).
      drawClassicWhiteMaskRect(page, maskX, pageHeight - maskBottom, maskW, maskH);

      // Draw the new text at the (moved) rect's top-left, baseline
      // dropped by `size` from the top so glyphs sit inside the rect.
      // Phase 21 — when no style field is supplied, keep the exact legacy
      // single-draw path (byte-compatible). With any style field present,
      // route through the shared styled-line renderer (alignment, line
      // spacing, underline, baseline shift, highlight, list prefixes).
      if (!hasTextStyle(style)) {
        page.drawText(safe, {
          x,
          y: pageHeight - y - size,
          size,
          font,
          color: rgb(color.r, color.g, color.b),
        });
      } else {
        drawStyledTextLines(
          page,
          pageHeight,
          safe.split(/\r\n|\r|\n/),
          x,
          y,
          payload.rect.width,
          size,
          font,
          color,
          {
            align: style.align ?? 'left',
            lineHeight: style.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT,
            underline: style.underline ?? false,
            baselineShift: style.baselineShift ?? 0,
            highlight: style.highlight,
            list: style.list ?? 'none',
            indent: style.indent ?? 0,
            charSpacing: style.charSpacing ?? 0,
          },
        );
      }

      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      // Best-effort: restore pdfDoc so a failed draw doesn't leave a
      // half-applied white rectangle behind.
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `editTextRun failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Phase 84 (True redaction) — permanently remove the glyphs covered by
   * `payload.marks` from the target page's content stream, then draw an
   * opaque rectangle for every mark in the resolved colour. Enqueued
   * through `_enqueue` like every other mutating op; ONE undo snapshot is
   * taken before the mutation so undo restores the pre-redaction bytes.
   *
   * Refuses loudly with a typed `redaction-unsupported` error (and leaves
   * the document byte-for-byte unchanged) when the page content stream
   * cannot be decoded or a marked run's font advances cannot be resolved.
   * A mark that covers no removable text contributes a readable warning
   * rather than a silent no-op.
   */
  async applyRedactions(
    docId: string,
    payload: ApplyRedactionsPayload,
  ): Promise<Result<RedactionApplyResult, EngineError>> {
    return this._enqueue(docId, () => this._applyRedactionsImpl(docId, payload));
  }

  private async _applyRedactionsImpl(
    docId: string,
    payload: ApplyRedactionsPayload,
  ): Promise<Result<RedactionApplyResult, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const marks = Array.isArray(payload.marks) ? payload.marks : [];
    if (marks.length === 0) {
      return err('empty-range', 'applyRedactions: no redaction marks provided');
    }
    const pageResult = resolveVisiblePage(doc, payload.page);
    if (!pageResult.ok) return pageResult;

    // One snapshot BEFORE mutating: undo restores the pre-redaction bytes.
    const snapshot = await snapshotDocWithPdf(doc);
    try {
      const page = doc.pdfDoc.getPage(pageResult.value);
      const pageHeight = page.getSize().height;

      // Decode the page content stream(s); an unsupported filter refuses.
      const content = decodePageContentStreams(doc.pdfDoc, page);

      // Convert each top-left page-point mark into content-stream user space
      // (origin bottom-left, y up) — the same convention editTextRun uses.
      const resolver = buildRedactionAdvanceResolver(page);
      const userMarks = marks.map((mark) => ({
        rect: {
          x: mark.rect.x,
          y: pageHeight - (mark.rect.y + mark.rect.height),
          width: mark.rect.width,
          height: mark.rect.height,
        },
      }));

      // Per-mark notice: a mark under which no removable text was found is
      // reported, never silent. The all-marks call below does the rewrite.
      const warnings: string[] = [];
      for (let i = 0; i < userMarks.length; i += 1) {
        const perMark = removeRedactedGlyphs(content, [userMarks[i]], resolver);
        if (perMark.removedGlyphs === 0) {
          warnings.push(
            `Redaction mark ${i + 1} on page ${payload.page} covered no removable ` +
              `text (images and vector content are not removed).`,
          );
        }
      }

      const result = removeRedactedGlyphs(content, userMarks, resolver);
      const color =
        normalizeRedactionColor(payload.color) ??
        DEFAULT_SETTINGS.redactionColor ??
        '#000000';

      // REPLACE the page /Contents with ONE raw FlateDecode stream carrying
      // the rewritten text plus the opaque mark rectangles. Appending via
      // getContentStream cannot remove glyphs, so the stream is replaced.
      const rectOps = userMarks
        .map((mark) => redactionRectOperators(mark.rect, color))
        .join('\n');
      const finalContent = `${result.content}\n${rectOps}\n`;
      const streamRef = doc.pdfDoc.context.register(
        doc.pdfDoc.context.flateStream(Buffer.from(finalContent, 'latin1')),
      );
      page.node.set(PDFName.of('Contents'), streamRef);

      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok({
        state: buildState(doc),
        removedGlyphs: result.removedGlyphs,
        warnings,
      });
    } catch (e) {
      // Restore the pre-change bytes exactly (mirrors _editTextRunImpl).
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      if (e instanceof RedactionUnsupportedError) {
        // Phase 84 — typed refusal. The code is not yet a member of the
        // shared `EngineError` union (chunk A omission); it is cast so this
        // op typechecks without widening the union and breaking the
        // renderer-owned exhaustive `describeEngineError` switch (chunk C
        // owns adding the union member + its case). The runtime code is the
        // exact string contract the renderer matches.
        return err(
          'redaction-unsupported' as EngineError,
          `applyRedactions: page ${payload.page} ${e.reason}${
            e.fontName ? ` (font ${e.fontName})` : ''
          }`,
        );
      }
      return err(
        'engine-error',
        `applyRedactions failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Phase 10 / Phase 14 / DEF-135 / DEF-136 — add a new text box. As of
   * Phase 14 this pushes a `TextBoxModel` into the engine-side placement
   * registry (NO immediate draw); the box is drawn once at its FINAL rect
   * at save time (serializeDoc), so moving it never masks the content
   * under its old rect. The previous implementation baked the box into the
   * page at add time and used `editImage` mask-and-draw to move it, which
   * white-masked the OLD rect and erased any document content under it
   * (DEF-135). The registry approach mirrors `placeSignature`.
   *
   * `payload.id` is optional — the renderer may pass its own uuid; if
   * absent the engine generates one and returns it on
   * `EngineState.textBoxes`. `color` (legacy `EditColor`) is normalised to
   * a hex string for the stored `TextBoxModel`.
   */
  async addTextBox(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._addTextBoxImpl(docId, payload));
  }

  private async _addTextBoxImpl(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    if (doc.order.length === 0) {
      return err('out-of-range', `cannot add a text box to a document with 0 pages`);
    }
    if (payload.page < 1 || payload.page > doc.order.length) {
      return err('out-of-range', `page ${payload.page} out of range [1,${doc.order.length}]`);
    }
    if (typeof payload.text !== 'string' || payload.text.length === 0) {
      return err('engine-error', 'addTextBox requires non-empty text');
    }
    // Phase 21 — validate the new style fields before mutating (reject ->
    // typed engine-error). Legacy font/size coercion is unchanged.
    const styleResult = validateTextStyleFields(payload);
    if (!styleResult.ok) {
      return err('engine-error', `addTextBox: ${styleResult.reason}`);
    }
    const style = styleResult.value;
    // Phase 27 — a supplied-but-invalid family fails loud (never a silent
    // substitution to Helvetica); an absent family keeps the legacy default.
    if (payload.font !== undefined && !isEditFont(payload.font)) {
      return err(
        'engine-error',
        `addTextBox: unsupported font ${JSON.stringify(payload.font)}; supported families are ${EDIT_FONTS.join(', ')}`,
      );
    }
    // Registry op: no pdfDoc mutation, so a plain snapshot (no pdfBytes)
    // suffices for undo — restoreSnapshot reverts the registry directly.
    const snapshot = snapshotDoc(doc);
    const font: EditFont = payload.font ?? 'Helvetica';
    const size = typeof payload.size === 'number' && payload.size > 0 ? payload.size : 12;
    const color = payload.color ? editColorToHex(payload.color) : undefined;
    const box: TextBoxModel = {
      id: typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : randomUUID(),
      page: payload.page,
      rect: {
        x: payload.rect.x,
        y: payload.rect.y,
        width: payload.rect.width,
        height: payload.rect.height,
      },
      text: payload.text,
      font,
      size,
      color,
      background: payload.background,
      ...style,
    };
    doc.textBoxes.push(box);
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  /**
   * Phase 14 / DEF-135 / DEF-136 — move a registry text box to `rect`.
   * Updates the box's rect in the registry; the box is redrawn at its new
   * rect on the next save/getDocumentBytes. No masking of the old rect —
   * underlying content is never erased (the root cause of DEF-135).
   */
  async moveTextBox(
    docId: string,
    id: string,
    rect: AnnRect,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._moveTextBoxImpl(docId, id, rect));
  }

  private async _moveTextBoxImpl(
    docId: string,
    id: string,
    rect: AnnRect,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const idx = doc.textBoxes.findIndex((tb) => tb.id === id);
    if (idx === -1) {
      return err('not-found', `text box ${id} not found`);
    }
    const snapshot = snapshotDoc(doc);
    doc.textBoxes[idx] = {
      ...doc.textBoxes[idx],
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  /**
   * Phase 14 / DEF-136 — delete a registry text box by id. Removes it from
   * the registry so it is no longer drawn at save time. This is the Delete
   * op that was missing for committed text boxes (DEF-136).
   */
  async deleteTextBox(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._deleteTextBoxImpl(docId, id));
  }

  private async _deleteTextBoxImpl(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const idx = doc.textBoxes.findIndex((tb) => tb.id === id);
    if (idx === -1) {
      return err('not-found', `text box ${id} not found`);
    }
    const snapshot = snapshotDoc(doc);
    doc.textBoxes.splice(idx, 1);
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  /**
   * Phase 21 — apply a Word/Adobe-class style patch to a registry text box.
   * Every patch field is optional and preserve-if-valid; a supplied-but-
   * invalid field (including a font outside the StandardFont allowlist)
   * rejects the WHOLE patch with a typed engine-error (mirrors the watermark
   * contract). An unknown id also returns engine-error — never a silent
*  success. `highlight: null` is the one explicit-removal field: it drops
   *  the box's stored band (absent still preserves it). On success the box is
   *  updated in the registry, the doc is marked modified, the per-doc undo
   *  snapshot is pushed, and the new state returned.
   *
   *  DEF-242 — a patch that supplies NO effective field (an empty object, or
   *  only keys whose value is `undefined`) is a no-op: return the unchanged
   *  state without marking the doc modified, without pushing an undo snapshot
   *  and without clearing the redo stack. A patch whose supplied keys are ALL
   *  unknown is a caller error and returns a typed engine-error naming them
   *  (never a silent no-op); unknown keys MIXED with known ones are ignored.
   */
  async updateTextBox(
    docId: string,
    id: string,
    patch: TextBoxStylePatch,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._updateTextBoxImpl(docId, id, patch));
  }

  private async _updateTextBoxImpl(
    docId: string,
    id: string,
    rawPatch: TextBoxStylePatch,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const idx = doc.textBoxes.findIndex((tb) => tb.id === id);
    if (idx === -1) {
      return err('engine-error', `updateTextBox: text box ${id} not found`);
    }
    const validated = validateTextBoxStylePatch(rawPatch);
    if (!validated.ok) {
      return err('engine-error', `updateTextBox: ${validated.reason}`);
    }
    const patch = validated.value;
    // DEF-242 — no supplied field survived validation: this is a no-op. Return
    // the unchanged state, leaving modified/undo/redo exactly as they were.
    if (Object.keys(patch).length === 0) {
      return ok(buildState(doc));
    }
    const snapshot = snapshotDoc(doc);
    const current = doc.textBoxes[idx];
    const next: TextBoxModel = { ...current };
    if (patch.text !== undefined) next.text = patch.text;
    if (patch.font !== undefined) next.font = patch.font;
    if (patch.size !== undefined) next.size = patch.size;
    if (patch.color !== undefined) next.color = editColorToHex(patch.color);
    if (patch.background !== undefined) next.background = patch.background;
    if (patch.align !== undefined) next.align = patch.align;
    if (patch.lineHeight !== undefined) next.lineHeight = patch.lineHeight;
    if (patch.bold !== undefined) next.bold = patch.bold;
    if (patch.italic !== undefined) next.italic = patch.italic;
    if (patch.underline !== undefined) next.underline = patch.underline;
    if (patch.baselineShift !== undefined) next.baselineShift = patch.baselineShift;
    if (patch.highlight !== undefined) {
      // Phase 21 follow-up — `null` is an explicit removal: the stored model
      // loses its `highlight` (the draw path paints no band). A colour sets it.
      next.highlight = patch.highlight === null ? undefined : { ...patch.highlight };
    }
    if (patch.list !== undefined) next.list = patch.list;
    if (patch.indent !== undefined) next.indent = patch.indent;
    if (patch.charSpacing !== undefined) next.charSpacing = patch.charSpacing;
    doc.textBoxes[idx] = next;
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  /**
   * Phase 10 — edit an image (move/resize/replace/crop). All four ops
   * reduce to: mask `oldRect` with a white rectangle, then embed
   * `imageBytes` (PNG or JPEG) and draw it at `newRect`. The renderer
   * produces the transformed bytes (resize/crop happen in its canvas);
   * the engine only composites onto the page.
   *
   * The original image XObject and its `Do` operator remain in the
   * content stream but are visually covered. True in-place content-
   * stream editing of the `cm` transform is not done — see the Phase
   * 10 report for the feasibility limit.
   */
  async editImage(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._editImageImpl(docId, payload));
  }

  private async _editImageImpl(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const pageResult = resolveVisiblePage(doc, payload.page);
    if (!pageResult.ok) return pageResult;

    const snapshot = await snapshotDocWithPdf(doc);
    try {
      const page = doc.pdfDoc.getPage(pageResult.value);
      const pageHeight = page.getSize().height;

      // Mask the original placement with a white rectangle.
      const old = payload.oldRect;
      drawClassicWhiteMaskRect(page, old.x, pageHeight - old.y - old.height, old.width, old.height);

      // Embed the new image bytes (PNG or JPEG) and draw at newRect.
      const bytes = payload.imageBytes instanceof Uint8Array
        ? payload.imageBytes
        : new Uint8Array(payload.imageBytes);
      const image = detectImageFormat(bytes) === 'png'
        ? await doc.pdfDoc.embedPng(bytes)
        : await doc.pdfDoc.embedJpg(bytes);

      const next = payload.newRect;
      page.drawImage(image, {
        x: next.x,
        y: pageHeight - next.y - next.height,
        width: next.width,
        height: next.height,
      });

      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `editImage failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 11: OCR — recognize text (build invisible text layer) + suspects
  // -----------------------------------------------------------------------

  /**
   * Phase 11 — run OCR over the renderer-supplied page images and write an
   * invisible text layer (pdf-lib `TextRenderingMode.Invisible`, i.e. PDF
   * `Tr 3`) onto each matching PDF page so the scanned document becomes
   * searchable/selectable while the original page image stays visible.
   *
   * The renderer rasterises pages with its existing PDF.js DOM-canvas path
   * (pdf-lib cannot rasterise; main-side pdf.js crashed the native canvas
   * backend during feasibility testing) and sends the PNG bytes in
   * `pageImages`. The engine maps each word's pixel bbox back to PDF points
   * using `dpi` (pt = px * 72 / dpi) and draws it invisibly at the right
   * spot. Recognised words are stored on the doc for `ocrSuspects`.
   *
   * `onProgress` (optional) is invoked once per page for 'recognizing' and
   * once for 'writing'; the main process forwards it to the requesting
   * renderer window so batch OCR can show progress without freezing the UI.
   *
   * Undo: captures pre-OCR pdfDoc bytes so a revert restores the page
   * content streams (the invisible text is removed along with them).
   */
  async ocrRecognize(
    docId: string,
    opts: OcrRecognizeOptions,
    onProgress?: (p: OcrProgress) => void,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._ocrRecognizeImpl(docId, opts, onProgress));
  }

  /**
   * Phase 51 — request cancellation of an in-flight OCR run on `docId`.
   *
   * Deliberately NOT enqueued on the per-doc queue: `_ocrRecognizeImpl` is
   * usually blocked awaiting tesseract for the current page, so a queued
   * cancel would not run until the whole run had already finished. This
   * flips the run's shared flag (read between pages) and resolves at once.
   *
   * A cancel with no run in flight — before the first page, or after the run
   * settled — is a harmless no-op returning `{ cancelled: false }`. Calling
   * it twice is idempotent. It never throws and never touches the document.
   */
  async ocrCancel(
    docId: string,
  ): Promise<Result<OcrCancelResult, EngineError>> {
    const run = this.ocrRuns.get(docId);
    if (run === undefined) {
      return ok({ cancelled: false });
    }
    run.cancelled = true;
    return ok({ cancelled: true });
  }

  private async _ocrRecognizeImpl(
    docId: string,
    opts: OcrRecognizeOptions,
    onProgress?: (p: OcrProgress) => void,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.ocr === null) {
      return err('engine-error', 'OCR service is not available in this build');
    }
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    // B13 — guard a missing/empty options object. An empty tab (no docId)
    // already returns engine-error above; this catches a renderer that
    // forwards undefined/null opts with a valid docId so the language read
    // below cannot crash the main process with "Cannot read properties of
    // undefined (reading 'language')". Returns engine-error, matching the
    // empty-tab contract, so the renderer's defensive gates degrade cleanly.
    if (opts === null || typeof opts !== 'object') {
      return err('engine-error', 'ocrRecognize: options is required');
    }
    // Validate language against the bundled allowlist.
    if (typeof opts.language !== 'string' || !(OCR_LANGUAGES as readonly string[]).includes(opts.language)) {
      return err('engine-error', `unsupported OCR language: ${String(opts.language)}`);
    }
    // Validate downsample (informational; per-image dpi is authoritative).
    if (typeof opts.downsample !== 'number' || !Number.isFinite(opts.downsample) || opts.downsample < 72 || opts.downsample > 600) {
      return err('engine-error', `downsample must be in 72..600, got ${String(opts.downsample)}`);
    }
    if (!Array.isArray(opts.pageImages) || opts.pageImages.length === 0) {
      return err('empty-range', 'no page images provided — the renderer must rasterise pages first');
    }
    const totalPages = opts.pageImages.length;

    const snapshot = await snapshotDocWithPdf(doc);
    // Phase 51 — register this run's cancel token BEFORE the first page so a
    // cancel arriving during any page's tesseract await is observed. The
    // token is always removed when the run settles (success, failure or
    // cancel), which keeps cancel-after-finish a no-op and stops a stale
    // cancel from affecting a later run.
    const run = { cancelled: false };
    this.ocrRuns.set(docId, run);
    const restoreOnCancel = async (): Promise<Result<EngineState, EngineError>> => {
      // A cancelled run leaves the document exactly as it was: reload the
      // pre-run bytes (removing any invisible text already drawn), and do
      // NOT record words, push undo, or flip the modified flag.
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('cancelled', 'ocrRecognize cancelled');
    };
    try {
      // Embed a single standard font for the whole text layer (Latin-1 only —
      // non-Latin glyphs are dropped by sanitizeForStandardFont, the documented
      // Phase 10/11 limitation for the bundled standard fonts).
      const font = await doc.pdfDoc.embedFont(StandardFonts.Helvetica);
      const storedWords: StoredOcrWord[] = [];
      // Per-page failures are accumulated, not fatal. A single bad page (bad
      // dpi, a tesseract throw, an out-of-range index) must NOT abort the
      // whole run and roll back the pages that DID get a text layer — that
      // early-return behaviour left a multi-page batch with no completion
      // signal: every page error returned `err`, so a batch caller counting
      // successes saw zero and never reported completion (DEF-051). The
      // engine now skips the failing page, records why, and continues; the
      // final Result lists every skipped page so the caller can surface them.
      const failures: OcrPageFailure[] = [];
      let written = 0;

      for (let i = 0; i < opts.pageImages.length; i++) {
        // Phase 51 — cancel between pages: checked before this page's
        // recognition starts. A cancel that arrived while the previous page
        // was writing is observed here.
        if (run.cancelled) return restoreOnCancel();
        const img = opts.pageImages[i];
        try {
          const pageResult = resolveVisiblePage(doc, img.page);
          if (!pageResult.ok) {
            failures.push({ page: img.page, message: pageResult.error.message });
            continue;
          }
          if (!(img.pngBytes instanceof Uint8Array)) {
            failures.push({ page: img.page, message: 'page image has no pngBytes' });
            continue;
          }
          if (typeof img.dpi !== 'number' || !Number.isFinite(img.dpi) || img.dpi < 72 || img.dpi > 600) {
            failures.push({ page: img.page, message: `page image has invalid dpi ${String(img.dpi)}` });
            continue;
          }

          onProgress?.({ docId, page: img.page, totalPages, phase: 'recognizing' });
          let rawWords: RawOcrWord[];
          try {
            rawWords = await this.ocr.recognize(img.pngBytes, opts.language);
          } catch (e) {
            failures.push({
              page: img.page,
              message: `recognition failed: ${e instanceof Error ? e.message : String(e)}`,
            });
            continue;
          }

          // Phase 51 — cancel after recognition, before the Tr=3 text-layer
          // write: the current page's tesseract was just cancelled, so emit
          // no 'writing' progress and draw nothing.
          if (run.cancelled) return restoreOnCancel();
          onProgress?.({ docId, page: img.page, totalPages, phase: 'writing' });
          const page = doc.pdfDoc.getPage(pageResult.value);
          const pageHeight = page.getSize().height;
          const scale = 72 / img.dpi; // pt per pixel
          // pdf-lib's `drawText` does NOT honour a `renderMode` option (its
          // typed options omit it and the runtime never reads it — verified
          // against the source). So the invisible text layer is built the
          // standard way: emit the PDF `Tr` text-state operator explicitly.
          // We push `3 Tr` (Invisible) inside a `q`/`Q` graphics-state pair so
          // the mode is scoped to the OCR words only — any text drawn on the
          // page later (e.g. editTextRun) stays visible. drawText wraps each
          // call in its own q/Q and inherits the outer Tr=3, so the glyphs are
          // not painted but remain `Tj` operators -> searchable/selectable.
          //
          // The closing `Q` is emitted in a `finally` so a per-word `drawText`
          // throw (a bad glyph, an embedFont hiccup) can never leave the page's
          // content stream with an unbalanced `q 3 Tr` (more push than pop).
          // An unbalanced stream does not corrupt the file structure, but it
          // leaks the Tr=3 mode onto subsequent drawings on the same page and
          // makes the saved content stream fail a strict q/Q balance check.
          // DEF-052: the q/Q pair must always close per attempted page.
          page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
          try {
            for (const w of rawWords) {
              const { x0, y0, x1, y1 } = w.bbox;
              const ptLeft = x0 * scale;
              const ptTop = y0 * scale;
              const ptWidth = (x1 - x0) * scale;
              const ptHeight = (y1 - y0) * scale;
              const size = clamp(ptHeight, 6, 96);
              const safe = sanitizeForStandardFont(w.text);
              if (safe.length === 0) continue;
              // PDF baseline: image y grows downward, PDF y upward. Drop the
              // font size below the top of the bbox so the glyph sits inside it.
              page.drawText(safe, {
                x: ptLeft,
                y: pageHeight - ptTop - size,
                size,
                font,
              });
              storedWords.push({
                text: w.text,
                confidence: w.confidence,
                page: img.page,
                rect: { x: ptLeft, y: ptTop, width: ptWidth, height: ptHeight },
              });
            }
          } finally {
            page.pushOperators(popGraphicsState());
          }
          written += 1;
        } catch (e) {
          // Any unexpected per-page error: record it and keep going so the
          // run still completes for the remaining pages (DEF-051).
          failures.push({
            page: img.page,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // If NO page produced a text layer, the whole run failed: revert and
      // report every accumulated failure so the caller can show them.
      if (written === 0) {
        await tryRestorePdfBytes(doc, snapshot.pdfBytes);
        const detail = failures.map((f) => `page ${f.page}: ${f.message}`).join('; ');
        return err(
          'engine-error',
          `ocrRecognize failed on all ${totalPages} page(s): ${detail}`,
        );
      }

      // Phase 51 — final cancel check before committing the run. Catches a
      // cancel that arrived while the last page's text layer was being
      // drawn; without it the words/undo/modified flag would leak from a
      // run the user already cancelled.
      if (run.cancelled) return restoreOnCancel();
      doc.lastOcrWords = storedWords;
      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      const state = buildState(doc);
      if (failures.length > 0) {
        (state as EngineState & { ocrFailures?: OcrPageFailure[] }).ocrFailures = failures;
      }
      return ok(state);
    } catch (e) {
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `ocrRecognize failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // Phase 51 — always drop this run's cancel token. Only remove it if it
      // is still the active one (a later queued run may have replaced it),
      // so a stale cancel can never flag a fresh run.
      if (this.ocrRuns.get(docId) === run) this.ocrRuns.delete(docId);
    }
  }

  /**
   * Phase 11 — return the low-confidence words from the most recent
   * `ocrRecognize` call (confidence below `SUSPECT_CONFIDENCE_THRESHOLD`).
   * Read-only; does not queue behind mutations. Returns `engine-error` if
   * no OCR has been run on the document yet.
   */
  async ocrSuspects(
    docId: string,
  ): Promise<Result<OcrSuspect[], EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    if (!doc.lastOcrWords || doc.lastOcrWords.length === 0) {
      return err('engine-error', 'no OCR has been run on this document');
    }
    const low = selectLowConfidence(doc.lastOcrWords, SUSPECT_CONFIDENCE_THRESHOLD);
    const suspects: OcrSuspect[] = low.map((w) => ({
      word: w.text,
      page: w.page,
      rect: { ...w.rect },
      confidence: w.confidence,
    }));
    return ok(suspects);
  }

  // -----------------------------------------------------------------------
  // Phase 12: replacePages — replace a visible page range with another PDF
  // -----------------------------------------------------------------------
  async replacePages(
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._replacePagesImpl(docId, otherBytes, targetRange));
  }

  private async _replacePagesImpl(
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const [start, end] = targetRange;
    const visibleCount = doc.order.length;
    if (
      !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end < 0 || start > end || start >= visibleCount
    ) {
      return err('out-of-range', `targetRange [${start},${end}] out of bounds for ${visibleCount} pages`);
    }

    let otherDoc: PDFDocument;
    try {
      otherDoc = await PDFDocument.load(otherBytes, { preserveXFA: true });
    } catch (e) {
      return err('engine-error', `replacePages: could not parse other PDF: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (otherDoc.getPageCount() === 0) {
      return err('empty-range', 'replacePages: source PDF has 0 pages');
    }

    const snapshot = await snapshotDocWithPdf(doc);
    try {
      const out = await PDFDocument.create();
      const beforeIdxs = doc.order.slice(0, start); // visible 0..start-1 -> origIdx
      const afterIdxs = doc.order.slice(end + 1);  // visible end+1.. -> origIdx
      const otherCount = otherDoc.getPageCount();
      const newAnnotations: AnnModel[][] = [];
      // Separate page-ref maps per source: object-number ref tags are NOT
      // globally unique across two PDFDocuments (each context numbers objects
      // from 1), so a single shared map would collide a current-page ref with
      // an other-page ref that happen to share an object number — remapping a
      // dropped page's bookmark onto an unrelated inserted page. Keep one map
      // per source so each outline's dests only resolve within their own doc.
      const currentMap = new Map<string, PDFRef>();
      const otherMap = new Map<string, PDFRef>();

      // Before pages (kept from current doc).
      for (const origIdx of beforeIdxs) {
        const [copied] = await out.copyPages(doc.pdfDoc, [origIdx]);
        const rotation = doc.rotations[origIdx];
        if (rotation !== 0) copied.setRotation(degrees(rotation * 90));
        out.addPage(copied);
        newAnnotations.push(cloneAnnotations([doc.annotations[origIdx] ?? []])[0] ?? []);
        const srcRef = doc.pdfDoc.getPage(origIdx).ref;
        if (srcRef) currentMap.set(srcRef.tag, copied.ref);
      }

      // Other-doc pages (inserted).
      const insertStart = beforeIdxs.length; // visible index where inserted pages begin
      for (const oi of otherDoc.getPageIndices()) {
        const [copied] = await out.copyPages(otherDoc, [oi]);
        const srcRot = otherDoc.getPage(oi).getRotation().angle;
        if (srcRot) copied.setRotation(degrees(srcRot));
        out.addPage(copied);
        newAnnotations.push([]);
        const srcRef = otherDoc.getPage(oi).ref;
        if (srcRef) otherMap.set(srcRef.tag, copied.ref);
      }

      // After pages (kept from current doc).
      for (const origIdx of afterIdxs) {
        const [copied] = await out.copyPages(doc.pdfDoc, [origIdx]);
        const rotation = doc.rotations[origIdx];
        if (rotation !== 0) copied.setRotation(degrees(rotation * 90));
        out.addPage(copied);
        newAnnotations.push(cloneAnnotations([doc.annotations[origIdx] ?? []])[0] ?? []);
        const srcRef = doc.pdfDoc.getPage(origIdx).ref;
        if (srcRef) currentMap.set(srcRef.tag, copied.ref);
      }

      // Carry the other doc's annotations onto the inserted pages (remap their
      // page to the visible position they now occupy).
      try {
        const otherAnns = parseAnnotationsFromDoc(otherDoc);
        for (let i = 0; i < otherAnns.length; i++) {
          const pageAnns = otherAnns[i] ?? [];
          for (const ann of pageAnns) {
            ann.page = (insertStart + i) + 1; // 1-based visible in the new doc
          }
          newAnnotations[insertStart + i] = pageAnns;
        }
      } catch {
        // Annotation carry from the other doc is best-effort.
      }

      // Carry outlines (bookmarks): current doc's outline (remapped for the
      // surviving before/after pages) concatenated with the other doc's
      // outline (remapped for the inserted pages). Links are annotations and
      // ride the per-page annotation carry above.
      try {
        carryOutlines(out, [
          { doc: doc.pdfDoc, map: currentMap },
          { doc: otherDoc, map: otherMap },
        ]);
      } catch {
        // Outline carry is best-effort — never block a replace on it.
      }

      // Remap placed signatures: before placements keep their page; the
      // replaced range's placements are dropped; after placements shift by
      // (otherCount - replacedCount).
      const replacedCount = end - start + 1;
      const shift = otherCount - replacedCount;
      const newPlacedSignatures: SignaturePlacement[] = [];
      for (const sp of doc.placedSignatures) {
        const p1 = sp.page; // 1-based visible
        if (p1 >= start + 1 && p1 <= end + 1) {
          continue; // placement was on a replaced page — drop it
        }
        let newPage = p1;
        if (p1 > end + 1) newPage = p1 + shift;
        newPlacedSignatures.push({ ...sp, page: newPage, rect: { ...sp.rect } });
      }

      const newCount = out.getPageCount();
      doc.pdfDoc = out;
      doc.order = Array.from({ length: newCount }, (_, i) => i);
      doc.deleted = Array.from({ length: newCount }, () => false);
      doc.rotations = Array.from({ length: newCount }, () => 0);
      doc.annotations = newAnnotations;
      doc.placedSignatures = newPlacedSignatures;
      // Page labels: the visible positions changed, so drop any previously-set
      // labels (they no longer line up with the new page set). The renderer can
      // re-apply renumberPages after a replace.
      doc.pageLabels = undefined;
      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `replacePages failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 12: renumberPages — set logical /PageLabels
  // -----------------------------------------------------------------------
  async renumberPages(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._renumberPagesImpl(docId, labels));
  }

  private async _renumberPagesImpl(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    if (!Array.isArray(labels)) {
      return err('engine-error', 'renumberPages: labels must be an array');
    }
    const visibleCount = doc.order.length;
    const cleaned: PageLabelEntry[] = [];
    for (const entry of labels) {
      if (entry === null || typeof entry !== 'object') continue;
      const { page, label } = entry;
      if (!Number.isInteger(page) || page < 1 || page > visibleCount) {
        return err('out-of-range', `renumberPages: page ${String(page)} out of range [1,${visibleCount}]`);
      }
      if (typeof label !== 'string') {
        return err('engine-error', 'renumberPages: label must be a string');
      }
      cleaned.push({ page, label });
    }
    const snapshot = snapshotDoc(doc);
    doc.pageLabels = cleaned.length > 0 ? cleaned : undefined;
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // Phase 12: cropPages — set CropBox AND TrimBox
  // -----------------------------------------------------------------------
  async cropPages(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._cropPagesImpl(docId, entries));
  }

  private async _cropPagesImpl(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const snapshot = await snapshotDocWithPdf(doc);
    const result = cropPagesInDoc(doc.pdfDoc, doc.order, entries);
    if (!result.ok) {
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return result;
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // Phase 85: setOutline — replace catalog /Outlines from an edited tree
  // -----------------------------------------------------------------------
  async setOutline(
    docId: string,
    entries: OutlineEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._setOutlineImpl(docId, entries));
  }

  private async _setOutlineImpl(
    docId: string,
    entries: OutlineEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    if (!Array.isArray(entries)) {
      return err('invalid-outline', 'setOutline: entries must be an array');
    }
    // Titles are validated against the RAW payload: normalizeOutline silently
    // DROPS empty titles, but the contract is to refuse the edit instead.
    if (outlineHasEmptyTitle(entries)) {
      return err('invalid-outline', 'setOutline: outline titles must be non-empty strings');
    }
    const clean = normalizeOutline(entries);
    const visibleCount = doc.order.length;

    // Validate every page BEFORE touching the document; any failure applies
    // nothing. A normalized page is either null or a positive integer, so the
    // only range failure left is an integer past the visible page set or one
    // pointing at a deleted slot.
    const findRangeError = (list: OutlineEntry[]): string | null => {
      for (const entry of list) {
        if (entry.page !== null) {
          const origIdx = entry.page <= visibleCount ? doc.order[entry.page - 1] : undefined;
          if (
            entry.page < 1 ||
            entry.page > visibleCount ||
            origIdx === undefined ||
            origIdx < 0 ||
            origIdx >= doc.pdfDoc.getPageCount() ||
            doc.deleted[origIdx] === true
          ) {
            return `outline: page ${entry.page} out of range [1,${visibleCount}]`;
          }
        }
        const childError = findRangeError(entry.children);
        if (childError !== null) return childError;
      }
      return null;
    };
    const rangeError = findRangeError(clean);
    if (rangeError !== null) {
      return err('out-of-range', rangeError);
    }

    const snapshot = await snapshotDocWithPdf(doc);
    try {
      const resolvePageRef = (page: number): PDFRef | null => {
        const origIdx = doc.order[page - 1];
        if (origIdx === undefined) return null;
        return doc.pdfDoc.getPage(origIdx).ref;
      };
      writeOutline(doc.pdfDoc, clean, resolvePageRef);
    } catch (e) {
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `setOutline: ${e instanceof Error ? e.message : String(e)}`);
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // Phase 12: addStamp — embed a renderer-drawn stamp raster
  // -----------------------------------------------------------------------
  async addStamp(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._addStampImpl(docId, payload));
  }

  private async _addStampImpl(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    if (typeof payload.stampId !== 'string' || !(STAMP_IDS as readonly string[]).includes(payload.stampId)) {
      return err('engine-error', `addStamp: invalid stampId ${String(payload.stampId)}`);
    }
    if (typeof payload.name !== 'string') {
      return err('engine-error', 'addStamp: name must be a string');
    }
    const pageResult = resolveVisiblePage(doc, payload.page);
    if (!pageResult.ok) return pageResult;
    const box = payload.rect;
    if (
      box === null || typeof box !== 'object' ||
      !Number.isFinite(box.x) || !Number.isFinite(box.y) ||
      !Number.isFinite(box.width) || !Number.isFinite(box.height) ||
      box.width <= 0 || box.height <= 0
    ) {
      return err('engine-error', 'addStamp: rect is invalid');
    }
    const pngBytes = payload.pngBytes instanceof Uint8Array
      ? payload.pngBytes
      : new Uint8Array(payload.pngBytes);
    if (pngBytes.length === 0) {
      return err('engine-error', 'addStamp: empty pngBytes');
    }

    const snapshot = await snapshotDocWithPdf(doc);
    try {
      const page = doc.pdfDoc.getPage(pageResult.value);
      const pageHeight = page.getSize().height;
      const { x, y, width, height } = box;
      // Embed the renderer-drawn stamp raster (PNG) and draw it at the rect.
      // pdf-lib has no rasteriser, so the renderer composites the stamp text +
      // border to a canvas and sends the PNG — exactly like signature placement.
      // The stamp is baked into the page content (one-way: not re-editable as a
      // stamp entity after save, though the pixels survive the round-trip).
      const image = detectImageFormat(pngBytes) === 'png'
        ? await doc.pdfDoc.embedPng(pngBytes)
        : await doc.pdfDoc.embedJpg(pngBytes);
      page.drawImage(image, {
        x,
        y: pageHeight - y - height,
        width,
        height,
      });
      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `addStamp failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 18: addWatermark — bake text/image watermarks onto pages
  // -----------------------------------------------------------------------
  async addWatermark(
    docId: string,
    settings: WatermarkSettings,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._addWatermarkImpl(docId, settings));
  }

  private async _addWatermarkImpl(
    docId: string,
    rawSettings: WatermarkSettings,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const settings = normalizeWatermarkSettings(rawSettings);
    if (settings === null) {
      return err('engine-error', 'addWatermark: settings are invalid');
    }

    // Page range: 1-based inclusive, against the visible page count.
    // `normalizeWatermarkSettings` already guarantees start >= 1 and
    // start <= end; only the upper bound needs checking here.
    const pageCount = doc.order.length;
    const start = settings.range ? settings.range[0] : 1;
    const end = settings.range ? settings.range[1] : pageCount;
    if (start < 1 || end > pageCount || start > end) {
      return err('out-of-range', `addWatermark: range [${start},${end}] out of bounds for ${pageCount} pages`);
    }

    // DEF-220 — document cap. Count the watermarks already baked into the
    // content-stream markers (the same source of truth `getWatermarks`
    // uses) and reject before any mutation; bounds the multi-watermark
    // bloat measured at ~50 MiB for 100 tiled stamps.
    const existingCount = this._scanWatermarkMarkers(doc).length;
    if (existingCount >= MAX_WATERMARKS_PER_DOC) {
      return err(
        'engine-error',
        `addWatermark: this document already has ${MAX_WATERMARKS_PER_DOC} watermarks (maximum)`,
      );
    }

    const isText = settings.type === 'text';
    const opacity = clamp(settings.opacity ?? DEFAULT_WATERMARK_OPACITY, 0, 1);
    const c = settings.color ?? DEFAULT_WATERMARK_COLOR;
    const color = rgb(c.r, c.g, c.b);

    // Sanitize the text up front (does not touch the document) so a
    // fully-non-Latin string is rejected before any state is snapshotted.
    let text = '';
    if (isText) {
      text = sanitizeForStandardFont(settings.text ?? '');
      if (text.length === 0) {
        return err('engine-error', 'addWatermark: text is empty after encoding');
      }
    }

    // DEF-217/DEF-220 — placement cap. For a tiled pattern compute the
    // row/column counts ARITHMETICALLY from the same bounds the draw loop
    // uses (never by running the loop), using a throwaway pdf-lib document
    // for the font/image metrics so the guard itself mutates nothing.
    // `size: 0.25, tile: true` would otherwise emit ~4.3 million
    // placements and kill the renderer.
    if (settings.tile === true) {
      let probeW = 0;
      let probeH = 0;
      let imageAspect = 1;
      try {
        const probe = await PDFDocument.create();
        if (isText) {
          const probeFont = await embedEditFont(
            probe, settings.font ?? 'Helvetica', !!settings.bold, !!settings.italic,
          );
          const tileSize = settings.size ?? DEFAULT_WATERMARK_TEXT_SIZE;
          probeW = probeFont.widthOfTextAtSize(text, tileSize);
          probeH = probeFont.heightAtSize(tileSize);
        } else {
          const imageBytes = settings.imageBytes as Uint8Array;
          const probeImage = detectImageFormat(imageBytes) === 'png'
            ? await probe.embedPng(imageBytes)
            : await probe.embedJpg(imageBytes);
          imageAspect = probeImage.width / probeImage.height;
        }
      } catch (e) {
        return err('engine-error', `addWatermark failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (let vi = start - 1; vi < end; vi++) {
        const origIdx = doc.order[vi];
        if (origIdx === undefined || origIdx < 0 || origIdx >= doc.pdfDoc.getPageCount()) {
          return err('out-of-range', `addWatermark: page ${vi + 1} resolves to invalid original index ${origIdx}`);
        }
        const { width: pw, height: ph } = doc.pdfDoc.getPage(origIdx).getSize();
        let w: number;
        let h: number;
        if (isText) {
          w = probeW;
          h = probeH;
        } else {
          h = settings.size ?? Math.min(pw, ph) * 0.33;
          w = h * imageAspect;
        }
        // The draw loop starts cy at h/2 and steps 1.5h while cy <= ph +
        // h/2 -> `floor(ph / (1.5h)) + 1` rows; even rows start cx at w/2,
        // odd rows at w/2 + 0.75w, both step 1.5w. Placements are counted
        // per parity because the odd rows are shifted half a step.
        const rows = Math.floor(ph / (1.5 * h)) + 1;
        const colsEven = Math.floor(pw / (1.5 * w)) + 1;
        const colsOdd = Math.floor((pw - 0.75 * w) / (1.5 * w)) + 1;
        const placements = Math.ceil(rows / 2) * colsEven + Math.floor(rows / 2) * colsOdd;
        if (placements > MAX_WATERMARK_PLACEMENTS_PER_PAGE) {
          return err(
            'engine-error',
            `addWatermark: tiling at this size would place more than ${MAX_WATERMARK_PLACEMENTS_PER_PAGE} copies on page ${vi + 1} (increase the size or turn tiling off)`,
          );
        }
      }
    }

    const snapshot = await snapshotDocWithPdf(doc);
    try {
      // Embed the font / image once (after the snapshot, like addStamp) and
      // reuse it on every page.
      let font: PDFFont | null = null;
      let image: PDFImage | null = null;
      if (isText) {
        font = await embedEditFont(
          doc.pdfDoc, settings.font ?? 'Helvetica', !!settings.bold, !!settings.italic,
        );
      } else {
        const imageBytes = settings.imageBytes as Uint8Array;
        image = detectImageFormat(imageBytes) === 'png'
          ? await doc.pdfDoc.embedPng(imageBytes)
          : await doc.pdfDoc.embedJpg(imageBytes);
      }

      const size = isText ? (settings.size ?? DEFAULT_WATERMARK_TEXT_SIZE) : 0;

      // DEF-216 — assign the next watermark id by scanning the markers
      // already baked into the pages (never an in-memory counter, so ids
      // cannot collide after an undo/restore resurrects older watermarks).
      let maxSuffix = 0;
      for (const info of this._scanWatermarkMarkers(doc)) {
        const suffix = Number.parseInt(info.id.replace(/^wm-/, ''), 10);
        if (Number.isFinite(suffix) && suffix > maxSuffix) maxSuffix = suffix;
      }
      const watermarkId = `wm-${maxSuffix + 1}`;

      for (let vi = start - 1; vi < end; vi++) {
        const origIdx = doc.order[vi];
        if (origIdx === undefined || origIdx < 0 || origIdx >= doc.pdfDoc.getPageCount()) {
          return err('out-of-range', `addWatermark: page ${vi + 1} resolves to invalid original index ${origIdx}`);
        }
        const page = doc.pdfDoc.getPage(origIdx);
        const { width: pw, height: ph } = page.getSize();

        // Watermark box dimensions (PDF points).
        let w: number;
        let h: number;
        if (isText && font !== null) {
          w = font.widthOfTextAtSize(text, size);
          // The font's line height bounds the box; the baseline sits 80%
          // down the box (the ascent for all three standard families is
          // ~0.72-0.78 of the line height, so this centers the glyphs
          // visually without per-family metrics).
          h = font.heightAtSize(size);
        } else if (image !== null) {
          // `size` is the drawn HEIGHT; the width scales to the image's
          // aspect ratio. Default height: 33% of the page's shorter side.
          h = settings.size ?? Math.min(pw, ph) * 0.33;
          w = h * (image.width / image.height);
        } else {
          return err('engine-error', 'addWatermark: internal error (missing font or image)');
        }

        // DEF-216: collect the placements first (the geometry below is
        // unchanged from the old drawAt), then emit ONE dedicated,
        // UNCOMPRESSED content stream per (watermark, page). The stream's
        // first line is the identity marker; the operators mirror
        // pdf-lib's own drawText/drawImage emission (q / GS / BT ... ET /
        // Q, or q / GS / cm cm / Do / Q) so the baked output renders
        // exactly like the old page.drawText/drawImage path.
        const tag = `${maxSuffix + 1}p${vi + 1}`;
        const gsName = page.node.newExtGState(
          `GSwm${tag}`,
          doc.pdfDoc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }),
        );
        const fontName = isText && font !== null
          ? page.node.newFontDictionary(`TFwm${tag}`, font.ref)
          : null;
        const imgName = image !== null
          ? page.node.newXObject(`Imwm${tag}`, image.ref)
          : null;

        // A placement is { x, y } in bottom-left page space: for text, x
        // is the glyph box's LEFT edge and y the baseline; for image,
        // (x, y) is the image rect's bottom-left corner.
        const placements: { x: number; y: number }[] = [];
        const placeAt = (cx: number, cy: number): void => {
          if (isText) {
            // The box's CENTER is (cx, cy) in top-left page space; the
            // baseline converts to bottom-left space with the font's 0.8
            // factor (same convention as the old page.drawText call).
            placements.push({ x: cx - w / 2, y: ph - (cy - h / 2) - h * 0.8 });
          } else {
            placements.push({ x: cx - w / 2, y: ph - cy - h / 2 });
          }
        };

        if (settings.tile) {
          // Staggered grid: rows step 1.5x the watermark height, columns
          // 1.5x the width; odd rows shift half a column so the pattern
          // reads as a diagonal field (classic "CONFIDENTIAL" look).
          const stepX = w * 1.5;
          const stepY = h * 1.5;
          let row = 0;
          for (let cy = h / 2; cy <= ph + h / 2; cy += stepY, row++) {
            const shift = row % 2 === 1 ? stepX / 2 : 0;
            for (let cx = w / 2 + shift; cx <= pw + w / 2; cx += stepX) {
              placeAt(cx, cy);
            }
          }
        } else if (settings.x !== undefined && settings.y !== undefined) {
          // Explicit placement: x/y is the box's TOP-LEFT (top-left origin,
          // PDF points — same convention as annotation rects).
          placeAt(settings.x + w / 2, settings.y + h / 2);
        } else {
          // Predefined slot: the box is centered on the grid point
          // (10% page-margin inset from the edges).
          const slot = settings.position ?? 'center';
          const [slotRow, slotCol] = slot.split('-');
          const mx = pw * 0.1;
          const my = ph * 0.1;
          const cx = slotCol === 'left' ? mx + w / 2 : slotCol === 'right' ? pw - mx - w / 2 : pw / 2;
          const cy = slotRow === 'top' ? my + h / 2 : slotRow === 'bottom' ? ph - my - h / 2 : ph / 2;
          placeAt(cx, cy);
        }

        const body: PDFOperator[] = [];
        if (isText && font !== null && fontName !== null) {
          // Mirror drawText's own encoding: font.encodeText produces the
          // font's real (single-byte for the standard fonts) byte string.
          // PDFHexString.fromText would emit UTF-16B (BOM + 2-byte code
          // units), which standard fonts cannot render.
          const hexText = font.encodeText(text);
          for (const p of placements) {
            body.push(
              beginText(),
              setFontAndSize(fontName, size),
              setFillingRgbColor(color.red, color.green, color.blue),
              setTextMatrix(1, 0, 0, 1, p.x, p.y),
              showText(hexText),
              endText(),
            );
            if (settings.underline === true) {
              // Underline rule under the glyph box (same fill color),
              // its own q/Q so the color state cannot leak.
              body.push(
                pushGraphicsState(),
                setFillingRgbColor(color.red, color.green, color.blue),
                rectangle(p.x, p.y - Math.max(1, size * 0.12), w, Math.max(1, size * 0.06)),
                fill(),
                popGraphicsState(),
              );
            }
          }
        } else if (image !== null && imgName !== null) {
          for (const p of placements) {
            body.push(
              concatTransformationMatrix(1, 0, 0, 1, p.x, p.y),
              concatTransformationMatrix(w, 0, 0, h, 0, 0),
              drawObject(imgName),
            );
          }
        } else {
          return err('engine-error', 'addWatermark: internal error (missing font or image)');
        }

        const marker = WATERMARK_MARKER_PREFIX + Buffer.from(JSON.stringify({
          id: watermarkId,
          type: isText ? 'text' : 'image',
          text: isText ? text : '',
          page: vi + 1,
          ...(fontName !== null ? { font: fontName.asString().replace(/^\//, '') } : {}),
          ...(imgName !== null ? { img: imgName.asString().replace(/^\//, '') } : {}),
          gs: gsName.asString().replace(/^\//, ''),
        }), 'utf8').toString('base64url');

        const ops = [pushGraphicsState(), setGraphicsState(gsName), ...body, popGraphicsState()];
        const bytes = new TextEncoder().encode([marker, ...ops.map((o) => o.toString())].join('\n'));
        const stream = doc.pdfDoc.context.stream(bytes);
        const ref = doc.pdfDoc.context.register(stream);
        page.node.addContentStream(ref);
      }

      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `addWatermark failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 18 / DEF-216: getWatermarks / deleteWatermark — watermark identity
  // -----------------------------------------------------------------------

  /** DEF-216 — scan every visible page's content streams for watermark
   *  markers. Returns one record per watermark id (first-seen order over
   *  the visible pages) with the 1-based visible page numbers the
   *  watermark rides on (ascending, de-duplicated). The marker is the
   *  single source of truth, so no in-memory state is consulted. */
  private _scanWatermarkMarkers(doc: EngineDoc): WatermarkInfo[] {
    const byId = new Map<string, WatermarkInfo>();
    for (let vi = 0; vi < doc.order.length; vi++) {
      const origIdx = doc.order[vi];
      if (origIdx === undefined || origIdx < 0 || origIdx >= doc.pdfDoc.getPageCount()) continue;
      const page = doc.pdfDoc.getPage(origIdx);
      const contents = page.node.normalizedEntries().Contents;
      if (!contents) continue;
      const elements: PDFObject[] = contents instanceof PDFArray
        ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
        : [contents];
      for (const el of elements) {
        const stream = doc.pdfDoc.context.lookupMaybe(el, PDFStream);
        if (!stream) continue;
        let marker: WatermarkMarker | null = null;
        try {
          marker = readWatermarkMarker(stream.getContents());
        } catch {
          continue;
        }
        if (!marker) continue;
        let info = byId.get(marker.id);
        if (!info) {
          info = { id: marker.id, type: marker.type, text: marker.text, pages: [] };
          byId.set(marker.id, info);
        }
        if (!info.pages.includes(vi + 1)) info.pages.push(vi + 1);
      }
    }
    return [...byId.values()];
  }

  async getWatermarks(docId: string): Promise<Result<WatermarkInfo[], EngineError>> {
    return this._enqueue(docId, () => this._getWatermarksImpl(docId));
  }

  private async _getWatermarksImpl(docId: string): Promise<Result<WatermarkInfo[], EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    return ok(this._scanWatermarkMarkers(doc));
  }

  async deleteWatermark(
    docId: string,
    watermarkId: string,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._deleteWatermarkImpl(docId, watermarkId));
  }

  private async _deleteWatermarkImpl(
    docId: string,
    watermarkId: string,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    if (typeof watermarkId !== 'string' || watermarkId.length === 0) {
      return err('engine-error', 'deleteWatermark: watermarkId must be a non-empty string');
    }

    // Find every page whose content carries a marker for this id.
    const targets: { origIdx: number; markers: WatermarkMarker[] }[] = [];
    for (let vi = 0; vi < doc.order.length; vi++) {
      const origIdx = doc.order[vi];
      if (origIdx === undefined || origIdx < 0 || origIdx >= doc.pdfDoc.getPageCount()) continue;
      const page = doc.pdfDoc.getPage(origIdx);
      const contents = page.node.normalizedEntries().Contents;
      if (!contents || !(contents instanceof PDFArray)) continue;
      const markers: WatermarkMarker[] = [];
      for (let i = 0; i < contents.size(); i++) {
        const stream = doc.pdfDoc.context.lookupMaybe(contents.get(i), PDFStream);
        if (!stream) continue;
        let marker: WatermarkMarker | null = null;
        try {
          marker = readWatermarkMarker(stream.getContents());
        } catch {
          continue;
        }
        if (marker !== null && marker.id === watermarkId) markers.push(marker);
      }
      if (markers.length > 0) targets.push({ origIdx, markers });
    }
    if (targets.length === 0) {
      return err('engine-error', `deleteWatermark: no watermark with id ${watermarkId} found`);
    }

    const snapshot = await snapshotDocWithPdf(doc);
    try {
      for (const { origIdx, markers } of targets) {
        const page = doc.pdfDoc.getPage(origIdx);
        const contents = page.node.normalizedEntries().Contents;
        if (contents && contents instanceof PDFArray) {
          // Iterate backwards: removal shifts the indices after it.
          for (let i = contents.size() - 1; i >= 0; i--) {
            const stream = doc.pdfDoc.context.lookupMaybe(contents.get(i), PDFStream);
            if (!stream) continue;
            let marker: WatermarkMarker | null = null;
            try {
              marker = readWatermarkMarker(stream.getContents());
            } catch {
              continue;
            }
            if (marker !== null && marker.id === watermarkId) {
              contents.remove(i);
            }
          }
        }
        // Best-effort resource cleanup: drop the marker's font/XObject/
        // ExtGState names from the page's resource dicts (skip a missing
        // key — another op may have removed it first).
        const resources = page.node.Resources();
        const removeResource = (dictKey: string, name: string | undefined): void => {
          if (!name || !resources) return;
          const sub = doc.pdfDoc.context.lookupMaybe(resources.get(PDFName.of(dictKey)), PDFDict);
          const key = PDFName.of(name);
          if (sub && sub.has(key)) sub.delete(key);
        };
        for (const marker of markers) {
          removeResource('Font', marker.font);
          removeResource('XObject', marker.img);
          removeResource('ExtGState', marker.gs);
        }
      }
      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      await tryRestorePdfBytes(doc, snapshot.pdfBytes);
      return err('engine-error', `deleteWatermark failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 12: exportFdf / importFdf — comments interchange
  // -----------------------------------------------------------------------
  async exportFdf(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this._enqueue(docId, () => this._exportFdfImpl(docId));
  }

  private async _exportFdfImpl(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      // DEF-164: exportFdf flips annotation y to PDF bottom-left space, so it
      // needs each original page's height (indexed by origIdx).
      const pageHeights = Array.from(
        { length: doc.pdfDoc.getPageCount() },
        (_, idx) => doc.pdfDoc.getPage(idx).getSize().height,
      );
      const bytes = exportFdfBytes(doc.annotations, doc.order, pageHeights);
      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (e) {
      return err('engine-error', `exportFdf failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async importFdf(
    docId: string,
    fdfBytes: Uint8Array,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._importFdfImpl(docId, fdfBytes));
  }

  private async _importFdfImpl(
    docId: string,
    fdfBytes: Uint8Array,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const view = fdfBytes instanceof Uint8Array ? fdfBytes : new Uint8Array(fdfBytes);
    // DEF-164: parseFdf flips annotation y from PDF bottom-left back to the
    // renderer's top-left space, so it needs each VISIBLE page's height
    // (indexed by 0-based visible page).
    const pageHeights = doc.order.map(
      (origIdx) => doc.pdfDoc.getPage(origIdx).getSize().height,
    );
    let imported: AnnModel[];
    try {
      imported = parseFdf(view, pageHeights);
    } catch (e) {
      return err('engine-error', `importFdf: could not parse FDF: ${e instanceof Error ? e.message : String(e)}`);
    }
    const snapshot = snapshotDoc(doc);
    for (const ann of imported) {
      // Place onto the visible page (1-based). /Page already mapped at parse
      // time; clamp into range so a stale /Page can't index out of bounds.
      const visiblePage = Math.max(1, Math.min(ann.page, doc.order.length));
      const origIdx = doc.order[visiblePage - 1];
      if (origIdx === undefined) continue;
      if (doc.annotations[origIdx] === undefined) doc.annotations[origIdx] = [];
      doc.annotations[origIdx].push({ ...ann, page: visiblePage });
    }
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok(buildState(doc));
  }

  // -----------------------------------------------------------------------
  // Phase 57 feature B: exportFormData / importFormData - AcroForm values
  // -----------------------------------------------------------------------
  async exportFormData(
    docId: string,
    format: 'fdf' | 'xfdf',
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this._enqueue(docId, () => this._exportFormDataImpl(docId, format));
  }

  private async _exportFormDataImpl(
    docId: string,
    format: 'fdf' | 'xfdf',
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const entries = getFormFields(doc.pdfDoc).map((f) => ({
        name: f.name,
        value: Array.isArray(f.value) ? f.value.join(',') : f.value,
      }));
      const bytes =
        format === 'xfdf'
          ? new TextEncoder().encode(exportFormXfdf(entries))
          : exportFormFdf(entries);
      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (e) {
      return err('engine-error', `exportFormData failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async importFormData(
    docId: string,
    format: 'fdf' | 'xfdf',
    data: Uint8Array,
  ): Promise<Result<FormDataImportReport, EngineError>> {
    return this._enqueue(docId, () => this._importFormDataImpl(docId, format, data));
  }

  private async _importFormDataImpl(
    docId: string,
    format: 'fdf' | 'xfdf',
    data: Uint8Array,
  ): Promise<Result<FormDataImportReport, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const view = data instanceof Uint8Array ? data : new Uint8Array(data);
    let entries: FormValueEntry[];
    try {
      entries =
        format === 'xfdf'
          ? parseFormXfdf(new TextDecoder('utf-8').decode(view))
          : parseFormFdf(view);
    } catch (e) {
      const label = format === 'xfdf' ? 'XFDF' : 'FDF';
      return err(
        'engine-error',
        `importFormData: could not parse ${label}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    // A zero-entry input applies nothing: no snapshot, no dirty flag.
    if (entries.length === 0) {
      return ok({ matched: [], unmatched: [], empty: [] });
    }
    // Snapshot BEFORE applying so undo restores the pre-import values.
    const snapshot = snapshotDoc(doc);
    const fields = getFormFields(doc.pdfDoc);
    const used = new Set<string>();
    const matched: string[] = [];
    const unmatched: string[] = [];
    for (const entry of entries) {
      // The mapped-field rule documented at shared/convert.ts:204 — exact
      // name first, then case-insensitive. An unmatched name is NEVER
      // created as a stray field.
      let field = fields.find((f) => f.name === entry.name && !used.has(f.id));
      if (field === undefined) {
        const lower = entry.name.toLowerCase();
        field = fields.find((f) => f.name.toLowerCase() === lower && !used.has(f.id));
      }
      if (field === undefined) {
        unmatched.push(entry.name);
        continue;
      }
      used.add(field.id);
      matched.push(field.name);
      fillFormField(doc.pdfDoc, field.id, entry.value);
    }
    const empty = fields.filter((f) => !used.has(f.id)).map((f) => f.name);
    doc.undoStack.push(snapshot);
    doc.redoStack = [];
    doc.modified = true;
    return ok({ matched, unmatched, empty });
  }

  // -----------------------------------------------------------------------
  // Phase 57 feature A: PDF/E engineering documents - optional content
  // groups (layers), XMP pdfe metadata and 3D-content detection.
  // -----------------------------------------------------------------------

  async getLayers(docId: string): Promise<Result<PdfLayer[], EngineError>> {
    return this._enqueue(docId, () => this._getLayersImpl(docId));
  }

  private async _getLayersImpl(
    docId: string,
  ): Promise<Result<PdfLayer[], EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const config = resolveOcConfig(doc.pdfDoc);
      if (config === undefined) {
        return ok([]);
      }
      const entries = flattenOcOrder(config);
      const off = config.lookupMaybe(PDFName.of('OFF'), PDFArray);
      const layers: PdfLayer[] = [];
      let unnamed = 1;
      entries.forEach((entry, index) => {
        const ocg = asOcDict(doc.pdfDoc, entry);
        const name = decodePdfText(ocg?.get(PDFName.of('Name'))) ?? `Layer ${unnamed++}`;
        layers.push({ index, name, visible: !arrayContainsEntry(off, entry) });
      });
      return ok(layers);
    } catch (e) {
      return err('engine-error', `getLayers failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async setLayerVisibility(
    docId: string,
    index: number,
    visible: boolean,
  ): Promise<Result<EngineState, EngineError>> {
    return this._enqueue(docId, () => this._setLayerVisibilityImpl(docId, index, visible));
  }

  private async _setLayerVisibilityImpl(
    docId: string,
    index: number,
    visible: boolean,
  ): Promise<Result<EngineState, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const config = resolveOcConfig(doc.pdfDoc);
      const entries = config === undefined ? [] : flattenOcOrder(config);
      if (config === undefined || !Number.isInteger(index) || index < 0 || index >= entries.length) {
        return err('out-of-range', `layer index ${index} out of range [0,${Math.max(0, entries.length - 1)}]`);
      }
      const entry = entries[index];
      // /OCProperties lives in the pdfDoc, so the undo entry must capture
      // serialized pdfDoc bytes (matching insertBlankPage:1721 and
      // insertFromPdf:1828 — in both the snapshot precedes the mutation).
      // Capture BEFORE the /ON//OFF edits so undo restores the exact
      // pre-toggle visibility; the out-of-range return above already
      // pushed nothing, keeping the undo stack untouched on rejection.
      const snapshot = await snapshotDocWithPdf(doc);
      // Never touch /Order. ON/OFF are the only arrays this op edits.
      const on = config.lookupMaybe(PDFName.of('ON'), PDFArray);
      if (on !== undefined) {
        removeEntryFromArray(on, entry);
      }
      if (visible) {
        const off = config.lookupMaybe(PDFName.of('OFF'), PDFArray);
        if (off !== undefined) {
          removeEntryFromArray(off, entry);
        }
      } else {
        let off = config.lookupMaybe(PDFName.of('OFF'), PDFArray);
        if (off === undefined) {
          off = doc.pdfDoc.context.obj([]) as PDFArray;
          config.set(PDFName.of('OFF'), off);
        }
        if (!arrayContainsEntry(off, entry)) {
          off.push(entry);
        }
      }
      doc.undoStack.push(snapshot);
      doc.redoStack = [];
      doc.modified = true;
      return ok(buildState(doc));
    } catch (e) {
      return err('engine-error', `setLayerVisibility failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async getCadMetadata(
    docId: string,
  ): Promise<Result<PdfCadMetadata | null, EngineError>> {
    return this._enqueue(docId, () => this._getCadMetadataImpl(docId));
  }

  private async _getCadMetadataImpl(
    docId: string,
  ): Promise<Result<PdfCadMetadata | null, EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    const raw = doc.pdfDoc.catalog.get(PDFName.of('Metadata'));
    if (raw === undefined) return ok(null);
    const stream = doc.pdfDoc.context.lookupMaybe(raw, PDFStream);
    if (stream === undefined) return ok(null);
    // Refuse BEFORE decoding: a declared /Length over the ceiling is a bounded,
    // documented refusal (the standing aggregate-budget rule), never an
    // allocation of the whole packet.
    const declaredLength = stream.dict.lookupMaybe(PDFName.of('Length'), PDFNumber)?.asNumber();
    if (declaredLength !== undefined && declaredLength > METADATA_MAX_BYTES) {
      return err('engine-error', 'getCadMetadata: XMP metadata exceeds the 4 MiB scan ceiling');
    }
    try {
      const packet = decodeMetadataStream(stream);
      return ok(extractPdfeBlocks(packet));
    } catch {
      // A failed decode is never an error: the document simply declares no
      // readable pdfe block.
      return ok(null);
    }
  }

  async get3dContent(
    docId: string,
  ): Promise<Result<Pdf3dContent[], EngineError>> {
    return this._enqueue(docId, () => this._get3dContentImpl(docId));
  }

  private async _get3dContentImpl(
    docId: string,
  ): Promise<Result<Pdf3dContent[], EngineError>> {
    const doc = this.docs.get(docId);
    if (doc === undefined) {
      return err('engine-error', `unknown document: ${docId}`);
    }
    try {
      const found: Pdf3dContent[] = [];
      let counter = 1;
      for (let visible = 0; visible < doc.order.length; visible++) {
        const page = doc.pdfDoc.getPage(doc.order[visible]);
        const annots = page.node.Annots();
        if (annots === undefined) continue;
        for (let i = 0; i < annots.size(); i++) {
          const annot = doc.pdfDoc.context.lookupMaybe(annots.get(i), PDFDict);
          if (annot === undefined) continue;
          const subtype = annot.lookupMaybe(PDFName.of('Subtype'), PDFName);
          if (subtype === undefined || subtype.decodeText() !== '3D') continue;
          const name = decodePdfText(annot.get(PDFName.of('NM')))
            ?? decodePdfText(annot.get(PDFName.of('T')))
            ?? `3D object ${counter}`;
          found.push({ page: visible + 1, name });
          counter += 1;
        }
      }
      return ok(found);
    } catch (e) {
      return err('engine-error', `get3dContent failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 57 feature A helpers - optional content groups, pdfe XMP, 3D detection
// ---------------------------------------------------------------------------

/** Phase 57 feature A - the XMP scan ceiling (4 MiB). */
const METADATA_MAX_BYTES = 4 * 1024 * 1024;

/** Phase 57 feature A - per-block cap on returned pdfe key/value pairs. */
const PDFE_MAX_ENTRIES = 64;

/**
 * Resolve catalog /OCProperties to the config dict. The config is the /D entry
 * when present, otherwise /OCProperties itself. Returns undefined when the
 * document declares no optional content at all.
 */
function resolveOcConfig(pdfDoc: PDFDocument): PDFDict | undefined {
  const raw = pdfDoc.catalog.get(PDFName.of('OCProperties'));
  if (raw === undefined) return undefined;
  const ocprops = pdfDoc.context.lookupMaybe(raw, PDFDict);
  if (ocprops === undefined) return undefined;
  return ocprops.lookupMaybe(PDFName.of('D'), PDFDict) ?? ocprops;
}

/**
 * Flatten the config /Order array one level into OCG refs/dicts, keeping
 * document order. A nested array is descended once (its direct members are
 * considered); anything that is not a PDFRef or PDFDict is skipped.
 */
function flattenOcOrder(config: PDFDict): PDFObject[] {
  const order = config.lookupMaybe(PDFName.of('Order'), PDFArray);
  if (order === undefined) return [];
  const out: PDFObject[] = [];
  const consider = (value: PDFObject | undefined): void => {
    if (value instanceof PDFRef || value instanceof PDFDict) out.push(value);
  };
  for (let i = 0; i < order.size(); i++) {
    const el = order.get(i);
    if (el instanceof PDFArray) {
      for (let j = 0; j < el.size(); j++) consider(el.get(j));
    } else {
      consider(el);
    }
  }
  return out;
}

/** Resolve one flattened /Order entry to its OCG dict, if any. */
function asOcDict(pdfDoc: PDFDocument, entry: PDFObject): PDFDict | undefined {
  if (entry instanceof PDFDict) return entry;
  if (entry instanceof PDFRef) return pdfDoc.context.lookupMaybe(entry, PDFDict);
  return undefined;
}

/** Decode a PDFString/PDFHexString to a plain string, or undefined. */
function decodePdfText(value: PDFObject | undefined): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    try {
      return value.decodeText();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** True when the array holds the entry (same object or same ref tag). */
function arrayContainsEntry(arr: PDFArray | undefined, entry: PDFObject): boolean {
  if (arr === undefined) return false;
  for (let i = 0; i < arr.size(); i++) {
    const el = arr.get(i);
    if (el === entry) return true;
    if (el instanceof PDFRef && entry instanceof PDFRef && el.tag === entry.tag) return true;
  }
  return false;
}

/** Remove every occurrence of the entry (same object or same ref tag). */
function removeEntryFromArray(arr: PDFArray, entry: PDFObject): void {
  for (let i = arr.size() - 1; i >= 0; i--) {
    const el = arr.get(i);
    if (el === entry || (el instanceof PDFRef && entry instanceof PDFRef && el.tag === entry.tag)) {
      arr.remove(i);
    }
  }
}

/**
 * Decode a metadata stream's raw contents to text. A Flate-encoded stream is
 * inflated with node's inflateSync; anything else is decoded as UTF-8. The
 * caller bounds the packet by its declared /Length before calling this.
 */
function decodeMetadataStream(stream: PDFStream): string {
  const raw = stream.getContents();
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  let filterName: string | undefined;
  if (filter instanceof PDFName) {
    filterName = filter.decodeText();
  } else if (filter instanceof PDFArray) {
    filterName = filter.lookupMaybe(0, PDFName)?.decodeText();
  }
  const bytes = filterName === 'FlateDecode' ? inflateSync(raw) : raw;
  return new TextDecoder('utf-8').decode(bytes);
}

/** The prefix bound to the pdfe namespace URI, defaulting to 'pdfe'. */
function pdfePrefix(packet: string): string {
  const match = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*["']http:\/\/www\.aiim\.org\/pdfe\/ns\/["']/.exec(packet);
  return match?.[1] ?? 'pdfe';
}

/** Extract one pdfe block's direct pdfe-prefixed child elements as pairs. */
function extractPdfeBlock(
  packet: string,
  prefix: string,
  block: string,
): Array<{ key: string; value: string }> {
  const open = new RegExp(`<${prefix}:${block}(?:\\s[^>]*)?>`).exec(packet);
  if (open === null) return [];
  const start = open.index + open[0].length;
  const end = packet.indexOf(`</${prefix}:${block}>`, start);
  if (end < 0) return [];
  const inner = packet.slice(start, end);
  const pair = new RegExp(
    `<${prefix}:([A-Za-z_][\\w.-]*)(?:\\s[^>]*)?>([^<]*)</${prefix}:\\1>`,
    'g',
  );
  const out: Array<{ key: string; value: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pair.exec(inner)) !== null) {
    out.push({ key: match[1], value: match[2].trim() });
    if (out.length >= PDFE_MAX_ENTRIES) break;
  }
  return out;
}

/**
 * Find the pdfe namespace blocks in an XMP packet. Returns null when none of
 * the three blocks is present at all; a present block with no entries yields
 * an empty array for that block.
 */
function extractPdfeBlocks(packet: string): PdfCadMetadata | null {
  const prefix = pdfePrefix(packet);
  const present = new RegExp(
    `<${prefix}:(Identification|Measurement|Geospatial)(?:\\s[^>]*)?>`,
  ).test(packet);
  if (!present) return null;
  return {
    identification: extractPdfeBlock(packet, prefix, 'Identification'),
    measurement: extractPdfeBlock(packet, prefix, 'Measurement'),
    geospatial: extractPdfeBlock(packet, prefix, 'Geospatial'),
  };
}

/** Clamp a number into [min, max]. */
function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

/**
 * DEF-131 — strip a `/CropBox` or `/TrimBox` from `dstLeaf` when the
 * `srcLeaf` did not carry one on its own node. pdf-lib's `copyPages`
 * walks `PDFPageLeaf.InheritableEntries` and pulls any value the
 * cloned leaf was inheriting from its source /Pages parent DOWN onto
 * the cloned leaf so the value survives the copy (the dest /Pages
 * root does not carry it). For /Resources, /MediaBox and /Rotate that
 * is the correct behaviour; for /CropBox and /TrimBox it propagates a
 * source-level (often global) box onto every dest leaf whose source
 * leaf did not have its own. A per-page crop on page 1 of a doc whose
 * /Pages root carried a /CropBox then rendered every page at the
 * inherited crop. The dest /Pages root never carries a /CropBox
 * (`PDFDocument.create()` builds a bare root), so the pulled-down leaf
 * value is the ONLY place the inherited box lives in the output —
 * deleting it when the source leaf did not have one leaves the dest
 * leaf with no box, matching the source leaf's effective state.
 */
function neutralizeInheritedBox(
  dstLeaf: { delete?: (name1: any, name2?: any) => void; get?: (name: any) => any },
  srcLeaf: { get?: (name: any) => any },
  key: string,
): void {
  try {
    if (typeof dstLeaf.delete !== 'function') return;
    if (typeof srcLeaf.get !== 'function') return;
    // Only strip when the SOURCE leaf did not carry the box on its own
    // node. A leaf that carried its own box (e.g. a page the user just
    // cropped) keeps it; the box is not inherited, it is intentional.
    if (srcLeaf.get(PDFName.of(key)) === undefined) {
      dstLeaf.delete(PDFName.of(key));
    }
  } catch {
    // Best-effort: never block a save on a box-strip failure.
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Detect image format from magic bytes. Returns 'png' if the buffer starts
 * with the 8‑byte PNG signature, otherwise returns 'jpeg'.
 */
function detectImageFormat(buf: Uint8Array): 'png' | 'jpeg' {
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8) {
    for (let i = 0; i < 8; i++) {
      if (buf[i] !== PNG_SIG[i]) {
        return 'jpeg';
      }
    }
    return 'png';
  }
  return 'jpeg';
}

// ---------------------------------------------------------------------------
// Phase 10: Edit-content helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a 1-based VISIBLE page index to the 0-based original pdfDoc
 * page index. Returns EngineError if the page is out of range.
 */
function resolveVisiblePage(
  doc: EngineDoc,
  page1: number,
): Result<number, EngineError> {
  if (!Number.isInteger(page1) || page1 < 1 || page1 > doc.order.length) {
    return err('out-of-range', `page ${page1} out of range [1,${doc.order.length}]`);
  }
  const visibleIdx = page1 - 1;
  const origIdx = doc.order[visibleIdx];
  if (origIdx === undefined || origIdx < 0 || origIdx >= doc.pdfDoc.getPageCount()) {
    return err('out-of-range', `page ${page1} resolves to invalid original index ${origIdx}`);
  }
  return ok(origIdx);
}

/** Phase 85 — true when the RAW outline payload contains an entry whose title
 *  is not a non-empty (after trim) string, so `_setOutlineImpl` can refuse the
 *  edit rather than let `normalizeOutline` silently drop it. Non-object entries
 *  are treated as invalid too. Nesting beyond the normalized depth clamp is
 *  ignored, matching what `normalizeOutline` would keep. */
function outlineHasEmptyTitle(input: unknown, depth = 0): boolean {
  if (!Array.isArray(input)) return false;
  if (depth >= MAX_OUTLINE_DEPTH) return false;
  for (const item of input) {
    if (item === null || typeof item !== 'object') return true;
    const rec = item as { title?: unknown; children?: unknown };
    if (typeof rec.title !== 'string' || rec.title.trim().length === 0) return true;
    if (outlineHasEmptyTitle(rec.children, depth + 1)) return true;
  }
  return false;
}

/**
 * Strip characters that pdf-lib's StandardFonts (WinAnsiEncoding) cannot
 * encode. Code points > 0xFFFF and most > 0xFF are dropped; controls are
 * replaced with a space. This is the documented Phase 10 limitation —
 * non-Latin text cannot be drawn with the bundled standard fonts and
 * would otherwise throw inside font.encodeText.
 */
function sanitizeForStandardFont(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20) {
      if (ch === '\n' || ch === '\r' || ch === '\t') {
        // Keep whitespace newlines/tabs as-is; the caller wraps on them.
        out += ch;
      } else {
        out += ' ';
      }
      continue;
    }
    if (code > 0xFF) {
      // Drop non-Latin-1 characters — StandardFonts cannot encode them.
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Wrap text to fit a max width, breaking on word boundaries. Long words
 * that exceed the width are hard-broken across lines. Newlines in the
 * input are honoured as explicit line breaks.
 *
 * Phase 27 — `charSpacing` (points) is included in every width measurement
 * (see `styledTextWidth`), so a tracked line wraps early enough not to
 * overflow its box. Absent/0 leaves the legacy wrap byte-identical.
 */
function wrapTextToWidth(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
  charSpacing = 0,
): string[] {
  const measure = (t: string): number => styledTextWidth(font, t, size, charSpacing);
  const out: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para.length === 0) {
      out.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (word.length === 0) continue;
      const candidate = line.length === 0 ? word : line + ' ' + word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
      } else {
        // If the single word itself is too long, hard-break it.
        if (line.length > 0) {
          out.push(line);
          line = '';
        }
        if (measure(word) <= maxWidth) {
          line = word;
        } else {
          let chunk = '';
          for (const ch of word) {
            if (measure(chunk + ch) <= maxWidth) {
              chunk += ch;
            } else {
              if (chunk.length > 0) out.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        }
      }
    }
    out.push(line);
  }
  return out;
}

function snapshotDoc(doc: EngineDoc): Snapshot {
  return {
    order: [...doc.order],
    deleted: [...doc.deleted],
    rotations: [...doc.rotations],
    annotations: cloneAnnotations(doc.annotations),
    placedSignatures: doc.placedSignatures.map((sp) => ({
      ...sp,
      rect: { ...sp.rect },
    })),
    textBoxes: doc.textBoxes.map(cloneTextBoxModel),
    comments: doc.comments.map(cloneCommentThread),
    formFields: tryGetFormFields(doc),
    // DEF-028: capture rich form snapshot so flatten+undo can rebuild fields
    snapFormFields: trySnapshotAllFormFields(doc),
    // Phase 12: capture page labels for renumberPages undo.
    pageLabels: doc.pageLabels ? doc.pageLabels.map((l) => ({ ...l })) : undefined,
  };
}

/**
 * Phase 10 — snapshot that also captures the serialized pdfDoc bytes so
 * a content-editing op (editTextRun/addTextBox/editImage) can be undone
 * by reloading the pdfDoc. Only Phase 10 ops mutate page content streams
 * directly, so only they pay this cost.
 */
async function snapshotDocWithPdf(doc: EngineDoc): Promise<Snapshot> {
  const snap = snapshotDoc(doc);
  try {
    const bytes = await doc.pdfDoc.save();
    snap.pdfBytes = bytes;
  } catch {
    // If serialization fails, proceed without a pdf snapshot — undo of
    // this op will then not revert content, but the op itself may still
    // succeed. Better than blocking the edit entirely.
  }
  return snap;
}

async function restoreSnapshot(doc: EngineDoc, snap: Snapshot): Promise<void> {
  doc.order = [...snap.order];
  doc.deleted = [...snap.deleted];
  doc.rotations = [...snap.rotations];
  doc.annotations = cloneAnnotations(snap.annotations);
  doc.placedSignatures = snap.placedSignatures.map((sp) => ({
    ...sp,
    rect: { ...sp.rect },
  }));
  // Phase 14 / DEF-135 / DEF-136: restore the text-box registry so undo of
  // addTextBox/moveTextBox/deleteTextBox/updateTextBox reverts the registry
  // (a registry op captures a plain snapshotDoc, so snap.textBoxes is always
  // present).
  doc.textBoxes = (snap.textBoxes ?? []).map(cloneTextBoxModel);
  // Phase 28: restore the comment threads so undo of addComment reverts the
  // entry, and undo of deleteAnnotation restores the dropped thread.
  doc.comments = (snap.comments ?? []).map(cloneCommentThread);
  // Phase 12: restore page labels (undefined means none were set).
  doc.pageLabels = snap.pageLabels ? snap.pageLabels.map((l) => ({ ...l })) : undefined;

  // Phase 10: if the snapshot captured pdfDoc bytes, reload the pdfDoc
  // so content edits (drawn white rects / text / images) are reverted.
  // Awaited so buildState runs against the reverted pdfDoc.
  if (snap.pdfBytes) {
    await tryRestorePdfBytes(doc, snap.pdfBytes);
  }

  // DEF-028: if we have a rich form snapshot, use it to restore form fields
  // (rebuilding from scratch if the form was flattened). Otherwise fall back
  // to value-only restore.
  if (snap.snapFormFields && snap.snapFormFields.length > 0) {
    tryRestoreFormFieldsFromSnap(doc, snap.snapFormFields);
  } else if (snap.formFields) {
    tryRestoreFormFields(doc, snap.formFields);
  }
}

/**
 * Phase 10 — reload doc.pdfDoc from a previously captured byte snapshot.
 * Used by restoreSnapshot (best-effort, fire-and-forget) and by the
 * Phase 10 op error-recovery paths (awaited). On failure the existing
 * pdfDoc is left untouched so the document stays openable.
 */
async function tryRestorePdfBytes(doc: EngineDoc, bytes: Uint8Array | undefined): Promise<void> {
  if (!bytes) return;
  try {
    const reloaded = await PDFDocument.load(bytes, { preserveXFA: true });
    doc.pdfDoc = reloaded;
  } catch {
    // Best-effort: leave the current pdfDoc in place.
  }
}

function tryGetFormFields(doc: EngineDoc): FormField[] | undefined {
  try {
    return getFormFields(doc.pdfDoc);
  } catch {
    return undefined;
  }
}

function trySnapshotAllFormFields(doc: EngineDoc): FormSnapshotEntry[] | undefined {
  try {
    return snapshotAllFormFields(doc.pdfDoc);
  } catch {
    return undefined;
  }
}

function tryRestoreFormFields(doc: EngineDoc, fields: FormField[]): void {
  try {
    for (const field of fields) {
      fillFormField(doc.pdfDoc, field.id, field.value);
    }
  } catch {
    // Best-effort restore — ignore errors
  }
}

function tryRestoreFormFieldsFromSnap(doc: EngineDoc, entries: FormSnapshotEntry[]): void {
  try {
    restoreFormFieldsFromSnapshot(doc.pdfDoc, entries);
  } catch {
    // Best-effort restore — ignore errors
  }
}

function buildState(doc: EngineDoc): EngineState {
  const state: EngineState = {
    pageCount: doc.order.length,
    modified: doc.modified,
    pageOrder: [...doc.order],
    rotations: doc.order.map((i) => doc.rotations[i]),
    deleted: [...doc.deleted],
  };
  // Attach Phase 3 annotations as a flat array — the renderer's
  // normalizeState expects Array.isArray(annotations).
  // Each AnnModel already carries a 1‑based `page` field.
  const flat: AnnModel[] = [];
  for (let vi = 0; vi < doc.order.length; vi++) {
    const origIdx = doc.order[vi];
    const pageAnns = doc.annotations[origIdx];
    if (pageAnns !== undefined) {
      flat.push(...pageAnns);
    }
  }
  (state as any).annotations = flat;
  // Attach placed signatures
  (state as any).placedSignatures = doc.placedSignatures.map((sp) => ({
    id: sp.id,
    signatureId: sp.signatureId,
    page: sp.page,
    rect: { ...sp.rect },
  }));
  // Phase 14 / DEF-135 / DEF-136: attach the text-box registry so the
  // renderer can render/move/delete committed boxes from EngineState.
  // Phase 21: the clone carries the new style fields (align, lineHeight,
  // bold, italic, underline, baselineShift, highlight, list) so the panel
  // can reflect the selected object's actual formatting.
  state.textBoxes = doc.textBoxes.map(cloneTextBoxModel);
  // Phase 28 — attach the comment threads (one per annotated element with
  // comments). Always present (empty array when none) so the renderer can
  // decide the comment-icon visibility without a separate call.
  state.comments = doc.comments.map(cloneCommentThread);
  // Attach form fields with remapped page numbers (DEF-031)
  try {
    const rawFields = getFormFields(doc.pdfDoc);
    const remapped = remapFormFieldPages(rawFields, doc.order);
    if (remapped.length > 0) {
      state.formFields = remapped;
    }
  } catch {
    // Document has no form or form is corrupt — omit formFields
  }
  // Phase 59 item 4 — surface the most recent native-fill report so the
  // renderer can show "N filled / M skipped with reasons" from the fill/save
  // IPC result without a new channel. Optional; absent until a fill/save ran.
  // ADV-127 / DEF-427 — the report is stored in ORIGINAL pdfDoc page indices
  // and remapped here to the VISIBLE page the user actually sees (a field on a
  // deleted page gets `page: null`), matching getFormFields / buildState.
  if (doc.lastFormFillReport !== undefined) {
    state.formFillReport = remapFormFillReportPages(doc.lastFormFillReport, doc.order);
  }
  // Phase 12: expose page labels set by renumberPages (visible order).
  if (doc.pageLabels && doc.pageLabels.length > 0) {
    state.pageLabels = doc.pageLabels.map((l) => ({ ...l }));
  }
  return state;
}

/**
 * DEF-292 — build `doc`'s state and attach the other document's state as
 * `pairedState`, so a joint cross-document undo/redo refreshes BOTH panes
 * from one round-trip. The paired state carries no `pairedState` of its own.
 */
function pairedState(
  otherDocId: string,
  doc: EngineDoc,
  other: EngineDoc,
): EngineState {
  const state = buildState(doc);
  state.pairedState = { docId: otherDocId, state: buildState(other) };
  return state;
}

/**
 * Remap form field page numbers from original pdfDoc indices to visible
 * (1-based) positions based on the current page order. Fields on deleted
 * pages are filtered out. (DEF-031)
 */
function remapFormFieldPages(
  fields: FormField[],
  order: number[],
): FormField[] {
  const result: FormField[] = [];
  for (const field of fields) {
    const origIdx = field.page - 1; // field.page is 1-based original index
    const visibleIdx = order.indexOf(origIdx);
    if (visibleIdx === -1) continue; // Field on a deleted page — skip
    const newPage = visibleIdx + 1;
    // ADV-124 / DEF-424 — an orphan widget id keeps its `orphan-` prefix so
    // the UI and report can tell it apart from a real, fillable field. Only a
    // real field's id is rebuilt from its visible page + name.
    const id = field.id.startsWith('orphan-')
      ? field.id
      : `form-${visibleIdx}-${field.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    result.push({ ...field, page: newPage, id });
  }
  return result;
}

/**
 * ADV-127 / DEF-427 — remap a native-fill report's page numbers from ORIGINAL
 * pdfDoc indices to VISIBLE (1-based) positions, the same mapping
 * `remapFormFieldPages` applies to the field list. A row whose page was
 * deleted becomes `page: null` (the field is gone from the document). Rows
 * that are not tied to a page already carry `page: null` and are untouched.
 */
function remapFormFillReportPages(
  reports: FormFillReport[],
  order: number[],
): FormFillReport[] {
  return reports.map((report) => {
    if (report.page === null) return { ...report };
    const origIdx = report.page - 1;
    const visibleIdx = order.indexOf(origIdx);
    return { ...report, page: visibleIdx === -1 ? null : visibleIdx + 1 };
  });
}

/**
 * ADV-127 / DEF-427 — the inverse of `remapFormFillReportPages`. The save paths
 * run `fillFormNatively` on the freshly serialized output, whose page indices
 * are already VISIBLE order; convert them back to original indices so the
 * single stored report is always original-indexed and `buildState` can remap
 * it once (this keeps a report correct even after a later page delete).
 */
function reportPagesToOriginal(
  reports: FormFillReport[],
  order: number[],
): FormFillReport[] {
  return reports.map((report) => {
    if (report.page === null) return { ...report };
    const origIdx = order[report.page - 1];
    return { ...report, page: origIdx === undefined ? null : origIdx + 1 };
  });
}

/**
 * ADV-124 / DEF-424 — the truthful single-row report for a fill attempt on an
 * orphan widget id. Matches the orphan by its getFormFields id so the row
 * carries the widget's real name and (original-index) page; falls back to a
 * generic `orphan-unfilled` row if the widget can no longer be found.
 */
function orphanUnfilledReport(pdfDoc: PDFDocument, id: string): FormFillReport[] {
  const detail = 'widget is not referenced by the AcroForm /Fields tree';
  try {
    for (const orphan of findOrphanWidgets(pdfDoc)) {
      const orphanId =
        `orphan-${orphan.pageIndex}-${orphan.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
      if (orphanId !== id) continue;
      return [
        { name: orphan.name, page: orphan.pageIndex + 1, kind: 'orphan', status: 'orphan-unfilled', detail },
      ];
    }
  } catch {
    // Fall through to the generic row.
  }
  return [
    {
      name: id.replace(/^orphan-/, ''),
      page: null,
      kind: 'orphan',
      status: 'orphan-unfilled',
      detail,
    },
  ];
}

function applyOpToDoc(doc: EngineDoc, op: OpEntry): Result<void, EngineError> {
  const surviving = doc.order.length;
  switch (op.kind) {
    case 'rotate-cw': {
      if (op.page < 0 || op.page >= surviving) {
        return err('out-of-range', `page ${op.page} out of range [0,${surviving - 1}]`);
      }
      const origIdx = doc.order[op.page];
      doc.rotations[origIdx] = (doc.rotations[origIdx] + 1) % 4;
      return ok(undefined);
    }
    case 'rotate-ccw': {
      if (op.page < 0 || op.page >= surviving) {
        return err('out-of-range', `page ${op.page} out of range [0,${surviving - 1}]`);
      }
      const origIdx = doc.order[op.page];
      doc.rotations[origIdx] = (doc.rotations[origIdx] + 3) % 4;
      return ok(undefined);
    }
    case 'delete': {
      if (op.page < 0 || op.page >= surviving) {
        return err('out-of-range', `page ${op.page} out of range [0,${surviving - 1}]`);
      }
      if (surviving <= 1) {
        return err('empty-range', 'cannot delete the last remaining page');
      }
      const origIdx = doc.order[op.page];
      doc.deleted[origIdx] = true;
      doc.order.splice(op.page, 1);
      // Drop annotations for the deleted page
      dropPageAnnotations(doc.annotations, origIdx);
      // Update placed signatures: remove placements on deleted page, shift
      const deletedVisiblePage = op.page + 1; // 1-based
      const newPlaced: SignaturePlacement[] = [];
      for (const sp of doc.placedSignatures) {
        if (sp.page === deletedVisiblePage) {
          continue; // Remove placement on deleted page
        }
        if (sp.page > deletedVisiblePage) {
          newPlaced.push({ ...sp, page: sp.page - 1, rect: { ...sp.rect } });
        } else {
          newPlaced.push({ ...sp, rect: { ...sp.rect } });
        }
      }
      doc.placedSignatures = newPlaced;
      // Phase 14 / DEF-135 / DEF-136: drop text boxes on the deleted page and
      // shift boxes after it, mirroring the signature handling above so the
      // registry stays consistent with the visible page numbering.
      const newBoxes: TextBoxModel[] = [];
      for (const tb of doc.textBoxes) {
        if (tb.page === deletedVisiblePage) {
          continue; // Remove box on deleted page
        }
        if (tb.page > deletedVisiblePage) {
          newBoxes.push({ ...tb, page: tb.page - 1, rect: { ...tb.rect } });
        } else {
          newBoxes.push({ ...tb, rect: { ...tb.rect } });
        }
      }
      doc.textBoxes = newBoxes;
      return ok(undefined);
    }
    case 'reorder': {
      if (op.param === undefined) {
        return err('engine-error', 'reorder requires a param (target position)');
      }
      const from = op.page;
      const to = op.param;
      if (from < 0 || from >= surviving) {
        return err('out-of-range', `reorder from ${from} out of range [0,${surviving - 1}]`);
      }
      if (to < 0 || to >= surviving) {
        return err('out-of-range', `reorder to ${to} out of range [0,${surviving - 1}]`);
      }
      if (from === to) {
        return err('no-op', 'reorder from and to are the same');
      }
      const [moved] = doc.order.splice(from, 1);
      doc.order.splice(to, 0, moved);
      return ok(undefined);
    }
    default:
      return err('engine-error', `unknown op kind: ${(op as any).kind}`);
  }
}

/**
 * Phase 49 — the product name stamped into every PDF the app produces.
 * pdf-lib's PDFDocument constructor (`updateInfoDict`) force-sets /Producer to
 * "pdf-lib (https://github.com/Hopding/pdf-lib)" and only fills /Creator when
 * absent, so the output is branded explicitly here. `save()` does not re-run
 * updateInfoDict (the constructor does), so setting both immediately before a
 * save sticks.
 */
export const PDF_PRODUCER = 'Jovrel';

/** Stamp the Jovrel Producer/Creator onto an output document (best-effort). */
export function stampBrandMetadata(doc: PDFDocument): void {
  try {
    doc.setProducer(PDF_PRODUCER);
    doc.setCreator(PDF_PRODUCER);
  } catch {
    // Metadata is cosmetic; never fail a save because of it.
  }
}

/**
 * Phase 52 — emit the classic pdf-lib white-fill rectangle operator stream.
 *
 * @cantoo/pdf-lib rewrote `drawRectangle` to route through `drawSvgPath`, so
 * its output is a different (visually identical) operator sequence. The
 * DEF-151/DEF-221 masks have a pinned operator contract — a `1 1 1 rg` block
 * whose first `cm` is the rect's bottom-left and whose path includes
 * `\n0 <h> l` then `\n<w> 0 l` — which the engine's own tests (and any
 * downstream byte inspection) rely on. Masking keeps the original sequence
 * so unencrypted output is byte-shape unchanged; every other draw call still
 * uses the library's `drawRectangle`.
 *
 * This is the one place the engine reaches past a high-level API: it uses
 * the library's exported operator constructors plus PDFPage's internal
 * `getContentStream()`, because no public API preserves the legacy sequence.
 */
function drawClassicWhiteMaskRect(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const stream = (page as unknown as {
    getContentStream(): { push(...ops: PDFOperator[]): void };
  }).getContentStream();
  stream.push(
    pushGraphicsState(),
    setFillingRgbColor(1, 1, 1),
    setLineWidth(0),
    setDashPattern([], 0),
    translate(x, y),
    rotateRadians(0),
    skewRadians(0, 0),
    moveTo(0, 0),
    lineTo(0, height),
    lineTo(width, height),
    lineTo(width, 0),
    closePath(),
    fill(),
    popGraphicsState(),
  );
}

// ---------------------------------------------------------------------------
// Phase 84 (True redaction) — page content-stream rewrite helpers
// ---------------------------------------------------------------------------

/** The standard-14 base font names pdf-lib can measure without an embedded
 *  metrics table (pdf-lib's own standard fonts carry no /Widths). */
const REDACTION_STANDARD_FONT_NAMES = new Set<string>(Object.values(StandardFonts));

/** Parse a six-digit hex colour (`#rrggbb`) into 0..1 rgb components. An
 *  unparseable value falls back to black; callers validate first. */
function hexToUnitRgb(hex: string): { r: number; g: number; b: number } {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/** Raw operator text for one opaque mark rectangle in content-stream user
 *  space. Mirrors `drawClassicWhiteMaskRect` but in the configured colour and
 *  appended to the (already rewritten) stream instead of pushed onto a live
 *  content stream. */
function redactionRectOperators(rect: AnnRect, colorHex: string): string {
  const { r, g, b } = hexToUnitRgb(colorHex);
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  return [
    pushGraphicsState(),
    setFillingRgbColor(r, g, b),
    setLineWidth(0),
    setDashPattern([], 0),
    moveTo(rect.x, rect.y),
    lineTo(rect.x, y2),
    lineTo(x2, y2),
    lineTo(x2, rect.y),
    closePath(),
    fill(),
    popGraphicsState(),
  ]
    .map((op) => op.toString())
    .join('\n');
}

/** Decode every page /Contents entry (single ref or array) to a latin1 string,
 *  in order. Throws `RedactionUnsupportedError` when an entry is not a stream
 *  or its filter chain cannot be decoded — the engine maps that to a typed
 *  `redaction-unsupported` refusal before mutating anything. */
function decodePageContentStreams(pdfDoc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  if (!contents) return '';
  const entries: unknown[] = contents instanceof PDFArray ? contents.asArray() : [contents];
  let out = '';
  for (const entry of entries) {
    let decoded: Uint8Array;
    try {
      const obj = pdfDoc.context.lookup(entry as PDFRef);
      if (!(obj instanceof PDFStream)) {
        throw new Error('page /Contents entry is not a stream');
      }
      const raw = PDFRawStream.of(
        obj.dict,
        obj.getContents(),
        obj instanceof PDFRawStream ? obj.transform : undefined,
      );
      decoded = decodePDFRawStream(raw).decode();
    } catch {
      throw new RedactionUnsupportedError('content-stream-undecodable');
    }
    out += new TextDecoder('latin1').decode(decoded);
  }
  return out;
}

/**
 * Build a `RedactionAdvanceResolver` from a page's font resources: a `Tf`
 * resource name maps to the font dict, then to per-code glyph advances in
 * thousandths of an em. Simple fonts use `/FirstChar` + `/Widths` (with a
 * `/FontDescriptor /MissingWidth` fallback); standard-14 base fonts are
 * measured with pdf-lib's `StandardFontEmbedder`. Type0/Type3 and any font
 * whose metrics cannot be read return `null`, which makes the shared remover
 * refuse loudly rather than guess. Never returns a guessed advance.
 */
function buildRedactionAdvanceResolver(page: PDFPage): RedactionAdvanceResolver {
  const embedders = new Map<string, StandardFontEmbedder>();
  let fontDict: PDFDict | undefined;
  try {
    const resources = page.node.Resources();
    if (resources) fontDict = resources.lookup(PDFName.of('Font'), PDFDict);
  } catch {
    fontDict = undefined;
  }

  return (fontName, _size, showText) => {
    if (showText.length === 0) return [];
    if (!fontDict) return null;
    let font: PDFDict | undefined;
    try {
      font = fontDict.lookupMaybe(PDFName.of(fontName), PDFDict);
    } catch {
      return null;
    }
    if (!font) return null;

    let subtype = '';
    try {
      subtype = font.get(PDFName.of('Subtype'))?.toString() ?? '';
    } catch {
      subtype = '';
    }
    if (subtype === '/Type0' || subtype === '/Type3') return null;

    let firstChar: number | undefined;
    let widths: PDFArray | undefined;
    let missingWidth: number | undefined;
    try {
      firstChar = font.lookupMaybe(PDFName.of('FirstChar'), PDFNumber)?.asNumber();
      widths = font.lookupMaybe(PDFName.of('Widths'), PDFArray);
      const descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      missingWidth = descriptor?.lookupMaybe(PDFName.of('MissingWidth'), PDFNumber)?.asNumber();
    } catch {
      // Fall through to the base-font / MissingWidth paths below.
    }

    if (widths && firstChar !== undefined) {
      const out: number[] = [];
      for (let i = 0; i < showText.length; i += 1) {
        const code = showText.charCodeAt(i) & 0xff;
        const index = code - firstChar;
        const entry = index >= 0 && index < widths.size() ? widths.get(index) : undefined;
        if (entry instanceof PDFNumber) {
          out.push(entry.asNumber());
        } else if (missingWidth !== undefined) {
          out.push(missingWidth);
        } else {
          return null;
        }
      }
      return out;
    }

    let baseFont = '';
    try {
      baseFont = font.get(PDFName.of('BaseFont'))?.toString().replace(/^\//, '') ?? '';
    } catch {
      baseFont = '';
    }
    if (REDACTION_STANDARD_FONT_NAMES.has(baseFont)) {
      let embedder = embedders.get(baseFont);
      if (!embedder) {
        try {
          embedder = StandardFontEmbedder.for(
            baseFont as Parameters<typeof StandardFontEmbedder.for>[0],
          );
        } catch {
          return null;
        }
        embedders.set(baseFont, embedder);
      }
      const out: number[] = [];
      for (let i = 0; i < showText.length; i += 1) {
        try {
          out.push(embedder.widthOfTextAtSize(showText[i], 1) * 1000);
        } catch {
          return null;
        }
      }
      return out;
    }

    if (missingWidth !== undefined) {
      return showText.split('').map(() => missingWidth as number);
    }
    return null;
  };
}

/**
 * DEF-378 / DEF-381 — carry source-catalog entries onto the re-serialized
 * output document.
 *
 * serializeDoc builds a fresh PDFDocument and copies only pages, so catalog
 * entries were dropped on every save: an opened PDF/A or PDF/X document lost
 * its declared conformance level and its ICC output intent before it was ever
 * re-validated, and a document with optional content groups lost its layers.
 * The source entries cannot be attached as-is because their PDFRefs belong to
 * the source context; they are deep-cloned into the output context with
 * pdf-lib's own PDFObjectCopier, which also memoises shared indirect objects
 * (the same ICC stream referenced twice is copied once).
 *
 * Every entry carried here is known to never reference a page object, so a
 * whole-value clone cannot drag the page tree into the output context:
 *   - /Metadata, /OutputIntents        (DEF-378: XMP + ICC)
 *   - /MarkInfo, /Lang, /ViewerPreferences  (flat dicts / strings)
 *   - /Collection, /AF                 (portfolio / associated-file metadata)
 *
 * /OCProperties is NOT cloned here (DEF-400): a whole-value clone minted a
 * SECOND copy of every optional-content group, distinct from the ones
 * copyPages had already put on the output pages, so PDF.js could never match a
 * content stream's `/OC /MCn` group to the configuration by object identity.
 * carryOptionalContent rebuilds it against the page-used output objects
 * instead; see that function for the carried-vs-dropped ledger.
 *
 * Page-linked entries are carried separately by carryPageLinkedEntries, which
 * REMAPS their page references through the serializer's page map instead of
 * cloning them (a clone would drag the source page object into the destination
 * context and corrupt the page tree):
 *   - /Dests       (named destinations: catalog dict or /Names name tree)
 *   - /OpenAction  (/S /GoTo action dict; a named /D destination is kept)
 *
 * /Names is a name tree that CAN hold page references (named destinations),
 * so it is NOT cloned wholesale — its /JavaScript subtree is copied by
 * carryJavaScriptNames below, and its /Dests subtree is remapped by
 * carryPageLinkedEntries. Neither subtree drags a source page object into the
 * output: JS values are action dicts holding strings/streams, and /Dests page
 * refs are remapped to the matching OUTPUT page object.
 *
 * Still deliberately dropped, each needing its own page-ref remapping pass:
 *   - /StructTreeRoot  (tagged-PDF structure references page objects; needs a
 *     real re-tagging pass — recorded as FEA-023)
 *   - /Names as a whole  (only the /JavaScript and /Dests subtrees are carried)
 *   - /AcroForm  (the engine owns form serialization; see serializeDoc)
 *   - destination shapes carryPageLinkedEntries cannot remap: a destination
 *     whose page ref resolves to no source page (dropped for that entry only,
 *     never a partial/garbage destination), and /OpenAction values that are
 *     not a /S /GoTo dict (e.g. a URI action or a bare destination array).
 *   - /Outlines and /PageLabels are NOT dropped — carried by separate code paths.
 *
 * Failure-isolated: any clone/remap failure is skipped so a save is never
 * blocked by an uncloneable metadata stream or an unresolvable destination; a
 * document with no destinations/OpenAction produces the same bytes as before
 * (no spurious empty /Dests is written).
 */
function carryCatalogEntries(out: PDFDocument, src: PDFDocument): void {
  const names = [
    'Metadata',
    'OutputIntents',
    'MarkInfo',
    'Lang',
    'ViewerPreferences',
    'Collection',
    'AF',
  ] as const;
  for (const name of names) {
    try {
      const value = src.catalog.get(PDFName.of(name));
      if (value === undefined) continue;
      const cloned = PDFObjectCopier.for(src.context, out.context).copy(value);
      out.catalog.set(PDFName.of(name), cloned);
    } catch {
      // Best-effort: never fail a save because a catalog entry could not be
      // cloned. The save proceeds exactly as it did before DEF-378.
    }
  }
  // Separate, failure-isolated selective step: /Names /JavaScript only.
  try {
    carryJavaScriptNames(out, src);
  } catch {
    // Same best-effort contract as the whole-entry clones above.
  }
}

/**
 * Selectively carry ONLY the source catalog's `/Names /JavaScript` subtree.
 *
 * `/Names` can reference page objects through named destinations, so cloning
 * it wholesale could copy page objects into the destination context and
 * corrupt the page tree. The `/JavaScript` name tree is different: its values
 * are JavaScript action dictionaries (strings/streams), never pages, and it is
 * exactly what the PDF/A rule set rejects. Cloning just this subtree keeps the
 * serialized bytes the validator sees faithful to the source, closing the
 * false-PASS hole where JavaScript was dropped before validation.
 */
function carryJavaScriptNames(out: PDFDocument, src: PDFDocument): void {
  const srcNamesValue = src.catalog.get(PDFName.of('Names'));
  if (srcNamesValue === undefined) return;
  const srcNames = src.context.lookupMaybe(srcNamesValue, PDFDict);
  if (srcNames === undefined) return;
  const jsValue = srcNames.get(PDFName.of('JavaScript'));
  if (jsValue === undefined) return;

  const cloned = PDFObjectCopier.for(src.context, out.context).copy(jsValue);
  const existing = out.context.lookupMaybe(out.catalog.get(PDFName.of('Names')), PDFDict);
  if (existing === undefined) {
    const outNames = out.context.obj({}) as PDFDict;
    outNames.set(PDFName.of('JavaScript'), cloned);
    out.catalog.set(PDFName.of('Names'), out.context.register(outNames));
  } else {
    existing.set(PDFName.of('JavaScript'), cloned);
  }
}

/**
 * DEF-400 — carry the catalog's `/OCProperties` so the layer configuration in
 * the OUTPUT document references the SAME output optional-content group (OCG)
 * objects the OUTPUT pages' marked content uses.
 *
 * Why a dedicated pass: the page tree (and therefore every page's
 * `/Resources /Properties << /MCn <OCG ref> >>`) is copied into the output by
 * `copyPages`, which mints its OWN output OCG refs through pdf-lib's copier.
 * Cloning `/OCProperties` separately (the old blind-clone entry in
 * carryCatalogEntries) minted a SECOND, distinct copy of every OCG. PDF.js
 * matches a content stream's `/OC /MCn` group against the `/OCProperties`
 * configuration BY OBJECT IDENTITY, so two copies can never match: hiding a
 * layer then cannot change the render. This pass maps the config arrays onto
 * the page-used objects instead of re-cloning them.
 *
 * Carried shapes (see carryCatalogEntries for the carried-vs-dropped ledger):
 *   - `/OCProperties /OCGs` (the master list) rebuilt in SOURCE ORDER from the
 *     output refs already used by the pages, plus a shared-copier clone for a
 *     layer no page references (so it still appears in the layer list);
 *   - `/D` as a NEW dict: `/ON`, `/OFF` and `/Order` rebuilt by mapping every
 *     source ref through the same map, preserving nested `/Order` arrays;
 *     `/BaseState` and `/Name` copied verbatim (plain values).
 *
 * Deliberately NOT carried, named here so nothing is silently dropped:
 *   - `/D /AS` (alternate configurations) — needs its own config-array remap;
 *     documented gap, left out of scope by DEF-400 (DEF-400 spec item 4);
 *   - an OCG referenced only from an XObject's own `/Resources /Properties`:
 *     the page walk covers the pages' OWN resources only (recursing into
 *     XObject resources is out of scope), so such a layer falls back to the
 *     shared-copier clone rather than the page-used object;
 *   - an unnamed OCG referenced by a page (no `/Name` to pair on): the config
 *     entry is a structural clone, so identity is guaranteed only for NAMED
 *     layers — the DEF-400 case; unnamed layers keep their previous behavior;
 *   - mapping entries whose source ref is neither in `/OCGs`, `/Order`, `/ON`
 *     or `/OFF` — an unmappable entry is dropped, never emitted as garbage.
 *
 * Failure-isolated: any throw is swallowed so a save is never blocked, exactly
 * like the other carries. A document with no `/OCProperties` writes nothing
 * (no spurious empty `/OCProperties`), mirroring the `/Dests` guarantee.
 */
function carryOptionalContent(
  out: PDFDocument,
  src: PDFDocument,
  pageMap: Map<number, number>,
): void {
  try {
    const srcOcPropsValue = src.catalog.get(PDFName.of('OCProperties'));
    if (srcOcPropsValue === undefined) return; // byte-stability: nothing to carry
    const srcOcProps = src.context.lookupMaybe(srcOcPropsValue, PDFDict);
    if (srcOcProps === undefined) return;

    // Source config dict: /D when present, else /OCProperties itself — mirrors
    // resolveOcConfig so the arrays we rebuild are the ones the engine reads.
    const srcConfig = srcOcProps.lookupMaybe(PDFName.of('D'), PDFDict) ?? srcOcProps;
    const srcOcgsArr = src.context.lookupMaybe(srcOcProps.get(PDFName.of('OCGs')), PDFArray);

    const sourceEntries: PDFObject[] = [];
    const seen = new Set<PDFObject>();
    const addSource = (value: PDFObject | undefined): void => {
      if (!(value instanceof PDFRef || value instanceof PDFDict)) return;
      if (seen.has(value)) return;
      seen.add(value);
      sourceEntries.push(value);
    };
    // /OCGs is the master list; it also defines the output /OCGs order.
    const srcOcgList: PDFObject[] = [];
    if (srcOcgsArr !== undefined) {
      for (let i = 0; i < srcOcgsArr.size(); i++) {
        const entry = srcOcgsArr.get(i);
        if (entry instanceof PDFRef || entry instanceof PDFDict) srcOcgList.push(entry);
        addSource(entry);
      }
    }
    // Some producers populate only /D /Order. Fall back to it both for the
    // master list and (below) for identity mapping.
    for (const entry of flattenOcOrder(srcConfig)) {
      if (srcOcgList.length === 0) srcOcgList.push(entry);
      addSource(entry);
    }
    const onArr0 = src.context.lookupMaybe(srcConfig.get(PDFName.of('ON')), PDFArray);
    if (onArr0 !== undefined) for (let i = 0; i < onArr0.size(); i++) addSource(onArr0.get(i));
    const offArr0 = src.context.lookupMaybe(srcConfig.get(PDFName.of('OFF')), PDFArray);
    if (offArr0 !== undefined) for (let i = 0; i < offArr0.size(); i++) addSource(offArr0.get(i));

    const srcDictOf = (entry: PDFObject): PDFDict | undefined =>
      entry instanceof PDFDict ? entry : src.context.lookupMaybe(entry, PDFDict);
    const nameOf = (entry: PDFObject): string | undefined => {
      const dict = srcDictOf(entry);
      const raw = dict?.get(PDFName.of('Name'));
      if (raw === undefined) return undefined;
      return decodePdfText(raw) ?? raw.toString().replace(/^\//, '');
    };
    // A name is only usable as a join key when it is unique among the source
    // OCGs; a duplicate name is ambiguous and falls back to a clone.
    const nameCounts = new Map<string, number>();
    for (const entry of sourceEntries) {
      const name = nameOf(entry);
      if (name !== undefined) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }

    // ---- 1. output OCG refs the pages already use, keyed by unique name ----
    const pageEntries: Array<{ props: PDFDict; key: PDFName }> = [];
    for (const [, outIdx] of [...pageMap.entries()].sort((a, b) => a[1] - b[1])) {
      const resources = out.getPage(outIdx).node.Resources();
      const props = resources?.lookupMaybe(PDFName.of('Properties'), PDFDict);
      if (props === undefined) continue;
      for (const [key] of props.entries()) pageEntries.push({ props, key });
    }
    const canonicalByName = new Map<string, PDFObject>();
    for (const { props, key } of pageEntries) {
      const value = props.get(key);
      if (value === undefined) continue;
      const dict = value instanceof PDFDict
        ? value
        : out.context.lookupMaybe(value, PDFDict);
      if (dict === undefined) continue;
      const name = decodePdfText(dict.get(PDFName.of('Name')))
        ?? dict.get(PDFName.of('Name'))?.toString().replace(/^\//, '');
      if (name === undefined || (nameCounts.get(name) ?? 0) !== 1) continue;
      // Make the page reference indirect so it survives a save as one object.
      let ref: PDFObject = value;
      if (!(value instanceof PDFRef)) {
        ref = out.context.register(value);
        props.set(key, ref);
      }
      if (!canonicalByName.has(name)) canonicalByName.set(name, ref);
    }
    // Normalize: every page entry naming the same unique OCG points at the one
    // canonical ref, so page-to-page identity holds as well as page-to-config.
    for (const { props, key } of pageEntries) {
      const value = props.get(key);
      if (value === undefined) continue;
      const dict = value instanceof PDFDict
        ? value
        : out.context.lookupMaybe(value, PDFDict);
      const name = dict === undefined
        ? undefined
        : decodePdfText(dict.get(PDFName.of('Name')))
          ?? dict.get(PDFName.of('Name'))?.toString().replace(/^\//, '');
      const canonical = name === undefined ? undefined : canonicalByName.get(name);
      if (canonical !== undefined && value !== canonical) props.set(key, canonical);
    }

    // ---- 2. source OCG -> output object -----------------------------------
    const sharedCopier = PDFObjectCopier.for(src.context, out.context);
    const srcRefToOut = new Map<string, PDFObject>();
    const srcDictToOut = new Map<PDFDict, PDFObject>();
    const record = (source: PDFObject, mapped: PDFObject): void => {
      if (source instanceof PDFRef) srcRefToOut.set(source.tag, mapped);
      else if (source instanceof PDFDict) srcDictToOut.set(source, mapped);
    };
    const mapEntry = (value: PDFObject | undefined): PDFObject | undefined => {
      if (value === undefined) return undefined;
      if (value instanceof PDFRef) return srcRefToOut.get(value.tag);
      if (value instanceof PDFDict) return srcDictToOut.get(value);
      return undefined;
    };
    // Pair every source OCG that a page already uses with that page's object.
    for (const entry of sourceEntries) {
      const name = nameOf(entry);
      if (name === undefined) continue;
      const canonical = canonicalByName.get(name);
      if (canonical !== undefined) record(entry, canonical);
    }
    // Clone the leftovers (layers no page uses) through ONE shared copier, so a
    // layer shared between configs is cloned once and still appears in the list.
    for (const entry of sourceEntries) {
      if (mapEntry(entry) !== undefined) continue;
      try {
        const cloned = sharedCopier.copy(entry);
        record(entry, cloned instanceof PDFRef ? cloned : out.context.register(cloned));
      } catch {
        // Entry is dropped from the rebuilt arrays; never fail the save.
      }
    }

    const remapList = (arr: PDFArray): PDFArray | undefined => {
      const els: PDFObject[] = [];
      for (let i = 0; i < arr.size(); i++) {
        const el = arr.get(i);
        if (el instanceof PDFArray) {
          const nested = remapList(el);
          if (nested !== undefined) els.push(nested);
          continue;
        }
        const mapped = mapEntry(el);
        if (mapped !== undefined) els.push(mapped);
      }
      return els.length > 0 ? (out.context.obj(els) as PDFArray) : undefined;
    };

    const outOcgs: PDFObject[] = [];
    for (const entry of srcOcgList) {
      const mapped = mapEntry(entry);
      if (mapped !== undefined) outOcgs.push(mapped);
    }

    // ---- 3. NEW /OCProperties --------------------------------------------
    const outD = out.context.obj({}) as PDFDict;
    for (const key of ['ON', 'OFF', 'Order'] as const) {
      const srcArr = src.context.lookupMaybe(srcConfig.get(PDFName.of(key)), PDFArray);
      if (srcArr === undefined) continue;
      const remapped = remapList(srcArr);
      if (remapped !== undefined) outD.set(PDFName.of(key), remapped);
    }
    for (const key of ['BaseState', 'Name'] as const) {
      const value = srcConfig.get(PDFName.of(key));
      if (value instanceof PDFName || value instanceof PDFString) {
        outD.set(PDFName.of(key), value);
      }
    }
    // /D /AS (alternate configurations) intentionally not carried — see the
    // out-of-scope ledger in this function's block comment.
    const outOcProps = out.context.obj({}) as PDFDict;
    outOcProps.set(PDFName.of('OCGs'), out.context.obj(outOcgs) as PDFArray);
    outOcProps.set(PDFName.of('D'), out.context.register(outD));
    out.catalog.set(PDFName.of('OCProperties'), out.context.register(outOcProps));
  } catch {
    // Best-effort: a save is never blocked by an un-carryable layer config.
  }
}

/**
 * Phase 57 feature G — carry the page-linked catalog entries `/Dests` (named
 * destinations) and `/OpenAction` (the initial view) across a save, REMAPPING
 * their page references through the serializer's page map.
 *
 * A whole-value clone is exactly what DEF-378/DEF-381 refused here: a
 * destination holds the SOURCE page object, so cloning one would copy a page
 * into the output's destination context and corrupt the page tree. Instead
 * each destination's page reference is resolved back to its source page index
 * and re-pointed at the matching OUTPUT page object; the rest of the
 * destination (`/XYZ`, `/Fit`, coordinates, ...) is carried verbatim.
 *
 * Carried shapes (see the block comment on carryCatalogEntries for the full
 * carried-vs-dropped ledger):
 *   - catalog `/Dests` as a name->destination dict, or as a name tree
 *     (`/Names` key/destination pairs, recursing `/Kids`);
 *   - `/Names /Dests` name-tree entries;
 *   - a destination array `[pageRef|pageDict /Fit...]`;
 *   - a destination dict whose `/D` holds an array or a name/string;
 *   - a named destination (name/string) kept intact;
 *   - `/OpenAction` as a `/S /GoTo` action dict (its `/D` remapped when it is
 *     a destination; a name `/D` is kept).
 *
 * Deliberately NOT carried, named here so nothing is silently dropped:
 *   - a destination whose page ref resolves to no source page, or whose shape
 *     is unsupported — dropped for that entry only, never a partial/garbage
 *     destination;
 *   - `/OpenAction` values that are not a `/S /GoTo` dict (a URI action, a
 *     bare destination array, ...);
 *   - `/StructTreeRoot` (FEA-023 — needs a real re-tagging pass);
 *   - `/Names` as a whole (only /JavaScript and /Dests subtrees are carried);
 *   - `/AcroForm` (the engine owns form serialization).
 *
 * Failure-isolated: every lookup/remap is guarded, and a document with no
 * destinations/OpenAction writes nothing (no spurious empty `/Dests`), so its
 * bytes are identical to before this change.
 */
function carryPageLinkedEntries(
  out: PDFDocument,
  src: PDFDocument,
  pageMap: Map<number, number>,
): void {
  // Source page ref tag -> source page index (== origIdx, since getPages()
  // returns pages in source order). The node map covers direct page dicts.
  const refToOrig = new Map<string, number>();
  const nodeToOrig = new Map<PDFDict, number>();
  const srcPages = src.getPages();
  for (let origIdx = 0; origIdx < srcPages.length; origIdx++) {
    const ref = srcPages[origIdx].ref;
    if (ref !== undefined) refToOrig.set(ref.tag, origIdx);
    nodeToOrig.set(srcPages[origIdx].node, origIdx);
  }

  // Resolve a destination page reference (indirect ref or direct page dict) to
  // the matching OUTPUT page ref, or undefined when it names no surviving page.
  const resolveOutputPageRef = (value: PDFObject | undefined): PDFRef | undefined => {
    let origIdx: number | undefined;
    if (value instanceof PDFRef) origIdx = refToOrig.get(value.tag);
    else if (value instanceof PDFDict) origIdx = nodeToOrig.get(value);
    if (origIdx === undefined) return undefined;
    const outIdx = pageMap.get(origIdx);
    if (outIdx === undefined) return undefined;
    return out.getPage(outIdx).ref;
  };

  // Carry one primitive destination entry into the output context, or null for
  // shapes we do not carry (nested dicts/arrays/refs in a destination tail).
  // PDFName/PDFNumber/PDFString are context-free immutable values, so they can
  // be reused as-is (round-tripping them through .of() would re-escape names).
  const carryPrimitive = (value: PDFObject | undefined): PDFObject | null => {
    if (
      value instanceof PDFName ||
      value instanceof PDFNumber ||
      value instanceof PDFString
    ) {
      return value;
    }
    return null;
  };

  // Remap a destination array `[pageRef /Fit | /XYZ x y z ...]`; the tail is
  // preserved verbatim. Returns null when no output page can be resolved.
  const remapDestArray = (arr: PDFArray): PDFArray | null => {
    if (arr.size() === 0) return null;
    const pageRef = resolveOutputPageRef(arr.get(0));
    if (pageRef === undefined) return null;
    const els: PDFObject[] = [pageRef];
    for (let i = 1; i < arr.size(); i++) {
      const prim = carryPrimitive(arr.get(i));
      if (prim !== null) els.push(prim);
    }
    return out.context.obj(els) as PDFArray;
  };

  // Remap any destination shape. A name/string is a named destination and is
  // kept intact; a dict carries its /D (array or name) plus primitive siblings.
  // Returns null when the page ref cannot be resolved.
  const remapDestination = (value: unknown): PDFObject | null => {
    try {
      if (value instanceof PDFArray) return remapDestArray(value);
      if (value instanceof PDFName) return value;
      if (value instanceof PDFString) return value;
      if (value instanceof PDFDict) {
        const d = value.get(PDFName.of('D'));
        if (d === undefined) return null;
        const remappedD = remapDestination(d);
        if (remappedD === null) return null;
        const copy = out.context.obj({}) as PDFDict;
        for (const [key, val] of value.entries()) {
          if (key.toString() === '/D') { copy.set(key, remappedD); continue; }
          const prim = carryPrimitive(val);
          if (prim !== null) copy.set(key, prim);
        }
        return out.context.register(copy);
      }
      if (value instanceof PDFRef) {
        if (refToOrig.has(value.tag)) return resolveOutputPageRef(value) ?? null;
        const looked = src.context.lookup(value);
        if (looked instanceof PDFArray || looked instanceof PDFDict) {
          return remapDestination(looked);
        }
        return null;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Remap a /Dests name tree node: carry each `/Names` key/destination pair
  // (dropping unresolvable entries) and recurse `/Kids`. Returns null when the
  // node carries nothing.
  const remapDestsNode = (node: PDFDict): PDFDict | null => {
    const outNode = out.context.obj({}) as PDFDict;
    let carried = false;

    const namesArr = src.context.lookupMaybe(node.get(PDFName.of('Names')), PDFArray);
    if (namesArr !== undefined) {
      const pairs: PDFObject[] = [];
      for (let i = 0; i + 1 < namesArr.size(); i += 2) {
        const remapped = remapDestination(namesArr.get(i + 1));
        if (remapped === null) continue;
        const key = namesArr.get(i);
        pairs.push(key instanceof PDFString ? PDFString.of(key.asString()) : (key as PDFObject));
        pairs.push(remapped);
        carried = true;
      }
      if (pairs.length > 0) outNode.set(PDFName.of('Names'), out.context.obj(pairs) as PDFArray);
    }

    const kidsArr = src.context.lookupMaybe(node.get(PDFName.of('Kids')), PDFArray);
    if (kidsArr !== undefined) {
      const kids: PDFObject[] = [];
      for (let i = 0; i < kidsArr.size(); i++) {
        const kid = src.context.lookupMaybe(kidsArr.get(i), PDFDict);
        if (kid === undefined) continue;
        const mapped = remapDestsNode(kid);
        if (mapped === null) continue;
        kids.push(out.context.register(mapped));
        carried = true;
      }
      if (kids.length > 0) outNode.set(PDFName.of('Kids'), out.context.obj(kids) as PDFArray);
    }

    return carried ? outNode : null;
  };

  const isNameTree = (node: PDFDict): boolean =>
    node.has(PDFName.of('Names')) || node.has(PDFName.of('Kids'));

  // A `/Dests` container: a name tree, or a direct name->destination dict.
  const remapDests = (node: PDFDict): PDFDict | null => {
    if (isNameTree(node)) return remapDestsNode(node);
    const outDests = out.context.obj({}) as PDFDict;
    let carried = false;
    for (const [key, value] of node.entries()) {
      const remapped = remapDestination(value);
      if (remapped === null) continue;
      outDests.set(key, remapped);
      carried = true;
    }
    return carried ? outDests : null;
  };

  // Catalog /Dests (direct dict or name tree).
  const srcDests = src.context.lookupMaybe(src.catalog.get(PDFName.of('Dests')), PDFDict);
  if (srcDests !== undefined) {
    const carried = remapDests(srcDests);
    if (carried !== null) {
      out.catalog.set(PDFName.of('Dests'), out.context.register(carried));
    }
  }

  // /Names /Dests (always a name tree). Merge into the /Names dict the JS
  // carry may already have created on the output.
  const srcNames = src.context.lookupMaybe(src.catalog.get(PDFName.of('Names')), PDFDict);
  const srcNamesDests = srcNames?.get(PDFName.of('Dests'));
  if (srcNamesDests !== undefined) {
    const tree = src.context.lookupMaybe(srcNamesDests, PDFDict);
    if (tree !== undefined) {
      const carried = remapDestsNode(tree);
      if (carried !== null) {
        let outNames = out.context.lookupMaybe(out.catalog.get(PDFName.of('Names')), PDFDict);
        if (outNames === undefined) {
          outNames = out.context.obj({}) as PDFDict;
          out.catalog.set(PDFName.of('Names'), out.context.register(outNames));
        }
        outNames.set(PDFName.of('Dests'), out.context.register(carried));
      }
    }
  }

  // /OpenAction: remap only a /S /GoTo action dict. A non-GoTo /OpenAction or
  // a bare destination array is deliberately out of scope (see block comment).
  const srcOpenAction = src.context.lookupMaybe(
    src.catalog.get(PDFName.of('OpenAction')),
    PDFDict,
  );
  if (
    srcOpenAction !== undefined &&
    srcOpenAction.get(PDFName.of('S'))?.toString() === '/GoTo'
  ) {
    const d = srcOpenAction.get(PDFName.of('D'));
    if (d !== undefined) {
      const remappedD = remapDestination(d);
      if (remappedD !== null) {
        const outAction = out.context.obj({}) as PDFDict;
        for (const [key, val] of srcOpenAction.entries()) {
          if (key.toString() === '/D') { outAction.set(key, remappedD); continue; }
          const prim = carryPrimitive(val);
          if (prim !== null) outAction.set(key, prim);
        }
        out.catalog.set(PDFName.of('OpenAction'), out.context.register(outAction));
      }
    }
  }
}

/**
 * Phase 59 item 4 — true when the output document carries at least one
 * AcroForm field. Guards the native-fill pass so a form-less save neither
 * embeds the Unicode font nor touches appearances (keeping its bytes
 * unchanged).
 */
function outputHasFormFields(doc: PDFDocument): boolean {
  try {
    if (doc.catalog.get(PDFName.of('AcroForm')) === undefined) return false;
    return doc.getForm().getFields().length > 0;
  } catch {
    return false;
  }
}

async function serializeDoc(doc: EngineDoc): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pageMap = new Map<number, number>(); // origIdx -> output page index

  for (let idx = 0; idx < doc.order.length; idx++) {
    const origIdx = doc.order[idx];
    const [copied] = await out.copyPages(doc.pdfDoc, [origIdx]);
    // DEF-130: normalize the rotation slot to a finite integer in [0,3]
    // before passing it to degrees(). A snapshot/restore mismatch (the
    // original DEF-130 root cause: insertBlankPage used snapshotDoc so
    // undo did not revert the pdfDoc, leaving a "ghost" page whose
    // origIdx exceeded the rotations array length) left
    // `doc.rotations[origIdx]` === undefined, and `undefined * 90` ->
    // NaN threw "degreeAngle must be of type number" out of
    // getDocumentBytes. The snapshot fix above closes the hole at the
    // source; this guard closes it at the serialization site so a
    // future array-length mismatch can never reproduce the throw.
    const rawRot = doc.rotations[origIdx];
    const rotation = Number.isFinite(rawRot) && Number.isInteger(rawRot)
      ? ((rawRot % 4) + 4) % 4
      : 0;
    if (rotation !== 0) {
      copied.setRotation(degrees(rotation * 90));
    }
    // DEF-131: pdf-lib's `copyPages` walks `PDFPageLeaf.InheritableEntries`
    // (`Resources`, `MediaBox`, `CropBox`, `Rotate`) and pulls any value
    // the cloned leaf is inheriting from its source /Pages parent DOWN
    // onto the cloned leaf so it survives the copy. That is correct for
    // /Resources, /MediaBox and /Rotate (the dest /Pages root does not
    // carry them), but it propagates a SOURCE /CropBox (or /TrimBox,
    // which pdf-lib also pulls down even though it is not in the
    // inheritable list — see copyPDFPage's InheritableEntries loop)
    // onto every dest leaf whose source leaf did not have its own. A
    // per-page crop on page 1 of a doc whose /Pages root carried a
    // /CropBox (e.g. a scanned PDF with a global crop) then rendered
    // every page at the inherited crop instead of only page 1. The
    // dest /Pages root never carries a /CropBox (PDFDocument.create()
    // builds a bare /Type /Pages /Kids /Count root), so the cloned
    // leaf's pulled-down /CropBox is the ONLY place the inherited
    // value lives in the output — deleting it when the source leaf
    // did not have one leaves the dest leaf with no /CropBox, matching
    // the source leaf's effective state (no leaf /CropBox). This
    // neutralizes the propagation: only pages whose source leaf
    // carried a /CropBox (i.e. pages the user actually cropped) keep
    // one in the output.
    neutralizeInheritedBox(copied.node, doc.pdfDoc.getPage(origIdx).node, 'CropBox');
    neutralizeInheritedBox(copied.node, doc.pdfDoc.getPage(origIdx).node, 'TrimBox');
    out.addPage(copied);
    pageMap.set(origIdx, idx);
  }

  // DEF-378 / DEF-381 — carry the source catalog entries that cannot reference
  // a page (XMP, ICC output intents, layers, portfolio metadata, ...) plus the
  // /Names /JavaScript subtree, so a save does not lose a PDF/A or PDF/X
  // declaration, optional content, or hide JavaScript from the validator.
  carryCatalogEntries(out, doc.pdfDoc);

  // DEF-400 — rebuild /OCProperties against the output pages' own OCG objects
  // so PDF.js can match the config to the content stream by identity.
  carryOptionalContent(out, doc.pdfDoc, pageMap);

  // Serialize annotations onto the output doc
  await serializeAnnotations(out, doc.annotations, doc.order);

  // Phase 59 item 4 — CARRY the source AcroForm across the rebuild.
  //
  // The previous implementation RECREATED each field (createTextField /
  // createCheckBox / ... + addToPage with no box), which reset every widget to
  // pdf-lib's default 200x50 box at (0,0), collapsed each multi-widget button
  // group to a single widget, and gave the recreated widgets pdf-lib's default
  // white fill + black border — the "layer of fields" users saw over their real
  // form. carryAcroForm deep-copies the /AcroForm object graph with one copier
  // seeded with the output page refs and the widgets `copyPages` already placed
  // on the output pages, so fields, kids, widgets, /DR, /DA, /Ff, /Opt and /AP
  // survive intact and every widget /P points at the NEW page. Master switch
  // for the carry is the source /AcroForm itself; no form means no-op.
  try {
    carryAcroForm(doc.pdfDoc, out, pageMap);
  } catch {
    // A malformed form must never block a save; the save simply has no form.
  }

  // Phase 59 item 4 — NATIVE fill. After the AcroForm is carried, re-apply
  // every field's current value and regenerate each widget's appearance with
  // the bundled Unicode font, so the values live on the FIELDS (not a painted
  // overlay) and open correctly in an independent reader. The report is kept
  // on the engine document and surfaced through EngineState.formFillReport.
  // Saving with `updateFieldAppearances: false` is essential: pdf-lib's
  // default would re-render everything with WinAnsi Helvetica, discarding the
  // Unicode font and throwing on a non-WinAnsi value. The font is embedded
  // ONLY when the output actually carries form fields, so a form-less save is
  // byte-for-byte what it was before.
  if (outputHasFormFields(out)) {
    try {
      const font = await embedEditFont(out, 'DejaVu Serif', false, false);
      doc.lastFormFillReport = reportPagesToOriginal(fillFormNatively(out, font), doc.order);
    } catch (e) {
      console.warn(
        `[tflex] native form fill skipped: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Render placed signatures onto the output pages
  if (doc.placedSignatures.length > 0) {
    const pngCache = new Map<string, Awaited<ReturnType<typeof out['embedPng']>>>();
    for (const sp of doc.placedSignatures) {
      const outPageIdx = sp.page - 1; // 1-based -> 0-based
      if (outPageIdx < 0 || outPageIdx >= out.getPageCount()) continue;

      const pngBytes = sp.pngBytes instanceof Uint8Array
        ? sp.pngBytes
        : new Uint8Array(sp.pngBytes);

      let embeddedImage = pngCache.get(sp.id);
      if (embeddedImage === undefined) {
        try {
          embeddedImage = await out.embedPng(pngBytes);
          pngCache.set(sp.id, embeddedImage);
        } catch {
          continue; // Invalid PNG — skip
        }
      }

      const page = out.getPage(outPageIdx);
      const { x, y, width, height } = sp.rect;
      // PDF coordinates: origin is bottom-left. Convert from top-left.
      const pageHeight = page.getSize().height;
      const pdfY = pageHeight - y - height;

      page.drawImage(embeddedImage, {
        x,
        y: pdfY,
        width,
        height,
      });
    }

    // DEF-030: serialize signature placement metadata into the PDF so it
    // survives save/reload. Stored as a custom catalog entry.
    serializeSignatureMetadata(out, doc.placedSignatures);
  }

  // Phase 14 / DEF-135 / DEF-136 — draw every registry text box once at its
  // FINAL rect (no masking of any prior rect), then persist the registry into
  // a custom catalog entry so boxes survive save/reload and can be moved/
  // deleted after a reopen (mirrors signature placements).
  await drawTextBoxes(out, doc.textBoxes);
  serializeTextBoxMetadata(out, doc.textBoxes);
  // Phase 28 — persist the comment threads in the catalog so they survive
  // save/reopen (both the normal and the optimized save paths).
  serializeCommentMetadata(out, doc.comments);

  // Phase 12 — carry the document outline (bookmarks) onto the output doc
  // with a page-ref remap, so bookmarks survive a save. pageRefMap maps the
  // source page ref tag to the matching output page ref (only surviving,
  // visible pages are present; outline dests to dropped pages are left bare).
  try {
    const pageRefMap = new Map<string, PDFRef>();
    for (const [origIdx, outIdx] of pageMap) {
      const srcRef = doc.pdfDoc.getPage(origIdx).ref;
      if (srcRef) pageRefMap.set(srcRef.tag, out.getPage(outIdx).ref);
    }
    carryOutlines(out, [{ doc: doc.pdfDoc, map: pageRefMap }]);
  } catch {
    // Outline carry is best-effort — never block a save on a malformed outline.
  }

  // Phase 57 feature G — carry /Dests and /OpenAction with their page refs
  // remapped through pageMap (no-op when the source has neither). Best-effort;
  // a malformed destination must never block a save.
  try {
    carryPageLinkedEntries(out, doc.pdfDoc, pageMap);
  } catch {
    // Best-effort — unresolvable destinations are simply not carried.
  }

  // Phase 12 — apply logical page labels to the output catalog's /PageLabels.
  if (doc.pageLabels && doc.pageLabels.length > 0) {
    try {
      applyPageLabels(out, doc.pageLabels);
    } catch {
      // Best-effort — a bad label must not block a save.
    }
  }

  // Phase 49 — brand the produced PDF's Producer/Creator as Jovrel.
  stampBrandMetadata(out);
  // Phase 59 item 4 — appearances were regenerated above with the Unicode
  // font, so suppress pdf-lib's own (WinAnsi Helvetica) re-render on save.
  return out.save({ updateFieldAppearances: false });
}

/**
 * Like serializeDoc but accepts an OptimizePreset to control compression.
 *
 * - 'none':    useObjectStreams = false (linearized, flat object layout)
 * - 'compact': useObjectStreams = true  (default pdf-lib compression)
 * - 'max':     useObjectStreams = true  + strip Info dictionary metadata
 *
 * Form fields, annotations, and signatures are propagated into the output
 * document just like the normal save path so the optimized output remains
 * functionally identical.
 */
async function serializeDocOptimized(
  doc: EngineDoc,
  preset: OptimizePreset,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pageMap = new Map<number, number>();

  for (let idx = 0; idx < doc.order.length; idx++) {
    const origIdx = doc.order[idx];
    const [copied] = await out.copyPages(doc.pdfDoc, [origIdx]);
    // DEF-130: normalize the rotation slot (see serializeDoc).
    const rawRot = doc.rotations[origIdx];
    const rotation = Number.isFinite(rawRot) && Number.isInteger(rawRot)
      ? ((rawRot % 4) + 4) % 4
      : 0;
    if (rotation !== 0) {
      copied.setRotation(degrees(rotation * 90));
    }
    // DEF-131: neutralize the inherited /CropBox /TrimBox propagation
    // (see serializeDoc).
    neutralizeInheritedBox(copied.node, doc.pdfDoc.getPage(origIdx).node, 'CropBox');
    neutralizeInheritedBox(copied.node, doc.pdfDoc.getPage(origIdx).node, 'TrimBox');
    out.addPage(copied);
    pageMap.set(origIdx, idx);
  }

  // Serialize annotations onto the output doc
  await serializeAnnotations(out, doc.annotations, doc.order);

  // Phase 59 item 4 — carry the AcroForm (see serializeDoc for the rationale).
  try {
    carryAcroForm(doc.pdfDoc, out, pageMap);
  } catch {
    // A malformed form must never block a save.
  }

  // Phase 59 item 4 — native fill (see serializeDoc): re-apply the carried
  // values and regenerate appearances with the Unicode font, reporting every
  // field's outcome. Only when the output actually carries form fields.
  if (outputHasFormFields(out)) {
    try {
      const font = await embedEditFont(out, 'DejaVu Serif', false, false);
      doc.lastFormFillReport = reportPagesToOriginal(fillFormNatively(out, font), doc.order);
    } catch (e) {
      console.warn(
        `[tflex] native form fill skipped: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Render placed signatures onto the output pages
  if (doc.placedSignatures.length > 0) {
    const pngCache = new Map<string, Awaited<ReturnType<typeof out['embedPng']>>>();
    for (const sp of doc.placedSignatures) {
      const outPageIdx = sp.page - 1;
      if (outPageIdx < 0 || outPageIdx >= out.getPageCount()) continue;

      const pngBytes = sp.pngBytes instanceof Uint8Array
        ? sp.pngBytes
        : new Uint8Array(sp.pngBytes);

      let embeddedImage = pngCache.get(sp.id);
      if (embeddedImage === undefined) {
        try {
          embeddedImage = await out.embedPng(pngBytes);
          pngCache.set(sp.id, embeddedImage);
        } catch {
          continue;
        }
      }

      const page = out.getPage(outPageIdx);
      const { x, y, width, height } = sp.rect;
      const pageHeight = page.getSize().height;
      const pdfY = pageHeight - y - height;

      page.drawImage(embeddedImage, {
        x,
        y: pdfY,
        width,
        height,
      });
    }

    serializeSignatureMetadata(out, doc.placedSignatures);
  }

  // Phase 14 / DEF-135 / DEF-136 — draw registry text boxes at their final
  // rect and persist the registry (mirrors serializeDoc so an optimized save
  // preserves boxes the same way).
  await drawTextBoxes(out, doc.textBoxes);
  serializeTextBoxMetadata(out, doc.textBoxes);
  // Phase 28 — persist the comment threads in the catalog so they survive
  // save/reopen (both the normal and the optimized save paths).
  serializeCommentMetadata(out, doc.comments);

  // Copy document-level metadata unless max preset strips it
  if (preset !== 'max') {
    try {
      const title = doc.pdfDoc.getTitle();
      const author = doc.pdfDoc.getAuthor();
      const subject = doc.pdfDoc.getSubject();
      const keywords = doc.pdfDoc.getKeywords();
      if (title) out.setTitle(title);
      if (author) out.setAuthor(author);
      if (subject) out.setSubject(subject);
      if (keywords) out.setKeywords(typeof keywords === 'string' ? [keywords] : keywords);
    } catch {
      // Metadata copy is best-effort.
    }
  }

  // Phase 12 — carry the outline (bookmarks) and page labels onto the
  // optimized output, mirroring serializeDoc so an optimized save preserves
  // them. Best-effort; never block a save on a malformed outline/label.
  try {
    const pageRefMap = new Map<string, PDFRef>();
    for (const [origIdx, outIdx] of pageMap) {
      const srcRef = doc.pdfDoc.getPage(origIdx).ref;
      if (srcRef) pageRefMap.set(srcRef.tag, out.getPage(outIdx).ref);
    }
    carryOutlines(out, [{ doc: doc.pdfDoc, map: pageRefMap }]);
  } catch {
    // Best-effort.
  }

  // Phase 57 feature G — same /Dests + /OpenAction page-ref remap as
  // serializeDoc, so an optimized save preserves internal links and the
  // initial view. Best-effort.
  try {
    carryPageLinkedEntries(out, doc.pdfDoc, pageMap);
  } catch {
    // Best-effort — unresolvable destinations are simply not carried.
  }

  // DEF-400 — same /OCProperties identity rebuild as serializeDoc, so an
  // optimized save keeps layers PDF.js can match to the page content.
  carryOptionalContent(out, doc.pdfDoc, pageMap);

  if (doc.pageLabels && doc.pageLabels.length > 0) {
    try {
      applyPageLabels(out, doc.pageLabels);
    } catch {
      // Best-effort.
    }
  }

  const useObjectStreams = preset !== 'none';

  // Phase 49 — brand the optimized output's Producer/Creator as Jovrel.
  // ('max' strips metadata from the SOURCE copy above, but the products the
  // app writes still identify Jovrel as the tool that produced them.)
  stampBrandMetadata(out);
  // Phase 59 item 4 — suppress pdf-lib's WinAnsi appearance re-render (the
  // native fill regenerated appearances with the Unicode font above).
  return out.save({ useObjectStreams, updateFieldAppearances: false });
}

/**
 * Maximum byte length we are willing to JSON.parse for signature
 * placement metadata (DEF-075). Realistic payloads are tiny (a few KB
 * of base64 per placement), so 64 MiB is a generous ceiling that still
 * stops a hostile/huge catalog entry from blowing up memory on reload.
 */
const MAX_SIG_META_BYTES = 64 * 1024 * 1024;

/**
 * Serialize signature placement metadata into the output PDF's CATALOG
 * under a private `/TFlexSig` key (DEF-030, DEF-075).
 *
 * Why the catalog and not the Info /Keywords field (ADV-022 / DEF-075)?
 *   The previous implementation stored the placements JSON inside the
 *   Info dictionary's Keywords field with a `TFLEXSIG:` prefix. That was
 *   fragile: any feature (or an external metadata editor) that overwrites
 *   Keywords silently destroyed every signature placement on the next
 *   reload; the Info dictionary is optional and routinely stripped by PDF
 *   processors; and base64 bytes inside a PDF literal string can be
 *   mangled by re-encodings. The catalog is the document root and is not
 *   touched by Info-dict edits; a private hex string `<...>` is raw bytes
 *   and survives every re-encode. Standard viewers ignore unknown catalog
 *   keys, so the entry is invisible to the user.
 *
 * The payload is a JSON array of `{id, signatureId, page, x, y, width,
 * height, pngBase64}`. A size cap (MAX_SIG_META_BYTES) guards against
 * hostile/huge payloads blowing up JSON.parse on reload; if exceeded, the
 * metadata is dropped (the drawn signature images still persist on the
 * pages — they are baked into page content, independent of this entry).
 */
function serializeSignatureMetadata(
  out: PDFDocument,
  placements: SignaturePlacement[],
): void {
  if (placements.length === 0) return;
  try {
    const data: Array<Record<string, unknown>> = [];
    for (const sp of placements) {
      const pngBytes = sp.pngBytes instanceof Uint8Array
        ? sp.pngBytes
        : new Uint8Array(sp.pngBytes);
      const base64 = Buffer.from(pngBytes).toString('base64');
      data.push({
        id: sp.id,
        signatureId: sp.signatureId,
        page: sp.page,
        x: sp.rect.x,
        y: sp.rect.y,
        width: sp.rect.width,
        height: sp.rect.height,
        pngBase64: base64,
      });
    }

    const jsonStr = JSON.stringify(data);
    if (jsonStr.length > MAX_SIG_META_BYTES) return;
    out.catalog.set(PDFName.of('TFlexSig'), PDFHexString.of(jsonStr));
  } catch {
    // Best-effort: if serialization fails, the drawn images still persist
    // on the pages (baked into page content, independent of this entry).
  }
}

/**
 * Parse signature placement metadata from a loaded PDFDocument (DEF-030,
 * DEF-075).
 *
 * Primary path: read the private `/TFlexSig` catalog entry (a hex string
 * of the placements JSON). This is independent of the Info /Keywords
 * field and survives metadata edits / Info strips.
 *
 * Legacy fallback: files saved by the previous implementation stored the
 * payload in the Info /Keywords field with a `TFLEXSIG:` prefix. We still
 * honour that so documents saved before DEF-075 keep loading. New saves
 * always write the catalog entry (and only the catalog entry).
 */

/**
 * DEF-138 — read each page's /Rotate (in degrees) and convert it to
 * quarter-turns (0/1/2/3) so a rotated page stays rotated across save/reopen.
 * `page.getRotation().angle` walks the inheritable /Rotate entry (the page
 * leaf's own /Rotate, or the parent /Pages /Rotate) via pdf-lib's
 * `getInheritableAttribute`, so an inherited rotation is honoured too. A
 * non-multiple-of-90 angle is rounded to the nearest quarter-turn; an
 * unparseable /Rotate degrades to 0 (upright) so a malformed entry never
 * blocks the load.
 */
function parseRotationsFromDoc(pdfDoc: PDFDocument, count: number): number[] {
  const rotations = Array.from({ length: count }, () => 0);
  for (let i = 0; i < count; i++) {
    try {
      const angle = pdfDoc.getPage(i).getRotation().angle;
      if (Number.isFinite(angle)) {
        // Normalise to [0,3]: round to the nearest 90, then mod 4.
        const quarters = Math.round(angle / 90) % 4;
        rotations[i] = ((quarters % 4) + 4) % 4;
      }
    } catch {
      // Best-effort: a malformed /Rotate leaves the page upright.
    }
  }
  return rotations;
}

function parseSignaturesFromDoc(pdfDoc: PDFDocument): SignaturePlacement[] {
  // --- Primary: catalog /TFlexSig hex string -----------------------------
  try {
    const entry = pdfDoc.catalog.get(PDFName.of('TFlexSig'));
    if (entry !== undefined) {
      const jsonStr = sigMetaEntryToString(entry);
      if (jsonStr !== undefined) {
        const parsed = parseSigMetaJson(jsonStr);
        if (parsed.length > 0) return parsed;
      }
    }
  } catch {
    // fall through to legacy path
  }

  // --- Legacy: Info /Keywords TFLEXSIG: marker ---------------------------
  try {
    const keywords = pdfDoc.getKeywords();
    if (!keywords) return [];
    let markerStr: string | undefined;
    if (Array.isArray(keywords)) {
      markerStr = keywords.find((k) => typeof k === 'string' && k.startsWith('TFLEXSIG:'));
    } else if (typeof keywords === 'string') {
      markerStr = keywords.startsWith('TFLEXSIG:') ? keywords : undefined;
    }
    if (!markerStr) return [];
    return parseSigMetaJson(markerStr.slice('TFLEXSIG:'.length));
  } catch {
    return [];
  }
}

/** Decode a catalog `/TFlexSig` value (PDFHexString or PDFString) back to
 *  the raw JSON string. Returns undefined for unknown value types or
 *  payloads that exceed the safety cap. ONLY `asString()` may be used —
 *  `decodeText()` applies text-encoding heuristics that corrupt raw
 *  JSON/base64 bytes. */
function sigMetaEntryToString(entry: unknown): string | undefined {
  if (typeof (entry as { asString?: unknown })?.asString !== 'function') return undefined;
  let jsonStr: string;
  try {
    jsonStr = (entry as { asString(): string }).asString();
  } catch {
    return undefined;
  }
  if (typeof jsonStr !== 'string' || jsonStr.length > MAX_SIG_META_BYTES) {
    return undefined;
  }
  return jsonStr;
}

/** Parse the placements JSON with structural validation. Returns an empty
 *  array for any malformed shape so a corrupt/hostile entry never throws
 *  out of the load path. */
function parseSigMetaJson(jsonStr: string): SignaturePlacement[] {
  const data = JSON.parse(jsonStr);
  if (!Array.isArray(data)) return [];

  const result: SignaturePlacement[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (typeof entry.id !== 'string' || typeof entry.signatureId !== 'string') continue;
    if (typeof entry.page !== 'number') continue;
    if (typeof entry.pngBase64 !== 'string') continue;

    const pngBytes = Buffer.from(entry.pngBase64, 'base64');
    result.push({
      id: entry.id,
      signatureId: entry.signatureId,
      page: entry.page,
      rect: {
        x: typeof entry.x === 'number' ? entry.x : 0,
        y: typeof entry.y === 'number' ? entry.y : 0,
        width: typeof entry.width === 'number' ? entry.width : 0,
        height: typeof entry.height === 'number' ? entry.height : 0,
      },
      pngBytes: new Uint8Array(pngBytes),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 14 / DEF-135 / DEF-136: text-box placement registry (serialization)
// ---------------------------------------------------------------------------
//
// Text boxes live in an engine-side registry (like signature placements) and
// are only drawn at save time, once, at their FINAL rect — so moving a box
// never masks the content under its old rect (the root cause of DEF-135).
// The registry is persisted into a private `/TFlexBox` catalog entry (a hex
// string of the boxes JSON) so boxes survive save/reload and can be moved/
// deleted after a reopen. Standard viewers ignore unknown catalog keys, so
// the entry is invisible to the user.

/** Maximum byte length we are willing to JSON.parse for text-box metadata.
 *  Realistic payloads are tiny (no images — just text + geometry), so 16 MiB
 *  is a generous ceiling that still stops a hostile/huge catalog entry from
 *  blowing up memory on reload. */
const MAX_TEXTBOX_META_BYTES = 16 * 1024 * 1024;

/** Phase 21 — deep-clone a registry text box. `rect` and `highlight` are the
 *  only object-valued fields; cloning them keeps snapshots, undo restores and
 *  the `EngineState` echo from sharing mutable references with the live
 *  registry. */
function cloneTextBoxModel(tb: TextBoxModel): TextBoxModel {
  return {
    ...tb,
    rect: { ...tb.rect },
    highlight: tb.highlight ? { ...tb.highlight } : undefined,
  };
}

/** Phase 27 — the drawn width of `text` at `size` INCLUDING character
 *  spacing. The `Tc` operator adds `spacing` after every glyph; for layout
 *  (wrapping, alignment, underline length) we count the inter-glyph gaps
 *  (`glyphCount - 1`), so a trailing gap does not affect alignment or
 *  overflow. A zero/absent spacing returns the plain glyph width, keeping
 *  the legacy measurement exact. */
function styledTextWidth(
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  text: string,
  size: number,
  charSpacing: number,
): number {
  const base = font.widthOfTextAtSize(text, size);
  if (charSpacing === 0) return base;
  const glyphs = Array.from(text).length;
  return base + charSpacing * Math.max(0, glyphs - 1);
}

/** Phase 21 — true when at least one new style field is supplied, so the
 *  caller can keep the byte-compatible legacy draw path when none is. */
function hasTextStyle(style: {
  align?: TextAlign;
  lineHeight?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  baselineShift?: number;
  highlight?: { r: number; g: number; b: number };
  list?: TextListStyle;
  indent?: number;
  charSpacing?: number;
}): boolean {
  return style.align !== undefined || style.lineHeight !== undefined ||
    style.bold !== undefined || style.italic !== undefined ||
    style.underline !== undefined || style.baselineShift !== undefined ||
    style.highlight !== undefined || style.list !== undefined ||
    style.indent !== undefined || style.charSpacing !== undefined;
}

/** Phase 21 — width of the per-line list prefix for wrapping. `number` uses
 *  the widest plausible `999. ` so the first lines never overflow. Phase 27 —
 *  `charSpacing` is included so a tracked prefix is reserved at its real
 *  width. */
function listPrefixWidth(
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  list: TextListStyle,
  charSpacing = 0,
): number {
  if (list === 'bullet') return styledTextWidth(font, '\u2022 ', size, charSpacing);
  if (list === 'number') return styledTextWidth(font, '999. ', size, charSpacing);
  return 0;
}

/** Phase 21 — horizontal start of a line inside the box for the given
 *  alignment. `justify` starts at the left edge (extra space is distributed
 *  between words by the caller). */
function alignedLineX(rectX: number, width: number, lineWidth: number, align: TextAlign): number {
  if (align === 'center') return rectX + Math.max(0, (width - lineWidth) / 2);
  if (align === 'right') return rectX + Math.max(0, width - lineWidth);
  return rectX;
}

/** Phase 21 — the shared styled-line renderer used by BOTH the save-time text
 *  box draw and the immediate `editTextRun` draw. `lines` are already wrapped
 *  (or split on explicit newlines). `rectTop` is the top-left-origin y of the
 *  block's first line. Draw order: every highlight band first (so bands sit
 *  BEHIND the glyphs), then per line the underline rule and the glyphs.
 *
 *  Phase 27 — `charSpacing` (points) is emitted as the `Tc` text-state
 *  operator INSIDE each text object (after `BT`, before the show operator)
 *  when non-zero. Absent/0 keeps the exact `page.drawText` operator stream,
 *  so legacy output is byte-identical; every width used for layout is
 *  measured with `styledTextWidth` so tracked lines wrap and align at their
 *  real width. */
export function drawStyledTextLines(
  page: PDFPage,
  pageHeight: number,
  lines: string[],
  rectX: number,
  rectTop: number,
  width: number,
  size: number,
  font: PDFFont,
  color: { r: number; g: number; b: number },
  style: {
    align: TextAlign;
    lineHeight: number;
    underline: boolean;
    baselineShift: number;
    highlight?: { r: number; g: number; b: number };
    list: TextListStyle;
    indent: number;
    charSpacing: number;
  },
): void {
  const lineStep = size * style.lineHeight;
  const pad = 2;
  const charSpacing = style.charSpacing;

  // Phase 21 — `indent` insets the paragraph inside the box: every line,
  // including the first, starts at `rectX + indent` and alignment/wrapping
  // operate inside the indented content box. Absent (0) leaves the content
  // box identical to the box rect, so the legacy bytes are unchanged.
  const contentX = rectX + style.indent;
  const contentWidth = Math.max(0, width - style.indent);

  // The drawn text for each line (list prefix included) and its measured width.
  const described = lines.map((raw, i) => {
    const prefix = style.list === 'bullet' ? '\u2022 '
      : style.list === 'number' ? `${i + 1}. `
      : '';
    const text = prefix + sanitizeForStandardFont(raw);
    return { text, width: styledTextWidth(font, text, size, charSpacing) };
  });

  // Phase 27 — a non-zero spacing needs a hand-built text object with `Tc`.
  // Register the font once so the emitted `Tf` names a resource the page
  // carries; a zero spacing never touches the page (legacy path).
  const fontKey = charSpacing !== 0 ? ensureTextFontKey(page, font) : undefined;

  // 1) Highlight bands, drawn before any glyph so they sit behind the ink.
  if (style.highlight !== undefined) {
    let cursorTop = rectTop;
    for (const line of described) {
      const hx = alignedLineX(contentX, contentWidth, line.width, style.align);
      page.drawRectangle({
        x: hx - pad,
        y: pageHeight - cursorTop - size,
        width: line.width + 2 * pad,
        height: size,
        color: rgb(style.highlight.r, style.highlight.g, style.highlight.b),
      });
      cursorTop += lineStep;
    }
  }

  // 2) Underline + glyphs.
  let cursorTop = rectTop;
  for (let i = 0; i < described.length; i++) {
    const line = described[i];
    const baseline = pageHeight - cursorTop - size + style.baselineShift;
    const x = alignedLineX(contentX, contentWidth, line.width, style.align);

    if (style.underline) {
      page.drawRectangle({
        x,
        y: baseline - size * 0.12,
        width: line.width,
        height: Math.max(0.5, size * 0.05),
        color: rgb(color.r, color.g, color.b),
      });
    }

    const isLast = i === described.length - 1;
    if (style.align === 'justify' && !isLast) {
      drawJustifiedLine(page, line.text, x, baseline, contentWidth, size, font, color, charSpacing, fontKey);
    } else if (charSpacing !== 0 && fontKey !== undefined) {
      drawSpacedText(page, line.text, x, baseline, size, font, color, charSpacing, fontKey);
    } else {
      page.drawText(line.text, {
        x,
        y: baseline,
        size,
        font,
        color: rgb(color.r, color.g, color.b),
      });
    }
    cursorTop += lineStep;
  }
}

/** Phase 27 — register `font` in the page's resource dict and return the
 *  resource key, so a hand-emitted `Tf` names the same font the resource dict
 *  carries. On the annotation /AP collector (`ApStreamOps`) `setFont` is a
 *  no-op and `fontKey` is the fixed `Helv` resource the collector declares. */
function ensureTextFontKey(page: PDFPage, font: PDFFont): PDFName {
  const target = page as unknown as { setFont?: (f: PDFFont) => void; fontKey?: PDFName };
  if (typeof target.setFont === 'function') target.setFont(font);
  return target.fontKey ?? PDFName.of(font.name);
}

/** Phase 27 — emit a single text run whose glyphs carry character spacing.
 *  The operator stream is `q BT <color> <Tf> Tc <Tm> Tj ET Q`, so `Tc` lands
 *  inside the text object, after `BT` and before the show operator. Only
 *  used for a non-zero spacing; the zero case keeps `page.drawText` exactly. */
function drawSpacedText(
  page: PDFPage,
  text: string,
  x: number,
  baseline: number,
  size: number,
  font: PDFFont,
  color: { r: number; g: number; b: number },
  charSpacing: number,
  fontKey: PDFName,
): void {
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFillingRgbColor(color.r, color.g, color.b),
    setFontAndSize(fontKey, size),
    setCharacterSpacing(charSpacing),
    setTextMatrix(1, 0, 0, 1, x, baseline),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState(),
  );
}

/** Phase 21 — draw a line word-by-word, distributing the extra inter-word
 *  space evenly (justify). Falls back to a normal draw when the line has
 *  fewer than two words or no space to distribute. Phase 27 — `charSpacing`
 *  is applied to each drawn word and included in the width bookkeeping. */
function drawJustifiedLine(
  page: PDFPage,
  text: string,
  startX: number,
  baseline: number,
  width: number,
  size: number,
  font: PDFFont,
  color: { r: number; g: number; b: number },
  charSpacing = 0,
  fontKey?: PDFName,
): void {
  const drawWhole = (): void => {
    if (charSpacing !== 0 && fontKey !== undefined) {
      drawSpacedText(page, text, startX, baseline, size, font, color, charSpacing, fontKey);
    } else {
      page.drawText(text, { x: startX, y: baseline, size, font, color: rgb(color.r, color.g, color.b) });
    }
  };
  const words = text.split(' ');
  if (words.length < 2) {
    drawWhole();
    return;
  }
  const natural = styledTextWidth(font, text, size, charSpacing);
  const extra = width - natural;
  if (extra <= 0) {
    drawWhole();
    return;
  }
  const gap = extra / (words.length - 1);
  const spaceWidth = styledTextWidth(font, ' ', size, charSpacing);
  let cursorX = startX;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.length > 0) {
      if (charSpacing !== 0 && fontKey !== undefined) {
        drawSpacedText(page, word, cursorX, baseline, size, font, color, charSpacing, fontKey);
      } else {
        page.drawText(word, { x: cursorX, y: baseline, size, font, color: rgb(color.r, color.g, color.b) });
      }
      cursorX += styledTextWidth(font, word, size, charSpacing);
    }
    if (i < words.length - 1) cursorX += spaceWidth + gap;
  }
}

/** Draw every registry text box at its FINAL rect on the output document.
 *  No masking of any prior rect — the box is drawn exactly once. Word-wraps
 *  the text, auto-fits the font size so all lines fit the box height, draws
 *  an optional opaque white background fill, and converts the top-left-origin
 *  rect to PDF's bottom-left coordinate system. Mirrors the legacy
 *  `_addTextBoxImpl` draw logic but applied to the registry at save time. */
async function drawTextBoxes(out: PDFDocument, boxes: TextBoxModel[]): Promise<void> {
  if (boxes.length === 0) return;
  // Phase 27 — `embedEditFont` caches the embedded font per (document,
  // family, bold, italic), so a doc with many boxes does not re-embed the
  // same font once per box. A bundled family is embedded as a subset; a
  // missing/unreadable font file throws a FontEmbedError naming the family,
  // which the save path maps to a typed engine-error.
  for (const box of boxes) {
    // `box.page` is the 1-based VISIBLE page; the output doc's pages are
    // built in visible order (serializeDoc iterates doc.order), so the
    // output page index is `box.page - 1`. Same mapping as signatures.
    const outPageIdx = box.page - 1;
    if (outPageIdx < 0 || outPageIdx >= out.getPageCount()) continue;

    const page = out.getPage(outPageIdx);
    const pageHeight = page.getSize().height;
    const { x, y, width, height } = box.rect;

    if (box.background === 'white') {
      page.drawRectangle({
        x,
        y: pageHeight - y - height,
        width,
        height,
        color: rgb(1, 1, 1),
      });
    }

    const font = await embedEditFont(out, box.font, box.bold ?? false, box.italic ?? false);
    const color = box.color ? hexToRgb(box.color) : { r: 0, g: 0, b: 0 };
    const lineHeight = box.lineHeight ?? DEFAULT_TEXT_LINE_HEIGHT;
    const list = box.list ?? 'none';
    const indent = box.indent ?? 0;
    const charSpacing = box.charSpacing ?? 0;

    // Auto-fit: wrap to the indented content width (minus the list prefix),
    // then shrink the font size so ALL wrapped lines fit within the box height
    // (DEF-113 — never silently drop text). Phase 27 — the wrap width is
    // measured with character spacing included, so a tracked line wraps
    // before it overflows the box.
    const MIN_FIT_SIZE = 4;
    const wrap = (s: number): string[] =>
      wrapTextToWidth(
        box.text,
        font,
        s,
        Math.max(1, width - indent - listPrefixWidth(font, s, list, charSpacing)),
        charSpacing,
      );
    let size = box.size;
    let lines = wrap(size);
    if (height > 0 && lines.length > 0) {
      const needed = lines.length * size * lineHeight;
      if (needed > height) {
        size = Math.max(MIN_FIT_SIZE, height / (lines.length * lineHeight));
        lines = wrap(size);
      }
    }

    drawStyledTextLines(page, pageHeight, lines, x, y, width, size, font, color, {
      align: box.align ?? 'left',
      lineHeight,
      underline: box.underline ?? false,
      baselineShift: box.baselineShift ?? 0,
      highlight: box.highlight,
      list,
      indent,
      charSpacing,
    });
  }
}

/** Serialize the text-box registry into the output PDF's CATALOG under a
 *  private `/TFlexBox` key (a hex string of the boxes JSON). A size cap
 *  guards against hostile/huge payloads; if exceeded, the metadata is
 *  dropped (the drawn text still persists on the pages — it is baked into
 *  page content at save, independent of this entry). */
function serializeTextBoxMetadata(out: PDFDocument, boxes: TextBoxModel[]): void {
  if (boxes.length === 0) return;
  try {
    const data = boxes.map((tb) => ({
      id: tb.id,
      page: tb.page,
      rect: {
        x: tb.rect.x,
        y: tb.rect.y,
        width: tb.rect.width,
        height: tb.rect.height,
      },
      text: tb.text,
      font: tb.font,
      size: tb.size,
      color: tb.color,
      background: tb.background,
      // Phase 21 — optional style fields. JSON.stringify omits undefined, so a
      // legacy box's catalog entry is byte-for-byte unchanged.
      align: tb.align,
      lineHeight: tb.lineHeight,
      bold: tb.bold,
      italic: tb.italic,
      underline: tb.underline,
      baselineShift: tb.baselineShift,
      highlight: tb.highlight,
      list: tb.list,
      indent: tb.indent,
      // Phase 27 — character spacing (tracking). Omitted when undefined, so a
      // legacy box's catalog entry is byte-for-byte unchanged.
      charSpacing: tb.charSpacing,
    }));
    const jsonStr = JSON.stringify(data);
    if (jsonStr.length > MAX_TEXTBOX_META_BYTES) return;
    out.catalog.set(PDFName.of('TFlexBox'), PDFHexString.of(jsonStr));
  } catch {
    // Best-effort: the drawn text still persists on the pages.
  }
}

/** Parse the text-box registry from a loaded PDFDocument. Returns an empty
 *  array when the doc has no `/TFlexBox` catalog entry or the entry is
 *  malformed/hostile — never throws out of the load path. */
function parseTextBoxesFromDoc(pdfDoc: PDFDocument): TextBoxModel[] {
  try {
    const entry = pdfDoc.catalog.get(PDFName.of('TFlexBox'));
    if (entry === undefined) return [];
    const jsonStr = textBoxMetaEntryToString(entry);
    if (jsonStr === undefined) return [];
    return parseTextBoxMetaJson(jsonStr);
  } catch {
    return [];
  }
}

/** Decode a catalog `/TFlexBox` value (PDFHexString or PDFString) back to the
 *  raw JSON string. Returns undefined for unknown value types or payloads
 *  that exceed the safety cap. ONLY `asString()` may be used — `decodeText()`
 *  applies text-encoding heuristics that corrupt raw JSON bytes (same rule as
 *  the signature metadata path). */
function textBoxMetaEntryToString(entry: unknown): string | undefined {
  if (typeof (entry as { asString?: unknown })?.asString !== 'function') return undefined;
  let jsonStr: string;
  try {
    jsonStr = (entry as { asString(): string }).asString();
  } catch {
    return undefined;
  }
  if (typeof jsonStr !== 'string' || jsonStr.length > MAX_TEXTBOX_META_BYTES) {
    return undefined;
  }
  return jsonStr;
}

/** Parse the boxes JSON with structural validation. Returns an empty array
 *  for any malformed shape so a corrupt/hostile entry never throws out of
 *  the load path. `font`/`size`/`color`/`background` are normalised to the
 *  `TextBoxModel` shape with safe defaults. */
function parseTextBoxMetaJson(jsonStr: string): TextBoxModel[] {
  const data = JSON.parse(jsonStr);
  if (!Array.isArray(data)) return [];
  const result: TextBoxModel[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    if (typeof entry.id !== 'string') continue;
    if (typeof entry.page !== 'number') continue;
    if (typeof entry.text !== 'string') continue;
    const rect = entry.rect;
    if (typeof rect !== 'object' || rect === null) continue;
    if (typeof rect.x !== 'number' || typeof rect.y !== 'number'
      || typeof rect.width !== 'number' || typeof rect.height !== 'number') continue;
    const font: EditFont = isEditFont(entry.font) ? entry.font : 'Helvetica';
    const size = typeof entry.size === 'number' && entry.size > 0 ? entry.size : 12;
    const color = typeof entry.color === 'string' ? entry.color : undefined;
    const background: 'white' | 'none' | undefined =
      entry.background === 'white' || entry.background === 'none' ? entry.background : undefined;
    // Phase 21 — rehydrate the style fields with the same validation used on
    // the write path. A corrupt/hostile entry drops the style fields (the
    // legacy box fields are still kept) rather than throwing out of load.
    const styleResult = validateTextStyleFields(entry);
    const style = styleResult.ok ? styleResult.value : {};
    result.push({
      id: entry.id,
      page: entry.page,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      text: entry.text,
      font,
      size,
      color,
      background,
      ...style,
    });
  }
  return result;
}

/** Convert a legacy `EditColor` ({r,g,b} in [0,1]) to a `#rrggbb` hex string
 *  for the stored `TextBoxModel.color`. Components are clamped to [0,1] then
 *  scaled to [0,255]. */
function editColorToHex(c: { r: number; g: number; b: number }): string {
  const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(toByte(c.r))}${hex(toByte(c.g))}${hex(toByte(c.b))}`;
}

/** Parse a hex color string (#rgb or #rrggbb) to pdf-lib's `rgb()` range
 *  ({r,g,b} in [0,1]). Used when drawing a registry box at save time. Falls
 *  back to black for an unparseable string so a bad color never blocks a
 *  save. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = String(hex).trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    return { r: 0, g: 0, b: 0 };
  }
  const num = parseInt(h, 16);
  return {
    r: ((num >> 16) & 0xff) / 255,
    g: ((num >> 8) & 0xff) / 255,
    b: (num & 0xff) / 255,
  };
}

// ---------------------------------------------------------------------------
// Phase 28: comment threads (Adobe-like comments on annotations)
// ---------------------------------------------------------------------------

/** Phase 28 — the trimmed text length cap for one comment/reply entry. */
const MAX_COMMENT_TEXT_LENGTH = 4000;
/** Phase 28 — the author shown when the caller supplies none (or a blank
 *  string). The renderer may pass a real author later. */
const DEFAULT_COMMENT_AUTHOR = 'You';
/** Phase 28 — ceiling on the `/TFlexComments` catalog payload parsed on load.
 *  Realistic threads are a few KB; 4 MiB stops a hostile/huge entry from
 *  blowing up JSON.parse on reopen. */
const MAX_COMMENT_META_BYTES = 4 * 1024 * 1024;

/** Phase 28 — deep-clone a thread (entries are the only nested objects) so
 *  snapshots, undo restores and the `EngineState` echo never share mutable
 *  references with the live registry. */
function cloneCommentThread(thread: CommentThread): CommentThread {
  return {
    annotationId: thread.annotationId,
    entries: thread.entries.map((e) => ({ ...e })),
  };
}

/** Phase 28 — normalize the optional author: a blank/absent value falls back
 *  to the default. Never throws. */
function normalizeCommentAuthor(author: unknown): string {
  if (typeof author !== 'string') return DEFAULT_COMMENT_AUTHOR;
  const trimmed = author.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_COMMENT_AUTHOR;
}

/** Phase 28 — validate and normalize one comment/reply body. Returns the
 *  trimmed text, or a reason string when the text is not a non-empty string
 *  within the length cap (the op turns that into a typed engine-error). */
function validateCommentText(text: unknown): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof text !== 'string') return { ok: false, reason: 'comment text must be a string' };
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'comment text must not be empty' };
  if (trimmed.length > MAX_COMMENT_TEXT_LENGTH) {
    return { ok: false, reason: `comment text exceeds ${MAX_COMMENT_TEXT_LENGTH} characters` };
  }
  return { ok: true, text: trimmed };
}

/** Phase 28 — true when the document holds an annotation with this id (any
 *  page, visible or not). A comment on a missing annotation fails loud. */
function hasAnnotation(doc: EngineDoc, annId: string): boolean {
  for (const pageAnns of doc.annotations) {
    if (pageAnns.some((a) => a.id === annId)) return true;
  }
  return false;
}

/** Phase 28 — serialize the comment threads into the output PDF's CATALOG
 *  under a private `/TFlexComments` key (a hex string of the threads JSON),
 *  mirroring `/TFlexBox` and `/TFlexSig`. The catalog root is not touched by
 *  Info-dict edits and a private hex string survives every re-encode, so the
 *  threads round-trip through save/reopen. Best-effort: a failure or an
 *  oversized payload drops the entry rather than blocking the save. */
function serializeCommentMetadata(out: PDFDocument, threads: CommentThread[]): void {
  if (threads.length === 0) return;
  try {
    const data = threads.map((t) => ({
      annotationId: t.annotationId,
      entries: t.entries.map((e) => ({
        id: e.id,
        author: e.author,
        text: e.text,
        createdAt: e.createdAt,
      })),
    }));
    const jsonStr = JSON.stringify(data);
    if (jsonStr.length > MAX_COMMENT_META_BYTES) return;
    out.catalog.set(PDFName.of('TFlexComments'), PDFHexString.of(jsonStr));
  } catch {
    // Best-effort: the save still succeeds without the comment metadata.
  }
}

/** Phase 28 — parse the comment threads from a loaded PDFDocument. Returns an
 *  empty array when the doc has no `/TFlexComments` catalog entry or the
 *  entry is malformed/hostile — never throws out of the load path. */
function parseCommentsFromDoc(pdfDoc: PDFDocument): CommentThread[] {
  try {
    const entry = pdfDoc.catalog.get(PDFName.of('TFlexComments'));
    if (entry === undefined) return [];
    if (typeof (entry as { asString?: unknown })?.asString !== 'function') return [];
    let jsonStr: string;
    try {
      // ONLY `asString()` — `decodeText()` applies text-encoding heuristics
      // that corrupt raw JSON bytes (same rule as /TFlexBox and /TFlexSig).
      jsonStr = (entry as unknown as { asString(): string }).asString();
    } catch {
      return [];
    }
    if (typeof jsonStr !== 'string' || jsonStr.length > MAX_COMMENT_META_BYTES) return [];
    return parseCommentMetaJson(jsonStr);
  } catch {
    return [];
  }
}

/** Phase 28 — parse the threads JSON with structural validation. Returns an
 *  empty array for any malformed shape (or an unparseable string) so a
 *  corrupt/hostile entry never throws out of the load path. An entry that
 *  fails validation is dropped; a thread with no valid entries is dropped. */
function parseCommentMetaJson(jsonStr: string): CommentThread[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const result: CommentThread[] = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const thread = raw as Record<string, unknown>;
    if (typeof thread.annotationId !== 'string' || thread.annotationId.length === 0) continue;
    if (!Array.isArray(thread.entries)) continue;
    const entries: CommentEntry[] = [];
    for (const rawEntry of thread.entries) {
      if (typeof rawEntry !== 'object' || rawEntry === null) continue;
      const entry = rawEntry as Record<string, unknown>;
      if (typeof entry.id !== 'string' || entry.id.length === 0) continue;
      if (typeof entry.text !== 'string') continue;
      entries.push({
        id: entry.id,
        author: normalizeCommentAuthor(entry.author),
        text: entry.text,
        createdAt: typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
          ? entry.createdAt
          : 0,
      });
    }
    if (entries.length > 0) {
      result.push({ annotationId: thread.annotationId, entries });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Phase 9: text extraction helpers
// ---------------------------------------------------------------------------

/**
 * Convert a byte array to a string with a TRUE 1:1 byte->char mapping
 * (U+0000..U+00FF), so `charCodeAt(i) & 0xff` always recovers the original
 * byte. This matters because the raw-PDF text extractor searches the whole
 * file as a string and `decodeStream` reconstructs stream bytes from that
 * string before inflate.
 *
 * DEF-060: `new TextDecoder('latin1')` was used here previously, but the
 * WHATWG Encoding spec makes 'latin1' an alias for 'windows-1252', which
 * remaps bytes 0x80-0x9F (e.g. 0x9C -> U+0153 'œ'). When decodeStream then
 * did `charCodeAt(i) & 0xff`, byte 0x9C became 0x53, corrupting the zlib
 * header of every FlateDecode content stream and making inflate throw
 * ("incorrect header check") — so extractTextFromRawPdf silently returned
 * '' for every page and createDocxFromDoc fell back to images for all text.
 * Node's Buffer 'latin1' encoding is a true 1:1 map (unlike WHATWG
 * TextDecoder), so the round-trip is lossless. Buffer is already used
 * elsewhere in this module for base64 signature metadata.
 */
function bytesToByteString(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

/**
 * Extract text from a specific page of a raw PDF byte buffer. Uses a minimal
 * PDF parser that walks the cross-reference table and page tree to find
 * content streams, decodes them (FlateDecode), and extracts text from PDF
 * text operators (Tj, TJ, ', ").
 */
function extractTextFromRawPdf(bytes: Uint8Array, targetPageIndex: number): string {
  try {
    const text = bytesToByteString(bytes);

    // Parse xref table/stream to build an offset map: object number -> byte offset
    const objOffsets = parseXref(text);

    // Parse the trailer to find the /Root reference
    const rootRef = parseTrailerRootRef(text);
    if (!rootRef) return '';

    // Resolve: Root -> Pages -> Kids -> page objects
    const rootObj = resolveObject(text, rootRef, objOffsets);
    if (!rootObj) return '';

    const pagesRef = extractDictRef(rootObj, 'Pages');
    if (!pagesRef) return '';

    const pagesObj = resolveObject(text, pagesRef, objOffsets);
    if (!pagesObj) return '';

    // Get the Kids array reference
    const kids = extractDictArray(pagesObj, 'Kids');
    if (!kids || kids.length === 0) return '';

    if (targetPageIndex < 0 || targetPageIndex >= kids.length) return '';

    const pageRef = kids[targetPageIndex];
    if (!pageRef) return '';

    const pageObj = resolveObject(text, pageRef, objOffsets);
    if (!pageObj) return '';

    // DEF-402: resolve the page's /Resources /Font entries so hex strings can
    // be decoded through a Type0 font's /ToUnicode CMap instead of
    // windows-1252 (an Identity-H hex string carries glyph IDs, not codes).
    // DEF-406: the extraction cache is shared across the document's pages.
    const fontMaps = resolvePageFontToUnicode(text, pageObj, objOffsets, getFontExtractionCache(bytes));

    // Get the /Contents reference (may be a single ref or an array of refs)
    const contentsRefs = extractDictRefOrArray(pageObj, 'Contents');
    if (!contentsRefs || contentsRefs.length === 0) return '';

    // Decode each content stream and concatenate
    let rawContent = '';
    for (const ref of contentsRefs) {
      const streamObj = resolveObject(text, ref, objOffsets);
      if (!streamObj) continue;
      const decoded = decodeStream(text, streamObj);
      if (decoded) rawContent += decoded;
    }

    return parseContentStreamText(rawContent, fontMaps);
  } catch {
    return '';
  }
}

/**
 * Parse a PDF cross-reference section (xref table or xref stream) and return
 * a map from object number to its byte offset in the file.
 */
function parseXref(raw: string): Map<number, number> {
  const offsets = new Map<number, number>();

  // Try traditional xref table first: "xref\n0 N\n0000000000 65535 f\r\n..."
  const xrefMatch = raw.match(/xref\r?\n/);
  if (xrefMatch && xrefMatch.index !== undefined) {
    const xrefStart = xrefMatch.index;
    const xrefSection = raw.substring(xrefStart, xrefStart + 500000); // generous limit

    // Parse subsection lines: "nnnnnnnnnn ggggg n\r\n" or "nnnnnnnnnn ggggg f\r\n"
    const entryRegex = /^(\d{10}) (\d{5}) ([nf])\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(xrefSection)) !== null) {
      const type = match[3];
      if (type === 'n') {
        // The object number is derived from the subsection header.
        // We need to track the current subsection base.
        // For simplicity, parse the subsection headers too.
      }
    }
  }

  // PDFs from pdf-lib use cross-reference streams (PDF 1.5+).
  // The xref stream is pointed to by /XRefStm in the trailer or by startxref.
  // For a simpler approach, scan for all "obj" markers and note their numbers.
  //
  // DEF-407: bound the numeric quantifiers and require a digit-run start. An
  // unbounded `(\d+)\s+(\d+)\s+obj` backtracks quadratically on a long all-digit
  // run (a legal hex string in a Tj stream), hanging the app for minutes.
  // `(?<!\d)` skips mid-run positions (the previous match's tail is never
  // re-scanned anyway) and `\d{1,10}` caps each backtrack, so a digit run is
  // linear. Object/generation numbers in real PDFs never exceed 10 digits, so
  // parsed xref semantics are unchanged for every real document.
  const objRegex = /(?<!\d)(\d{1,10})\s+(\d{1,10})\s+obj/g;
  let match: RegExpExecArray | null;
  while ((match = objRegex.exec(raw)) !== null) {
    // match.index is the start of "obj", so the object starts before it
    // Actually the format is "1 0 obj" so match.index points to the start.
    // The object number is match[1], generation is match[2].
    const objNum = parseInt(match[1], 10);
    offsets.set(objNum, match.index);
  }

  return offsets;
}

/**
 * Extract the /Root indirect reference from the PDF. pdf-lib outputs
 * cross-reference streams (PDF 1.5+), so the Root reference is in the
 * last object's dictionary (the xref stream), not in a traditional
 * trailer section.
 */
function parseTrailerRootRef(raw: string): string | null {
  // Try traditional trailer first: "trailer\n<< ... /Root 1 0 R ... >>"
  const trailerMatch = raw.match(/trailer\s*<<([^>]*(?:>>[^>]*)*)>>/);
  if (trailerMatch) {
    const rootMatch = trailerMatch[1].match(/\/Root\s+(\d+\s+\d+\s+R)/);
    if (rootMatch) return rootMatch[1];
  }

  // For cross-reference streams: find the last object in the file.
  // The xref stream object is typically the last object and contains
  // /Root in its dictionary.
  //
  // DEF-407: same bounded/lookbehind quantifiers as parseXref — this runs over
  // the whole raw file in the same extraction path and must not backtrack on a
  // long digit run.
  const allObjMatches = [...raw.matchAll(/(?<!\d)(\d{1,10})\s+(\d{1,10})\s+obj\s*<<([\s\S]*?)>>/g)];
  if (allObjMatches.length > 0) {
    // Check the last few objects (xref stream is always last)
    for (let i = allObjMatches.length - 1; i >= Math.max(0, allObjMatches.length - 5); i--) {
      const dict = allObjMatches[i][3];
      const rootMatch = dict.match(/\/Root\s+(\d+\s+\d+\s+R)/);
      if (rootMatch) return rootMatch[1];
    }
  }

  // Last resort: scan all objects for /Root
  const rootMatch = raw.match(/\/Root\s+(\d+\s+\d+\s+R)/);
  return rootMatch ? rootMatch[1] : null;
}

/**
 * Resolve an indirect reference string like "5 0 R" to its raw object text
 * using the offsets map. Returns the text from the object number marker to
 * the matching "endobj".
 *
 * DEF-060: a naive `raw.indexOf('endobj', offset)` is wrong for stream
 * objects because the binary stream payload (FlateDecode-compressed content)
 * can contain the 6-byte sequence "endobj" — that match truncates the object
 * text mid-stream, `decodeStream` then slices the wrong bytes and inflate
 * fails, so `extractTextFromRawPdf` silently returns '' for every page (the
 * pre-DEF-060 exportText behaviour, which is why its tests only asserted
 * `typeof text === 'string'`). For stream objects we parse the dict's
 * /Length (a direct integer in pdf-lib output) to skip past the stream
 * payload before searching for `endobj`; if /Length is missing or indirect
 * we fall back to searching for `endstream` first. Non-stream objects keep
 * the fast path.
 */
function resolveObject(raw: string, ref: string, offsets: Map<number, number>): string | null {
  const refMatch = ref.match(/^(\d+)\s+\d+\s+R$/);
  if (!refMatch) return null;
  const objNum = parseInt(refMatch[1], 10);
  const offset = offsets.get(objNum);
  if (offset === undefined) return null;

  // Locate the `stream` keyword (followed by \n or \r\n) within this object.
  // The keyword sits after the `<<...>>` dict, so the first hit after `offset`
  // is this object's stream (objects do not nest).
  let streamKeywordIdx = raw.indexOf('stream\n', offset);
  const streamKeywordIdxRN = raw.indexOf('stream\r\n', offset);
  if (streamKeywordIdxRN >= 0 && (streamKeywordIdx < 0 || streamKeywordIdxRN < streamKeywordIdx)) {
    streamKeywordIdx = streamKeywordIdxRN;
  }

  if (streamKeywordIdx >= 0) {
    const header = raw.slice(offset, streamKeywordIdx);
    // dataStart points to the first byte after the stream keyword + EOL.
    const dataStart = raw[streamKeywordIdx + 6] === '\r'
      ? streamKeywordIdx + 8 // 'stream\r\n'
      : streamKeywordIdx + 7; // 'stream\n'
    // /Length is a direct integer for pdf-lib output. Use it to skip past
    // the (possibly binary) payload before searching for endobj.
    const lengthMatch = header.match(/\/Length\s+(\d+)/);
    if (lengthMatch) {
      const len = parseInt(lengthMatch[1], 10);
      const afterPayload = dataStart + len;
      const endIdx = raw.indexOf('endobj', afterPayload);
      if (endIdx >= 0) return raw.slice(offset, endIdx + 6);
    }
    // Fallback: find endstream (9 bytes — far less likely to collide with
    // binary payload than 6-byte "endobj") then endobj after it.
    const endstreamIdx = raw.indexOf('endstream', dataStart);
    if (endstreamIdx >= 0) {
      const endIdx = raw.indexOf('endobj', endstreamIdx);
      if (endIdx >= 0) return raw.slice(offset, endIdx + 6);
    }
  }

  // Non-stream object (or stream lookup failed): fast path.
  const endIdx = raw.indexOf('endobj', offset);
  if (endIdx < 0) return null;
  return raw.slice(offset, endIdx + 6);
}

/**
 * Extract a reference string (e.g. "5 0 R") from a dictionary for a given key.
 */
function extractDictRef(dict: string, key: string): string | null {
  const regex = new RegExp(`/${key}\\s+(\\d+\\s+\\d+\\s+R)`);
  const match = dict.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract an array of references from a dictionary key that may be a single
 * reference or an array of references.
 */
function extractDictRefOrArray(dict: string, key: string): string[] {
  // Try array: /Key [1 0 R 2 0 R]
  const arrayRegex = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`);
  const arrayMatch = dict.match(arrayRegex);
  if (arrayMatch) {
    const inner = arrayMatch[1];
    const refs: string[] = [];
    const refRegex = /(\d+\s+\d+\s+R)/g;
    let m: RegExpExecArray | null;
    while ((m = refRegex.exec(inner)) !== null) {
      refs.push(m[1]);
    }
    return refs;
  }

  // Try single ref: /Key 1 0 R
  const ref = extractDictRef(dict, key);
  return ref ? [ref] : [];
}

/**
 * Extract an array of references from a dictionary key (e.g. /Kids array).
 */
function extractDictArray(dict: string, key: string): string[] {
  return extractDictRefOrArray(dict, key);
}

/**
 * Decode a PDF stream object. The stream object text consists of the object
 * header ("N G obj"), a dictionary ("<<...>>"), the stream keyword, the raw
 * stream data, "endstream", and "endobj".
 *
 * Handles FlateDecode and ASCII85Decode filters.
 */
function decodeStream(raw: string, streamObjText: string, maxInflateBytes?: number): string | null {
  // Find the absolute offset of this object in the raw PDF text
  const objOffset = raw.indexOf(streamObjText);
  if (objOffset < 0) return null;

  // Extract the stream dictionary to check for filters
  const dictMatch = streamObjText.match(/<<([^>]*(?:>>[^>]*)*)>>/s);
  const dict = dictMatch ? dictMatch[1] : '';

  // Find the stream data boundaries within streamObjText
  const streamIdxNL = streamObjText.indexOf('stream\n');
  const streamIdxRN = streamObjText.indexOf('stream\r\n');
  const streamKeywordIdx = streamIdxNL >= 0 ? streamIdxNL : streamIdxRN;
  if (streamKeywordIdx < 0) return null;

  // Data starts after 'stream\n' or 'stream\r\n'
  const dataOffsetInObj = streamKeywordIdx === streamIdxNL
    ? streamKeywordIdx + 7  // 'stream\n'
    : streamKeywordIdx + 8; // 'stream\r\n'

  // Find endstream after the data start
  const endstreamIdx = streamObjText.indexOf('endstream', dataOffsetInObj);
  if (endstreamIdx < 0) return null;

  // Absolute positions in raw
  const absDataStart = objOffset + dataOffsetInObj;
  const absDataEnd = objOffset + endstreamIdx;

  // Convert latin1 characters back to bytes (latin1 is 1:1 with bytes 0-255)
  const streamText = raw.slice(absDataStart, absDataEnd);
  const streamBytes = new Uint8Array(streamText.length);
  for (let i = 0; i < streamText.length; i++) {
    streamBytes[i] = streamText.charCodeAt(i) & 0xff;
  }

  // Check for common filters
  const hasFlateDecode = dict.includes('FlateDecode');
  const hasASCII85 = dict.includes('ASCII85Decode');

  try {
    let decoded: Uint8Array;
    if (hasASCII85) {
      const a85 = decodeASCII85(streamBytes);
      decoded = hasFlateDecode
        ? (maxInflateBytes !== undefined
            ? inflateSync(a85, { maxOutputLength: maxInflateBytes })
            : inflateSync(a85))
        : a85;
    } else if (hasFlateDecode) {
      // DEF-408: the /ToUnicode path passes MAX_TOUNICODE_CMAP_BYTES so a
      // zlib bomb is refused by zlib itself instead of materialising hundreds
      // of MiB before the decoded-char ceiling can reject it. A bounded inflate
      // that overflows is treated as "ignore this CMap" (return null) rather
      // than falling back to the raw bytes.
      decoded = maxInflateBytes !== undefined
        ? inflateSync(streamBytes, { maxOutputLength: maxInflateBytes })
        : inflateSync(streamBytes);
    } else {
      decoded = streamBytes;
    }
    return bytesToByteString(decoded);
  } catch {
    // A bounded inflate that refused an oversized stream means the caller must
    // ignore the stream entirely; raw bytes are not a valid substitute.
    if (maxInflateBytes !== undefined && hasFlateDecode) return null;
    // If decompression fails, return the raw bytes as text
    return bytesToByteString(streamBytes);
  }
}

/**
 * Decode ASCII85 encoded data. PDF uses a modified ASCII85 where the data
 * is terminated by '~>'.
 */
function decodeASCII85(data: Uint8Array): Uint8Array {
  const ascii85Text = bytesToByteString(data);
  // Remove whitespace and find the data between the start and '~>'
  let cleaned = ascii85Text.replace(/\s/g, '');
  const endMarker = cleaned.indexOf('~>');
  if (endMarker >= 0) cleaned = cleaned.substring(0, endMarker);

  const result: number[] = [];
  let group: number[] = [];
  let padding = 0;

  for (const ch of cleaned) {
    if (ch === 'z') {
      // 'z' represents 4 zero bytes
      result.push(0, 0, 0, 0);
      continue;
    }
    const val = ch.charCodeAt(0) - 33; // '!' = 0
    if (val < 0 || val > 84) continue;
    group.push(val);

    if (group.length === 5) {
      let num = group[0] * 85 * 85 * 85 * 85 +
                group[1] * 85 * 85 * 85 +
                group[2] * 85 * 85 +
                group[3] * 85 +
                group[4];
      result.push((num >> 24) & 0xff, (num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff);
      group = [];
    }
  }

  // Handle leftover group
  if (group.length > 0) {
    padding = 5 - group.length;
    for (let i = 0; i < padding; i++) group.push(84); // pad with max value (84)
    let num = group[0] * 85 * 85 * 85 * 85 +
              group[1] * 85 * 85 * 85 +
              group[2] * 85 * 85 +
              group[3] * 85 +
              group[4];
    for (let i = 0; i < 4 - padding; i++) {
      result.push((num >> (24 - i * 8)) & 0xff);
    }
  }

  return new Uint8Array(result);
}

/**
 * DEF-402 — named ceilings for /ToUnicode CMap work. A CMap whose decoded
 * text exceeds MAX_TOUNICODE_CMAP_CHARS characters, or whose parsed mapping
 * would exceed MAX_TOUNICODE_ENTRIES entries, is IGNORED (the extractor falls
 * back to the windows-1252 hex decoder) rather than parsed. Refuse, never
 * stall — a hostile or corrupt CMap must not hang or exhaust memory.
 */
const MAX_TOUNICODE_CMAP_CHARS = 1000000;
const MAX_TOUNICODE_ENTRIES = 65536;

/**
 * DEF-405/406/408 — additional named ceilings for the /ToUnicode path.
 *
 * MAX_TOUNICODE_CMAP_BYTES bounds the INFLATE itself (DEF-408): a hostile
 * FlateDecode CMap must never be allowed to expand past this many bytes. It is
 * 4x MAX_TOUNICODE_CMAP_CHARS so a legitimate CMap near the decoded-char
 * ceiling (a byte-per-char text stream) still inflates, while a 256 MiB bomb
 * is refused in zlib before it can be materialised. Note this differs from
 * MAX_TOUNICODE_CMAP_CHARS, which is checked on the decoded STRING.
 *
 * MAX_PAGE_FONT_ENTRIES bounds how many `/Name N G R` entries in a page's
 * /Font dict are examined (DEF-406); entries beyond it fall back to the
 * windows-1252 decoder. A real page has a handful of fonts, never thousands.
 *
 * MAX_DOC_TOUNICODE_FONTS bounds how many DISTINCT font objects get their
 * /ToUnicode parsed across one document extraction (DEF-406). The per-font
 * memo cache makes repeated references to one font O(1); this ceiling caps the
 * distinct-font shape.
 */
const MAX_TOUNICODE_CMAP_BYTES = 4 * MAX_TOUNICODE_CMAP_CHARS; // 4,000,000
const MAX_PAGE_FONT_ENTRIES = 4096;
const MAX_DOC_TOUNICODE_FONTS = 4096;

/**
 * DEF-406 — per-document extraction cache, keyed by the raw PDF byte buffer.
 * exportText / createDocxFromDoc hand the SAME Uint8Array object to
 * extractTextFromRawPdf for every page, so a WeakMap keyed by that object
 * shares the font memo across the document's pages and is collected with it.
 * `fontMaps` memoises by resolved font object number (null = a font that was
 * examined and yielded no map), so N resource names pointing at one font cost
 * O(1) after the first; `fontsParsed` enforces the per-document ToUnicode cap.
 */
interface FontExtractionCache {
  fontMaps: Map<number, ToUnicodeMap | null>;
  fontsParsed: number;
}
const fontExtractionCaches = new WeakMap<Uint8Array, FontExtractionCache>();

function getFontExtractionCache(bytes: Uint8Array): FontExtractionCache {
  let cache = fontExtractionCaches.get(bytes);
  if (cache === undefined) {
    cache = { fontMaps: new Map(), fontsParsed: 0 };
    fontExtractionCaches.set(bytes, cache);
  }
  return cache;
}

/** A parsed /ToUnicode CMap: normalized source-code hex -> unicode string,
 *  plus the source-code width in bytes (Identity-H uses 2-byte codes). */
interface ToUnicodeMap {
  map: Map<string, string>;
  codeWidth: number;
}

/** Normalize a source-code hex token: lowercase, no leading zeros. */
function normCode(hex: string): string {
  const h = hex.toLowerCase().replace(/^0+/, '');
  return h.length > 0 ? h : '0';
}

/** Format a code as a zero-padded hex token of the given digit width. */
function srcHexFor(code: number, digits: number): string {
  return code.toString(16).padStart(digits, '0').slice(-digits);
}

/** Decode a UTF-16BE hex destination value (CMap bfchar/bfrange target). */
function decodeUtf16BeHex(hex: string): string {
  let h = hex;
  if (h.length % 2 !== 0) h += '0';
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) {
    bytes[i / 2] = parseInt(h.substring(i, i + 2), 16);
  }
  if (bytes.length % 2 !== 0) {
    // Not a whole UTF-16 code unit — decode as windows-1252 rather than throw.
    return new TextDecoder('windows-1252').decode(bytes);
  }
  try {
    return new TextDecoder('utf-16be').decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Increment the last UTF-16 code unit of a bfrange destination. */
function incrementUtf16(dest: string, delta: number): string {
  if (dest.length === 0 || delta === 0) return dest;
  const next = dest.charCodeAt(dest.length - 1) + delta;
  if (next > 0xffff) return dest;
  return dest.slice(0, -1) + String.fromCharCode(next);
}

/** CMap whitespace, matching JS `\s` over the latin1 byte-string. */
const CMAP_WS = /\s/;

/**
 * Read a single `<hex>` token starting at `pos`. Returns the hex body (without
 * the angle brackets) and the index just past the closing '>', or null when no
 * well-formed token starts there. `<<` is rejected (it opens a dictionary, not
 * a hex string). Pure character walk, so it cannot backtrack.
 */
function readCmapHexToken(text: string, pos: number): { hex: string; end: number } | null {
  if (text[pos] !== '<' || text[pos + 1] === '<') return null;
  let i = pos + 1;
  while (i < text.length && text[i] !== '>') {
    const c = text.charCodeAt(i);
    const isHex =
      (c >= 0x30 && c <= 0x39) || // 0-9
      (c >= 0x41 && c <= 0x46) || // A-F
      (c >= 0x61 && c <= 0x66); // a-f
    if (!isHex) return null;
    i++;
  }
  if (i >= text.length) return null; // unterminated
  if (i === pos + 1) return null; // empty token (`<>`) — not a CMap hex value
  return { hex: text.slice(pos + 1, i), end: i + 1 };
}

/**
 * Parse a decoded /ToUnicode CMap into a lookup. Supports beginbfchar and
 * beginbfrange (simple and array forms). Returns null (caller keeps the
 * windows-1252 fallback) for an empty, oversized or malformed CMap.
 */
function parseToUnicodeCMap(cmapText: string): ToUnicodeMap | null {
  if (cmapText.length > MAX_TOUNICODE_CMAP_CHARS) return null;
  const map = new Map<string, string>();
  let codeWidth = 0;
  const noteWidth = (srcHex: string): void => {
    if (codeWidth !== 0) return;
    const w = Math.floor(srcHex.length / 2);
    if (w === 1 || w === 2) codeWidth = w;
  };
  const overCeiling = (): boolean => map.size >= MAX_TOUNICODE_ENTRIES;

  // DEF-405: linear section scan. The old lazy/global regex match was O(n^2)
  // on a CMap full of unmatched `beginbfchar` tokens (a measured hostile
  // shape): every failed lazy match re-scanned the remainder. indexOf advances
  // monotonically, so total work is O(n) and the decoded-char ceiling is
  // checked before any large result is built.
  let cursor = 0;
  for (;;) {
    const sectionStart = cmapText.indexOf('beginbfchar', cursor);
    if (sectionStart < 0) break;
    const bodyStart = sectionStart + 11; // 'beginbfchar'.length
    const sectionEnd = cmapText.indexOf('endbfchar', bodyStart);
    if (sectionEnd < 0) break; // unmatched opener: ignore the remainder
    const body = cmapText.slice(bodyStart, sectionEnd);
    cursor = sectionEnd + 9; // 'endbfchar'.length

    // DEF-404: one ordered left-to-right scan over the body, so the scanner
    // always advances past what it consumed and can never re-read an array's
    // destination list as simple pairs.
    let i = 0;
    while (i < body.length) {
      const src = readCmapHexToken(body, i);
      if (src === null) {
        i++;
        continue;
      }
      i = src.end;
      while (i < body.length && CMAP_WS.test(body[i])) i++;
      const dst = readCmapHexToken(body, i);
      if (dst === null) continue; // malformed pair; next iteration advances
      i = dst.end;
      if (overCeiling()) return null;
      noteWidth(src.hex);
      map.set(normCode(src.hex), decodeUtf16BeHex(dst.hex));
    }
  }

  // beginbfrange: simple "<lo> <hi> <dst>" and array "<lo> <hi> [<d1> ...]"
  cursor = 0;
  for (;;) {
    const sectionStart = cmapText.indexOf('beginbfrange', cursor);
    if (sectionStart < 0) break;
    const bodyStart = sectionStart + 12; // 'beginbfrange'.length
    const sectionEnd = cmapText.indexOf('endbfrange', bodyStart);
    if (sectionEnd < 0) break;
    const body = cmapText.slice(bodyStart, sectionEnd);
    cursor = sectionEnd + 10; // 'endbfrange'.length

    let i = 0;
    while (i < body.length) {
      const loTok = readCmapHexToken(body, i);
      if (loTok === null) {
        i++;
        continue;
      }
      i = loTok.end;
      while (i < body.length && CMAP_WS.test(body[i])) i++;
      const hiTok = readCmapHexToken(body, i);
      if (hiTok === null) continue;
      i = hiTok.end;
      while (i < body.length && CMAP_WS.test(body[i])) i++;

      if (body[i] === '[') {
        // Array form. Scan the destination list inline; the enclosing loop
        // continues after the closing ']' so no destination is re-parsed.
        i++;
        const dests: string[] = [];
        while (i < body.length) {
          while (i < body.length && CMAP_WS.test(body[i])) i++;
          if (i >= body.length) break; // unterminated array
          if (body[i] === ']') {
            i++;
            break;
          }
          const d = readCmapHexToken(body, i);
          if (d === null) {
            i++;
            continue;
          }
          dests.push(d.hex);
          i = d.end;
          if (dests.length > MAX_TOUNICODE_ENTRIES) return null;
        }
        const loNum = parseInt(loTok.hex, 16);
        noteWidth(loTok.hex);
        for (let k = 0; k < dests.length; k++) {
          if (overCeiling()) return null;
          map.set(normCode(srcHexFor(loNum + k, loTok.hex.length)), decodeUtf16BeHex(dests[k]));
        }
      } else if (body[i] === '<') {
        // Simple form: <lo> <hi> <dst>
        const dstTok = readCmapHexToken(body, i);
        if (dstTok === null) continue;
        i = dstTok.end;
        const loNum = parseInt(loTok.hex, 16);
        const hiNum = parseInt(hiTok.hex, 16);
        if (hiNum < loNum || hiNum - loNum >= MAX_TOUNICODE_ENTRIES) return null;
        noteWidth(loTok.hex);
        const dest = decodeUtf16BeHex(dstTok.hex);
        for (let code = loNum; code <= hiNum; code++) {
          if (overCeiling()) return null;
          map.set(normCode(srcHexFor(code, loTok.hex.length)), incrementUtf16(dest, code - loNum));
        }
      } else {
        // No destination token; resume one character on (loop guard).
        continue;
      }
    }
  }

  if (map.size === 0 || codeWidth === 0) return null;
  return { map, codeWidth };
}

/** Decode a hex string through a font's ToUnicode map, chunking by code
 *  width. A code with no mapping falls back per-code to windows-1252. */
function decodeHexWithMap(hex: string, tu: ToUnicodeMap): string {
  let h = hex;
  if (h.length % 2 !== 0) h += '0';
  const width = tu.codeWidth * 2;
  let out = '';
  for (let i = 0; i < h.length; i += width) {
    const chunk = h.substring(i, i + width);
    if (chunk.length < width) {
      out += decodeHexString(chunk);
      continue;
    }
    const mapped = tu.map.get(normCode(chunk));
    out += mapped !== undefined ? mapped : decodeHexString(chunk);
  }
  return out;
}

/**
 * Extract the body of a directly-written dictionary value (`/Key << ... >>`)
 * from a parent object text, matching nested `<< >>` pairs. Returns null when
 * the key is absent or its value is an indirect reference instead.
 */
function extractDirectDictBody(parent: string, key: string): string | null {
  const m = new RegExp(`/${key}\\s*<<`).exec(parent);
  if (!m) return null;
  const dictStart = m.index + m[0].length - 2;
  let depth = 0;
  for (let i = dictStart; i < parent.length - 1; i++) {
    if (parent[i] === '<' && parent[i + 1] === '<') {
      depth++;
      i++;
      continue;
    }
    if (parent[i] === '>' && parent[i + 1] === '>') {
      depth--;
      i++;
      if (depth === 0) return parent.slice(dictStart + 2, i - 1);
    }
  }
  return null;
}

/**
 * DEF-402 — resolve the page's /Resources /Font entries to their /ToUnicode
 * maps, keyed by the font's resource name. Best-effort: a malformed font tree
 * yields no maps (extraction then keeps the windows-1252 fallback).
 *
 * DEF-406 — the `cache` is shared across the whole document extraction. A
 * font's parsed map is memoised by its object number, so the realistic hostile
 * shape (thousands of resource names pointing at one font) costs O(1) per
 * entry after the first. In addition the page's DECLARED /Font extent is
 * preflighted and only the first MAX_PAGE_FONT_ENTRIES entries are examined
 * (the rest fall back), and at most MAX_DOC_TOUNICODE_FONTS distinct fonts get
 * their /ToUnicode parsed per document.
 */
function resolvePageFontToUnicode(
  raw: string,
  pageObj: string,
  offsets: Map<number, number>,
  cache: FontExtractionCache,
): Map<string, ToUnicodeMap> {
  const result = new Map<string, ToUnicodeMap>();
  try {
    let resourcesDict = extractDirectDictBody(pageObj, 'Resources');
    if (resourcesDict === null) {
      const resRef = extractDictRef(pageObj, 'Resources');
      if (resRef) {
        const resObj = resolveObject(raw, resRef, offsets);
        if (resObj) resourcesDict = resObj;
      }
    }
    if (!resourcesDict) return result;

    let fontDict = extractDirectDictBody(resourcesDict, 'Font');
    if (fontDict === null) {
      const fontRef = extractDictRef(resourcesDict, 'Font');
      if (fontRef) {
        const fontObj = resolveObject(raw, fontRef, offsets);
        if (fontObj) fontDict = fontObj;
      }
    }
    if (!fontDict) return result;

    // Preflight the declared /Font extent, bounded so the count itself cannot
    // walk an unbounded dict: stop counting once the ceiling is exceeded.
    let declared = 0;
    const countRegex = /\/([^\s/<>\[\]()]+)\s+\d{1,10}\s+\d{1,10}\s+R/g;
    while (declared <= MAX_PAGE_FONT_ENTRIES && countRegex.exec(fontDict) !== null) {
      declared++;
    }
    const examineLimit = Math.min(declared, MAX_PAGE_FONT_ENTRIES);

    const entryRegex = /\/([^\s/<>\[\]()]+)\s+(\d{1,10})\s+(\d{1,10})\s+R/g;
    let examined = 0;
    let m: RegExpExecArray | null;
    while ((m = entryRegex.exec(fontDict)) !== null) {
      if (examined >= examineLimit) break;
      examined++;
      const name = m[1];
      const fontObjNum = parseInt(m[2], 10);

      // Memo lookup by object number — null means "examined, no map".
      const cached = cache.fontMaps.get(fontObjNum);
      if (cached !== undefined) {
        if (cached !== null) result.set(name, cached);
        continue;
      }

      const fontObj = resolveObject(raw, `${m[2]} ${m[3]} R`, offsets);
      if (!fontObj || !/\/Subtype\s*\/Type0/.test(fontObj)) {
        cache.fontMaps.set(fontObjNum, null);
        continue;
      }
      const tuRef = extractDictRef(fontObj, 'ToUnicode');
      if (!tuRef) {
        cache.fontMaps.set(fontObjNum, null);
        continue;
      }
      // Per-document cap on how many fonts get a ToUnicode parse.
      if (cache.fontsParsed >= MAX_DOC_TOUNICODE_FONTS) {
        cache.fontMaps.set(fontObjNum, null);
        continue;
      }
      cache.fontsParsed++;
      const tuObj = resolveObject(raw, tuRef, offsets);
      if (!tuObj) {
        cache.fontMaps.set(fontObjNum, null);
        continue;
      }
      const decoded = decodeStream(raw, tuObj, MAX_TOUNICODE_CMAP_BYTES);
      if (!decoded) {
        cache.fontMaps.set(fontObjNum, null);
        continue;
      }
      const parsed = parseToUnicodeCMap(decoded);
      cache.fontMaps.set(fontObjNum, parsed);
      if (parsed) result.set(name, parsed);
    }
  } catch {
    // Best-effort — a malformed font tree must never break extraction.
  }
  return result;
}

/**
 * Parse a decoded PDF content stream and extract text from Tj, TJ, '
 * and " operators. Handles both literal strings `(text)` and hexadecimal
 * strings `<hex>`. pdf-lib uses hex strings for fonts with custom
 * encodings (WinAnsiEncoding/PDFDocEncoding).
 *
 * DEF-402 — hex strings are decoded through the CURRENT font's /ToUnicode
 * map when that font has one (see `fontMaps`); a document whose fonts carry
 * no map keeps the windows-1252 fallback byte-for-byte.
 */
function parseContentStreamText(
  content: string,
  fontMaps: Map<string, ToUnicodeMap> = new Map(),
): string {
  const parts: string[] = [];

  // Track `/Name size Tf` by stream position so a hex string is decoded with
  // the font in effect where it appears.
  const tfEvents: Array<{ index: number; font: string }> = [];
  const tfRegex = /\/([^\s/<>\[\]()]+)\s+[\d.]+\s+Tf/g;
  let tfMatch: RegExpExecArray | null;
  while ((tfMatch = tfRegex.exec(content)) !== null) {
    tfEvents.push({ index: tfMatch.index, font: tfMatch[1] });
  }
  const fontAt = (pos: number): string | null => {
    let lo = 0;
    let hi = tfEvents.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tfEvents[mid].index <= pos) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found >= 0 ? tfEvents[found].font : null;
  };
  const decodeHexAt = (hex: string, pos: number): string => {
    if (fontMaps.size === 0) return decodeHexString(hex);
    const name = fontAt(pos);
    const tu = name !== null ? fontMaps.get(name) : undefined;
    return tu !== undefined ? decodeHexWithMap(hex, tu) : decodeHexString(hex);
  };

  // Match hex-encoded text: <hex> Tj
  const hexTjRegex = /<([0-9A-Fa-f]*)>\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = hexTjRegex.exec(content)) !== null) {
    const hex = match[1];
    if (hex.length > 0) {
      parts.push(decodeHexAt(hex, match.index));
    }
  }

  // Match literal text: (text) Tj
  const tjRegex = /\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
  while ((match = tjRegex.exec(content)) !== null) {
    parts.push(decodePdfString(match[1]));
  }

  // Match TJ array with hex strings: [<hex> num <hex> ...] TJ
  const hexTjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = hexTjArrayRegex.exec(content)) !== null) {
    const inner = match[1];
    // Hex strings in array
    const hexStrRegex = /<([0-9A-Fa-f]*)>/g;
    let hexStrMatch: RegExpExecArray | null;
    while ((hexStrMatch = hexStrRegex.exec(inner)) !== null) {
      const hex = hexStrMatch[1];
      if (hex.length > 0) {
        parts.push(decodeHexAt(hex, match.index + 1 + hexStrMatch.index));
      }
    }
    // Literal strings in array
    const strRegex = /\(((?:[^()\\]|\\.)*)\)/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = strRegex.exec(inner)) !== null) {
      parts.push(decodePdfString(strMatch[1]));
    }
  }

  // Match ': (text) ' and '<hex> '
  const quoteRegex = /(?:\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f]*)>)\s*'/g;
  while ((match = quoteRegex.exec(content)) !== null) {
    if (match[1] !== undefined) {
      parts.push(decodePdfString(match[1]));
    } else if (match[2] && match[2].length > 0) {
      parts.push(decodeHexAt(match[2], match.index));
    }
  }

  return parts.join('');
}

/**
 * Decode a PDF hexadecimal string to a UTF-8 string. Each pair of hex
 * digits represents one byte. pdf-lib uses WinAnsiEncoding for standard
 * fonts, so we map bytes through a simple Latin-1 decoder.
 */
function decodeHexString(hex: string): string {
  if (hex.length === 0) return '';
  // Pad to even length
  if (hex.length % 2 !== 0) hex += '0';
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

/**
 * Decode a PDF literal-string body (the content between the parentheses)
 * handling common escape sequences.
 */
function decodePdfString(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\') {
      i++;
      if (i >= s.length) break;
      const c = s[i];
      switch (c) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case '(':
        case ')':
        case '\\':
          out += c;
          break;
        default:
          // Try octal: \ddd (1-3 digits)
          if (c >= '0' && c <= '7') {
            let octal = '';
            let j = 0;
            while (j < 3 && i + j < s.length && s[i + j] >= '0' && s[i + j] <= '7') {
              octal += s[i + j];
              j++;
            }
            const code = parseInt(octal, 8);
            out += String.fromCharCode(code);
            i += j - 1; // -1 because the outer i++ will advance
          } else {
            // Unknown escape — treat literally
            out += c;
          }
          break;
      }
    } else {
      out += s[i];
    }
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 9: DOCX builder (minimal store-only ZIP of Office Open XML)
// ---------------------------------------------------------------------------

/** DEF-060 — one page of a text-first DOCX. A 'text' page emits real
 *  w:p/w:r/w:t paragraphs (editable in Word); an 'image' page emits an
 *  inline drawing (wp:inline) from the renderer-rasterised PNG fallback.
 *  Pages are separated by explicit page breaks so the .docx page count
 *  matches the source PDF. */
type DocxDocPage =
  | { kind: 'text'; text: string }
  | { kind: 'image'; entry: DocxImageEntry };

/**
 * Escape a string for inclusion in an XML text node. Covers the five
 * characters XML mandates (& < > " '). Used for w:t run text so a page
 * containing `<` or `&` does not produce malformed document.xml.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * DEF-060 — build a .docx from per-page text, falling back to inline images
 * for pages with no extractable text. The output is a valid store-only ZIP
 * of Office Open XML; text pages contain real w:p/w:r/w:t runs (selectable
 * and editable in Word) and image pages contain a wp:inline drawing sized to
 * the source page in EMU (1 point = 12700 EMU).
 *
 * Page separation: every page after the first is preceded by a paragraph
 * holding a `w:br w:type="page"` run, so the .docx page count matches the
 * input page count regardless of how the text wraps.
 */
function buildDocxFromDoc(pages: DocxDocPage[]): Uint8Array {
  const EMU_PER_POINT = 12700;

  const docXmlHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>`;

  const docRelsHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;

  let docXml = docXmlHeader;
  let docRels = docRelsHeader;
  let imageIdx = 0;
  const imageEntries: DocxImageEntry[] = [];

  for (let i = 0; i < pages.length; i++) {
    // Page break before every page except the first. A page break lives in
    // its own paragraph so the break is never the first child of body.
    if (i > 0) {
      docXml += `
    <w:p>
      <w:r>
        <w:br w:type="page"/>
      </w:r>
    </w:p>`;
    }

    const page = pages[i];
    if (page.kind === 'text') {
      // Emit one w:p per line. Each line is a single w:r wrapping a w:t with
      // xml:space="preserve" so leading/trailing spaces survive. An empty
      // text page (no fallback raster available) still gets one paragraph
      // so the page slot exists.
      const lines = page.text.length === 0 ? [''] : page.text.split('\n');
      for (const line of lines) {
        docXml += `
    <w:p>
      <w:r>
        <w:t xml:space="preserve">${escapeXml(line)}</w:t>
      </w:r>
    </w:p>`;
      }
    } else {
      imageIdx += 1;
      const relId = `rId${imageIdx}`;
      const entry = page.entry;
      const emuW = Math.round(entry.pageWidth * EMU_PER_POINT);
      const emuH = Math.round(entry.pageHeight * EMU_PER_POINT);
      docXml += `
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${emuW}" cy="${emuH}"/>
            <wp:docPr id="${imageIdx}" name="Page ${entry.pageNumber}"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr>
                    <pic:cNvPr id="0" name="Page ${entry.pageNumber}"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="${relId}"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="${emuW}" cy="${emuH}"/>
                    </a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>`;
      docRels += `
  <Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${imageIdx}.png"/>`;
      imageEntries.push(entry);
    }
  }

  docXml += `
  </w:body>
</w:document>`;

  docRels += `
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const encoder = new TextEncoder();

  const zipFiles: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'word/document.xml', data: encoder.encode(docXml) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(docRels) },
  ];

  for (let i = 0; i < imageEntries.length; i++) {
    zipFiles.push({
      name: `word/media/image${i + 1}.png`,
      data: imageEntries[i].pngBuffer,
    });
  }

  return createStoreZip(zipFiles);
}

/**
 * Build a minimal .docx file from rasterised page images. The output is a
 * valid ZIP archive containing the Office Open XML wrapper with one image
 * per page, each filling one "page" section in the document.
 *
 * EMU conversion: 1 point = 12700 EMU (1 inch = 72 points = 914400 EMU).
 */
function buildDocxFromImages(entries: DocxImageEntry[]): Uint8Array {
  const EMU_PER_POINT = 12700;

  // Build word/document.xml
  let docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>`;

  let docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const relId = `rId${i + 1}`;
    const emuW = Math.round(entry.pageWidth * EMU_PER_POINT);
    const emuH = Math.round(entry.pageHeight * EMU_PER_POINT);

    // Add a page break before every page except the first
    if (i > 0) {
      docXml += `
    <w:p>
      <w:r>
        <w:br w:type="page"/>
      </w:r>
    </w:p>`;
    }

    docXml += `
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${emuW}" cy="${emuH}"/>
            <wp:docPr id="${i + 1}" name="Page ${entry.pageNumber}"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr>
                    <pic:cNvPr id="0" name="Page ${entry.pageNumber}"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="${relId}"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm>
                      <a:off x="0" y="0"/>
                      <a:ext cx="${emuW}" cy="${emuH}"/>
                    </a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>`;

    docRels += `
  <Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`;
  }

  docXml += `
  </w:body>
</w:document>`;

  docRels += `
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const encoder = new TextEncoder();

  const zipFiles: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'word/document.xml', data: encoder.encode(docXml) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(docRels) },
  ];

  for (let i = 0; i < entries.length; i++) {
    zipFiles.push({
      name: `word/media/image${i + 1}.png`,
      data: entries[i].pngBuffer,
    });
  }

  return createStoreZip(zipFiles);
}

/**
 * Build a minimal store-only (uncompressed) ZIP archive from the given file
 * entries. Each entry has a name (path within the archive, using '/' as
 * separator) and raw data. The output is a valid ZIP file that can be opened
 * by any compliant unzip tool, including Microsoft Word for .docx.
 */
function createStoreZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  // Calculate CRC-32 upfront because we need it in both local and central headers
  const entries = files.map((f) => ({
    name: f.name,
    nameBytes: new TextEncoder().encode(f.name),
    data: f.data,
    crc: crc32(f.data),
  }));

  let offset = 0;
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];

  for (const entry of entries) {
    const nameLen = entry.nameBytes.length;
    const size = entry.data.length;

    // Local file header
    const lh = new Uint8Array(30 + nameLen);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);          // version needed (2.0)
    lv.setUint16(6, 0x0800, true);      // general-purpose bit flag (UTF-8)
    lv.setUint16(8, 0, true);           // compression: store
    lv.setUint16(10, 0, true);          // mod time
    lv.setUint16(12, 0, true);          // mod date
    lv.setUint32(14, entry.crc, true);   // CRC-32
    lv.setUint32(18, size, true);        // compressed size
    lv.setUint32(22, size, true);        // uncompressed size
    lv.setUint16(26, nameLen, true);     // filename length
    lv.setUint16(28, 0, true);           // extra field length
    lh.set(entry.nameBytes, 30);
    localParts.push(lh);

    // Central directory header
    const ch = new Uint8Array(46 + nameLen);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);   // signature
    cv.setUint16(4, 20, true);           // version made by (2.0)
    cv.setUint16(6, 20, true);           // version needed (2.0)
    cv.setUint16(8, 0x0800, true);       // general-purpose bit flag (UTF-8)
    cv.setUint16(10, 0, true);           // compression: store
    cv.setUint16(12, 0, true);           // mod time
    cv.setUint16(14, 0, true);           // mod date
    cv.setUint32(16, entry.crc, true);    // CRC-32
    cv.setUint32(20, size, true);         // compressed size
    cv.setUint32(24, size, true);         // uncompressed size
    cv.setUint16(28, nameLen, true);      // filename length
    cv.setUint16(30, 0, true);            // extra field length
    cv.setUint16(32, 0, true);            // file comment length
    cv.setUint16(34, 0, true);            // disk number start
    cv.setUint16(36, 0, true);            // internal file attributes
    cv.setUint32(38, 0, true);            // external file attributes
    cv.setUint32(42, offset, true);       // relative offset of local header
    ch.set(entry.nameBytes, 46);
    centralParts.push(ch);

    offset += 30 + nameLen + size;
  }

  // Concatenate everything
  const localHeaderSize = localParts.reduce((s, p) => s + p.length, 0);
  const filesSize = entries.reduce((s, e) => s + e.data.length, 0);
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);

  const total = localHeaderSize + filesSize + centralSize + 22;
  const result = new Uint8Array(total);
  let pos = 0;

  for (let i = 0; i < entries.length; i++) {
    result.set(localParts[i], pos); pos += localParts[i].length;
    result.set(entries[i].data, pos); pos += entries[i].data.length;
  }

  const centralOffset = pos;
  for (const cp of centralParts) {
    result.set(cp, pos); pos += cp.length;
  }

  // End of central directory record
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // signature
  ev.setUint16(4, 0, true);              // disk number
  ev.setUint16(6, 0, true);              // disk with central directory
  ev.setUint16(8, entries.length, true);  // entries on this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, centralSize, true);    // size of central directory
  ev.setUint32(16, centralOffset, true);  // offset of central directory
  ev.setUint16(20, 0, true);             // comment length
  result.set(eocd, pos);

  return result;
}

/**
 * Calculate CRC-32 (IEEE 802.3 / ZIP flavour) of a byte array.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
