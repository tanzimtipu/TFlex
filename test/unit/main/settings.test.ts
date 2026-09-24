import { mkdir, mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANNOTATION_RECENT_TOOLS_CAP, DEFAULT_SETTINGS, DOCK_PINS_CAP, DOCK_UNPINNED_CAP, TOOL_USAGE_CAP, normalizeAnnotationRecentTools, normalizeSettings, SettingsService } from '../../../src/main/services/settings';
import type { AppSettings, RecentFile } from '../../../src/shared/types';

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
    expect(normalizeSettings({ theme: 'frosted' }).theme).toBe('frosted');
    expect(normalizeSettings({ theme: 'purple' }).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(normalizeSettings({}).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(DEFAULT_SETTINGS.theme).toBe('frosted');
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
  // DEF-230: the failed save now RESOLVES (no rejection reaches IPC) and
  // reports via the write-error callback; the tmp cleanup assertion stays.
  it('cleans up .tmp file when rename fails', async () => {
    // Make the target path a directory so rename fails with EISDIR/ENOTDIR
    await mkdir(file, { recursive: true });

    const errors: string[] = [];
    const svc = new SettingsService(file, undefined, (m) => errors.push(m));
    await expect(svc.save({ ...DEFAULT_SETTINGS, theme: 'light' })).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);

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

  // Phase 27 — the allowlist widens with the bundled OFL families; an unknown
  // id is still rejected (preserve-if-valid / reject-if-invalid).
  it('preserves the Phase-27 bundled family ids and still rejects near-misses', () => {
    expect(normalizeSettings({ editDefaultFont: 'Liberation Sans' }).editDefaultFont).toBe('Liberation Sans');
    expect(normalizeSettings({ editDefaultFont: 'DejaVu Serif' }).editDefaultFont).toBe('DejaVu Serif');
    expect(normalizeSettings({ editDefaultFont: 'DejaVu Sans Mono' }).editDefaultFont).toBe('DejaVu Sans Mono');
    expect(normalizeSettings({ editDefaultFont: 'LiberationSans' }).editDefaultFont).toBeUndefined();
    expect(normalizeSettings({ editDefaultFont: 'dejavu serif' }).editDefaultFont).toBeUndefined();
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

// Phase 13 / DEF-073: saveAsLinearize validation
describe('Phase 13 / DEF-073: saveAsLinearize validation', () => {
  it('preserves valid saveAsLinearize booleans', () => {
    expect(normalizeSettings({ saveAsLinearize: true }).saveAsLinearize).toBe(true);
    expect(normalizeSettings({ saveAsLinearize: false }).saveAsLinearize).toBe(false);
  });

  it('rejects non-boolean saveAsLinearize values (left unset; consumer applies default false)', () => {
    expect(normalizeSettings({ saveAsLinearize: 'true' }).saveAsLinearize).toBeUndefined();
    expect(normalizeSettings({ saveAsLinearize: 1 }).saveAsLinearize).toBeUndefined();
    expect(normalizeSettings({ saveAsLinearize: 0 }).saveAsLinearize).toBeUndefined();
    expect(normalizeSettings({ saveAsLinearize: 'false' }).saveAsLinearize).toBeUndefined();
    expect(normalizeSettings({ saveAsLinearize: null }).saveAsLinearize).toBeUndefined();
    expect(normalizeSettings({ saveAsLinearize: undefined }).saveAsLinearize).toBeUndefined();
    expect(normalizeSettings({ saveAsLinearize: ['true'] }).saveAsLinearize).toBeUndefined();
    expect(normalizeSettings({ saveAsLinearize: { value: true } }).saveAsLinearize).toBeUndefined();
  });

  it('does not set saveAsLinearize when absent', () => {
    expect(normalizeSettings({}).saveAsLinearize).toBeUndefined();
  });

  it('save/load round-trips saveAsLinearize', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      saveAsLinearize: true,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.saveAsLinearize).toBe(true);
    }
  });

  it('invalid saveAsLinearize on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      saveAsLinearize: 'yes',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.saveAsLinearize).toBeUndefined();
      expect(result.value.theme).toBe('light');
    }
  });
});

