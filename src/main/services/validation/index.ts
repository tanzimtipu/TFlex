import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
} from '@cantoo/pdf-lib';
import { err, ok, type Result } from '../../../shared/result';
import type { EngineError } from '../../../shared/types';
import type {
  ValidationErrorCode,
  ValidationReport,
  ValidationTag,
  ValidationTarget,
} from '../../../shared/validation';
import { collectDocumentFacts, evaluatePdfA } from './pdfa';
import { evaluatePdfX } from './pdfx';
import {
  extractXmpPacket,
  extractXmpInfo,
  isRecognisedPdfaId,
  isRecognisedPdfxId,
  pdfaLabel,
  pdfxLabel,
} from './xmp';

/**
 * Phase 54 features D + E — the validation service and the export guard.
 *
 * The service loads a document, reads what its XMP DECLARES, collects the
 * document facts once and runs the matching bounded rule set. It never
 * converts colour, never injects conformance metadata and never strips
 * encryption. A validation that ran returns `ok` with the report even when it
 * found violations; only a validation that could not be attempted at all
 * (unknown target, unreadable document) returns `err` with a typed code.
 */

const VALID_TARGETS: readonly ValidationTarget[] = [
  'pdfa-1b',
  'pdfa-2b',
  'pdfa-3b',
  'pdfx-1a',
  'pdfx-3',
  'pdfx-4',
];

export function isValidationTarget(value: unknown): value is ValidationTarget {
  return typeof value === 'string' && (VALID_TARGETS as readonly string[]).includes(value);
}

/** Read the catalog `/Metadata` XMP packet as decoded bytes, or null. */
function readXmpBytes(doc: PDFDocument): Uint8Array | null {
  // DEF-383 — `lookupMaybe` throws on a wrong-typed value; a wrong-typed
  // /Metadata must degrade to "no declaration", never an `internal` error.
  const raw = doc.catalog.get(PDFName.of('Metadata'), true);
  if (raw === undefined) return null;
  const metadata = doc.context.lookup(raw);
  if (!(metadata instanceof PDFStream)) return null;
  try {
    const stream = PDFRawStream.of(
      metadata.dict,
      metadata.getContents(),
      metadata instanceof PDFRawStream ? metadata.transform : undefined,
    );
    return decodePDFRawStream(stream).decode();
  } catch {
    return null;
  }
}

/** The declared identification label for the target family, or null, plus
 *  whether the declaration names a level this rule set knows (DEF-386). */
function declaredLabel(
  doc: PDFDocument,
  target: ValidationTarget,
): { label: string | null; recognised: boolean } {
  const info = extractXmpInfo(extractXmpPacket(readXmpBytes(doc)));
  if (target.startsWith('pdfa')) {
    if (info.pdfa === null) return { label: null, recognised: true };
    return { label: pdfaLabel(info.pdfa), recognised: isRecognisedPdfaId(info.pdfa) };
  }
  if (info.pdfx === null) return { label: null, recognised: true };
  return { label: pdfxLabel(info.pdfx), recognised: isRecognisedPdfxId(info.pdfx) };
}

export class DocumentValidationService {
  /** Validate raw PDF bytes against a target. */
  async validateBytes(
    bytes: Uint8Array,
    target: ValidationTarget,
  ): Promise<Result<ValidationReport, ValidationErrorCode>> {
    if (!isValidationTarget(target)) {
      return err('unknown-target', `Unknown validation target: ${String(target)}`);
    }
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false,
        throwOnInvalidObject: false,
      });
    } catch (e) {
      return err(
        'unreadable-document',
        `The document could not be parsed for validation: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    try {
      const facts = collectDocumentFacts(doc);
      const standard: 'pdfa' | 'pdfx' = target.startsWith('pdfa') ? 'pdfa' : 'pdfx';
      const declared = declaredLabel(doc, target);
      const violations =
        standard === 'pdfa' ? evaluatePdfA(target, facts) : evaluatePdfX(target, facts);
      // DEF-386 — an unrecognised declared identifier is reported and never
      // paired with `conforms: true` (the warning itself prevents the claim).
      if (declared.label !== null && !declared.recognised) {
        violations.push({
          rule: `${standard}.declared-level`,
          detail: `The declared level "${declared.label}" is not a recognised ${standard === 'pdfa' ? 'PDF/A' : 'PDF/X'} identifier; the declaration cannot be checked against.`,
          severity: 'warning',
        });
      }
      return ok({
        target,
        standard,
        declared: declared.label,
        // `conforms` is true only when this bounded rule set found nothing at
        // all; an undetermined check is a warning, so it prevents a claim.
        conforms: violations.length === 0,
        violations,
      });
    } catch (e) {
      return err(
        'internal',
        `Validation failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Validate an open document by docId, resolving its serialized bytes. */
  async validateDocument(
    docId: string,
    getBytes: (docId: string) => Promise<Result<ArrayBuffer, EngineError>>,
    target: ValidationTarget,
  ): Promise<Result<ValidationReport, ValidationErrorCode>> {
    const result = await getBytes(docId);
    if (!result.ok) {
      return err('unreadable-document', result.error.message);
    }
    return this.validateBytes(new Uint8Array(result.value), target);
  }
}

/** The assessment function the guard calls (injectable for tests). */
export type AssessFn = (
  bytes: Uint8Array,
  target: ValidationTarget,
) => Promise<Result<ValidationReport, ValidationErrorCode>>;

/** The guard outcome. `none` means the target was `none`: no assessment ran. */
export type GuardOutcome<T> =
  | { action: 'none'; report: null; writeResult: T }
  | { action: 'written'; report: ValidationReport; writeResult: T }
  | { action: 'blocked'; report: ValidationReport };

/**
 * Run the export guard for a save.
 *
 *  - `target === 'none'` (the shipped default): the guard is a NO-OP. It does
 *    not assess anything and writes the bytes unchanged, so a user who never
 *    touches the setting sees the exact pre-Phase-54 save path.
 *  - otherwise it assesses once. A document that conforms (or `onViolation`
 *    `'warn'`) is written and the report returned; a violating document under
 *    `'block'` is NOT written and the report is returned.
 *  - an assessment that could not run at all returns `err` and does NOT write
 *    (the user asked for enforcement, so an unvalidated write is refused).
 */
export async function runExportGuard<T>(
  target: ValidationTag,
  onViolation: 'warn' | 'block',
  bytes: Uint8Array,
  write: (bytes: Uint8Array) => Promise<T>,
  assess: AssessFn,
): Promise<Result<GuardOutcome<T>, ValidationErrorCode>> {
  if (target === 'none') {
    const writeResult = await write(bytes);
    return ok({ action: 'none', report: null, writeResult });
  }
  const assessed = await assess(bytes, target);
  if (!assessed.ok) {
    return err(assessed.error.code, assessed.error.message);
  }
  const report = assessed.value;
  if (report.conforms || onViolation === 'warn') {
    const writeResult = await write(bytes);
    return ok({ action: 'written', report, writeResult });
  }
  return ok({ action: 'blocked', report });
}
