import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate';

/**
 * Phase 55 — a tiny bounded ZIP reader shared by the office adapters (ODT
 * here; PPTX and EPUB in later chunks).
 *
 * `fflate`'s sync unzip would expand every entry unconditionally, so a zip bomb
 * (one entry declaring a multi-gigabyte original size, compressed to a few
 * kilobytes) must be stopped before it allocates. `unzipSync` calls the
 * `filter` callback BEFORE decompressing each entry, with the entry's DECLARED
 * original size, so this wrapper refuses any entry above the per-entry ceiling
 * and any archive whose declared total busts the archive ceiling. A declared
 * size is the attacker's claim, so the cumulative actual decompressed length is
 * also re-checked after extraction: a lying header is caught too.
 */

/** Bounds enforced on every archive this module opens. */
export interface ZipLimits {
  /** Maximum number of entries in the archive. */
  maxEntries: number;
  /** Maximum sum of declared original sizes across all entries. */
  maxTotalUncompressedBytes: number;
  /** Maximum declared original size for a single entry. */
  maxEntryUncompressedBytes: number;
}

/** Default ceilings: comfortably above a real ODT/PPTX/EPUB, far below a bomb. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 4096,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxEntryUncompressedBytes: 128 * 1024 * 1024,
};

/** The two failure kinds a zipped container can report. */
export class ConvertZipError extends Error {
  readonly code: 'corrupt' | 'too-large';

  constructor(code: 'corrupt' | 'too-large', message: string) {
    super(message);
    this.name = 'ConvertZipError';
    this.code = code;
  }
}

/** Account declared entry sizes and refuse anything over the ceilings. */
class ZipGuard {
  private seen = 0;
  private declaredTotal = 0;
  breached = false;

  constructor(private readonly limits: ZipLimits) {}

  accept(file: UnzipFileInfo): boolean {
    this.seen += 1;
    if (this.seen > this.limits.maxEntries) {
      this.breached = true;
      return false;
    }
    if (file.originalSize > this.limits.maxEntryUncompressedBytes) {
      this.breached = true;
      return false;
    }
    this.declaredTotal += file.originalSize;
    if (this.declaredTotal > this.limits.maxTotalUncompressedBytes) {
      this.breached = true;
      return false;
    }
    return true;
  }

  assertWithinLimits(): void {
    if (this.breached || this.seen > this.limits.maxEntries) {
      throw new ConvertZipError(
        'too-large',
        `The archive exceeds the ${this.limits.maxEntries}-entry / ${Math.round(
          this.limits.maxTotalUncompressedBytes / (1024 * 1024),
        )} MiB import ceiling.`,
      );
    }
  }
}

function unzipOrThrow(
  data: Uint8Array,
  filter: (file: UnzipFileInfo) => boolean,
): Record<string, Uint8Array> {
  try {
    return unzipSync(data, { filter });
  } catch (thrown) {
    throw new ConvertZipError(
      'corrupt',
      thrown instanceof Error
        ? `The ZIP container could not be read: ${thrown.message}`
        : 'The ZIP container could not be read.',
    );
  }
}

export interface ZipArchive {
  /** Every extracted entry name, in archive order. */
  names(): string[];
  has(name: string): boolean;
  /** Entry bytes, or `null` when the archive has no such entry. */
  readBytes(name: string): Uint8Array | null;
  /** Entry decoded as UTF-8, or `null` when absent. */
  readText(name: string): string | null;
}

/**
 * Read the central directory and enforce the ceilings WITHOUT decompressing
 * anything. Used by the DOCX adapter to reject a bomb before handing the bytes
 * to `mammoth` (which would unzip them itself, unbounded).
 */
export function inspectZip(data: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): void {
  const guard = new ZipGuard(limits);
  unzipOrThrow(data, (file) => {
    guard.accept(file);
    return false;
  });
  guard.assertWithinLimits();
}

/**
 * Open `data` as a ZIP, enforcing `limits` before anything expands. Throws a
 * typed `ConvertZipError` (`too-large`) when a ceiling is hit, or (`corrupt`)
 * when the bytes are not a readable ZIP. Never returns a partially-expanded
 * archive for a bomb: the offending entry is refused, not truncated.
 */
export function openZip(
  data: Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ZipArchive {
  const guard = new ZipGuard(limits);
  const files = unzipOrThrow(data, (file) => guard.accept(file));
  guard.assertWithinLimits();

  // Re-check the ACTUAL decompressed lengths: a crafted header can understate
  // an entry's original size, and `unzipSync` would then have expanded it.
  let actualTotal = 0;
  for (const bytes of Object.values(files)) {
    actualTotal += bytes.length;
    if (
      bytes.length > limits.maxEntryUncompressedBytes ||
      actualTotal > limits.maxTotalUncompressedBytes
    ) {
      throw new ConvertZipError(
        'too-large',
        'The archive expands beyond the import ceiling.',
      );
    }
  }

  const names = Object.keys(files);
  const byName = new Map<string, Uint8Array>(Object.entries(files));
  return {
    names: () => [...names],
    has: (name) => byName.has(name),
    readBytes: (name) => byName.get(name) ?? null,
    readText: (name) => {
      const bytes = byName.get(name);
      return bytes === undefined ? null : strFromU8(bytes);
    },
  };
}