// Phase 16: pagesPanelCollapsed validation
describe('Phase 16: pagesPanelCollapsed validation', () => {
  it('preserves pagesPanelCollapsed: true', () => {
    expect(normalizeSettings({ pagesPanelCollapsed: true }).pagesPanelCollapsed).toBe(true);
  });

  it('preserves pagesPanelCollapsed: false', () => {
    expect(normalizeSettings({ pagesPanelCollapsed: false }).pagesPanelCollapsed).toBe(false);
  });

  it('rejects non-boolean pagesPanelCollapsed values (left undefined)', () => {
    expect(normalizeSettings({ pagesPanelCollapsed: 'yes' }).pagesPanelCollapsed).toBeUndefined();
    expect(normalizeSettings({ pagesPanelCollapsed: 'no' }).pagesPanelCollapsed).toBeUndefined();
    expect(normalizeSettings({ pagesPanelCollapsed: 1 }).pagesPanelCollapsed).toBeUndefined();
    expect(normalizeSettings({ pagesPanelCollapsed: 0 }).pagesPanelCollapsed).toBeUndefined();
    expect(normalizeSettings({ pagesPanelCollapsed: null }).pagesPanelCollapsed).toBeUndefined();
    expect(normalizeSettings({ pagesPanelCollapsed: undefined }).pagesPanelCollapsed).toBeUndefined();
    expect(normalizeSettings({ pagesPanelCollapsed: ['true'] }).pagesPanelCollapsed).toBeUndefined();
    expect(normalizeSettings({ pagesPanelCollapsed: { value: true } }).pagesPanelCollapsed).toBeUndefined();
  });

  it('does not set pagesPanelCollapsed when absent (consumer applies default false)', () => {
    const result = normalizeSettings({});
    expect(result.pagesPanelCollapsed).toBeUndefined();
    expect('pagesPanelCollapsed' in result).toBe(false);
  });

  it('save/load round-trips pagesPanelCollapsed', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      pagesPanelCollapsed: true,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pagesPanelCollapsed).toBe(true);
    }
  });

  it('invalid pagesPanelCollapsed on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      pagesPanelCollapsed: 'yes',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pagesPanelCollapsed).toBeUndefined();
      expect('pagesPanelCollapsed' in result.value).toBe(false);
      expect(result.value.theme).toBe('light');
    }
  });
});

// DEF-212: themeDefault validation — preserve-if-valid against
// 'light' | 'dark' | 'system' | 'frosted' (see AppSettings.themeDefault).
describe('DEF-212: themeDefault validation', () => {
  it('preserves all four valid themeDefault values', () => {
    expect(normalizeSettings({ themeDefault: 'light' }).themeDefault).toBe('light');
    expect(normalizeSettings({ themeDefault: 'dark' }).themeDefault).toBe('dark');
    expect(normalizeSettings({ themeDefault: 'system' }).themeDefault).toBe('system');
    expect(normalizeSettings({ themeDefault: 'frosted' }).themeDefault).toBe('frosted');
  });

  it('rejects invalid themeDefault values (not set on output)', () => {
    expect(normalizeSettings({ themeDefault: 'purple' }).themeDefault).toBeUndefined();
    expect(normalizeSettings({ themeDefault: 'Frosted' }).themeDefault).toBeUndefined();
    expect(normalizeSettings({ themeDefault: '' }).themeDefault).toBeUndefined();
    expect(normalizeSettings({ themeDefault: 123 }).themeDefault).toBeUndefined();
    expect(normalizeSettings({ themeDefault: true }).themeDefault).toBeUndefined();
    expect(normalizeSettings({ themeDefault: ['frosted'] }).themeDefault).toBeUndefined();
  });

  it('does not set themeDefault when absent', () => {
    expect(normalizeSettings({}).themeDefault).toBeUndefined();
  });

  it('save/load round-trips themeDefault: frosted', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'frosted' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      themeDefault: 'frosted' as const,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.themeDefault).toBe('frosted');
    }
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text).themeDefault).toBe('frosted');
  });

  it('invalid themeDefault on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      themeDefault: 'neon',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.themeDefault).toBeUndefined();
      expect(result.value.theme).toBe('light');
    }
  });
});

