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

describe('Phase 8: optimizePreset validation', () => {
  it('preserves valid optimizePreset values', () => {
    expect(normalizeSettings({ optimizePreset: 'none' }).optimizePreset).toBe('none');
    expect(normalizeSettings({ optimizePreset: 'compact' }).optimizePreset).toBe('compact');
    expect(normalizeSettings({ optimizePreset: 'max' }).optimizePreset).toBe('max');
  });

  it('rejects invalid optimizePreset values (not set on output)', () => {
    expect(normalizeSettings({ optimizePreset: 'screen' }).optimizePreset).toBeUndefined();
    expect(normalizeSettings({ optimizePreset: 'ebook' }).optimizePreset).toBeUndefined();
    expect(normalizeSettings({ optimizePreset: 123 }).optimizePreset).toBeUndefined();
    expect(normalizeSettings({ optimizePreset: true }).optimizePreset).toBeUndefined();
    expect(normalizeSettings({ optimizePreset: '' }).optimizePreset).toBeUndefined();
  });

  it('does not set optimizePreset when absent', () => {
    expect(normalizeSettings({}).optimizePreset).toBeUndefined();
  });

  it('save/load round-trips optimizePreset', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      optimizePreset: 'compact' as const,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.optimizePreset).toBe('compact');
    }
  });
});

// DEF-043: annotationColors normalization preserves AnnotationColorPreset objects
describe('DEF-043: annotationColors normalization', () => {
  it('preserves {id, hex} objects in light bucket', () => {
    const result = normalizeSettings({
      annotationColors: {
        light: [{ id: 'custom-1', hex: '#ff0000' }, { id: 'custom-2', hex: '#00ff00' }],
      },
    });
    expect(result.annotationColors).toBeDefined();
    expect(result.annotationColors!.light).toEqual([
      { id: 'custom-1', hex: '#ff0000' },
      { id: 'custom-2', hex: '#00ff00' },
    ]);
  });

  it('preserves {id, hex} objects in dark bucket', () => {
    const result = normalizeSettings({
      annotationColors: {
        dark: [{ id: 'a', hex: '#123456' }],
      },
    });
    expect(result.annotationColors).toBeDefined();
    expect(result.annotationColors!.dark).toEqual([
      { id: 'a', hex: '#123456' },
    ]);
  });

  it('converts plain strings to {id: hex, hex} objects', () => {
    const result = normalizeSettings({
      annotationColors: {
        light: ['#ff0000', '#00ff00'],
      },
    });
    expect(result.annotationColors).toBeDefined();
    expect(result.annotationColors!.light).toEqual([
      { id: '#ff0000', hex: '#ff0000' },
      { id: '#00ff00', hex: '#00ff00' },
    ]);
  });

  it('handles mixed arrays of strings and objects', () => {
    const result = normalizeSettings({
      annotationColors: {
        light: ['#ff0000', { id: 'custom-1', hex: '#00ff00' }, '#0000ff'],
      },
    });
    expect(result.annotationColors).toBeDefined();
    expect(result.annotationColors!.light).toEqual([
      { id: '#ff0000', hex: '#ff0000' },
      { id: 'custom-1', hex: '#00ff00' },
      { id: '#0000ff', hex: '#0000ff' },
    ]);
  });

  it('drops invalid entries (empty strings, missing fields, non-object non-string)', () => {
    const result = normalizeSettings({
      annotationColors: {
        light: [
          '',
          { id: '', hex: '#abc' },
          { id: 'valid', hex: '' },
          { hex: '#bad' }, // missing id
          { id: 'nohex' }, // missing hex
          123,
          true,
          null,
          '#ff0000',
        ],
      },
    });
    expect(result.annotationColors).toBeDefined();
    expect(result.annotationColors!.light).toHaveLength(1);
    expect(result.annotationColors!.light![0]).toEqual({ id: '#ff0000', hex: '#ff0000' });
  });

  it('preserves both light and dark buckets when both are present', () => {
    const result = normalizeSettings({
      annotationColors: {
        light: [{ id: 'l', hex: '#aaa' }],
        dark: ['#bbb'],
      },
    });
    expect(result.annotationColors).toBeDefined();
    expect(result.annotationColors!.light).toEqual([{ id: 'l', hex: '#aaa' }]);
    expect(result.annotationColors!.dark).toEqual([{ id: '#bbb', hex: '#bbb' }]);
  });

  it('does not set annotationColors when bucket arrays are empty', () => {
    const empty = normalizeSettings({
      annotationColors: { light: [], dark: [] },
    });
    expect(empty.annotationColors).toBeUndefined();

    const allInvalid = normalizeSettings({
      annotationColors: { light: [null, 123, ''] },
    });
    expect(allInvalid.annotationColors).toBeUndefined();
  });

  it('does not set annotationColors when key is missing', () => {
    expect(normalizeSettings({}).annotationColors).toBeUndefined();
  });

  it('does not set annotationColors when value is not an object', () => {
    expect(normalizeSettings({ annotationColors: 'nope' }).annotationColors).toBeUndefined();
    expect(normalizeSettings({ annotationColors: 123 }).annotationColors).toBeUndefined();
  });

  it('save/load round-trips annotationColors with objects', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      annotationColors: {
        light: [{ id: 'c1', hex: '#ff0000' }, { id: 'c2', hex: '#00ff00' }],
        dark: [{ id: 'c3', hex: '#0000ff' }],
      },
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.annotationColors).toEqual({
        light: [{ id: 'c1', hex: '#ff0000' }, { id: 'c2', hex: '#00ff00' }],
        dark: [{ id: 'c3', hex: '#0000ff' }],
      });
    }
  });
});

