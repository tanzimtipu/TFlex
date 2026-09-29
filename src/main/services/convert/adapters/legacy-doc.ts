import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ConvertResult, ConvertWarning } from '../../../../shared/convert';
import { ConvertCancelledError, ConvertFailure } from '../errors';
import { CONVERT_LIMITS } from '../limits';
import type { ConversionAdapter, ConvertAdapterContext } from '../registry';
import {
  blockedResourceWarnings,
  printHtmlToPdf,
  type HtmlPrintFn,
} from '../html-print';
import { injectSecurityMeta } from '../templates';
import { CfbError, CompoundFile, isCfb } from '../convert-cfb';
import { wrapOfficeDocument } from './docx';

export { isCfb } from '../convert-cfb';

/**
 * Phase 55 feature A — legacy binary Word (`.doc`).
 *
 * A `.doc` is an OLE/CFB container, not a ZIP, and there is no faithful pure-JS
 * layout reader. This is a BOUNDED best-effort text recovery: the shared CFB
 * walker in `convert-cfb.ts` (also used by the legacy `.ppt` path) locates the
 * `WordDocument` stream, then the FIB's piece table is honoured when present,
 * falling back to the simple `fcMin`/`fcMac` range. The result is a text-only
 * degraded import; the adapter must never present it as a faithful conversion.
 */

const MAX_RECOVERED_CHARS = 32 * 1024 * 1024;

/** True when the head is a CFB container holding a `WordDocument` directory
 *  entry (the name is UTF-16LE in the directory sector). */
export function looksLikeLegacyDoc(path: string, head: Buffer): boolean {
  if (!isCfb(head)) return false;
  if (extname(path).toLowerCase() === '.doc') return true;
  return head.includes(Buffer.from('WordDocument', 'utf16le'));
}

function u16(buf: Uint8Array, offset: number): number {
  if (offset + 2 > buf.length) throw new CfbError('truncated CFB field');
  return buf[offset] | (buf[offset + 1] << 8);
}

function u32(buf: Uint8Array, offset: number): number {
  if (offset + 4 > buf.length) throw new CfbError('truncated CFB field');
  return (
    (buf[offset] |
      (buf[offset + 1] << 8) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 24)) >>>
    0
  );
}

/** How the text was recovered — recorded in the warning's detail. */
export type DocRecoveryMethod = 'piece-table' | 'simple';

export interface DocRecovery {
  text: string;
  method: DocRecoveryMethod;
}

function decodeWordBytes(raw: Uint8Array, utf16: boolean): string {
  if (utf16) return Buffer.from(raw).toString('utf16le');
  try {
    return new TextDecoder('windows-1252').decode(raw);
  } catch {
    return Buffer.from(raw).toString('latin1');
  }
}

/** Reconstruct text from the FIB's piece table (fast-saved / complex files). */
function readPieceTable(word: Uint8Array, table: Uint8Array): string | null {
  const fcClx = u32(word, 0x01a2);
  const lcbClx = u32(word, 0x01a6);
  if (lcbClx === 0 || fcClx + lcbClx > table.length) return null;
  const clx = table.subarray(fcClx, fcClx + lcbClx);

  let index = 0;
  let plc: Uint8Array | null = null;
  while (index < clx.length) {
    const kind = clx[index];
    if (kind === 0x01) {
      if (index + 3 > clx.length) break;
      const length = u16(clx, index + 1);
      index += 3 + length;
      continue;
    }
    if (kind === 0x02) {
      if (index + 5 > clx.length) break;
      const length = u32(clx, index + 1);
      if (index + 5 + length > clx.length) return null;
      plc = clx.subarray(index + 5, index + 5 + length);
      break;
    }
    break;
  }
  if (plc === null) return null;

  const pieces = Math.floor((plc.length - 4) / 12);
  if (pieces <= 0) return null;
  const pcdBase = (pieces + 1) * 4;
  let out = '';
  let chars = 0;
  for (let k = 0; k < pieces; k += 1) {
    const count = u32(plc, (k + 1) * 4) - u32(plc, k * 4);
    if (count <= 0) continue;
    chars += count;
    if (chars > MAX_RECOVERED_CHARS) break;
    const fc = u32(plc, pcdBase + k * 8 + 2);
    if ((fc & 0x40000000) !== 0) {
      const start = (fc & 0x3fffffff) >>> 1;
      if (start + count > word.length) continue;
      out += decodeWordBytes(word.subarray(start, start + count), false);
    } else {
      const offset = fc & 0x3fffffff;
      if (offset + count * 2 > word.length) continue;
      out += Buffer.from(word.subarray(offset, offset + count * 2)).toString('utf16le');
    }
  }
  return out.length > 0 ? out : null;
}