// Phase 19: annotationRecentTools validation
describe('Phase 19: annotationRecentTools validation', () => {
  it('preserves a valid 3-id array in order', () => {
    expect(normalizeSettings({ annotationRecentTools: ['ink', 'highlight', 'select'] }).annotationRecentTools)
      .toEqual(['ink', 'highlight', 'select']);
  });

  it('drops unknown ids and leaves the field absent when none survive', () => {
    expect(normalizeSettings({ annotationRecentTools: ['ink', 'bogus', 'select', 'pen'] }).annotationRecentTools)
      .toEqual(['ink', 'select']);
    expect(normalizeSettings({ annotationRecentTools: ['bogus', 'pen'] }).annotationRecentTools).toBeUndefined();
    expect('annotationRecentTools' in normalizeSettings({ annotationRecentTools: ['bogus'] })).toBe(false);
  });

  it('dedupes duplicates keeping the first occurrence', () => {
    expect(normalizeSettings({ annotationRecentTools: ['rect', 'ink', 'rect', 'ink', 'arrow'] }).annotationRecentTools)
      .toEqual(['rect', 'ink', 'arrow']);
  });

  it('truncates an 8-id array to 6 preserving order', () => {
    const ids = ['select', 'highlight', 'underline', 'strikeout', 'ink', 'textbox', 'rect', 'ellipse'];
    const normalized = normalizeSettings({ annotationRecentTools: ids }).annotationRecentTools;
    expect(normalized).toEqual(['select', 'highlight', 'underline', 'strikeout', 'ink', 'textbox']);
    expect(normalized).toHaveLength(ANNOTATION_RECENT_TOOLS_CAP);
  });

  it('rejects non-array values (leaves the field absent)', () => {
    for (const bad of ['ink', 123, { 0: 'ink' }, null] as unknown[]) {
      expect(normalizeSettings({ annotationRecentTools: bad }).annotationRecentTools).toBeUndefined();
    }
    expect(normalizeAnnotationRecentTools('ink')).toBeNull();
    expect(normalizeAnnotationRecentTools({ 0: 'ink' })).toBeNull();
  });

  it('does not set annotationRecentTools when absent (consumer applies default [])', () => {
    expect(normalizeSettings({}).annotationRecentTools).toBeUndefined();
    expect('annotationRecentTools' in normalizeSettings({})).toBe(false);
  });

  it('save/load round-trips annotationRecentTools order', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      annotationRecentTools: ['ink', 'highlight', 'select'],
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.annotationRecentTools).toEqual(['ink', 'highlight', 'select']);
    }
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text).annotationRecentTools).toEqual(['ink', 'highlight', 'select']);
  });
});

