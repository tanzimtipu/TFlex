import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LEGACY_SIGNATURE_IMAGES_DIR,
  migrateLegacyUserData,
} from '../../../src/main/services/userdata-migration';

// Phase 49 — the one-time TFlex -> Jovrel userData migration. Real temp
// directories, no Electron: the helper takes both paths explicitly.

let root: string;
let oldDir: string;
let newDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tflex-migrate-'));
  oldDir = join(root, 'tflex');
  newDir = join(root, 'Jovrel');
  await mkdir(oldDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seedLegacyState(): Promise<void> {
  await writeFile(join(oldDir, 'settings.json'), '{"theme":"frosted"}');
  await writeFile(join(oldDir, 'signatures.json'), '[]');
  await writeFile(join(oldDir, 'image-signatures.json'), '[]');
  await writeFile(join(oldDir, 'accounts-session.bin'), Buffer.from([1, 2, 3, 4]));
  await mkdir(join(oldDir, LEGACY_SIGNATURE_IMAGES_DIR), { recursive: true });
  await writeFile(join(oldDir, LEGACY_SIGNATURE_IMAGES_DIR, 'sig-1.png'), Buffer.from([9, 9]));
}

describe('Phase 49 — migrateLegacyUserData', () => {
  it('copies every state file and the signature-images directory', async () => {
    await seedLegacyState();

    const outcome = await migrateLegacyUserData(newDir, oldDir);

    expect(outcome.kind).toBe('migrated');
    expect(outcome).toEqual(expect.objectContaining({ copied: expect.arrayContaining([
      'settings.json',
      'signatures.json',
      'image-signatures.json',
      'accounts-session.bin',
      LEGACY_SIGNATURE_IMAGES_DIR,
    ]) }));
    expect(await readFile(join(newDir, 'settings.json'), 'utf8')).toBe('{"theme":"frosted"}');
    expect(await readFile(join(newDir, 'signatures.json'), 'utf8')).toBe('[]');
    expect(await readFile(join(newDir, 'accounts-session.bin'))).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(await readFile(join(newDir, LEGACY_SIGNATURE_IMAGES_DIR, 'sig-1.png'))).toEqual(Buffer.from([9, 9]));
  });

  it('leaves the old directory completely intact (copy, never move)', async () => {
    await seedLegacyState();

    await migrateLegacyUserData(newDir, oldDir);

    expect(existsSync(join(oldDir, 'settings.json'))).toBe(true);
    expect(existsSync(join(oldDir, 'signatures.json'))).toBe(true);
    expect(existsSync(join(oldDir, 'accounts-session.bin'))).toBe(true);
    expect(existsSync(join(oldDir, LEGACY_SIGNATURE_IMAGES_DIR, 'sig-1.png'))).toBe(true);
    expect(await readFile(join(oldDir, 'settings.json'), 'utf8')).toBe('{"theme":"frosted"}');
  });

  it('is a no-op when the old directory is absent', async () => {
    await rm(oldDir, { recursive: true, force: true });

    const outcome = await migrateLegacyUserData(newDir, oldDir);

    expect(outcome).toEqual({ kind: 'skipped', reason: 'old-dir-absent' });
    // The new directory is not even created.
    expect(existsSync(newDir)).toBe(false);
  });

  it('is a no-op when the new directory already holds settings.json', async () => {
    await seedLegacyState();
    await mkdir(newDir, { recursive: true });
    await writeFile(join(newDir, 'settings.json'), '{"theme":"light"}');

    const outcome = await migrateLegacyUserData(newDir, oldDir);

    expect(outcome).toEqual({ kind: 'skipped', reason: 'new-dir-has-state' });
    // The new directory's own state is untouched and nothing else was copied.
    expect(await readFile(join(newDir, 'settings.json'), 'utf8')).toBe('{"theme":"light"}');
    expect(existsSync(join(newDir, 'signatures.json'))).toBe(false);
  });

  it('is idempotent: a second run after a migration copies nothing', async () => {
    await seedLegacyState();
    await migrateLegacyUserData(newDir, oldDir);

    const second = await migrateLegacyUserData(newDir, oldDir);

    expect(second).toEqual({ kind: 'skipped', reason: 'new-dir-has-state' });
    expect(await readFile(join(newDir, 'settings.json'), 'utf8')).toBe('{"theme":"frosted"}');
  });

  it('never overwrites a file that already exists in the new directory', async () => {
    await seedLegacyState();
    await mkdir(newDir, { recursive: true });
    await writeFile(join(newDir, 'signatures.json'), '[{"keep":true}]');

    const outcome = await migrateLegacyUserData(newDir, oldDir);

    expect(outcome.kind).toBe('migrated');
    // Existing new-dir signatures survive; settings is copied in.
    expect(await readFile(join(newDir, 'signatures.json'), 'utf8')).toBe('[{"keep":true}]');
    expect(await readFile(join(newDir, 'settings.json'), 'utf8')).toBe('{"theme":"frosted"}');
  });

  it('skips when old and new resolve to the same directory', async () => {
    const outcome = await migrateLegacyUserData(oldDir.toUpperCase(), oldDir);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'same-dir' });
  });
});
