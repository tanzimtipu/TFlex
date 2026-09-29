import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { ok, type Result } from '../../../shared/result';
import type {
  ConvertErrorCode,
  ConvertManyResult,
  ConvertOpenResult,
  ConvertOptions,
  ConvertProgress,
  ConvertSourceInfo,
  CsvFieldMappingResult,
  ConvertWarning,
} from '../../../shared/convert';
import type {
  FillFormFieldPayload,
  FormField,
  ImageImportDefaults,
  OfficeConvertDefaults,
} from '../../../shared/types';
import { stampBrandMetadata } from '../engine';
import { convertError, mapAdapterThrow, CONVERT_ERROR_MESSAGES } from './errors';
import { resolveConvertOptions, type ResolvedConvertOptions } from './limits';
import {
  createDefaultRegistry,
  readSniffHead,
  type ConvertRegistry,
} from './registry';

/**
 * Phase 53 — DocumentConversionService.
 *
 * Owns the adapter registry and the conversion job map. Every import produces
 * PDF bytes and hands them to the EXISTING engine (`loadDocumentBytes`) in the
 * same process — no `ipcMain` hop and no second document model (ruling 1).
 * Nothing here throws across IPC: every failure is a typed `Result` (ruling 4).
 */

/** The slice of the engine the service needs; keeps the coupling narrow. */
export interface ConvertEnginePort {
  loadDocumentBytes(
    docId: string,
    bytes: Uint8Array,
    password?: string,
  ): Promise<Result<ArrayBuffer, string>>;
  /** Phase 53 feature G mode 2 - the EXISTING forms reader. Optional so the
   *  conversion tests can keep using a bytes-only stub. */
  getFormFields?(docId: string): Promise<Result<FormField[], string>>;
  /** The EXISTING forms writer; no second writer exists in this chunk. */
  fillFormField?(
    docId: string,
    payload: FillFormFieldPayload,
  ): Promise<Result<unknown, string>>;
}

export interface DocumentConversionServiceOptions {
  engine: ConvertEnginePort;
  registry?: ConvertRegistry;
  /** Progress sink; index.ts forwards it to the invoking window. */
  emitProgress?: (progress: ConvertProgress) => void;
  /**
   * DEF-388 — the stored `officeConvertDefaults` Settings block, read per call
   * so a settings change takes effect on the next import. When present, the
   * service resolves the spreadsheet/presentation import keys from it (an
   * explicit caller option still wins). Omitting it leaves the built-in
   * `DEFAULT_CONVERT_OPTIONS`, which keeps every pre-existing test unchanged.
   */
  getOfficeConvertDefaults?: () => OfficeConvertDefaults;
  /**
   * The stored `imageImportDefaults` Settings block (DEF-388 defect class), read
   * per call so a settings change takes effect on the next import. When present,
   * the service resolves `imagePageSizeMode` / `imageFixedPageSize` / `imageFit`
   * / `imageRotationDeg` from it (an explicit caller option still wins).
   * Omitting it leaves the built-in `DEFAULT_CONVERT_OPTIONS`.
   */
  getImageImportDefaults?: () => ImageImportDefaults;
}

export class DocumentConversionService {
  private readonly engine: ConvertEnginePort;
  private readonly registry: ConvertRegistry;
  private readonly emitProgress?: (progress: ConvertProgress) => void;
  private readonly getOfficeConvertDefaults?: () => OfficeConvertDefaults;
  private readonly getImageImportDefaults?: () => ImageImportDefaults;
  private readonly jobs = new Map<string, AbortController>();

  constructor(options: DocumentConversionServiceOptions) {
    this.engine = options.engine;
    this.registry = options.registry ?? createDefaultRegistry();
    this.emitProgress = options.emitProgress;
    this.getOfficeConvertDefaults = options.getOfficeConvertDefaults;
    this.getImageImportDefaults = options.getImageImportDefaults;
  }

  /** Resolve a caller's partial options against the built-in defaults and the
   *  stored office/image settings (DEF-388). */
  private resolveOptions(raw?: ConvertOptions): ResolvedConvertOptions {
    return resolveConvertOptions(
      raw,
      this.getOfficeConvertDefaults?.(),
      this.getImageImportDefaults?.(),
    );
  }

  /** Format, label and declared fidelity, known before conversion. */
  async sourceInfo(
    path: string,
  ): Promise<Result<ConvertSourceInfo, ConvertErrorCode>> {
    try {
      const head = await readSniffHead(path);
      const resolved = await this.registry.resolve(path, head);
      if (resolved === null) return convertError('unsupported-format');
      const info = await stat(path);
      if (info.size === 0) return convertError('empty-file');
      return ok({
        format: resolved.adapter.id,
        label: resolved.adapter.label,
        fidelity: resolved.adapter.fidelity,
      });
    } catch (thrown) {
      return mapAdapterThrow(thrown);
    }
  }