// DEF-230: a failed settings write must not reject the IPC promise and must
// not leave memory claiming a value the disk never got.
describe('DEF-230: settings write failures', () => {
  it('save() resolves, reports once and restores the last persisted state when the parent is a file', async () => {
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'not a directory', 'utf8');
    const badPath = join(blocker, 'settings.json');
    const errors: string[] = [];
    const svc = new SettingsService(badPath, undefined, (m) => errors.push(m));

    const next: AppSettings = { ...structuredClone(DEFAULT_SETTINGS), theme: 'dark' };
    await expect(svc.save(next)).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect(errors[0].length).toBeGreaterThan(0);
    // save() assigns this.current before writing; on failure it must be rolled
    // back to the last persisted snapshot (defaults here), not left at 'dark'.
    expect(svc.getCurrent()).toEqual(DEFAULT_SETTINGS);
  });

  it('addRecentFile resolves under the same failure condition', async () => {
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'not a directory', 'utf8');
    const badPath = join(blocker, 'settings.json');
    const errors: string[] = [];
    const svc = new SettingsService(badPath, undefined, (m) => errors.push(m));

    const recent: RecentFile = { path: join(dir, 'x.pdf'), name: 'x.pdf', openedAt: '2026-01-01T00:00:00.000Z' };
    await expect(svc.addRecentFile(recent)).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(svc.getCurrent().recentFiles).toEqual([]);
  });

  it('rename collision with an existing directory resolves, cleans tmp and reports once', async () => {
    const collision = join(dir, 'collision');
    await mkdir(collision, { recursive: true });
    const errors: string[] = [];
    const svc = new SettingsService(collision, undefined, (m) => errors.push(m));

    await expect(svc.save({ ...structuredClone(DEFAULT_SETTINGS), theme: 'dark' })).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(svc.getCurrent()).toEqual(DEFAULT_SETTINGS);
    await expect(stat(`${collision}.tmp`)).rejects.toThrow();
  });

  it('recovers once the path becomes writable and the queue is not poisoned', async () => {
    const sub = join(dir, 'sub');
    await writeFile(sub, 'blocker', 'utf8');
    const path = join(sub, 'settings.json');
    const errors: string[] = [];
    const saved: AppSettings[] = [];
    const svc = new SettingsService(path, (s) => saved.push(s), (m) => errors.push(m));

    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), theme: 'dark' });
    expect(errors).toHaveLength(1);
    expect(svc.getCurrent()).toEqual(DEFAULT_SETTINGS);

    await rm(sub, { force: true });
    await mkdir(sub, { recursive: true });
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), theme: 'light' });

    expect(errors).toHaveLength(1);
    expect(svc.getCurrent().theme).toBe('light');
    expect(saved).toHaveLength(1);
    expect(saved[0].theme).toBe('light');
    const text = await readFile(path, 'utf8');
    expect(JSON.parse(text).theme).toBe('light');
  });
});

// Phase 23: animationsEnabled validation
describe('Phase 23: animationsEnabled validation', () => {
  it('preserves animationsEnabled: true', () => {
    expect(normalizeSettings({ animationsEnabled: true }).animationsEnabled).toBe(true);
  });

  it('preserves animationsEnabled: false (valid false is not the default)', () => {
    expect(normalizeSettings({ animationsEnabled: false }).animationsEnabled).toBe(false);
  });

  it('rejects non-boolean animationsEnabled values (left undefined)', () => {
    for (const bad of ['true', 'false', 'yes', 1, 0, null, undefined, ['true'], { value: true }] as unknown[]) {
      const result = normalizeSettings({ animationsEnabled: bad });
      expect(result.animationsEnabled).toBeUndefined();
      expect('animationsEnabled' in result).toBe(false);
    }
  });

  it('does not set animationsEnabled when absent (consumer applies default true)', () => {
    const result = normalizeSettings({});
    expect(result.animationsEnabled).toBeUndefined();
    expect('animationsEnabled' in result).toBe(false);
  });

  it('save/load round-trips animationsEnabled: false', async () => {
    const svc = new SettingsService(file);
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), animationsEnabled: false });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.animationsEnabled).toBe(false);
    }
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text).animationsEnabled).toBe(false);
  });

  it('save/load round-trips animationsEnabled: true', async () => {
    const svc = new SettingsService(file);
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), animationsEnabled: true });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.animationsEnabled).toBe(true);
    }
  });

  it('invalid animationsEnabled on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      animationsEnabled: 'off',
      pagesPanelCollapsed: true,
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.animationsEnabled).toBeUndefined();
      expect('animationsEnabled' in result.value).toBe(false);
      expect(result.value.theme).toBe('light');
      expect(result.value.pagesPanelCollapsed).toBe(true);
    }
  });

  it('save/load keeps animationsEnabled together with the rest of the settings', async () => {
    const svc = new SettingsService(file);
    const settings: AppSettings = {
      theme: 'dark',
      geometry: { ...DEFAULT_SETTINGS.geometry, maximized: true },
      recentFiles: [{ path: join(dir, 'a.pdf'), name: 'a.pdf', openedAt: '2026-09-20T00:00:00.000Z' }],
      recentsCap: 5,
      saveAsLinearize: true,
      pagesPanelCollapsed: false,
      annotationRecentTools: ['ink', 'highlight'],
      animationsEnabled: false,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.animationsEnabled).toBe(false);
      expect(result.value.theme).toBe('dark');
      expect(result.value.geometry.maximized).toBe(true);
      expect(result.value.recentFiles).toHaveLength(1);
      expect(result.value.recentsCap).toBe(5);
      expect(result.value.saveAsLinearize).toBe(true);
      expect(result.value.pagesPanelCollapsed).toBe(false);
      expect(result.value.annotationRecentTools).toEqual(['ink', 'highlight']);
    }
  });
});

