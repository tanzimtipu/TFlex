/**
 * Phase 44 - concrete local ports for the sync engine (main process only).
 *
 * Small adapters that bind the sync engine's `SettingsPort` / `SignaturesPort`
 * interfaces to the existing services. Kept separate from `sync.ts` so the
 * engine stays free of any concrete service import and is testable in
 * isolation.
 */

import type { AppSettings, SavedSignature } from '../../../shared/types';
import type { SettingsService } from '../settings';
import type { SignatureService } from '../signature-service';
import type { SettingsPort, SignaturesPort } from './sync';

export function createSettingsPort(settings: SettingsService): SettingsPort {
  return {
    get: () => settings.getCurrent(),
    apply: (next: AppSettings) => settings.save(next),
  };
}

export function createSignaturesPort(signatures: SignatureService): SignaturesPort {
  return {
    list: () => signatures.list(),
    applyRemote: async (upserts: SavedSignature[], removedIds: string[]) => {
      await signatures.applySynced(upserts, removedIds);
    },
    // Phase 44 chunk 5 - the image half of the local store. Bytes are read
    // and written here; the sync engine never touches the filesystem itself.
    listImages: () => signatures.listImages(),
    readImage: (id) => signatures.readImage(id),
    writeImage: (id, bytes) => signatures.writeImage(id, bytes),
    setImageStorageKey: (id, storageKey) => signatures.setImageStorageKey(id, storageKey),
    applyRemoteImages: async (upserts, removedIds) => {
      await signatures.applyImageSynced(upserts, removedIds);
    },
  };
}