  /** Convert then open in the existing engine. The renderer creates `docId`;
   *  it doubles as the job id so `cancel` can reach the in-flight run. */
  async toDocument(
    docId: string,
    path: string,
    options?: ConvertOptions,
  ): Promise<Result<ConvertOpenResult, ConvertErrorCode>> {
    const controller = new AbortController();
    this.jobs.set(docId, controller);
    try {
      const head = await readSniffHead(path);
      const resolved = await this.registry.resolve(path, head);
      if (resolved === null) return convertError('unsupported-format');
      const adapter = resolved.adapter;

      const info = await stat(path);
      if (info.size === 0) return convertError('empty-file');
      if (adapter.maxBytes !== undefined && info.size > adapter.maxBytes) {
        return convertError('too-large');
      }

      const written = await adapter.convert({
        path,
        options: this.resolveOptions(options),
        head,
        signal: controller.signal,
        onProgress: (phase, ratio) => this.emit(docId, phase, ratio),
      });
      if (controller.signal.aborted) return convertError('cancelled');

      this.emit(docId, 'opening');
      const opened = await this.openInEngine(docId, written.bytes);
      if (!opened.ok) return opened;
      return ok({
        docId,
        pageCount: written.pageCount,
        sourceFormat: written.sourceFormat,
        fidelity: written.fidelity,
        warnings: written.warnings,
        title: written.title,
      });
    } catch (thrown) {
      return mapAdapterThrow(thrown);
    } finally {
      this.jobs.delete(docId);
    }
  }

  /**
   * Phase 54 criterion 1 — convert N paths into ONE document in the given
   * order. Each path goes through its own adapter (the same `convert` path
   * `toDocument` uses); a file whose adapter cannot participate in a multi-file
   * document fails the WHOLE request with `unsupported-format` naming the path,
   * so no partial document is ever registered. The merged bytes enter the
   * engine through the SAME `openInEngine` call `toDocument` uses.
   */
  async toDocumentMany(
    docId: string,
    paths: string[],
    options?: ConvertOptions,
  ): Promise<Result<ConvertManyResult, ConvertErrorCode>> {
    const controller = new AbortController();
    this.jobs.set(docId, controller);
    try {
      if (paths.length === 0) {
        return convertError('empty-file', 'No files were selected for import.');
      }
      const resolvedOptions = this.resolveOptions(options);
      const parts: Array<{
        bytes: Uint8Array;
        pageCount: number;
        format: ConvertManyResult['sourceFormats'][number];
        fidelity: ConvertManyResult['fidelity'];
        warnings: ConvertWarning[];
      }> = [];

      for (const path of paths) {
        const head = await readSniffHead(path);
        const resolved = await this.registry.resolve(path, head);
        if (resolved === null) {
          return convertError(
            'unsupported-format',
            `${CONVERT_ERROR_MESSAGES['unsupported-format']} (${basename(path)})`,
          );
        }
        const adapter = resolved.adapter;
        if (adapter.supportsMultiFile !== true) {
          return convertError(
            'unsupported-format',
            `This file type cannot be combined into one document. (${basename(path)})`,
          );
        }
        const info = await stat(path);
        if (info.size === 0) return convertError('empty-file');
        if (adapter.maxBytes !== undefined && info.size > adapter.maxBytes) {
          return convertError('too-large');
        }
        const written = await adapter.convert({
          path,
          options: resolvedOptions,
          head,
          signal: controller.signal,
          onProgress: (phase, ratio) => this.emit(docId, phase, ratio),
        });
        if (controller.signal.aborted) return convertError('cancelled');
        parts.push({
          bytes: written.bytes,
          pageCount: written.pageCount,
          format: written.sourceFormat,
          fidelity: written.fidelity,
          warnings: written.warnings,
        });
      }

      this.emit(docId, 'opening');
      const merged = await mergePdfParts(parts.map((part) => part.bytes));
      const opened = await this.openInEngine(docId, merged);
      if (!opened.ok) return opened;

      const warnings = parts.flatMap((part) => part.warnings);
      const fidelity = parts.some((part) => part.fidelity === 'degraded')
        ? 'degraded'
        : parts.some((part) => part.fidelity === 'layout')
          ? 'layout'
          : 'native';
      return ok({
        docId,
        pageCount: parts.reduce((sum, part) => sum + part.pageCount, 0),
        sourceFormats: parts.map((part) => part.format),
        fidelity,
        warnings,
        title: basename(paths[0]).replace(/\.[^.]+$/, ''),
      });
    } catch (thrown) {
      return mapAdapterThrow(thrown);
    } finally {
      this.jobs.delete(docId);
    }
  }

