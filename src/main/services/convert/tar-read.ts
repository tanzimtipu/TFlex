/**
 * Phase 56 feature C — a tiny bounded TAR (ustar) reader for the `.cbt` comic
 * adapter. Pure byte work: no I/O, no Electron, no pdf-lib.
 *
 * Format supported: POSIX ustar records — a 512-byte header, then the payload
 * padded to the next 512-byte boundary; the archive ends at two consecutive
 * zero blocks. Header fields read are `name` (0,100), `size` as OCTAL (124,12),
 * `typeflag` (156,1), `magic` (257,6) and the ustar `prefix` (345,155), which
 * is joined to `name` when `magic` starts with `ustar`.
 *
 * Deliberately unsupported, documented and refused rather than silently mis-read:
 *  - GNU long names (`typeflag 'L'`/`'K'`) are a typed `corrupt`;
 *  - base-256 (binary) numeric fields are refused by the octal parser.
 * PAX extended headers (`typeflag 'x'`/`'g'`) are skipped by their declared
 * size (they are not regular files), but their payload is NOT applied.
 *
 * A header or a declared payload that runs past the buffer end is a typed
 * `corrupt` — this is criterion 7's truncated-record case. A record count, a
 * single record or the total expansion above the ceilings is `too-large`,
 * mirroring `convert-zip.ts`.
 */

export interface TarEntry {
  name: string;
  bytes: Uint8Array;
}

/** Bounds enforced on every TAR this module reads. */
export interface TarLimits {
  /** Maximum number of 512-byte records walked. */
  maxEntries: number;
  /** Maximum sum of declared payload sizes across all regular files. */
  maxTotalBytes: number;
  /** Maximum declared payload size for a single regular file. */
  maxEntryBytes: number;
}

/** Default ceilings: comfortably above a real CBT, far below a decompression bomb. */
export const DEFAULT_TAR_LIMITS: TarLimits = {
  maxEntries: 4096,
  maxTotalBytes: 256 * 1024 * 1024,
  maxEntryBytes: 128 * 1024 * 1024,
};

/** The two failure kinds a TAR container can report; both map to `ConvertFailure`. */
export class TarReadError extends Error {
  readonly code: 'corrupt' | 'too-large';

  constructor(code: 'corrupt' | 'too-large', message: string) {
    super(message);
    this.name = 'TarReadError';
    this.code = code;
  }
}

const BLOCK = 512;
function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== 0) return false;
  }
  return true;
}

/** Read a NUL-terminated ASCII field, stopping at the first NUL. */
function readText(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const code = bytes[at + i];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

/** Parse one NUL/space-padded octal header field; a non-octal field is corrupt. */
function parseOctal(
  bytes: Uint8Array,
  at: number,
  length: number,
  what: string,
): number {
  const text = readText(bytes, at, length).trim();
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw new TarReadError('corrupt', `The TAR ${what} field is not a valid octal number.`);
  }
  return Number.parseInt(text, 8);
}

/**
 * Read every regular file from a ustar archive, enforcing `limits`. Entries are
 * returned in archive order; the caller (the comic composer) sorts them. Never
 * returns a partially-expanded archive: a record over a ceiling is refused, and
 * a truncated record throws before any later record is read.
 */
export function readTar(
  data: Uint8Array,
  limits: TarLimits = DEFAULT_TAR_LIMITS,
): TarEntry[] {
  const entries: TarEntry[] = [];
  let records = 0;
  let total = 0;
  let zeroBlocks = 0;
  let offset = 0;

  while (offset < data.length) {
    if (offset + BLOCK > data.length) {
      throw new TarReadError('corrupt', 'The TAR ends in a truncated 512-byte header.');
    }
    const header = data.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) {
      zeroBlocks += 1;
      offset += BLOCK;
      if (zeroBlocks >= 2) break;
      continue;
    }
    zeroBlocks = 0;

    records += 1;
    if (records > limits.maxEntries) {
      throw new TarReadError(
        'too-large',
        `The TAR has more than ${limits.maxEntries} records.`,
      );
    }

    const typeflag = header[156];
    if (typeflag === 0x4c || typeflag === 0x4b) {
      throw new TarReadError('corrupt', 'GNU long-name TAR records are not supported.');
    }

    const size = parseOctal(header, 124, 12, 'size');
    if (size > limits.maxEntryBytes) {
      throw new TarReadError(
        'too-large',
        'A TAR record declares more bytes than the per-entry import ceiling.',
      );
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw new TarReadError(
        'too-large',
        `The TAR expands beyond the ${Math.round(
          limits.maxTotalBytes / (1024 * 1024),
        )} MiB import ceiling.`,
      );
    }

    const payloadStart = offset + BLOCK;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > data.length) {
      throw new TarReadError(
        'corrupt',
        'A TAR record declares more bytes than the archive contains.',
      );
    }

    const isFile =
      typeflag === 0x30 || typeflag === 0x00 || typeflag === 0x37;
    if (isFile) {
      const magic = readText(header, 257, 6);
      const prefix = magic.startsWith('ustar') ? readText(header, 345, 155) : '';
      const name =
        prefix.length > 0
          ? `${prefix}/${readText(header, 0, 100)}`
          : readText(header, 0, 100);
      if (name.length > 0) {
        entries.push({ name, bytes: data.subarray(payloadStart, payloadEnd) });
      }
    }

    offset = payloadStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}
