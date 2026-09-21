import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { beginText, concatTransformationMatrix, degrees, drawObject, endText, fill, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFOptionList, PDFRadioGroup, PDFRef, PDFStream, PDFTextField, rectangle, rgb, setCharacterSpacing, setFillingRgbColor, setFontAndSize, setGraphicsState, setTextMatrix, showText, StandardFonts, TextRenderingMode, setTextRenderingMode, pushGraphicsState, popGraphicsState, type PDFOperator, type PDFObject, type PDFImage, type PDFFont, type PDFPage } from 'pdf-lib';
import { err, ok, type Result } from '../../shared/result';
import type {
  AddStampPayload,
  AddTextBoxPayload,
  AnnModel,
  AnnRect,
  CommentEntry,
  CommentThread,
  CreateAnnotationPayload,
  CropEntry,
  DocxImageEntry,
  EditAnnotationPayload,
  EditFont,
  EditImagePayload,
  EditTextRunPayload,
  EngineError,
  EngineState,
  ExportPageEntry,
  ExportPagesPayload,
  FillFormFieldPayload,
  FormField,
  MovePagesBetweenDocsPayload,
  MovePagesBetweenDocsResult,
  MoveSignaturePayload,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  OpEntry,
  OptimizePreset,
  OcrPageFailure,
  PageLabelEntry,
  PlaceSignaturePayload,
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
import { exportFdf as exportFdfBytes, parseFdf } from './fdf';
import { embedEditFont } from './fonts';
import {
  applyPageLabels,
  carryOutlines,
  cropPagesInDoc,
} from './page-organize';
import {
  fillFormField,
  findFieldPage,
  flattenForm,
  getFormFields,
  restoreFormFieldsFromSnapshot,
  snapshotAllFormFields,
  type FormSnapshotEntry,
} from './forms';
import { auditSpace as auditSpacePdf } from './optimize';
import { OcrService, selectLowConfidence, type RawOcrWord, SUSPECT_CONFIDENCE_THRESHOLD } from './ocr';
import {
  DEFAULT_WATERMARK_COLOR,
  DEFAULT_WATERMARK_OPACITY,
  DEFAULT_WATERMARK_TEXT_SIZE,
  MAX_WATERMARK_PLACEMENTS_PER_PAGE,
  MAX_WATERMARKS_PER_DOC,
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

  /** Phase 11 — OCR service (tesseract.js). Optional: an engine built
   *  without it simply refuses `ocrRecognize` with `engine-error`. The
   *  main process constructs one with the bundled `assets/tessdata`
   *  langPath so recognition is fully offline. */
  constructor(private readonly ocr: OcrService | null = null) {}


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
  ): Promise<Result<ArrayBuffer, 'open-error'>> {
    return this._enqueue(docId, () => this._loadDocumentImpl(docId, filePath));
  }

  private async _loadDocumentImpl(
    docId: string,
    filePath: string,
  ): Promise<Result<ArrayBuffer, 'open-error'>> {
    if (this.docs.has(docId)) {
      this.docs.delete(docId);
    }
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      return err('open-error', `could not read: ${filePath}`);
    }
    try {
      const pdfDoc = await PDFDocument.load(buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer);
      const count = pdfDoc.getPageCount();
      // DEF-032: reject 0-page documents at load time
      if (count === 0) {
        return err('open-error', `PDF has 0 pages: ${filePath}`);
      }
      const annotations = parseAnnotationsFromDoc(pdfDoc);
      const placedSignatures = parseSignaturesFromDoc(pdfDoc);
      const textBoxes = parseTextBoxesFromDoc(pdfDoc);
      const comments = parseCommentsFromDoc(pdfDoc);
      const rotations = parseRotationsFromDoc(pdfDoc, count);
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
      };
      this.docs.set(docId, doc);
      return ok(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    } catch {
      return err('open-error', `could not parse PDF: ${filePath}`);
    }
  }

  // -----------------------------------------------------------------------
  // loadDocumentBytes — bytes-only, no path.  Samples use this so the real
  // engine drives rotation/delete/undo/saveAs/annotations.  Save is disabled
  // until saveAs because there is no on-disk origin.
  // -----------------------------------------------------------------------
  async loadDocumentBytes(
    docId: string,
    bytes: Uint8Array,
  ): Promise<Result<ArrayBuffer, 'open-error'>> {
    return this._enqueue(docId, () => this._loadDocumentBytesImpl(docId, bytes));
  }

  private async _loadDocumentBytesImpl(
    docId: string,
    bytes: Uint8Array,
  ): Promise<Result<ArrayBuffer, 'open-error'>> {
    if (this.docs.has(docId)) {
      this.docs.delete(docId);
    }
    try {
      const pdfDoc = await PDFDocument.load(bytes);
      const count = pdfDoc.getPageCount();
      // DEF-032: reject 0-page documents at load time
      if (count === 0) {
        return err('open-error', 'PDF has 0 pages');
      }
      const annotations = parseAnnotationsFromDoc(pdfDoc);
      const placedSignatures = parseSignaturesFromDoc(pdfDoc);
      const textBoxes = parseTextBoxesFromDoc(pdfDoc);
      const comments = parseCommentsFromDoc(pdfDoc);
      const rotations = parseRotationsFromDoc(pdfDoc, count);
      const doc: EngineDoc = {
        pdfDoc,
        order: Array.from({ length: count }, (_, i) => i),
        deleted: Array.from({ length: count }, () => false),
        rotations,
        annotations,
        undoStack: [],
        redoStack: [],
        path: '',
        modified: false,
        placedSignatures,
        textBoxes,
        comments,
      };
      this.docs.set(docId, doc);
      // Return the original bytes so the renderer can feed them to PDF.js.
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return ok(buf);
    } catch {
      return err('open-error', 'could not parse PDF bytes');
    }
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
    const prev = doc.undoStack.pop()!;
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
    const next = doc.redoStack.pop()!;
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
        ) as ArrayBuffer));
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

      // DEF-029: migrate AcroForm fields from the main document and the
      // merged documents into the new merged PDFDocument.
      try {
        const dstForm = mergedDoc.getForm();
        const srcForm = doc.pdfDoc.getForm();
        const srcFields = srcForm.getFields();
        const mainDocOffset = position === 'before' ? otherPageCount : 0;

        for (const srcField of srcFields) {
          try {
            const srcPage = findFieldPage(doc.pdfDoc, srcField);
            const dstPageIdx = srcPage + mainDocOffset;
            if (dstPageIdx < 0 || dstPageIdx >= mergedDoc.getPageCount()) continue;
            migrateFormField(srcField, dstForm, mergedDoc.getPage(dstPageIdx));
          } catch { /* skip */ }
        }

        // Migrate fields from each merged document
        let offset = position === 'before' ? 0 : doc.order.length;
        for (const otherDoc of otherDocs) {
          try {
            const otherForm = otherDoc.getForm();
            const otherFields = otherForm.getFields();
            for (const otherField of otherFields) {
              try {
                const srcPage = findFieldPage(otherDoc, otherField);
                const dstPageIdx = offset + srcPage;
                if (dstPageIdx < 0 || dstPageIdx >= mergedDoc.getPageCount()) continue;
                migrateFormField(otherField, dstForm, mergedDoc.getPage(dstPageIdx));
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
          offset += otherDoc.getPageCount();
        }
      } catch {
        // If form migration fails, proceed without form fields
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
    const snapshot = snapshotDoc(doc);
    try {
      fillFormField(doc.pdfDoc, payload.id, payload.value);
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
    const snapshot = snapshotDoc(doc);
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
      otherDoc = await PDFDocument.load(otherBytes);
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

      // Success: record a per-doc undo snapshot (each doc's undo reverts its
      // own side) and mark each modified. A COPY leaves the source untouched,
      // so it gets no snapshot and stays unmodified (no spurious unsaved
      // prompt on a document whose content did not change).
      if (mode === 'move') {
        fromDoc.undoStack.push(fromSnap);
        fromDoc.redoStack = [];
        fromDoc.modified = true;
      }
      toDoc.undoStack.push(toSnap);
      toDoc.redoStack = [];
      toDoc.modified = true;
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
      page.drawRectangle({
        x: maskX,
        y: pageHeight - maskBottom,
        width: maskW,
        height: maskH,
        color: rgb(1, 1, 1),
      });

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
      page.drawRectangle({
        x: old.x,
        y: pageHeight - old.y - old.height,
        width: old.width,
        height: old.height,
        color: rgb(1, 1, 1),
      });

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
      otherDoc = await PDFDocument.load(otherBytes);
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

/**
 * Migrate a single form field from a source PDFDocument to a destination
 * form, placing it on the given page. (DEF-029)
 */
function migrateFormField(
  srcField: any,
  dstForm: any,
  dstPage: any,
): void {
  const name = srcField.getName();
  if (srcField instanceof PDFTextField) {
    const f = dstForm.createTextField(name);
    const text = srcField.getText?.() ?? '';
    f.setText(typeof text === 'string' ? text : '');
    f.addToPage(dstPage);
    setWidgetPageRef(f, dstPage);
  } else if (srcField instanceof PDFCheckBox) {
    const f = dstForm.createCheckBox(name);
    try { if (srcField.isChecked?.()) f.check(); } catch {}
    f.addToPage(dstPage);
    setWidgetPageRef(f, dstPage);
  } else if (srcField instanceof PDFRadioGroup) {
    const options = srcField.getOptions?.() ?? [];
    const f = dstForm.createRadioGroup(name);
    for (const opt of options) {
      f.addOptionToPage(String(opt), dstPage);
    }
    try {
      const sel = srcField.getSelected?.();
      if (sel) f.select(String(sel));
    } catch {}
    setWidgetPageRef(f, dstPage);
  } else if (srcField instanceof PDFDropdown) {
    const options = srcField.getOptions?.() ?? [];
    const f = dstForm.createDropdown(name);
    f.addOptions(options.map(String));
    f.addToPage(dstPage);
    try {
      const sel = srcField.getSelected?.();
      if (sel) {
        const val = Array.isArray(sel) ? String(sel[0]) : String(sel);
        f.select(val);
      }
    } catch {}
    setWidgetPageRef(f, dstPage);
  } else if (srcField instanceof PDFOptionList) {
    const options = srcField.getOptions?.() ?? [];
    const f = dstForm.createOptionList(name);
    f.addOptions(options.map(String));
    f.addToPage(dstPage);
    try {
      const sel = srcField.getSelected?.();
      if (sel) {
        if (Array.isArray(sel)) {
          for (const v of sel) { try { f.select(String(v)); } catch {} }
        } else {
          try { f.select(String(sel)); } catch {}
        }
      }
    } catch {}
    setWidgetPageRef(f, dstPage);
  }
}

/**
 * Set the /P (page reference) on a form field's widget annotations so
 * findFieldPage can locate the field. pdf-lib's addToPage puts the widget
 * ref in the page's /Annots but does not necessarily set /P on the widget.
 *
 * Uses page.ref (PDFPage's public ref getter) and page.doc to look up the
 * widget annotation. The looked-up object is a PDFWidgetAnnotation which
 * exposes a setP(pageRef) method.
 */
function setWidgetPageRef(field: any, page: any): void {
  try {
    const pageRef = page.ref;
    if (!pageRef) return;
    const doc = page.doc;
    if (!doc) return;
    const widgets = field.acroField?.getWidgets?.();
    if (!widgets) return;
    const widgetList: any[] = Array.isArray(widgets)
      ? widgets
      : (typeof widgets.size === 'function'
        ? Array.from({ length: widgets.size() }, (_, i: number) => widgets.get(i))
        : []);
    if (widgetList.length === 0) return;
    for (const wRef of widgetList) {
      try {
        const wObj = doc.context.lookup(wRef);
        if (wObj && typeof wObj.setP === 'function') {
          wObj.setP(pageRef);
        } else if (wObj && wObj.dict && typeof wObj.dict.set === 'function') {
          wObj.dict.set(PDFName.of('P'), pageRef);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
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
    const reloaded = await PDFDocument.load(bytes);
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
  // Phase 12: expose page labels set by renumberPages (visible order).
  if (doc.pageLabels && doc.pageLabels.length > 0) {
    state.pageLabels = doc.pageLabels.map((l) => ({ ...l }));
  }
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
    result.push({
      ...field,
      page: newPage,
      id: `form-${visibleIdx}-${field.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
    });
  }
  return result;
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

  // Serialize annotations onto the output doc
  await serializeAnnotations(out, doc.annotations, doc.order);

  // Migrate form fields from source to output document.
  // Page copying does not preserve the AcroForm structure, so we recreate
  // fields on the output pages and restore their values.
  try {
    const srcForm = doc.pdfDoc.getForm();
    const srcFields = srcForm.getFields();
    if (srcFields.length > 0) {
      const dstForm = out.getForm();
      for (const srcField of srcFields) {
        const name = srcField.getName();
        // Find the 0-based source page for this field
        const srcPage = findFieldPage(doc.pdfDoc, srcField);
        const dstPageIdx = pageMap.get(srcPage);
        if (dstPageIdx === undefined) continue; // page was deleted

        try {
          if (srcField instanceof PDFTextField) {
            const f = dstForm.createTextField(name);
            const text = srcField.getText?.() ?? '';
            f.setText(typeof text === 'string' ? text : '');
            f.addToPage(out.getPage(dstPageIdx));
          } else if (srcField instanceof PDFCheckBox) {
            const f = dstForm.createCheckBox(name);
            try { if (srcField.isChecked?.()) f.check(); } catch {}
            f.addToPage(out.getPage(dstPageIdx));
          } else if (srcField instanceof PDFRadioGroup) {
            const options = srcField.getOptions?.() ?? [];
            const f = dstForm.createRadioGroup(name);
            for (const opt of options) {
              f.addOptionToPage(String(opt), out.getPage(dstPageIdx));
            }
            try {
              const sel = srcField.getSelected?.();
              if (sel) f.select(String(sel));
            } catch {}
          } else if (srcField instanceof PDFDropdown) {
            const options = srcField.getOptions?.() ?? [];
            const f = dstForm.createDropdown(name);
            f.addOptions(options.map(String));
            f.addToPage(out.getPage(dstPageIdx));
            try {
              const sel = srcField.getSelected?.();
              if (sel) {
                const val = Array.isArray(sel) ? String(sel[0]) : String(sel);
                f.select(val);
              }
            } catch {}
          } else if (srcField instanceof PDFOptionList) {
            const options = srcField.getOptions?.() ?? [];
            const f = dstForm.createOptionList(name);
            f.addOptions(options.map(String));
            f.addToPage(out.getPage(dstPageIdx));
            try {
              const sel = srcField.getSelected?.();
              if (sel) {
                if (Array.isArray(sel)) {
                  for (const v of sel) { try { f.select(String(v)); } catch {} }
                } else {
                  try { f.select(String(sel)); } catch {}
                }
              }
            } catch {}
          }
        } catch {
          // Skip fields that fail to migrate
        }
      }
    }
  } catch {
    // If form migration fails, save without form fields
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

  // Phase 12 — apply logical page labels to the output catalog's /PageLabels.
  if (doc.pageLabels && doc.pageLabels.length > 0) {
    try {
      applyPageLabels(out, doc.pageLabels);
    } catch {
      // Best-effort — a bad label must not block a save.
    }
  }

  return out.save();
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

  // Migrate form fields
  try {
    const srcForm = doc.pdfDoc.getForm();
    const srcFields = srcForm.getFields();
    if (srcFields.length > 0) {
      const dstForm = out.getForm();
      for (const srcField of srcFields) {
        const name = srcField.getName();
        const srcPage = findFieldPage(doc.pdfDoc, srcField);
        const dstPageIdx = pageMap.get(srcPage);
        if (dstPageIdx === undefined) continue;

        try {
          if (srcField instanceof PDFTextField) {
            const f = dstForm.createTextField(name);
            const text = srcField.getText?.() ?? '';
            f.setText(typeof text === 'string' ? text : '');
            f.addToPage(out.getPage(dstPageIdx));
          } else if (srcField instanceof PDFCheckBox) {
            const f = dstForm.createCheckBox(name);
            try { if (srcField.isChecked?.()) f.check(); } catch {}
            f.addToPage(out.getPage(dstPageIdx));
          } else if (srcField instanceof PDFRadioGroup) {
            const options = srcField.getOptions?.() ?? [];
            const f = dstForm.createRadioGroup(name);
            for (const opt of options) {
              f.addOptionToPage(String(opt), out.getPage(dstPageIdx));
            }
            try {
              const sel = srcField.getSelected?.();
              if (sel) f.select(String(sel));
            } catch {}
          } else if (srcField instanceof PDFDropdown) {
            const options = srcField.getOptions?.() ?? [];
            const f = dstForm.createDropdown(name);
            f.addOptions(options.map(String));
            f.addToPage(out.getPage(dstPageIdx));
            try {
              const sel = srcField.getSelected?.();
              if (sel) {
                const val = Array.isArray(sel) ? String(sel[0]) : String(sel);
                f.select(val);
              }
            } catch {}
          } else if (srcField instanceof PDFOptionList) {
            const options = srcField.getOptions?.() ?? [];
            const f = dstForm.createOptionList(name);
            f.addOptions(options.map(String));
            f.addToPage(out.getPage(dstPageIdx));
            try {
              const sel = srcField.getSelected?.();
              if (sel) {
                if (Array.isArray(sel)) {
                  for (const v of sel) { try { f.select(String(v)); } catch {} }
                } else {
                  try { f.select(String(sel)); } catch {}
                }
              }
            } catch {}
          }
        } catch {
          // Skip fields that fail to migrate
        }
      }
    }
  } catch {
    // If form migration fails, save without form fields
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
  if (doc.pageLabels && doc.pageLabels.length > 0) {
    try {
      applyPageLabels(out, doc.pageLabels);
    } catch {
      // Best-effort.
    }
  }

  const useObjectStreams = preset !== 'none';

  return out.save({ useObjectStreams });
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

    return parseContentStreamText(rawContent);
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
  const objRegex = /(\d+)\s+(\d+)\s+obj/g;
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
  const allObjMatches = [...raw.matchAll(/(\d+)\s+(\d+)\s+obj\s*<<([\s\S]*?)>>/g)];
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
function decodeStream(raw: string, streamObjText: string): string | null {
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
      decoded = hasFlateDecode ? inflateSync(a85) : a85;
    } else if (hasFlateDecode) {
      decoded = inflateSync(streamBytes);
    } else {
      decoded = streamBytes;
    }
    return bytesToByteString(decoded);
  } catch {
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
 * Parse a decoded PDF content stream and extract text from Tj, TJ, '
 * and " operators. Handles both literal strings `(text)` and hexadecimal
 * strings `<hex>`. pdf-lib uses hex strings for fonts with custom
 * encodings (WinAnsiEncoding/PDFDocEncoding).
 */
function parseContentStreamText(content: string): string {
  const parts: string[] = [];

  // Match hex-encoded text: <hex> Tj
  const hexTjRegex = /<([0-9A-Fa-f]*)>\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = hexTjRegex.exec(content)) !== null) {
    const hex = match[1];
    if (hex.length > 0) {
      parts.push(decodeHexString(hex));
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
        parts.push(decodeHexString(hex));
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
      parts.push(decodeHexString(match[2]));
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