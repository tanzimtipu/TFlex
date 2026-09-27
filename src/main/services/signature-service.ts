import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SavedSignature, SignatureSource } from '../../shared/types';
import type { ImageSignatureMeta } from '../../shared/accounts';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Saved-signatures persistence service
// ---------------------------------------------------------------------------
// Stores an array of SavedSignature objects in a JSON file, similar to
// SettingsService. The file lives at `{userData}/signatures.json`.
//
// Phase 44 chunk 5 adds a PARALLEL image store: image signatures are not
// representable in `SavedSignature` (drawn/typed only), so their metadata
// lives in `{userData}/image-signatures.json` and their PNG bytes in
// `{userData}/signature-images/<id>.png`. This keeps the existing signature
// list and its IPC surface untouched while the transport handles the bytes.

/** Local ids are generated uuids, but a synced row's id is attacker-influenced
 *  input used as a file name, so it is validated before it touches the disk. */
const SAFE_IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class SignatureService {
  private _cached: SavedSignature[] | null = null;
  private _images: ImageSignatureMeta[] | null = null;
  private readonly imageMetadataPath: string;
  private readonly imageDir: string;

  constructor(private readonly filePath: string) {
    const dir = dirname(filePath);
    this.imageMetadataPath = join(dir, 'image-signatures.json');
    this.imageDir = join(dir, 'signature-images');
  }

  /**
   * Return the full list of saved signatures (from cache if loaded, else
   * load from disk first).
   */
  async list(): Promise<SavedSignature[]> {
    if (this._cached === null) {
      await this._loadFromDisk();
    }
    return this._cached ?? [];
  }

  /**
   * Add a new saved signature from a source and optional label.
   * Returns the updated full list.
   */
  async save(
    source: SignatureSource,
    label?: string,
  ): Promise<SavedSignature[]> {
    const list = await this.list();
    const displayLabel =
      label ??
      (source.kind === 'typed' ? source.text : `Signature ${list.length + 1}`);

    const entry: SavedSignature = {
      id: randomUUID(),
      label: displayLabel,
      createdAt: new Date().toISOString(),
      source: structuredClone(source),
    };

    list.push(entry);
    await this._writeToDisk(list);
    return this.list();
  }

  /**
   * Delete a saved signature by id. Returns the updated full list.
   */
  async delete(id: string): Promise<SavedSignature[]> {
    let list = await this.list();
    list = list.filter((s) => s.id !== id);
    await this._writeToDisk(list);
    return this.list();
  }

  /**
   * Phase 44 - apply a batch of cloud signature rows: upsert the drawn/typed
   * entries by id and remove the soft-deleted ids, preserving local order and
   * appending new ids. Image rows never reach here (metadata only, deferred).
   * Returns the updated list.
   */
  async applySynced(
    upserts: SavedSignature[],
    removedIds: string[],
  ): Promise<SavedSignature[]> {
    const list = await this.list();
    const removed = new Set(removedIds);
    const byId = new Map<string, SavedSignature>();
    const order: string[] = [];
    for (const entry of list) {
      if (removed.has(entry.id)) continue;
      byId.set(entry.id, entry);
      order.push(entry.id);
    }
    for (const upsert of upserts) {
      if (!byId.has(upsert.id)) order.push(upsert.id);
      byId.set(upsert.id, structuredClone(upsert));
    }
    await this._writeToDisk(order.map((id) => byId.get(id)!));
    return this.list();
  }

  // -----------------------------------------------------------------------
  // Phase 44 chunk 5 - image signatures (metadata + bytes)
  // -----------------------------------------------------------------------

  /** List the image-signature metadata, each with `hasBytes` resolved from
   *  disk (a metadata entry can exist before its bytes have been downloaded). */
  async listImages(): Promise<ImageSignatureMeta[]> {
    if (this._images === null) await this._loadImagesFromDisk();
    const images = this._images ?? [];
    return Promise.all(
      images.map(async (meta) => ({ ...meta, hasBytes: await this._hasImageBytes(meta.id) })),
    );
  }

  /** Read the local PNG bytes for an image signature, or null when absent. */
  async readImage(id: string): Promise<Uint8Array | null> {
    if (!SAFE_IMAGE_ID.test(id)) return null;
    try {
      return new Uint8Array(await readFile(this._imageFilePath(id)));
    } catch {
      return null;
    }
  }

  /** Persist PNG bytes for an image signature (atomic write). */
  async writeImage(id: string, bytes: Uint8Array): Promise<void> {
    if (!SAFE_IMAGE_ID.test(id)) throw new Error('invalid signature image id');
    await mkdir(this.imageDir, { recursive: true });
    const target = this._imageFilePath(id);
    const tmp = `${target}.tmp`;
    try {
      await writeFile(tmp, bytes);
      await rename(tmp, target);
    } catch (error) {
      try {
        await unlink(tmp);
      } catch {
        // Best-effort tmp cleanup.
      }
      throw error;
    }
  }

  /** Record the cloud object key the bytes were uploaded under. */
  async setImageStorageKey(id: string, storageKey: string): Promise<void> {
    const images = await this.listImages();
    const index = images.findIndex((meta) => meta.id === id);
    if (index === -1) return;
    images[index] = { ...images[index], storageKey };
    await this._writeImagesToDisk(images);
  }

  /** Apply cloud image rows: upsert by id, remove soft-deleted ids, preserving
   *  local order and appending new ids (the image analogue of `applySynced`). */
  async applyImageSynced(
    upserts: ImageSignatureMeta[],
    removedIds: string[],
  ): Promise<ImageSignatureMeta[]> {
    if (this._images === null) await this._loadImagesFromDisk();
    const removed = new Set(removedIds);
    const byId = new Map<string, ImageSignatureMeta>();
    const order: string[] = [];
    for (const meta of this._images ?? []) {
      if (removed.has(meta.id)) continue;
      byId.set(meta.id, meta);
      order.push(meta.id);
    }
    for (const upsert of upserts) {
      if (!byId.has(upsert.id)) order.push(upsert.id);
      const previous = byId.get(upsert.id);
      byId.set(upsert.id, {
        ...upsert,
        hasBytes: previous?.hasBytes ?? upsert.hasBytes,
      });
    }
    // Drop the bytes of soft-deleted images too, so a delete does not leave
    // orphaned PNGs behind.
    for (const id of removed) {
      if (!SAFE_IMAGE_ID.test(id)) continue;
      try {
        await unlink(this._imageFilePath(id));
      } catch {
        // No local bytes for this id; nothing to clean up.
      }
    }
    await this._writeImagesToDisk(order.map((id) => byId.get(id)!));
    return this.listImages();
  }

  private _imageFilePath(id: string): string {
    return join(this.imageDir, `${id}.png`);
  }

  private async _hasImageBytes(id: string): Promise<boolean> {
    if (!SAFE_IMAGE_ID.test(id)) return false;
    try {
      const info = await stat(this._imageFilePath(id));
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }

  private async _loadImagesFromDisk(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.imageMetadataPath, 'utf8');
    } catch {
      this._images = [];
      return;
    }
    try {
      const parsed = JSON.parse(text);
      this._images = Array.isArray(parsed) ? parsed.filter(isImageMeta) : [];
    } catch {
      this._images = [];
    }
  }

  private async _writeImagesToDisk(list: ImageSignatureMeta[]): Promise<void> {
    await mkdir(dirname(this.imageMetadataPath), { recursive: true });
    const stripped = list.map(({ hasBytes: _hasBytes, ...meta }) => meta);
    const tmp = `${this.imageMetadataPath}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(stripped, null, 2), 'utf8');
      await rename(tmp, this.imageMetadataPath);
      this._images = list;
    } catch {
      try {
        await unlink(tmp);
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async _loadFromDisk(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch {
      this._cached = [];
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        this._cached = [];
        return;
      }
      this._cached = parsed.filter(
        (e: unknown): e is SavedSignature =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as SavedSignature).id === 'string' &&
          typeof (e as SavedSignature).label === 'string' &&
          typeof (e as SavedSignature).createdAt === 'string' &&
          typeof (e as SavedSignature).source === 'object' &&
          (e as SavedSignature).source !== null,
      );
    } catch {
      this._cached = [];
    }
  }

  private async _writeToDisk(list: SavedSignature[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
      await rename(tmp, this.filePath);
      this._cached = list;
    } catch {
      try {
        await unlink(tmp);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

function isImageMeta(value: unknown): value is ImageSignatureMeta {
  if (value === null || typeof value !== 'object') return false;
  const meta = value as ImageSignatureMeta;
  return (
    typeof meta.id === 'string' &&
    SAFE_IMAGE_ID.test(meta.id) &&
    typeof meta.label === 'string' &&
    typeof meta.createdAt === 'string' &&
    (meta.storageKey === null || typeof meta.storageKey === 'string')
  );
}