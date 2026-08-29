import { readFile } from 'node:fs/promises';
import { err, ok, type Result } from '../../shared/result';
import type { PdfOpenError } from '../../shared/types';

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
  if (buffer.indexOf('/Encrypt') !== -1) {
    return err('encrypted', 'file is encrypted');
  }
  if (buffer.indexOf('startxref') === -1 || buffer.indexOf('%%EOF') === -1) {
    return err('corrupt', 'file has a PDF header but no readable trailer');
  }
  const value = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  void filePath;
  return ok(value as ArrayBuffer);
}