// DEF-303 — the debounced window-geometry persist must be a disk-only write:
// no `settings:changed` echo, so a geometry-only change cannot make the
// renderer re-render ~300 ms after a maximize. Every other write keeps its echo.
describe('DEF-303: saveGeometryOnly persists without echoing', () => {
  it('writes the geometry to disk but does not call onChange', async () => {
    const echoed: AppSettings[] = [];
    const svc = new SettingsService(file, (s) => echoed.push(s));

    await svc.saveGeometryOnly({
      x: 10, y: 20, width: 1024, height: 768, maximized: true,
    });

    expect(echoed).toHaveLength(0);
    expect(svc.getCurrent().geometry).toEqual({
      x: 10, y: 20, width: 1024, height: 768, maximized: true,
    });
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text).geometry).toEqual({
      x: 10, y: 20, width: 1024, height: 768, maximized: true,
    });
  });

  it('preserves the other settings fields while updating the geometry', async () => {
    const echoed: AppSettings[] = [];
    const svc = new SettingsService(file, (s) => echoed.push(s));
    await svc.save({
      ...structuredClone(DEFAULT_SETTINGS),
      theme: 'dark',
      recentsCap: 5,
      pagesPanelCollapsed: true,
    });
    expect(echoed).toHaveLength(1);

    await svc.saveGeometryOnly({
      x: 1, y: 2, width: 800, height: 600, maximized: false,
    });

    // Only the non-geometry write echoed.
    expect(echoed).toHaveLength(1);
    const text = await readFile(file, 'utf8');
    const onDisk = JSON.parse(text);
    expect(onDisk.theme).toBe('dark');
    expect(onDisk.recentsCap).toBe(5);
    expect(onDisk.pagesPanelCollapsed).toBe(true);
    expect(onDisk.geometry).toEqual({
      x: 1, y: 2, width: 800, height: 600, maximized: false,
    });
  });

  it('normalizes an out-of-range geometry like a normal save (min size floor)', async () => {
    const svc = new SettingsService(file);
    await svc.saveGeometryOnly({
      x: -50, y: -50, width: 100, height: 100, maximized: false,
    });
    const text = await readFile(file, 'utf8');
    const onDisk = JSON.parse(text);
    expect(onDisk.geometry.width).toBe(640);
    expect(onDisk.geometry.height).toBe(480);
  });

  it('a burst of geometry writes still echoes nothing and lands the last value', async () => {
    const echoed: AppSettings[] = [];
    const svc = new SettingsService(file, (s) => echoed.push(s));

    await Promise.all([
      svc.saveGeometryOnly({ x: 1, y: 1, width: 700, height: 500, maximized: false }),
      svc.saveGeometryOnly({ x: 2, y: 2, width: 800, height: 600, maximized: false }),
      svc.saveGeometryOnly({ x: 3, y: 3, width: 900, height: 700, maximized: true }),
    ]);

    expect(echoed).toHaveLength(0);
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text).geometry).toEqual({
      x: 3, y: 3, width: 900, height: 700, maximized: true,
    });
  });

  it('the renderer-initiated save still echoes (the silent path is geometry-only)', async () => {
    const echoed: AppSettings[] = [];
    const svc = new SettingsService(file, (s) => echoed.push(s));

    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), theme: 'light' });

    expect(echoed).toHaveLength(1);
    expect(echoed[0].theme).toBe('light');
  });
});

