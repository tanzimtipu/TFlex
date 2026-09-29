/**
 * Phase 55 chunk 3 — the shared OLE/CFB (Compound File Binary) walker.
 *
 * Extracted verbatim from `adapters/legacy-doc.ts` so the legacy binary Word
 * and PowerPoint readers share ONE container parser instead of two. Byte
 * layout is unchanged: the header's sector shifts, the DIFAT/FAT, the directory
 * entries and the (mini) FAT chains are walked exactly as before, and the same
 * `CfbError` is raised for a malformed container.
 *
 * This module does no format-specific work. Callers ask for a stream by its
 * UTF-16LE directory name (`WordDocument`, `PowerPoint Document`, ...).
 */

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAX_SECTOR_CHAIN = 4 * 1024 * 1024;

/** True when the head carries the OLE/CFB signature. */
export function isCfb(head: Buffer): boolean {
  if (head.length < CFB_SIGNATURE.length) return false;
  return CFB_SIGNATURE.every((byte, index) => head[index] === byte);
}

/** A CFB structure problem; callers map it to a typed `corrupt` failure. */
export class CfbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CfbError';
  }
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

interface CfbDirectoryEntry {
  name: string;
  type: number;
  startSector: number;
  size: number;
}

/** A parsed OLE/CFB container exposing its streams by name. */
export class CompoundFile {
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: number[] = [];
  private readonly miniFat: number[] = [];
  private root!: CfbDirectoryEntry;
  private readonly entries: CfbDirectoryEntry[] = [];

  constructor(private readonly data: Uint8Array) {
    this.sectorSize = 2 ** u16(data, 0x1e);
    this.miniSectorSize = 2 ** u16(data, 0x20);
    this.miniCutoff = u32(data, 0x38);
    if (this.sectorSize < 128 || this.sectorSize > 65536) {
      throw new CfbError('unsupported CFB sector size');
    }
    this.readFat(u32(data, 0x2c), u32(data, 0x30), u32(data, 0x44), u32(data, 0x48));
    this.readDirectory(u32(data, 0x30));
    this.readMiniFat(u32(data, 0x3c), u32(data, 0x40));
  }

  private sectorOffset(sector: number): number {
    const offset = (sector + 1) * this.sectorSize;
    if (offset < 0 || offset + this.sectorSize > this.data.length) {
      throw new CfbError('CFB sector outside the file');
    }
    return offset;
  }

  private sectorBytes(sector: number): Uint8Array {
    const offset = this.sectorOffset(sector);
    return this.data.subarray(offset, offset + this.sectorSize);
  }

  private readFat(
    numFatSectors: number,
    _firstDir: number,
    firstDifat: number,
    numDifat: number,
  ): void {
    const fatSectors: number[] = [];
    for (let i = 0; i < 109; i += 1) {
      const sector = u32(this.data, 0x4c + i * 4);
      if (sector === FREESECT || sector === ENDOFCHAIN) break;
      fatSectors.push(sector);
    }
    let difat = firstDifat;
    let guard = 0;
    while (
      difat !== ENDOFCHAIN &&
      difat !== FREESECT &&
      guard < numDifat &&
      guard < MAX_SECTOR_CHAIN
    ) {
      const bytes = this.sectorBytes(difat);
      const perSector = this.sectorSize / 4 - 1;
      for (let i = 0; i < perSector; i += 1) {
        const sector = u32(bytes, i * 4);
        if (sector === FREESECT || sector === ENDOFCHAIN) continue;
        fatSectors.push(sector);
      }
      difat = u32(bytes, perSector * 4);
      guard += 1;
    }
    const declared = numFatSectors === 0 ? fatSectors.length : numFatSectors;
    for (const sector of fatSectors.slice(0, declared)) {
      const bytes = this.sectorBytes(sector);
      for (let i = 0; i < bytes.length; i += 4) this.fat.push(u32(bytes, i));
    }
    if (this.fat.length === 0) throw new CfbError('CFB has no FAT');
  }