/** Recover text from the `WordDocument` stream, or null when there is none. */
export function recoverDocText(doc: CompoundFileLike): DocRecovery | null {
  const word = doc.read('WordDocument');
  if (word === null || word.length < 32) return null;
  if (u16(word, 0) !== 0xa5ec) return null;
  const flags = u16(word, 0x0a);
  // Encrypted or obfuscated: refuse rather than emit garbage.
  if ((flags & 0x0100) !== 0 || (flags & 0x8000) !== 0) return null;
  const fComplex = (flags & 0x0004) !== 0;
  const fWhichTblStm = (flags & 0x0200) !== 0;
  const fExtChar = (flags & 0x1000) !== 0;

  if (fComplex) {
    const table = doc.read(fWhichTblStm ? '1Table' : '0Table');
    if (table !== null) {
      const text = readPieceTable(word, table);
      if (text !== null) return { text, method: 'piece-table' };
    }
  }

  const fcMin = u32(word, 0x18);
  const fcMac = u32(word, 0x1c);
  if (fcMac > fcMin && fcMac <= word.length) {
    return {
      text: decodeWordBytes(word.subarray(fcMin, fcMac), fExtChar),
      method: 'simple',
    };
  }
  return null;
}

/** The single method the recovery needs (keeps the walker swappable in tests). */
export interface CompoundFileLike {
  read(name: string): Uint8Array | null;
}

/** Normalise Word's in-text control characters into plain text. */
export function cleanWordText(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x0d || code === 0x0b || code === 0x0c || code === 0x0a) {
      out += '\n';
      continue;
    }
    if (code === 0x07 || code === 0x09) {
      out += '\t';
      continue;
    }
    if (code === 0x1e) {
      out += '-';
      continue;
    }
    if (code === 0xa0) {
      out += ' ';
      continue;
    }
    if (code === 0x13 || code === 0x14 || code === 0x15) continue;
    if (code < 0x20) continue;
    out += character;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the legacy `.doc` adapter. `print` and `maxBytes` are injectable for
 * unit tests. Fidelity is ALWAYS `degraded` and the `legacy-format-degraded`
 * warning names exactly what was and was not recovered.
 */
export function createLegacyDocAdapter(
  print: HtmlPrintFn = printHtmlToPdf,
  maxBytes: number = CONVERT_LIMITS.docBytes,
): ConversionAdapter {
  return {
    id: 'doc',
    label: 'Legacy Word document (.doc)',
    extensions: ['.doc'],
    capabilities: { canImport: true, canExport: false },
    fidelity: 'degraded',
    specificity: 'specific',
    maxBytes,

    sniff(path: string, head: Buffer): boolean {
      return looksLikeLegacyDoc(path, head);
    },

    async convert(ctx: ConvertAdapterContext): Promise<ConvertResult> {
      const { path, options, signal, onProgress } = ctx;
      const info = await stat(path);
      if (info.size > maxBytes) throw new ConvertFailure('too-large');
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('decoding', 0.1);
      const bytes = await readFile(path);
      let doc: CompoundFile;
      try {
        doc = new CompoundFile(new Uint8Array(bytes));
      } catch (thrown) {
        throw new ConvertFailure(
          'corrupt',
          `The legacy Word container could not be read: ${
            thrown instanceof Error ? thrown.message : String(thrown)
          }`,
        );
      }

      const recovered = recoverDocText(doc);
      if (recovered === null) {
        throw new ConvertFailure(
          'decode-failed',
          'No readable text could be recovered from this legacy Word document. It may be encrypted or use an unsupported word-processing format.',
        );
      }
      const text = cleanWordText(recovered.text);
      if (text.trim().length === 0) {
        throw new ConvertFailure(
          'decode-failed',
          'The legacy Word document contained no recoverable text.',
        );
      }
      if (signal?.aborted) throw new ConvertCancelledError();

      onProgress?.('laying-out', 0.5);
      const html = injectSecurityMeta(
        wrapOfficeDocument(`<pre>${escapeText(text)}</pre>`),
      );
      const printed = await print(html, {
        pageSize: options.pageSize,
        marginMm: options.marginMm,
        printBackground: options.htmlPrintBackgrounds,
      });
      if (!printed.ok) {
        throw new ConvertFailure(printed.error.code, printed.error.message);
      }

      const warnings: ConvertWarning[] = [
        {
          code: 'legacy-format-degraded',
          message:
            'This legacy .doc file was imported as extracted text only. Headings, lists, tables, images, inline styling, columns and page layout could not be recovered.',
          detail: `Recovered ${text.length} character(s) via ${
            recovered.method === 'piece-table'
              ? 'the Word piece table'
              : 'the simple fcMin/fcMac range'
          }.`,
        },
        ...blockedResourceWarnings(printed.value.blockedUrls),
      ];

      onProgress?.('done', 1);
      return {
        bytes: printed.value.bytes,
        pageCount: printed.value.pageCount,
        sourceFormat: 'doc',
        fidelity: 'degraded',
        warnings,
        title: basename(path, extname(path)),
      };
    },
  };
}

/** The shipped adapter; the registry loads this one. */
export const legacyDocAdapter: ConversionAdapter = createLegacyDocAdapter();