describe('Phase 36: dockPins validation', () => {
  it('preserves a valid array in order', () => {
    const result = normalizeSettings({ dockPins: ['rotate', 'delete', 'merge'] });
    expect(result.dockPins).toEqual(['rotate', 'delete', 'merge']);
  });

  it('drops non-string entries and empty strings', () => {
    const result = normalizeSettings({ dockPins: ['rotate', 7, null, '', 'delete', {}, 'merge'] as unknown[] });
    expect(result.dockPins).toEqual(['rotate', 'delete', 'merge']);
  });

  it('dedupes duplicates keeping the first occurrence', () => {
    const result = normalizeSettings({ dockPins: ['rotate', 'delete', 'rotate', 'merge', 'delete'] });
    expect(result.dockPins).toEqual(['rotate', 'delete', 'merge']);
  });

  it('truncates an over-long array to DOCK_PINS_CAP preserving order', () => {
    const result = normalizeSettings({ dockPins: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(result.dockPins).toEqual(['a', 'b', 'c', 'd']);
    expect(result.dockPins).toHaveLength(DOCK_PINS_CAP);
  });

  it('truncates after de-duplication, not before', () => {
    const result = normalizeSettings({ dockPins: ['a', 'a', 'b', 'c', 'd', 'e'] });
    expect(result.dockPins).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rejects non-array values (field left absent)', () => {
    for (const bad of ['rotate', 7, null, undefined, {}, { 0: 'rotate' }] as unknown[]) {
      const result = normalizeSettings({ dockPins: bad });
      expect(result.dockPins).toBeUndefined();
      expect('dockPins' in result).toBe(false);
    }
  });

  it('accepts an array whose entries all drop as an empty array', () => {
    const result = normalizeSettings({ dockPins: [1, null, ''] as unknown[] });
    expect(result.dockPins).toEqual([]);
    expect('dockPins' in result).toBe(true);
  });

  it('save/load round-trips dockPins', async () => {
    const svc = new SettingsService(file);
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), dockPins: ['rotate', 'merge'] });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dockPins).toEqual(['rotate', 'merge']);
    }
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk.dockPins).toEqual(['rotate', 'merge']);
  });

  it('invalid dockPins on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      pagesPanelCollapsed: true,
      dockPins: 'rotate',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dockPins).toBeUndefined();
      expect('dockPins' in result.value).toBe(false);
      expect(result.value.pagesPanelCollapsed).toBe(true);
      expect(result.value.theme).toBe('light');
    }
  });
});