// DEF-044: saveCurrent reads state at execution time, not enqueue time
describe('DEF-044: saveCurrent race-condition fix', () => {
  it('saveCurrent reads this.current at execution time, not enqueue time', async () => {
    const svc = new SettingsService(file);
    // Load defaults into the service's in-memory state
    const loaded = await svc.load();
    expect(loaded.ok).toBe(true);

    // Enqueue a renderer-style save with a new theme
    const rendererSave = svc.save({
      ...DEFAULT_SETTINGS,
      theme: 'light' as const,
      annotationColors: {
        light: [{ id: 'c1', hex: '#ff0000' }],
      },
    });

    // Immediately call saveCurrent — this mimics window-all-closed firing
    // while the renderer save is still in the queue
    const quitSave = svc.saveCurrent();

    // Wait for both to complete
    await Promise.all([rendererSave, quitSave]);

    // The renderer save ran first (it was enqueued first),
    // then saveCurrent should have read this.current (updated by renderer save)
    // and written that to disk
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.theme).toBe('light');
      expect(result.value.annotationColors).toBeDefined();
      expect(result.value.annotationColors!.light).toEqual([{ id: 'c1', hex: '#ff0000' }]);
    }
  });

  it('saveCurrent after a series of saves sees the latest state', async () => {
    const svc = new SettingsService(file);
    const loaded = await svc.load();
    expect(loaded.ok).toBe(true);

    // Simulate rapid theme toggles from the renderer
    const save1 = svc.save({ ...DEFAULT_SETTINGS, theme: 'light' as const });
    const save2 = svc.save({
      ...DEFAULT_SETTINGS,
      theme: 'dark' as const,
      annotationColors: { light: [{ id: 'a', hex: '#111' }] },
    });
    const save3 = svc.save({
      ...DEFAULT_SETTINGS,
      theme: 'light' as const,
      annotationColors: { light: [{ id: 'a', hex: '#111' }, { id: 'b', hex: '#222' }] },
    });

    // saveCurrent enqueued after all renderer saves — must see save3's state
    const quitSave = svc.saveCurrent();

    await Promise.all([save1, save2, save3, quitSave]);

    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.theme).toBe('light');
      expect(result.value.annotationColors!.light).toEqual([
        { id: 'a', hex: '#111' },
        { id: 'b', hex: '#222' },
      ]);
    }
  });

  it('saveCurrent without any prior save writes current in-memory state', async () => {
    const svc = new SettingsService(file);
    const loaded = await svc.load();
    expect(loaded.ok).toBe(true);

    await svc.saveCurrent();

    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.theme).toBe(DEFAULT_SETTINGS.theme);
    }
  });

  it('saveCurrent preserves changes from a fully-flushed renderer save', async () => {
    const svc = new SettingsService(file);
    await svc.load();

    // Simulate a normal flow: renderer saves, then user quits
    await svc.save({
      ...DEFAULT_SETTINGS,
      theme: 'light' as const,
      annotationColors: { dark: [{ id: 'dc1', hex: '#333' }] },
    });

    // Now call saveCurrent (window-all-closed)
    await svc.saveCurrent();

    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.theme).toBe('light');
      expect(result.value.annotationColors!.dark).toEqual([{ id: 'dc1', hex: '#333' }]);
    }
  });
});

