import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SavedSignature, SignatureSource } from '../../shared/types';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Saved-signatures persistence service
// ---------------------------------------------------------------------------
// Stores an array of SavedSignature objects in a JSON file, similar to
// SettingsService. The file lives at `{userData}/signatures.json`.

export class SignatureService {
  private _cached: SavedSignature[] | null = null;

  constructor(private readonly filePath: string) {}

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