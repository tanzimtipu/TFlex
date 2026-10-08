import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ADV-248: `save()` must persist the value passed at call time, not whatever
// `this.current` holds when the queued write later executes. A failed write
// rolls `this.current` back to `this.persisted` (DEF-230); if the next queued
// save reads `this.current` at execution time it persists the rolled-back value
// and the user's newer change never reaches disk.
//
// This mock wraps the real `writeFile` so we can make exactly one write fail
// while every other fs call stays real.
const fsState = vi.hoisted(() => ({
  failNextWrite: false,
  realWriteFile: null as null | typeof import('node:fs/promises').writeFile,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  fsState.realWriteFile = actual.writeFile;
  return {
    ...actual,
    writeFile: vi.fn((...args: any[]) => {
      if (fsState.failNextWrite) {
        fsState.failNextWrite = false;
        return Promise.reject(new Error('disk full'));
      }
      return (fsState.realWriteFile as (...a: any[]) => Promise<void>)(...args);
    }),
  };
});

import {
  DEFAULT_SETTINGS,
  SettingsService,
} from '../../../src/main/services/settings';
import type { AppSettings } from '../../../src/shared/types';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-settings-queue-'));
  file = join(dir, 'settings.json');
  fsState.failNextWrite = false;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SettingsService.save snapshot at call time (ADV-248)', () => {
  it('persists the newer queued save when the earlier queued write fails', async () => {
    const errors: string[] = [];
    const svc = new SettingsService(file, undefined, (m) => errors.push(m));

    const X: AppSettings = { ...DEFAULT_SETTINGS, theme: 'light' };
    const Z: AppSettings = { ...DEFAULT_SETTINGS, theme: 'dark' };

    fsState.failNextWrite = true;
    const first = svc.save(X);
    const second = svc.save(Z);
    await Promise.all([first, second]);

    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text).theme).toBe('dark');
    expect(svc.getCurrent().theme).toBe('dark');
    expect(errors).toHaveLength(1);
  });

  it('a single failed save still leaves current at the last persisted value (DEF-230)', async () => {
    const errors: string[] = [];
    const svc = new SettingsService(file, undefined, (m) => errors.push(m));

    await svc.save({ ...DEFAULT_SETTINGS, theme: 'dark' });

    fsState.failNextWrite = true;
    await svc.save({ ...DEFAULT_SETTINGS, theme: 'light' });

    expect(svc.getCurrent().theme).toBe('dark');
    expect(errors).toHaveLength(1);
  });
});