// Phase 9: exportImageFormat, exportImageDpi, createImageQuality validation
describe('Phase 9: create + export settings validation', () => {
  it('preserves valid exportImageFormat values', () => {
    expect(normalizeSettings({ exportImageFormat: 'png' }).exportImageFormat).toBe('png');
    expect(normalizeSettings({ exportImageFormat: 'jpeg' }).exportImageFormat).toBe('jpeg');
    expect(normalizeSettings({ exportImageFormat: 'tiff' }).exportImageFormat).toBe('tiff');
  });

  it('rejects invalid exportImageFormat values', () => {
    expect(normalizeSettings({ exportImageFormat: 'webp' }).exportImageFormat).toBeUndefined();
    expect(normalizeSettings({ exportImageFormat: 123 }).exportImageFormat).toBeUndefined();
    expect(normalizeSettings({ exportImageFormat: '' }).exportImageFormat).toBeUndefined();
    expect(normalizeSettings({ exportImageFormat: true }).exportImageFormat).toBeUndefined();
  });

  it('does not set exportImageFormat when absent', () => {
    expect(normalizeSettings({}).exportImageFormat).toBeUndefined();
  });

  it('preserves valid exportImageDpi values', () => {
    expect(normalizeSettings({ exportImageDpi: 72 }).exportImageDpi).toBe(72);
    expect(normalizeSettings({ exportImageDpi: 150 }).exportImageDpi).toBe(150);
    expect(normalizeSettings({ exportImageDpi: 300 }).exportImageDpi).toBe(300);
    expect(normalizeSettings({ exportImageDpi: 600 }).exportImageDpi).toBe(600);
  });

  it('rejects exportImageDpi outside 72-600 range', () => {
    expect(normalizeSettings({ exportImageDpi: 71 }).exportImageDpi).toBeUndefined();
    expect(normalizeSettings({ exportImageDpi: 601 }).exportImageDpi).toBeUndefined();
    expect(normalizeSettings({ exportImageDpi: 0 }).exportImageDpi).toBeUndefined();
    expect(normalizeSettings({ exportImageDpi: -1 }).exportImageDpi).toBeUndefined();
  });

  it('rejects non-numeric exportImageDpi values', () => {
    expect(normalizeSettings({ exportImageDpi: '150' }).exportImageDpi).toBeUndefined();
    expect(normalizeSettings({ exportImageDpi: true }).exportImageDpi).toBeUndefined();
    expect(normalizeSettings({ exportImageDpi: NaN }).exportImageDpi).toBeUndefined();
    expect(normalizeSettings({ exportImageDpi: Infinity }).exportImageDpi).toBeUndefined();
  });

  it('does not set exportImageDpi when absent', () => {
    expect(normalizeSettings({}).exportImageDpi).toBeUndefined();
  });

  it('preserves valid createImageQuality values', () => {
    expect(normalizeSettings({ createImageQuality: 0 }).createImageQuality).toBe(0);
    expect(normalizeSettings({ createImageQuality: 0.5 }).createImageQuality).toBe(0.5);
    expect(normalizeSettings({ createImageQuality: 1 }).createImageQuality).toBe(1);
    expect(normalizeSettings({ createImageQuality: 0.85 }).createImageQuality).toBe(0.85);
  });

  it('rejects createImageQuality outside 0-1 range', () => {
    expect(normalizeSettings({ createImageQuality: -0.1 }).createImageQuality).toBeUndefined();
    expect(normalizeSettings({ createImageQuality: 1.1 }).createImageQuality).toBeUndefined();
    expect(normalizeSettings({ createImageQuality: 2 }).createImageQuality).toBeUndefined();
    expect(normalizeSettings({ createImageQuality: -1 }).createImageQuality).toBeUndefined();
  });

  it('rejects non-numeric createImageQuality values', () => {
    expect(normalizeSettings({ createImageQuality: '0.5' }).createImageQuality).toBeUndefined();
    expect(normalizeSettings({ createImageQuality: true }).createImageQuality).toBeUndefined();
    expect(normalizeSettings({ createImageQuality: NaN }).createImageQuality).toBeUndefined();
    expect(normalizeSettings({ createImageQuality: Infinity }).createImageQuality).toBeUndefined();
  });

  it('does not set createImageQuality when absent', () => {
    expect(normalizeSettings({}).createImageQuality).toBeUndefined();
  });

  it('save/load round-trips all Phase 9 settings', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      exportImageFormat: 'jpeg' as const,
      exportImageDpi: 300,
      createImageQuality: 0.85,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.exportImageFormat).toBe('jpeg');
      expect(result.value.exportImageDpi).toBe(300);
      expect(result.value.createImageQuality).toBe(0.85);
    }
  });
});

