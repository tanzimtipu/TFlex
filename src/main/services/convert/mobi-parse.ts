import { ConvertCancelledError, ConvertFailure } from './errors';

/**
 * Phase 56 feature B — the pure Mobipocket (`.mobi`/`.azw`) and KF8 (`.azw3`)
 * container parser.
 *
 * A Mobipocket file is a PalmDB (PalmDOC) database: a 78-byte header, a record
 * table and a list of records. Record 0 is the header block (PalmDOC header,
 * an optional EXTH block and the MOBI header); records 1..N hold the text, each
 * PalmDOC/LZ77-compressed; later records hold the images the text references by
 * `recindex`. A KF8 container carries a BOUNDARY record whose uid is
 * `0xFFFFFFFF`; everything after it is the KF8 (HTML-ish) part.
 *
 * This module is pure (no I/O, no Electron) so the adapter and the unit tests
 * share one implementation. A protected e-book is refused BEFORE any record is
 * decompressed: the app never attempts to decrypt. This is the parser's core
 * guarantee, and it is why the DRM check runs first.
 *
 * No XML/HTML dependency is added; PalmDOC decompression is implemented here.
 */

/** Compression codes in the PalmDOC header (record 0, offset 0). */
export const MOBI_COMPRESSION_NONE = 1;
export const MOBI_COMPRESSION_PALMDOC = 2;
export const MOBI_COMPRESSION_HUFFCDIC = 17480;

/** Hard ceiling on the total decompressed text (the spec's 32 MB bound). */
export const MAX_MOBI_TEXT_BYTES = 32 * 1024 * 1024;
/** Hard ceiling on one inlined image record. */
export const MAX_MOBI_IMAGE_BYTES = 16 * 1024 * 1024;

/** The readable refusal every DRM path throws. */
export const MOBI_DRM_MESSAGE =
  'This e-book is DRM-protected; Jovrel never decrypts protected e-books.';

const PALMDB_HEADER_BYTES = 78;
const PALMDB_RECORD_INFO_BYTES = 8;
/** The uid a KF8 BOUNDARY record carries (its record-info attributes field). */
const BOUNDARY_UID = 0xffffffff;
const MOBI_MAGIC = 'MOBI';
const EXTH_MAGIC = 'EXTH';
/** The first image record index sits at MOBI-relative +0x5C — record-0 absolute
 *  +108 when the MOBI header starts at offset 16. Guarded by the header length. */
const MOBI_IMAGE_INDEX_OFFSET = 0x5c;

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** One PalmDB record-table entry: the byte range it names and its uid. */
export interface PalmRecord {
  offset: number;
  length: number;
  uid: number;
}

export interface PalmDb {
  /** The 32-byte database name (NUL-terminated), trimmed. */
  name: string;
  records: PalmRecord[];
  bytes: Uint8Array;
}

/**
 * Read the PalmDB header and record table. The record count is bounded by the
 * u16 field and by the file itself, and every record offset must be inside the
 * file and monotonic, so a truncated table or an offset past the buffer is a
 * typed `corrupt` failure rather than a read past the end.
 */
export function parsePalmDb(bytes: Uint8Array): PalmDb {
  if (bytes.length < PALMDB_HEADER_BYTES) {
    throw new ConvertFailure(
      'corrupt',
      'The Mobipocket file is too short to hold a PalmDB header.',
    );
  }
  const name = ascii(bytes, 0, 32).replace(/\0.*$/, '').trim();
  const numRecords = u16(bytes, 76);
  const tableEnd = PALMDB_HEADER_BYTES + numRecords * PALMDB_RECORD_INFO_BYTES;
  if (numRecords < 1 || tableEnd > bytes.length) {
    throw new ConvertFailure(
      'corrupt',
      `The Mobipocket record table (${numRecords} record(s)) does not fit the file.`,
    );
  }

  const records: PalmRecord[] = [];
  for (let i = 0; i < numRecords; i += 1) {
    const at = PALMDB_HEADER_BYTES + i * PALMDB_RECORD_INFO_BYTES;
    const offset = u32(bytes, at);
    const uid = u32(bytes, at + 4);
    const next =
      i + 1 < numRecords
        ? u32(bytes, PALMDB_HEADER_BYTES + (i + 1) * PALMDB_RECORD_INFO_BYTES)
        : bytes.length;
    if (
      offset > bytes.length ||
      offset < tableEnd ||
      next < offset ||
      next > bytes.length
    ) {
      throw new ConvertFailure(
        'corrupt',
        `Mobipocket record ${i} points outside the file (offset ${offset}).`,
      );
    }
    records.push({ offset, length: next - offset, uid });
  }
  return { name, records, bytes };
}