describe('Phase 36: toolUsage validation', () => {
  it('preserves a valid map of counts', () => {
    const result = normalizeSettings({ toolUsage: { rotate: 12, merge: 3, delete: 0 } });
    expect(result.toolUsage).toEqual({ rotate: 12, merge: 3, delete: 0 });
  });

  it('drops negative, non-finite, non-integer and non-number values', () => {
    const result = normalizeSettings({
      toolUsage: {
        keep: 4,
        negative: -1,
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
        fraction: 1.5,
        strval: '3',
        boolval: true,
        nullval: null,
      } as unknown as Record<string, number>,
    });
    expect(result.toolUsage).toEqual({ keep: 4 });
  });

  it('drops empty-string keys', () => {
    const result = normalizeSettings({ toolUsage: { '': 9, rotate: 2 } as Record<string, number> });
    expect(result.toolUsage).toEqual({ rotate: 2 });
  });

  it('rejects non-object values wholesale (field left absent)', () => {
    for (const bad of [['rotate', 1], 'rotate', 7, null, undefined, Number.NaN] as unknown[]) {
      const result = normalizeSettings({ toolUsage: bad });
      expect(result.toolUsage).toBeUndefined();
      expect('toolUsage' in result).toBe(false);
    }
  });

  it('rejects an array even when it looks object-like', () => {
    const result = normalizeSettings({ toolUsage: ['a', 'b'] });
    expect(result.toolUsage).toBeUndefined();
  });

  it('caps the map at TOOL_USAGE_CAP keeping the highest counts', () => {
    const raw: Record<string, number> = {};
    for (let i = 0; i < TOOL_USAGE_CAP + 25; i += 1) {
      raw[`tool-${i}`] = i;
    }
    const result = normalizeSettings({ toolUsage: raw });
    expect(Object.keys(result.toolUsage ?? {})).toHaveLength(TOOL_USAGE_CAP);
    // 225 entries, keep the 200 highest: tool-224 down to tool-25 survive,
    // the 25 lowest (tool-24..tool-0) are dropped.
    expect(result.toolUsage?.['tool-224']).toBe(224);
    expect(result.toolUsage?.['tool-25']).toBe(25);
    expect(result.toolUsage?.['tool-24']).toBeUndefined();
    expect(result.toolUsage?.['tool-0']).toBeUndefined();
  });

  it('keeps incoming key order for ties at the cap boundary', () => {
    const raw: Record<string, number> = {};
    for (let i = 0; i < TOOL_USAGE_CAP; i += 1) {
      raw[`first-${i}`] = 5;
    }
    // All tie at 5; the capped result keeps the first-inserted 200.
    const result = normalizeSettings({ toolUsage: raw });
    expect(Object.keys(result.toolUsage ?? {})).toHaveLength(TOOL_USAGE_CAP);
    expect(result.toolUsage?.['first-0']).toBe(5);
    expect(result.toolUsage?.['first-199']).toBe(5);
  });

  it('accepts a map whose entries all drop as an empty object', () => {
    const result = normalizeSettings({ toolUsage: { bad: -5 } as Record<string, number> });
    expect(result.toolUsage).toEqual({});
    expect('toolUsage' in result).toBe(true);
  });

  it('save/load round-trips toolUsage', async () => {
    const svc = new SettingsService(file);
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), toolUsage: { rotate: 7, ocr: 2 } });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolUsage).toEqual({ rotate: 7, ocr: 2 });
    }
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk.toolUsage).toEqual({ rotate: 7, ocr: 2 });
  });

  it('invalid toolUsage on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'dark',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      dockPins: ['rotate'],
      toolUsage: 'rotate:3',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolUsage).toBeUndefined();
      expect('toolUsage' in result.value).toBe(false);
      expect(result.value.dockPins).toEqual(['rotate']);
      expect(result.value.theme).toBe('dark');
    }
  });
});

describe('Phase 36: toolsPaletteLayout tolerated legacy key', () => {
  it('keeps accepting list and grid', () => {
    expect(normalizeSettings({ toolsPaletteLayout: 'list' }).toolsPaletteLayout).toBe('list');
    expect(normalizeSettings({ toolsPaletteLayout: 'grid' }).toolsPaletteLayout).toBe('grid');
  });

  it('still rejects other values', () => {
    for (const bad of ['table', '', 1, null, undefined, ['list']] as unknown[]) {
      const result = normalizeSettings({ toolsPaletteLayout: bad });
      expect(result.toolsPaletteLayout).toBeUndefined();
      expect('toolsPaletteLayout' in result).toBe(false);
    }
  });

  it('an existing settings.json with the legacy key loads without error', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'frosted',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      toolsPaletteLayout: 'grid',
      dockPins: ['rotate'],
      toolUsage: { rotate: 1 },
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolsPaletteLayout).toBe('grid');
      expect(result.value.dockPins).toEqual(['rotate']);
      expect(result.value.toolUsage).toEqual({ rotate: 1 });
    }
  });

  it('save/load keeps both new fields together with the legacy key', async () => {
    const svc = new SettingsService(file);
    const settings: AppSettings = {
      theme: 'dark',
      geometry: { ...DEFAULT_SETTINGS.geometry, maximized: true },
      recentFiles: [],
      toolsPaletteLayout: 'list',
      pagesPanelCollapsed: true,
      dockPins: ['rotate', 'merge', 'delete', 'ocr'],
      toolUsage: { rotate: 9, merge: 4 },
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toolsPaletteLayout).toBe('list');
      expect(result.value.dockPins).toEqual(['rotate', 'merge', 'delete', 'ocr']);
      expect(result.value.toolUsage).toEqual({ rotate: 9, merge: 4 });
      expect(result.value.pagesPanelCollapsed).toBe(true);
    }
  });
});

