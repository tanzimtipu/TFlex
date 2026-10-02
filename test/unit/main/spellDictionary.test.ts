import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DictionaryService } from '../../../src/main/services/dictionary';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-dict-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('DictionaryService.load', () => {
  it('returns the raw words for a bundled language file', async () => {
    const raw = 'hello\nworld\n';
    await writeFile(join(dir, 'en-us.txt'), raw, 'utf8');
    const svc = new DictionaryService(dir);
    const result = await svc.load('en-US');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.language).toBe('en-US');
      expect(result.value.words).toBe(raw);
    }
  });

  it('returns a typed not-found error when the file is missing', async () => {
    const svc = new DictionaryService(dir);
    const result = await svc.load('en-US');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-found');
    }
  });

  it('returns a typed read-failed error when the path is unreadable', async () => {
    await mkdir(join(dir, 'en-us.txt'));
    const svc = new DictionaryService(dir);
    const result = await svc.load('en-US');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('read-failed');
    }
  });
});