/** The record at `index`, or a typed `corrupt` failure when it is absent. */
function recordBytes(db: PalmDb, index: number): Uint8Array {
  const record = db.records[index];
  if (record === undefined) {
    throw new ConvertFailure('corrupt', `Mobipocket record ${index} is missing.`);
  }
  return db.bytes.subarray(record.offset, record.offset + record.length);
}

/** The record at `index`, or null when it is absent (a non-fatal lookup). */
function rawRecord(db: PalmDb, index: number): Uint8Array | null {
  const record = db.records[index];
  if (record === undefined) return null;
  return db.bytes.subarray(record.offset, record.offset + record.length);
}

/** The 16-byte PalmDOC header at record 0, offset 0. */
export interface PalmDocHeader {
  compression: number;
  textLength: number;
  recordCount: number;
  recordSize: number;
  encryptionType: number;
}

export function parsePalmDocHeader(record0: Uint8Array): PalmDocHeader {
  if (record0.length < 16) {
    throw new ConvertFailure('corrupt', 'The Mobipocket header record is truncated.');
  }
  return {
    compression: u16(record0, 0),
    textLength: u32(record0, 4),
    recordCount: u16(record0, 8),
    recordSize: u16(record0, 10),
    encryptionType: u16(record0, 12),
  };
}

/** One EXTH record: `type`, and its data (a record's length field counts the
 *  8-byte type/length pair plus this data). */
export interface ExthRecord {
  type: number;
  data: Uint8Array;
}

export interface ExthBlock {
  start: number;
  end: number;
  records: ExthRecord[];
}

/** Parse an EXTH block when `EXTH` sits exactly at `start`; else null. */
export function parseExth(record0: Uint8Array, start: number): ExthBlock | null {
  if (start + 12 > record0.length) return null;
  if (ascii(record0, start, start + 4) !== EXTH_MAGIC) return null;
  const length = u32(record0, start + 4);
  const count = u32(record0, start + 8);
  const end = start + length;
  if (length < 12 || end > record0.length) return null;
  const records: ExthRecord[] = [];
  let at = start + 12;
  for (let i = 0; i < count && at + 8 <= end; i += 1) {
    const type = u32(record0, at);
    const size = u32(record0, at + 4);
    if (size < 8 || at + size > end) break;
    records.push({ type, data: record0.subarray(at + 8, at + size) });
    at += size;
  }
  return { start, end, records };
}

/** The MOBI header block: where it starts and the fields this parser needs. */
export interface MobiHeader {
  start: number;
  headerLength: number;
  /** 65001 = UTF-8, 1252 = CP1252. */
  textEncoding: number;
  /** Absolute record index of the first image, or null when the declared
   *  header length does not reach the field. */
  firstImageRecord: number | null;
}

function readMobiFields(record0: Uint8Array, start: number): MobiHeader {
  const headerLength = u32(record0, start + 4);
  const textEncoding = u32(record0, start + 12);
  const field = start + MOBI_IMAGE_INDEX_OFFSET;
  const covered =
    headerLength >= MOBI_IMAGE_INDEX_OFFSET + 4 && field + 4 <= record0.length;
  return {
    start,
    headerLength,
    textEncoding,
    firstImageRecord: covered ? u32(record0, field) : null,
  };
}

