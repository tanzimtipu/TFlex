import { mkdir, mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, SettingsService } from '../../../src/main/services/settings';
import type { RecentFile } from '../../../src/shared/types';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-settings-'));
  file = join(dir, 'settings.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SettingsService.load', () => {
  it('returns defaults when the file is missing', async () => {
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('returns corrupt-settings when the JSON is unparseable', async () => {
    await writeFile(file, '{ "theme": "dark",,, ', 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('corrupt-settings');
    }
  });

  it('returns corrupt-settings when the JSON is not an object', async () => {
    await writeFile(file, '"just a string"', 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('corrupt-settings');
    }
  });

  it('normalizes settings: valid theme kept, invalid theme defaulted', async () => {
    const svc = new SettingsService(file);
    expect(normalizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(normalizeSettings({ theme: 'dark' }).theme).toBe('dark');
    expect(normalizeSettings({ theme: 'purple' }).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(normalizeSettings({}).theme).toBe(DEFAULT_SETTINGS.theme);
    void svc;
  });

  it('caps recentFiles to 10 and drops entries with non-string fields', async () => {
    const many: unknown[] = [];
    for (let i = 0; i < 14; i++) {
      many.push({ path: `p${i}`, name: `n${i}`, openedAt: '2026-01-01T00:00:00.000Z' });
    }
    many.push({ path: 1, name: 'bad', openedAt: '2026-01-01T00:00:00.000Z' });
    many.push({ path: 'p', name: undefined, openedAt: 'x' });
    many.push('not-an-object');
    many.push(null);

    const normalized = normalizeSettings({ recentFiles: many });
    expect(normalized.recentFiles).toHaveLength(10);
    expect(normalized.recentFiles[0].path).toBe('p0');
    for (const f of normalized.recentFiles) {
      expect(typeof f.path).toBe('string');
      expect(typeof f.name).toBe('string');
      expect(typeof f.openedAt).toBe('string');
    }
  });

  it('normalizes geometry: missing keys get defaults, garbage numbers dropped', async () => {
    expect(normalizeSettings({ geometry: { width: 800, height: 600 } }).geometry).toEqual({
      ...DEFAULT_SETTINGS.geometry,
      width: 800,
      height: 600,
    });
    expect(
      normalizeSettings({ geometry: { x: 'a', width: Number.NaN, maximized: 'yes' } }).geometry,
    ).toEqual(DEFAULT_SETTINGS.geometry);
  });

  it('save/load round-trips', async () => {
    const svc = new SettingsService(file);
    const recent: RecentFile = { path: '/a/b.pdf', name: 'b.pdf', openedAt: new Date().toISOString() };
    const settings = {
      theme: 'light' as const,
      geometry: { x: 1, y: 2, width: 1000, height: 700, maximized: true },
      recentFiles: [recent],
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(settings);
    }
  });

  it('addRecentFile dedupes by path and puts newest first', async () => {
    const svc = new SettingsService(file);
    await svc.addRecentFile({ path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-01T00:00:00.000Z' });
    await svc.addRecentFile({ path: '/b.pdf', name: 'b.pdf', openedAt: '2026-01-02T00:00:00.000Z' });
    await svc.addRecentFile({ path: '/a.pdf', name: 'a.pdf', openedAt: '2026-01-03T00:00:00.000Z' });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recentFiles.map((f) => f.path)).toEqual(['/a.pdf', '/b.pdf']);
    }
  });

  it('save writes through a tmp file and renames', async () => {
    const svc = new SettingsService(file);
    await svc.save(DEFAULT_SETTINGS);
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text)).toEqual(DEFAULT_SETTINGS);
  });

  // DEF-005: serialized save queue prevents rename race
  it('serializes concurrent save calls so both succeed', async () => {
    const svc = new SettingsService(file);
    const a = { ...DEFAULT_SETTINGS, theme: 'light' as const };
    const b = { ...DEFAULT_SETTINGS, theme: 'dark' as const };
    await Promise.all([svc.save(a), svc.save(b)]);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The last save in the queue wins
      expect(result.value.theme).toBe('dark');
    }
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text).theme).toBe('dark');
  });

  it('serialized queue: rapid saves produce consistent file content', async () => {
    const svc = new SettingsService(file);
    const saves: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      saves.push(svc.save({ ...DEFAULT_SETTINGS, geometry: { ...DEFAULT_SETTINGS.geometry, width: 800 + i } }));
    }
    await Promise.all(saves);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Last save should have width = 800 + 9 = 809
      expect(result.value.geometry.width).toBe(809);
    }
    const text = await readFile(file, 'utf8');
    const parsed = JSON.parse(text);
    expect(parsed.geometry.width).toBe(809);
  });

  // DEF-004: failed save cleans up .tmp file
  it('cleans up .tmp file when rename fails', async () => {
    // Make the target path a directory so rename fails with EISDIR/ENOTDIR
    await mkdir(file, { recursive: true });

    const svc = new SettingsService(file);
    let threw = false;
    try {
      await svc.save({ ...DEFAULT_SETTINGS, theme: 'light' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // Verify the .tmp file was cleaned up
    let tmpExists = false;
    try {
      await stat(`${file}.tmp`);
      tmpExists = true;
    } catch {
      // Expected — tmp should not exist
    }
    expect(tmpExists).toBe(false);
  });

  // DEF-007: geometry clamping
  it('normalizeGeometry clamps width below 640 and height below 480', () => {
    const clamped = normalizeSettings({
      geometry: { width: 200, height: 100 },
    });
    expect(clamped.geometry.width).toBe(640);
    expect(clamped.geometry.height).toBe(480);
  });

  it('normalizeGeometry clamps zero and negative dimensions to minimums', () => {
    const zero = normalizeSettings({ geometry: { width: 0, height: 0 } });
    expect(zero.geometry.width).toBe(640);
    expect(zero.geometry.height).toBe(480);

    const neg = normalizeSettings({ geometry: { width: -100, height: -50 } });
    expect(neg.geometry.width).toBe(640);
    expect(neg.geometry.height).toBe(480);
  });

  it('normalizeGeometry passes through valid dimensions unchanged', () => {
    const valid = normalizeSettings({ geometry: { width: 1024, height: 768 } });
    expect(valid.geometry.width).toBe(1024);
    expect(valid.geometry.height).toBe(768);
  });
});
