import { readFile, writeFile } from 'node:fs/promises';
import { degrees, PDFCheckBox, PDFDocument, PDFDropdown, PDFName, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import { err, ok, type Result } from '../../shared/result';
import type {
  AnnModel,
  CreateAnnotationPayload,
  EditAnnotationPayload,
  EngineError,
  EngineState,
  FillFormFieldPayload,
  FormField,
  MoveSignaturePayload,
  OpEntry,
  PlaceSignaturePayload,
  SignaturePlacement,
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
  fillFormField,
  findFieldPage,
  flattenForm,
  getFormFields,
  restoreFormFieldsFromSnapshot,
  snapshotAllFormFields,
  type FormSnapshotEntry,
} from './forms';

// ---------------------------------------------------------------------------
// Internal document state
// ---------------------------------------------------------------------------

interface Snapshot {
  order: number[];
  deleted: boolean[];
  rotations: number[];
  annotations: AnnModel[][];
  placedSignatures: SignaturePlacement[];
  /** Snapshot of form field values for undo. Keyed by field id. */
  formFields?: FormField[];
  /** Rich form snapshot for rebuilding fields after flatten (DEF-028). */
  snapFormFields?: FormSnapshotEntry[];
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
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class EngineService {
  private docs = new Map<string, EngineDoc>();

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
      const doc: EngineDoc = {
        pdfDoc,
        order: Array.from({ length: count }, (_, i) => i),
        deleted: Array.from({ length: count }, () => false),
        rotations: Array.from({ length: count }, () => 0),
        annotations,
        undoStack: [],
        redoStack: [],
        path: filePath,
        modified: false,
        placedSignatures,
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
      const doc: EngineDoc = {
        pdfDoc,
        order: Array.from({ length: count }, (_, i) => i),
        deleted: Array.from({ length: count }, () => false),
        rotations: Array.from({ length: count }, () => 0),
        annotations,
        undoStack: [],
        redoStack: [],
        path: '',
        modified: false,
        placedSignatures,
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
    const current = snapshotDoc(doc);
    const prev = doc.undoStack.pop()!;
    doc.redoStack.push(current);
    restoreSnapshot(doc, prev);
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
    const current = snapshotDoc(doc);
    const next = doc.redoStack.pop()!;
    doc.undoStack.push(current);
    restoreSnapshot(doc, next);
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
      serializeAnnotations(splitDoc, splitAnns, Array.from({ length: splitAnns.length }, (_, i) => i));
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
      serializeAnnotations(extractDoc, extractAnns, Array.from({ length: extractAnns.length }, (_, i) => i));
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
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
    formFields: tryGetFormFields(doc),
    // DEF-028: capture rich form snapshot so flatten+undo can rebuild fields
    snapFormFields: trySnapshotAllFormFields(doc),
  };
}

function restoreSnapshot(doc: EngineDoc, snap: Snapshot): void {
  doc.order = [...snap.order];
  doc.deleted = [...snap.deleted];
  doc.rotations = [...snap.rotations];
  doc.annotations = cloneAnnotations(snap.annotations);
  doc.placedSignatures = snap.placedSignatures.map((sp) => ({
    ...sp,
    rect: { ...sp.rect },
  }));

  // DEF-028: if we have a rich form snapshot, use it to restore form fields
  // (rebuilding from scratch if the form was flattened). Otherwise fall back
  // to value-only restore.
  if (snap.snapFormFields && snap.snapFormFields.length > 0) {
    tryRestoreFormFieldsFromSnap(doc, snap.snapFormFields);
  } else if (snap.formFields) {
    tryRestoreFormFields(doc, snap.formFields);
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
    const rotation = doc.rotations[origIdx];
    if (rotation !== 0) {
      copied.setRotation(degrees(rotation * 90));
    }
    out.addPage(copied);
    pageMap.set(origIdx, idx);
  }

  // Serialize annotations onto the output doc
  serializeAnnotations(out, doc.annotations, doc.order);

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

  return out.save();
}

/**
 * Serialize signature placement metadata into the output PDF's Keywords
 * field (document Info dictionary) so parseSignaturesFromDoc can rebuild
 * the placements on reload. The Keywords field contains a JSON array with
 * id, signatureId, page, rect, and base64-encoded PNG bytes. (DEF-030)
 */
function serializeSignatureMetadata(
  out: PDFDocument,
  placements: SignaturePlacement[],
): void {
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
    // Prefix with a marker so we can detect our data on reload without
    // interfering with user-defined keywords.
    out.setKeywords(['TFLEXSIG:' + jsonStr]);
  } catch {
    // Best-effort: if serialization fails, the drawn images still persist
  }
}

/**
 * Parse signature placement metadata from a loaded PDFDocument by reading
 * the Keywords field from the document Info dictionary. Returns an empty
 * array if no metadata is found. (DEF-030)
 */
function parseSignaturesFromDoc(pdfDoc: PDFDocument): SignaturePlacement[] {
  try {
    const keywords = pdfDoc.getKeywords();
    if (!keywords) return [];
    // getKeywords returns string[]; we look for the TFLEXSIG: prefix
    let markerStr: string | undefined;
    if (Array.isArray(keywords)) {
      markerStr = keywords.find((k) => k.startsWith('TFLEXSIG:'));
    } else if (typeof keywords === 'string') {
      markerStr = keywords.startsWith('TFLEXSIG:') ? keywords : undefined;
    }
    if (!markerStr) return [];

    const jsonStr = markerStr.slice('TFLEXSIG:'.length);
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
  } catch {
    return [];
  }
}