/**
 * Locate the MOBI header. The standard layout puts `MOBI` at offset 16; the
 * contract's variant puts an `EXTH` block at offset 16 with the MOBI header
 * following it. Both are accepted so a real file and a spec-built file parse.
 */
export function parseMobiHeader(record0: Uint8Array): MobiHeader | null {
  if (record0.length < 20) return null;
  if (ascii(record0, 16, 20) === MOBI_MAGIC) return readMobiFields(record0, 16);
  if (ascii(record0, 16, 20) === EXTH_MAGIC) {
    const exth = parseExth(record0, 16);
    if (
      exth !== null &&
      exth.end + 20 <= record0.length &&
      ascii(record0, exth.end, exth.end + 4) === MOBI_MAGIC
    ) {
      return readMobiFields(record0, exth.end);
    }
  }
  return null;
}

/** Every EXTH block the header carries: at offset 16 when present, otherwise
 *  immediately after the MOBI header. */
export function collectExthRecords(
  record0: Uint8Array,
  mobi: MobiHeader | null,
): ExthRecord[] {
  const records: ExthRecord[] = [];
  const at16 = parseExth(record0, 16);
  if (at16 !== null) records.push(...at16.records);
  if (mobi !== null) {
    const after = parseExth(record0, mobi.start + mobi.headerLength);
    if (after !== null) records.push(...after.records);
  }
  return records;
}

function beInt(data: Uint8Array): number {
  let value = 0;
  for (let i = 0; i < data.length && i < 4; i += 1) value = (value << 8) | data[i];
  return value >>> 0;
}

/** True when the EXTH records carry non-zero DRM evidence (type 504 flags, or
 *  a non-zero 501/502/503 DRM offset/count/size). */
export function hasDrmEvidence(records: readonly ExthRecord[]): boolean {
  return records.some((record) => {
    if (record.type === 504) return beInt(record.data) !== 0;
    if (record.type === 501 || record.type === 502 || record.type === 503) {
      return beInt(record.data) !== 0;
    }
    return false;
  });
}

/**
 * PalmDOC (LZ77) decompression of one record. Units are big-endian u16:
 *   0x0000          padding, skipped
 *   0x0001..0x0008  copy the next `c` bytes literally
 *   0x0009..0x007F  emit the single byte `c`
 *   0x0080..0xBFBF  length = (c & 0x1F) + 3, distance = (c >> 5) & 0x7FF;
 *                   copy `length` bytes from `distance` bytes back
 *   0xC000..0xFFFF  emit 0x20, then the low byte of `c ^ 0x8000`
 * Every copy is guarded against the record end and the output cap.
 */
export function decompressPalmDoc(
  input: Uint8Array,
  outputCap: number,
  signal?: AbortSignal,
): Uint8Array {
  const limit = Math.max(0, outputCap);
  // Bounded growing buffer: start small and grow geometrically up to the cap,
  // tracking the written length. The old `number[]` accumulation held ~8 bytes
  // per output byte and `Uint8Array.from` then doubled the peak (DEF-398).
  let buffer = new Uint8Array(Math.min(limit, 64 * 1024));
  let length = 0;
  if (signal?.aborted) throw new ConvertCancelledError();
  const grow = (): void => {
    const size = Math.min(limit, Math.max(buffer.length * 2, buffer.length + 1));
    const bigger = new Uint8Array(size);
    bigger.set(buffer.subarray(0, length));
    buffer = bigger;
  };
  const emit = (byte: number): void => {
    if (length >= limit) {
      throw new ConvertFailure(
        'too-large',
        'The decompressed e-book text exceeds the 32 MB decompression ceiling.',
      );
    }
    if (length === buffer.length) grow();
    buffer[length] = byte & 0xff;
    length += 1;
  };

  let at = 0;
  let units = 0;
  while (at + 1 < input.length) {
    const unit = (input[at] << 8) | input[at + 1];
    at += 2;
    if (unit !== 0) {
      if (unit <= 0x08) {
        if (at + unit > input.length) {
          throw new ConvertFailure(
            'corrupt',
            'A PalmDOC literal run runs past the end of its record.',
          );
        }
        for (let k = 0; k < unit; k += 1) emit(input[at + k]);
        at += unit;
      } else if (unit <= 0x7f) {
        emit(unit);
      } else if (unit <= 0xbfbf) {
        const copyLength = (unit & 0x1f) + 3;
        const distance = (unit >> 5) & 0x7ff;
        if (distance === 0 || distance > length) {
          throw new ConvertFailure(
            'corrupt',
            'A PalmDOC back-reference points before the start of its record.',
          );
        }
        for (let k = 0; k < copyLength; k += 1) emit(buffer[length - distance]);
      } else {
        emit(0x20);
        emit((unit ^ 0x8000) & 0xff);
      }
    }
    units += 1;
    if ((units & 0x3fff) === 0 && signal?.aborted) {
      throw new ConvertCancelledError();
    }
  }
  return buffer.subarray(0, length);
}

