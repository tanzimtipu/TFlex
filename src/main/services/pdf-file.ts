import { readFile, writeFile } from 'node:fs/promises';
import { err, ok, type Result } from '../../shared/result';
import type { FdfOpenError, PdfOpenError } from '../../shared/types';

const HEADER_WINDOW = 1024;

/**
 * Reads a file from disk and returns its bytes as an ArrayBuffer, with a
 * minimal sniff to classify the usual failure modes. Deliberately does NOT
 * parse the PDF -- rendering is the renderer's job.
 */
export async function loadPdfFile(
  filePath: string,
): Promise<Result<ArrayBuffer, PdfOpenError>> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    return err('io', `could not read: ${filePath}`);
  }
  return sniff(buffer, filePath);
}

export function sniff(buffer: Buffer, filePath: string): Result<ArrayBuffer, PdfOpenError> {
  if (buffer.length === 0) {
    return err('corrupt', 'file is empty');
  }
  const headWindow = buffer.subarray(0, Math.min(buffer.length, HEADER_WINDOW));
  if (headWindow.indexOf('%PDF-') === -1) {
    return err('not-pdf', 'file does not have a %PDF- header');
  }
  // Phase 52 — an /Encrypt marker is NOT a sniff failure: encrypted files
  // are opened by the renderer (pdf.js prompts for the password) and by the
  // engine's password-aware load. If the file is actually corrupt, the
  // engine/pdf.js produces the typed failure instead. The header and
  // trailer checks below still apply.
  if (buffer.indexOf('startxref') === -1 || buffer.indexOf('%%EOF') === -1) {
    return err('corrupt', 'file has a PDF header but no readable trailer');
  }
  const value = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  void filePath;
  return ok(value as ArrayBuffer);
}

/**
 * Phase 12 — Reads an FDF (Forms Data Format) comment file from disk and
 * returns its bytes as an ArrayBuffer. FDF files start with `%FDF-` (not
 * `%PDF-`), so they cannot go through `loadPdfFile`'s PDF header sniff.
 * This path validates the `%FDF-` signature only; the engine's `importFdf`
 * does the structural parse.
 */
export async function loadFdfFile(
  filePath: string,
): Promise<Result<ArrayBuffer, FdfOpenError>> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    return err('io', `could not read: ${filePath}`);
  }
  return sniffFdf(buffer);
}

export function sniffFdf(buffer: Buffer): Result<ArrayBuffer, FdfOpenError> {
  if (buffer.length === 0) {
    return err('corrupt', 'file is empty');
  }
  const headWindow = buffer.subarray(0, Math.min(buffer.length, HEADER_WINDOW));
  // %FDF- is the FDF header signature (e.g. "%FDF-1.2"). Stricter than the
  // bare "%FDF" the parser accepts, so a real FDF file always passes here.
  if (headWindow.indexOf('%FDF-') === -1) {
    return err('not-fdf', 'file does not have a %FDF- header');
  }
  const value = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return ok(value as ArrayBuffer);
}

/**
 * Phase 57 feature B — Reads an FDF or XFDF form-DATA file from disk. An
 * `.xfdf` path returns the raw bytes: the engine's `parseFormXfdf` names a
 * non-XFDF input, and XFDF is XML with no `%FDF-` signature. Any other path
 * keeps the `%FDF-` signature check used by the comment path.
 */
export async function loadFormDataFile(
  filePath: string,
): Promise<Result<ArrayBuffer, FdfOpenError>> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    return err('io', `could not read: ${filePath}`);
  }
  if (filePath.toLowerCase().endsWith('.xfdf')) {
    if (buffer.length === 0) {
      return err('corrupt', 'file is empty');
    }
    const value = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return ok(value as ArrayBuffer);
  }
  return sniffFdf(buffer);
}

/**
 * Phase 57 feature B — Write form-DATA bytes (FDF or XFDF) to disk. Throws
 * on an io failure; the caller maps that to a typed `io` error.
 */
export async function writeFormDataFile(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeFile(filePath, bytes);
}