describe('Phase 37: dockUnpinned validation', () => {
  it('preserves a valid array in order', () => {
    const result = normalizeSettings({ dockUnpinned: ['rotate', 'delete', 'merge'] });
    expect(result.dockUnpinned).toEqual(['rotate', 'delete', 'merge']);
  });

  it('drops non-string entries and empty strings', () => {
    const result = normalizeSettings({ dockUnpinned: ['rotate', 7, null, '', 'delete', {}, 'merge'] as unknown[] });
    expect(result.dockUnpinned).toEqual(['rotate', 'delete', 'merge']);
  });

  it('dedupes duplicates keeping the first occurrence', () => {
    const result = normalizeSettings({ dockUnpinned: ['rotate', 'delete', 'rotate', 'merge', 'delete'] });
    expect(result.dockUnpinned).toEqual(['rotate', 'delete', 'merge']);
  });

  it('truncates an over-long array to DOCK_UNPINNED_CAP preserving order', () => {
    const raw = Array.from({ length: DOCK_UNPINNED_CAP + 10 }, (_, i) => `tool-${i}`);
    const result = normalizeSettings({ dockUnpinned: raw });
    expect(result.dockUnpinned).toHaveLength(DOCK_UNPINNED_CAP);
    expect(result.dockUnpinned?.[0]).toBe('tool-0');
    expect(result.dockUnpinned?.[DOCK_UNPINNED_CAP - 1]).toBe(`tool-${DOCK_UNPINNED_CAP - 1}`);
    expect(result.dockUnpinned?.[DOCK_UNPINNED_CAP]).toBeUndefined();
  });

  it('truncates after de-duplication, not before', () => {
    const raw = Array.from({ length: DOCK_UNPINNED_CAP + 10 }, () => 'rotate');
    const result = normalizeSettings({ dockUnpinned: raw });
    expect(result.dockUnpinned).toEqual(['rotate']);
  });

  it('rejects non-array values (field left absent)', () => {
    for (const bad of ['rotate', 7, null, undefined, {}, { 0: 'rotate' }] as unknown[]) {
      const result = normalizeSettings({ dockUnpinned: bad });
      expect(result.dockUnpinned).toBeUndefined();
      expect('dockUnpinned' in result).toBe(false);
    }
  });

  it('accepts an array whose entries all drop as an empty array', () => {
    const result = normalizeSettings({ dockUnpinned: [1, null, ''] as unknown[] });
    expect(result.dockUnpinned).toEqual([]);
    expect('dockUnpinned' in result).toBe(true);
  });

  it('save/load round-trips dockUnpinned', async () => {
    const svc = new SettingsService(file);
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), dockUnpinned: ['rotate', 'merge'] });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dockUnpinned).toEqual(['rotate', 'merge']);
    }
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk.dockUnpinned).toEqual(['rotate', 'merge']);
  });

  it('invalid dockUnpinned on disk is dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      pagesPanelCollapsed: true,
      dockUnpinned: 'rotate',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dockUnpinned).toBeUndefined();
      expect('dockUnpinned' in result.value).toBe(false);
      expect(result.value.pagesPanelCollapsed).toBe(true);
      expect(result.value.theme).toBe('light');
    }
  });
});