/** Decode a record with its declared encoding, falling back to CP1252. */
export function decodeMobiText(bytes: Uint8Array, encoding: number): string {
  if (encoding === 65001) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // Fall through to CP1252: the declared UTF-8 was not valid UTF-8.
    }
  }
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return Buffer.from(bytes).toString('latin1');
  }
}

const RECINDEX_RE = /<img\b[^>]*?\brecindex\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))/gi;

/** Every recindex the recovered markup references, in order, de-duplicated. */
export function referencedRecindexes(markup: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  RECINDEX_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RECINDEX_RE.exec(markup)) !== null) {
    const value = Number(match[1] ?? match[2] ?? match[3]);
    if (!Number.isFinite(value) || value < 0 || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** One part of a KF8 container: where it starts and its own headers. */
interface MobiPart {
  start: number;
  palmdoc: PalmDocHeader;
  mobi: MobiHeader | null;
}

export interface MobiDocument {
  /** The PalmDB name, or empty when it has none. */
  title: string;
  /** Recovered markup/text in reading order, before sanitizing. */
  markup: string;
  /** recindex -> raw image bytes (only referenced, resolvable indexes). */
  images: Map<number, Uint8Array>;
  /** Every recindex the markup references, in order, de-duplicated. */
  referenced: number[];
  /** True when the KF8 (AZW3) part supplied the text. */
  usedKf8: boolean;
  /** True when a KF8 BOUNDARY record was present. */
  hasKf8Part: boolean;
  /** Human notes for the legacy-format-degraded message. */
  notes: string[];
}

function isSupportedCompression(compression: number): boolean {
  return (
    compression === MOBI_COMPRESSION_NONE || compression === MOBI_COMPRESSION_PALMDOC
  );
}

/** Parse a KF8 part's header block; null (with a note) when it is absent. */
function readKf8Part(db: PalmDb, start: number, notes: string[]): MobiPart | null {
  let record0: Uint8Array;
  try {
    record0 = recordBytes(db, start);
  } catch {
    notes.push(
      'The KF8 (AZW3) part is missing, so the legacy Mobipocket text was printed instead.',
    );
    return null;
  }
  const palmdoc = parsePalmDocHeader(record0);
  const mobi = parseMobiHeader(record0);
  const exth = collectExthRecords(record0, mobi);
  if (palmdoc.encryptionType !== 0 || hasDrmEvidence(exth)) {
    throw new ConvertFailure('drm-protected', MOBI_DRM_MESSAGE);
  }
  return { start, palmdoc, mobi };
}

/** Decompress and decode a part's text records, in order, with the total cap. */
function readPartText(db: PalmDb, part: MobiPart, signal?: AbortSignal): string {
  const encoding = part.mobi?.textEncoding ?? 1252;
  const count = part.palmdoc.recordCount;
  if (count < 1) {
    throw new ConvertFailure('corrupt', 'The Mobipocket header declares no text records.');
  }
  if (part.start + count >= db.records.length) {
    throw new ConvertFailure(
      'corrupt',
      `The Mobipocket header declares ${count} text record(s) but the file holds fewer.`,
    );
  }
  const chunks: string[] = [];
  let total = 0;
  for (let i = 1; i <= count; i += 1) {
    const raw = recordBytes(db, part.start + i);
    const decoded =
      part.palmdoc.compression === MOBI_COMPRESSION_PALMDOC
        ? decompressPalmDoc(raw, MAX_MOBI_TEXT_BYTES - total, signal)
        : raw;
    total += decoded.length;
    if (total > MAX_MOBI_TEXT_BYTES) {
      throw new ConvertFailure(
        'too-large',
        'The decompressed e-book text exceeds the 32 MB decompression ceiling.',
      );
    }
    chunks.push(decodeMobiText(decoded, encoding));
  }
  return chunks.join('');
}

/**
 * Parse a Mobipocket/KF8 file. A protected e-book throws `drm-protected`
 * BEFORE any record is decompressed; HUFF/CDIC throws `unsupported-format`.
 * A KF8 container prefers its KF8 part and notes any fallback to the legacy
 * part in `notes`.
 */
export function parseMobi(bytes: Uint8Array, signal?: AbortSignal): MobiDocument {
  const db = parsePalmDb(bytes);
  const record0 = recordBytes(db, 0);
  const palmdoc = parsePalmDocHeader(record0);
  const mobi = parseMobiHeader(record0);
  const exth = collectExthRecords(record0, mobi);

  // DRM FIRST: refuse before any decompression so the file is never partially
  // parsed. `encryptionType` 1 and 2 are both encrypted.
  if (palmdoc.encryptionType !== 0 || hasDrmEvidence(exth)) {
    throw new ConvertFailure('drm-protected', MOBI_DRM_MESSAGE);
  }

  const notes: string[] = [];
  const boundary = db.records.findIndex((record, index) => index > 0 && record.uid === BOUNDARY_UID);
  let part: MobiPart = { start: 0, palmdoc, mobi };
  let usedKf8 = false;
  if (boundary >= 0 && boundary + 1 < db.records.length) {
    const kf8 = readKf8Part(db, boundary + 1, notes);
    if (kf8 !== null) {
      if (isSupportedCompression(kf8.palmdoc.compression)) {
        part = kf8;
        usedKf8 = true;
      } else {
        notes.push(
          'The KF8 (AZW3) part uses an unsupported compression method, so the legacy Mobipocket text was printed instead.',
        );
      }
    }
  }

  if (part.palmdoc.compression === MOBI_COMPRESSION_HUFFCDIC) {
    throw new ConvertFailure(
      'unsupported-format',
      'This e-book uses HUFF/CDIC compression, which Jovrel does not support; the file was not parsed.',
    );
  }
  if (!isSupportedCompression(part.palmdoc.compression)) {
    throw new ConvertFailure(
      'unsupported-format',
      `This e-book uses an unrecognised compression method (${part.palmdoc.compression}); the file was not parsed.`,
    );
  }

  const markup = readPartText(db, part, signal);
  const referenced = referencedRecindexes(markup);
  const images = new Map<number, Uint8Array>();
  if (part.mobi !== null && part.mobi.firstImageRecord !== null) {
    for (const recindex of referenced) {
      const index = part.start + part.mobi.firstImageRecord + recindex - 1;
      const raw = rawRecord(db, index);
      if (raw !== null && raw.length > 0 && raw.length <= MAX_MOBI_IMAGE_BYTES) {
        images.set(recindex, raw);
      }
    }
  }

  return {
    title: db.name,
    markup,
    images,
    referenced,
    usedKf8,
    hasKf8Part: boundary >= 0,
    notes,
  };
}