// Phase 10: editDefaultFont validation
describe('Phase 10: editDefaultFont validation', () => {
  it('preserves valid editDefaultFont values', () => {
    expect(normalizeSettings({ editDefaultFont: 'Helvetica' }).editDefaultFont).toBe('Helvetica');
    expect(normalizeSettings({ editDefaultFont: 'Times' }).editDefaultFont).toBe('Times');
    expect(normalizeSettings({ editDefaultFont: 'Courier' }).editDefaultFont).toBe('Courier');
  });

  it('rejects editDefaultFont values outside the allowlist', () => {
    expect(normalizeSettings({ editDefaultFont: 'Arial' }).editDefaultFont).toBeUndefined();
    expect(normalizeSettings({ editDefaultFont: 'Symbol' }).editDefaultFont).toBeUndefined();
    expect(normalizeSettings({ editDefaultFont: 'ZapfDingbats' }).editDefaultFont).toBeUndefined();
    expect(normalizeSettings({ editDefaultFont: 'helvetica' }).editDefaultFont).toBeUndefined();
  });

  it('rejects non-string editDefaultFont values', () => {
    expect(normalizeSettings({ editDefaultFont: 123 }).editDefaultFont).toBeUndefined();
    expect(normalizeSettings({ editDefaultFont: true }).editDefaultFont).toBeUndefined();
    expect(normalizeSettings({ editDefaultFont: null }).editDefaultFont).toBeUndefined();
    expect(normalizeSettings({ editDefaultFont: ['Helvetica'] }).editDefaultFont).toBeUndefined();
  });

  it('does not set editDefaultFont when absent (renderer applies its own default)', () => {
    expect(normalizeSettings({}).editDefaultFont).toBeUndefined();
  });

  it('save/load round-trips editDefaultFont', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      editDefaultFont: 'Times' as const,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.editDefaultFont).toBe('Times');
    }
  });

  it('invalid editDefaultFont on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      editDefaultFont: 'ComicSans',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.editDefaultFont).toBeUndefined();
      expect(result.value.theme).toBe('light');
    }
  });
});

