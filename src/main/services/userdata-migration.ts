import { constants } from 'node:fs';
import { access, copyFile, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Phase 49 — one-time userData migration (TFlex -> Jovrel)
// ---------------------------------------------------------------------------
// The product name changed, so Electron's userData directory moved from
// `%APPDATA%\tflex` to `%APPDATA%\Jovrel`. The operator's per-user state
// lives in the old directory; on FIRST RUN of the Jovrel build it is COPIED
// across, once, before any store is constructed.
//
// Rules (contract):
//   - COPY only. The old directory is never read-modified, renamed or deleted.
//   - Idempotent: a destination file that already exists is left untouched,
//     and the whole run is skipped once the new directory holds settings.json.
//   - Gated: skipped when the old directory is absent, when old and new are the
//     same path, or when the new directory already has state.
//
// The caller supplies both directories so this stays a pure filesystem helper,
// unit-testable without Electron.

/** TFlex's userData directory name (the Electron app name before the rename). */
export const LEGACY_USERDATA_DIRNAME = 'tflex';

/** Per-user files copied across, by name under userData. */
export const LEGACY_STATE_FILES = [
  'settings.json',
  'signatures.json',
  'image-signatures.json',
  'accounts-session.bin',
] as const;

/** Per-user image-signature directory copied across (recursively) if present. */
export const LEGACY_SIGNATURE_IMAGES_DIR = 'signature-images';

/** The file whose presence marks the new directory as already populated. */
export const NEW_USERDATA_STATE_MARKER = 'settings.json';

export type UserDataMigrationOutcome =
  | { kind: 'migrated'; copied: string[] }
  | { kind: 'skipped'; reason: 'same-dir' | 'old-dir-absent' | 'new-dir-has-state' };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the legacy per-user state from `oldDir` into `newDir`. Never throws for
 * an absent old directory; a genuine copy failure propagates so the caller can
 * log it (the stores then simply start empty, as they would on a fresh install).
 */
export async function migrateLegacyUserData(
  newDir: string,
  oldDir: string,
): Promise<UserDataMigrationOutcome> {
  if (oldDir.toLowerCase() === newDir.toLowerCase()) {
    return { kind: 'skipped', reason: 'same-dir' };
  }
  if (!(await exists(oldDir))) {
    return { kind: 'skipped', reason: 'old-dir-absent' };
  }
  if (await exists(join(newDir, NEW_USERDATA_STATE_MARKER))) {
    return { kind: 'skipped', reason: 'new-dir-has-state' };
  }

  await mkdir(newDir, { recursive: true });

  const copied: string[] = [];
  for (const name of LEGACY_STATE_FILES) {
    const src = join(oldDir, name);
    const dest = join(newDir, name);
    if ((await exists(src)) && !(await exists(dest))) {
      await copyFile(src, dest);
      copied.push(name);
    }
  }

  const srcImages = join(oldDir, LEGACY_SIGNATURE_IMAGES_DIR);
  const destImages = join(newDir, LEGACY_SIGNATURE_IMAGES_DIR);
  if ((await exists(srcImages)) && !(await exists(destImages))) {
    await cp(srcImages, destImages, { recursive: true });
    copied.push(LEGACY_SIGNATURE_IMAGES_DIR);
  }

  return { kind: 'migrated', copied };
}