  private readMiniFat(firstMiniFat: number, numMiniFat: number): void {
    if (firstMiniFat === ENDOFCHAIN || firstMiniFat === FREESECT) return;
    let sector = firstMiniFat;
    let guard = 0;
    const seen = new Set<number>();
    while (sector !== ENDOFCHAIN && sector !== FREESECT && guard < numMiniFat + 1) {
      if (seen.has(sector)) break;
      seen.add(sector);
      const bytes = this.sectorBytes(sector);
      for (let i = 0; i < bytes.length; i += 4) this.miniFat.push(u32(bytes, i));
      if (sector >= this.fat.length) break;
      sector = this.fat[sector];
      guard += 1;
    }
  }

  private readDirectory(firstDir: number): void {
    const bytes = this.readFatChain(firstDir, 0);
    for (let offset = 0; offset + 128 <= bytes.length; offset += 128) {
      const nameLen = u16(bytes, offset + 64);
      const type = bytes[offset + 66];
      if (nameLen < 2 || type === 0) continue;
      const name = Buffer.from(
        bytes.subarray(offset, offset + Math.min(nameLen - 2, 62)),
      ).toString('utf16le');
      const startSector = u32(bytes, offset + 116);
      const sizeLow = u32(bytes, offset + 120);
      const sizeHigh = u32(bytes, offset + 124);
      const size = sizeHigh === 0 ? sizeLow : Number.MAX_SAFE_INTEGER;
      this.entries.push({ name, type, startSector, size });
    }
    const root = this.entries.find((entry) => entry.type === 5);
    if (root === undefined) throw new CfbError('CFB has no root directory entry');
    this.root = root;
  }

  /** Follow a FAT chain from `start` and concatenate the sectors. */
  private readFatChain(start: number, expectedSize: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let sector = start;
    let total = 0;
    let guard = 0;
    const seen = new Set<number>();
    while (
      sector !== ENDOFCHAIN &&
      sector !== FREESECT &&
      guard < MAX_SECTOR_CHAIN
    ) {
      if (seen.has(sector)) throw new CfbError('CFB sector chain loops');
      seen.add(sector);
      const bytes = this.sectorBytes(sector);
      parts.push(bytes);
      total += bytes.length;
      if (expectedSize > 0 && total >= expectedSize) break;
      if (sector >= this.fat.length) break;
      sector = this.fat[sector];
      guard += 1;
    }
    const joined = Buffer.concat(parts.map((part) => Buffer.from(part)));
    return expectedSize > 0 ? joined.subarray(0, expectedSize) : joined;
  }

  /** Follow a mini-FAT chain within the root's mini stream. */
  private readMiniChain(start: number, size: number): Uint8Array {
    const miniStream = this.readFatChain(this.root.startSector, this.root.size);
    const parts: Uint8Array[] = [];
    let sector = start;
    let total = 0;
    let guard = 0;
    const seen = new Set<number>();
    while (sector !== ENDOFCHAIN && sector !== FREESECT && guard < MAX_SECTOR_CHAIN) {
      if (seen.has(sector)) throw new CfbError('CFB mini chain loops');
      seen.add(sector);
      const offset = sector * this.miniSectorSize;
      if (offset + this.miniSectorSize > miniStream.length) break;
      parts.push(miniStream.subarray(offset, offset + this.miniSectorSize));
      total += this.miniSectorSize;
      if (total >= size) break;
      if (sector >= this.miniFat.length) break;
      sector = this.miniFat[sector];
      guard += 1;
    }
    return Buffer.concat(parts.map((part) => Buffer.from(part))).subarray(0, size);
  }

  /** Read one stream by directory name, or null when absent. */
  read(name: string): Uint8Array | null {
    const entry = this.entries.find((candidate) => candidate.name === name);
    if (entry === undefined) return null;
    if (entry.size === 0) return new Uint8Array(0);
    if (entry.size !== Number.MAX_SAFE_INTEGER && entry.size < this.miniCutoff) {
      return this.readMiniChain(entry.startSector, entry.size);
    }
    return this.readFatChain(entry.startSector, entry.size);
  }
}