// Phase 11: ocrLanguage + ocrDownsample validation
describe('Phase 11: OCR settings validation', () => {
  const VALID_LANGS = ['eng', 'deu', 'fra', 'spa', 'ita', 'por', 'rus', 'chi_sim', 'jpn'];

  it('preserves valid ocrLanguage values', () => {
    for (const lang of VALID_LANGS) {
      expect(normalizeSettings({ ocrLanguage: lang }).ocrLanguage).toBe(lang);
    }
  });

  it('rejects ocrLanguage values outside the allowlist', () => {
    expect(normalizeSettings({ ocrLanguage: 'english' }).ocrLanguage).toBeUndefined();
    expect(normalizeSettings({ ocrLanguage: 'en' }).ocrLanguage).toBeUndefined();
    expect(normalizeSettings({ ocrLanguage: 'chi' }).ocrLanguage).toBeUndefined();
    expect(normalizeSettings({ ocrLanguage: 'ENG' }).ocrLanguage).toBeUndefined();
    expect(normalizeSettings({ ocrLanguage: '' }).ocrLanguage).toBeUndefined();
  });

  it('rejects non-string ocrLanguage values', () => {
    expect(normalizeSettings({ ocrLanguage: 123 }).ocrLanguage).toBeUndefined();
    expect(normalizeSettings({ ocrLanguage: true }).ocrLanguage).toBeUndefined();
    expect(normalizeSettings({ ocrLanguage: null }).ocrLanguage).toBeUndefined();
    expect(normalizeSettings({ ocrLanguage: ['eng'] }).ocrLanguage).toBeUndefined();
  });

  it('does not set ocrLanguage when absent', () => {
    expect(normalizeSettings({}).ocrLanguage).toBeUndefined();
  });

  it('preserves valid ocrDownsample values', () => {
    expect(normalizeSettings({ ocrDownsample: 72 }).ocrDownsample).toBe(72);
    expect(normalizeSettings({ ocrDownsample: 150 }).ocrDownsample).toBe(150);
    expect(normalizeSettings({ ocrDownsample: 300 }).ocrDownsample).toBe(300);
    expect(normalizeSettings({ ocrDownsample: 600 }).ocrDownsample).toBe(600);
  });

  it('rejects ocrDownsample outside 72-600 range', () => {
    expect(normalizeSettings({ ocrDownsample: 71 }).ocrDownsample).toBeUndefined();
    expect(normalizeSettings({ ocrDownsample: 601 }).ocrDownsample).toBeUndefined();
    expect(normalizeSettings({ ocrDownsample: 0 }).ocrDownsample).toBeUndefined();
    expect(normalizeSettings({ ocrDownsample: -1 }).ocrDownsample).toBeUndefined();
  });

  it('rejects non-numeric ocrDownsample values', () => {
    expect(normalizeSettings({ ocrDownsample: '300' }).ocrDownsample).toBeUndefined();
    expect(normalizeSettings({ ocrDownsample: true }).ocrDownsample).toBeUndefined();
    expect(normalizeSettings({ ocrDownsample: NaN }).ocrDownsample).toBeUndefined();
    expect(normalizeSettings({ ocrDownsample: Infinity }).ocrDownsample).toBeUndefined();
  });

  it('does not set ocrDownsample when absent', () => {
    expect(normalizeSettings({}).ocrDownsample).toBeUndefined();
  });

  it('save/load round-trips ocrLanguage + ocrDownsample', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      ocrLanguage: 'deu' as const,
      ocrDownsample: 200,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ocrLanguage).toBe('deu');
      expect(result.value.ocrDownsample).toBe(200);
    }
  });

  it('invalid ocrLanguage/ocrDownsample on disk are dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      ocrLanguage: 'klingon',
      ocrDownsample: 9999,
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ocrLanguage).toBeUndefined();
      expect(result.value.ocrDownsample).toBeUndefined();
      expect(result.value.theme).toBe('light');
    }
  });
});

// Phase 12: defaultStampId validation
describe('Phase 12: defaultStampId validation', () => {
  it('preserves valid defaultStampId values', () => {
    expect(normalizeSettings({ defaultStampId: 'APPROVED' }).defaultStampId).toBe('APPROVED');
    expect(normalizeSettings({ defaultStampId: 'DRAFT' }).defaultStampId).toBe('DRAFT');
    expect(normalizeSettings({ defaultStampId: 'CONFIDENTIAL' }).defaultStampId).toBe('CONFIDENTIAL');
    expect(normalizeSettings({ defaultStampId: 'FINAL' }).defaultStampId).toBe('FINAL');
  });

  it('rejects defaultStampId values outside the allowlist', () => {
    expect(normalizeSettings({ defaultStampId: 'approved' }).defaultStampId).toBeUndefined();
    expect(normalizeSettings({ defaultStampId: 'REVIEWED' }).defaultStampId).toBeUndefined();
    expect(normalizeSettings({ defaultStampId: 'SIGN' }).defaultStampId).toBeUndefined();
    expect(normalizeSettings({ defaultStampId: '' }).defaultStampId).toBeUndefined();
  });

  it('rejects non-string defaultStampId values', () => {
    expect(normalizeSettings({ defaultStampId: 123 }).defaultStampId).toBeUndefined();
    expect(normalizeSettings({ defaultStampId: true }).defaultStampId).toBeUndefined();
    expect(normalizeSettings({ defaultStampId: null }).defaultStampId).toBeUndefined();
    expect(normalizeSettings({ defaultStampId: ['APPROVED'] }).defaultStampId).toBeUndefined();
  });

  it('does not set defaultStampId when absent (consumer applies the default)', () => {
    expect(normalizeSettings({}).defaultStampId).toBeUndefined();
  });

  it('save/load round-trips defaultStampId', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      defaultStampId: 'DRAFT' as const,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaultStampId).toBe('DRAFT');
    }
  });

  it('invalid defaultStampId on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      defaultStampId: 'NOTASTAMP',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaultStampId).toBeUndefined();
      expect(result.value.theme).toBe('light');
    }
  });
});