  /** Hand produced bytes to the EXISTING engine (one document model). */
  private async openInEngine(
    docId: string,
    bytes: Uint8Array,
  ): Promise<Result<void, ConvertErrorCode>> {
    const loaded = await this.engine.loadDocumentBytes(docId, bytes);
    if (!loaded.ok) {
      return convertError(
        'internal',
        `The converted document could not be opened: ${loaded.error.message}`,
      );
    }
    return ok(undefined);
  }

  /** Abort an in-flight conversion. Safe to call for an unknown job. */
  cancel(jobId: string): void {
    this.jobs.get(jobId)?.abort();
  }

  /** Phase 53 feature G mode 2 - map CSV headers onto the fields of an ALREADY
   *  OPEN document. Reads and writes through the engine's existing
   *  `getFormFields` / `fillFormField`; it never opens the document itself and
   *  never writes bytes. Matching is exact name first, then case-insensitive;
   *  an unmatched header and a field with no column are reported, not errors. */
  async csvToDocumentFields(
    docId: string,
    path: string,
    options?: ConvertOptions,
  ): Promise<Result<CsvFieldMappingResult, ConvertErrorCode>> {
    try {
      const resolved = this.resolveOptions(options);
      // Settings gate: when CSV form mapping is off, this is a deliberate no-op.
      if (!resolved.csvFormMapping) {
        return ok({
          matched: [],
          unmatchedHeaders: [],
          missingFields: [],
          filled: 0,
          warnings: [],
        });
      }
      if (
        this.engine.getFormFields === undefined ||
        this.engine.fillFormField === undefined
      ) {
        return convertError(
          'internal',
          'The engine does not expose form-field access.',
        );
      }

      const fieldsResult = await this.engine.getFormFields(docId);
      if (!fieldsResult.ok) {
        return convertError('internal', fieldsResult.error.message);
      }
      const fields = fieldsResult.value;

      const head = await readSniffHead(path);
      const info = await stat(path);
      if (info.size === 0) return convertError('empty-file');

      // Lazy import keeps the parser (and its decoder) out of cold start.
      const { readCsvMappingGrid } = await import('./adapters/csv');
      const grid = await readCsvMappingGrid(path, head, resolved.csvDelimiter);
      if (grid.header === null) return convertError('empty-file');

      const exact = new Map<string, FormField>();
      const lower = new Map<string, FormField>();
      for (const field of fields) {
        if (!exact.has(field.name)) exact.set(field.name, field);
        const key = field.name.toLowerCase();
        if (!lower.has(key)) lower.set(key, field);
      }

      const matched: string[] = [];
      const unmatchedHeaders: string[] = [];
      const usedIds = new Set<string>();
      const warnings: ConvertWarning[] = [];
      let filled = 0;
      const values = grid.firstRow ?? [];

      for (let index = 0; index < grid.header.length; index += 1) {
        const rawHeader = grid.header[index];
        const header = rawHeader.trim();
        const field =
          exact.get(header) ?? lower.get(header.toLowerCase()) ?? null;
        if (field === null) {
          unmatchedHeaders.push(rawHeader);
          continue;
        }
        matched.push(field.name);
        usedIds.add(field.id);
        const write = await this.engine.fillFormField(docId, {
          id: field.id,
          value: values[index] ?? '',
        });
        if (write.ok) {
          filled += 1;
        } else {
          warnings.push({
            code: 'partial-content',
            message: `Field "${field.name}" could not be filled.`,
            detail: write.error.message,
          });
        }
      }

      const missingFields = fields
        .filter((field) => !usedIds.has(field.id))
        .map((field) => field.name);
      if (grid.hasMoreDataRows) {
        warnings.push({
          code: 'partial-content',
          message: 'More than one data row was present; only the first was applied.',
        });
      }

      return ok({ matched, unmatchedHeaders, missingFields, filled, warnings });
    } catch (thrown) {
      return mapAdapterThrow(thrown);
    }
  }

  private emit(jobId: string, phase: string, ratio?: number): void {
    this.emitProgress?.({ jobId, phase, ratio });
  }
}

/** Phase 54 — compose N adapter-produced PDFs into ONE document, in order. */
async function mergePdfParts(parts: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of parts) {
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  stampBrandMetadata(merged);
  return merged.save();
}
