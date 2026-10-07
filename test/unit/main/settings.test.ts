import { mkdir, mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANNOTATION_RECENT_TOOLS_CAP, DEFAULT_SETTINGS, DOCK_PINS_CAP, DOCK_UNPINNED_CAP, HOME_TOOLS_CAP, PANEL_LEFT_WIDTH_MAX, PANEL_LEFT_WIDTH_MIN, PANEL_RIGHT_WIDTH_MAX, PANEL_RIGHT_WIDTH_MIN, TAB_STYLES, TOOL_USAGE_CAP, normalizeAnnotationRecentTools, normalizeBoundedWidth, normalizeHomeTools, normalizeSettings, normalizeTabStyle, SettingsService } from '../../../src/main/services/settings';
import type { AppSettings, RecentFile } from '../../../src/shared/types';
import { DEFAULT_READING_DEFAULTS, type ReadingDefaults } from '../../../src/shared/types';

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
      // Phase 44 (operator change): the normalizer always emits this field
      // now (default true), so the round-trip expectation includes it.
      accountsEnabled: true,
      // Phase 58: same explicit-default shape — the normalizer always emits
      // tabStyle, resolving missing/invalid to 'colorful'.
      tabStyle: 'colorful' as const,
      // Phase 84: same explicit-default shape — the normalizer always emits
      // redactionColor, resolving missing/invalid to '#000000'.
      redactionColor: '#000000' as const,
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

// Phase 106 follow-up (TFL-938): homeMotionPaused validation
describe('Phase 106 follow-up (TFL-938): homeMotionPaused validation', () => {
  it('preserves homeMotionPaused: true', () => {
    expect(normalizeSettings({ homeMotionPaused: true }).homeMotionPaused).toBe(true);
  });

  it('preserves homeMotionPaused: false', () => {
    expect(normalizeSettings({ homeMotionPaused: false }).homeMotionPaused).toBe(false);
  });

  it('rejects non-boolean homeMotionPaused values (left undefined)', () => {
    expect(normalizeSettings({ homeMotionPaused: 'yes' }).homeMotionPaused).toBeUndefined();
    expect(normalizeSettings({ homeMotionPaused: 1 }).homeMotionPaused).toBeUndefined();
    expect(normalizeSettings({ homeMotionPaused: 0 }).homeMotionPaused).toBeUndefined();
    expect(normalizeSettings({ homeMotionPaused: null }).homeMotionPaused).toBeUndefined();
    expect(normalizeSettings({ homeMotionPaused: undefined }).homeMotionPaused).toBeUndefined();
    expect(normalizeSettings({ homeMotionPaused: ['true'] }).homeMotionPaused).toBeUndefined();
    expect(normalizeSettings({ homeMotionPaused: { value: true } }).homeMotionPaused).toBeUndefined();
  });

  it('does not set homeMotionPaused when absent (consumer applies default false)', () => {
    const result = normalizeSettings({});
    expect(result.homeMotionPaused).toBeUndefined();
    expect('homeMotionPaused' in result).toBe(false);
  });

  it('save/load round-trips homeMotionPaused', async () => {
    const svc = new SettingsService(file);
    const settings = {
      theme: 'dark' as const,
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [] as RecentFile[],
      homeMotionPaused: true,
    };
    await svc.save(settings);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.homeMotionPaused).toBe(true);
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

// Phase 44 (operator change): accountsEnabled ships ON by default, with the
// stored value as the escape hatch. These are persistence round-trips so the
// default cannot silently overwrite a user's opt-out on the next save.
describe('Phase 44: accountsEnabled default ON', () => {
  it('a settings.json with no accountsEnabled key resolves to true', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accountsEnabled).toBe(true);
    }
  });

  it('a missing settings.json resolves to true (fresh install)', async () => {
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accountsEnabled).toBe(true);
    }
  });

  it('save/load round-trips accountsEnabled: false (opt-out is preserved)', async () => {
    const svc = new SettingsService(file);
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), accountsEnabled: false });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accountsEnabled).toBe(false);
    }
    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text).accountsEnabled).toBe(false);
  });

  it('a non-boolean accountsEnabled on disk is rejected and resolves to true', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      accountsEnabled: 'yes',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accountsEnabled).toBe(true);
      expect(result.value.theme).toBe('light');
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
    const overLong = Array.from({ length: DOCK_PINS_CAP + 2 }, (_, i) => `t${i}`);
    const result = normalizeSettings({ dockPins: overLong });
    expect(result.dockPins).toEqual(
      Array.from({ length: DOCK_PINS_CAP }, (_, i) => `t${i}`),
    );
    expect(result.dockPins).toHaveLength(DOCK_PINS_CAP);
  });

  it('truncates after de-duplication, not before', () => {
    const duped = ['a', 'a', ...Array.from({ length: DOCK_PINS_CAP + 1 }, (_, i) => `t${i}`)];
    const result = normalizeSettings({ dockPins: duped });
    expect(result.dockPins).toEqual([
      'a',
      ...Array.from({ length: DOCK_PINS_CAP - 1 }, (_, i) => `t${i}`),
    ]);
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

describe('Phase 58: tabStyle validation', () => {
  it('preserves the two valid tab styles', () => {
    expect(normalizeSettings({ tabStyle: 'standard' }).tabStyle).toBe('standard');
    expect(normalizeSettings({ tabStyle: 'colorful' }).tabStyle).toBe('colorful');
  });

  it('resolves an invalid stored value to the colorful default', () => {
    for (const bad of ['holographic', 7, {}, null, undefined] as unknown[]) {
      expect(normalizeSettings({ tabStyle: bad }).tabStyle).toBe('colorful');
    }
  });

  it('normalizeTabStyle returns null for anything outside TAB_STYLES', () => {
    expect(normalizeTabStyle('standard')).toBe('standard');
    expect(normalizeTabStyle('colorful')).toBe('colorful');
    expect(normalizeTabStyle('holographic')).toBeNull();
    expect(normalizeTabStyle(7)).toBeNull();
    expect(TAB_STYLES).toEqual(['standard', 'colorful']);
  });
});

describe('Phase 58: homeTools validation', () => {
  it('preserves a valid array in order', () => {
    const result = normalizeSettings({ homeTools: ['rotate', 'delete', 'merge'] });
    expect(result.homeTools).toEqual(['rotate', 'delete', 'merge']);
  });

  it('drops non-string entries and empty strings', () => {
    const result = normalizeSettings({ homeTools: ['rotate', 7, null, '', 'delete', {}, 'merge'] as unknown[] });
    expect(result.homeTools).toEqual(['rotate', 'delete', 'merge']);
  });

  it('collapses duplicates keeping the first occurrence', () => {
    const result = normalizeSettings({ homeTools: ['rotate', 'delete', 'rotate', 'merge', 'delete'] });
    expect(result.homeTools).toEqual(['rotate', 'delete', 'merge']);
  });

  it('truncates a 16-entry array to HOME_TOOLS_CAP preserving order', () => {
    const overLong = Array.from({ length: 16 }, (_, i) => `t${i}`);
    const result = normalizeSettings({ homeTools: overLong });
    expect(result.homeTools).toHaveLength(HOME_TOOLS_CAP);
    expect(result.homeTools).toEqual(
      Array.from({ length: HOME_TOOLS_CAP }, (_, i) => `t${i}`),
    );
  });

  it('rejects a non-array leaving the key absent', () => {
    for (const bad of ['rotate', 7, null, undefined, {}, { 0: 'rotate' }] as unknown[]) {
      const result = normalizeSettings({ homeTools: bad });
      expect(result.homeTools).toBeUndefined();
      expect('homeTools' in result).toBe(false);
    }
  });

  it('normalizeHomeTools rejects non-arrays and dedupes/caps valid ones', () => {
    expect(normalizeHomeTools('rotate')).toBeNull();
    expect(normalizeHomeTools(7)).toBeNull();
    expect(normalizeHomeTools(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeHomeTools(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(HOME_TOOLS_CAP);
  });
});

describe('Phase 58: persisted caps', () => {
  it('DOCK_PINS_CAP and HOME_TOOLS_CAP match the renderer mirrors', () => {
    expect(DOCK_PINS_CAP).toBe(200);
    expect(HOME_TOOLS_CAP).toBe(14);
  });
});

describe('normalizeSettings readingDefaults (Phase 56 feature A)', () => {
  const stored: ReadingDefaults = {
    epub: { fontSizePt: 20, lineHeight: 2, theme: 'sepia' },
    comics: { layout: 'double', fit: 'width', rightToLeft: true },
  };

  it('preserves a fully valid readingDefaults exactly', () => {
    const result = normalizeSettings({ readingDefaults: stored });
    expect(result.readingDefaults).toEqual(stored);
  });

  it('accepts the documented range boundaries', () => {
    const low = normalizeSettings({
      readingDefaults: { epub: { fontSizePt: 10, lineHeight: 1, theme: 'dark' } },
    });
    expect(low.readingDefaults?.epub).toEqual({
      fontSizePt: 10,
      lineHeight: 1,
      theme: 'dark',
    });
    const high = normalizeSettings({
      readingDefaults: { epub: { fontSizePt: 32, lineHeight: 2.5, theme: 'sepia' } },
    });
    expect(high.readingDefaults?.epub).toEqual({
      fontSizePt: 32,
      lineHeight: 2.5,
      theme: 'sepia',
    });
  });

  it('rejects each invalid key back to its default, not the whole field', () => {
    const result = normalizeSettings({
      readingDefaults: {
        epub: { fontSizePt: 33, lineHeight: 0.5, theme: 'blue' },
        comics: { layout: 'triple', fit: 'diagonal', rightToLeft: 'yes' },
      },
    });
    expect(result.readingDefaults).toEqual(DEFAULT_READING_DEFAULTS);
    expect('readingDefaults' in result).toBe(true);
  });

  it('drops unknown keys at every level', () => {
    const result = normalizeSettings({
      readingDefaults: {
        epub: { fontSizePt: 18, bogus: 1 },
        junk: 2,
        comics: { rightToLeft: true, extra: 'x' },
      },
    });
    expect(result.readingDefaults).toEqual({
      epub: { fontSizePt: 18, lineHeight: 1.5, theme: 'light' },
      comics: { layout: 'single', fit: 'height', rightToLeft: true },
    });
  });

  it('fills a missing block from the documented default', () => {
    const result = normalizeSettings({
      readingDefaults: { comics: { rightToLeft: true } },
    });
    expect(result.readingDefaults).toEqual({
      epub: { ...DEFAULT_READING_DEFAULTS.epub },
      comics: { layout: 'single', fit: 'height', rightToLeft: true },
    });
  });

  it('leaves a missing/invalid/empty field absent', () => {
    expect(normalizeSettings({}).readingDefaults).toBeUndefined();
    expect('readingDefaults' in normalizeSettings({})).toBe(false);
    expect(normalizeSettings({ readingDefaults: 'x' }).readingDefaults).toBeUndefined();
    expect(normalizeSettings({ readingDefaults: [] }).readingDefaults).toBeUndefined();
    expect(normalizeSettings({ readingDefaults: {} }).readingDefaults).toBeUndefined();
  });

  it('save/load round-trips readingDefaults', async () => {
    const svc = new SettingsService(file);
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS), readingDefaults: stored });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.readingDefaults).toEqual(stored);
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

describe('normalizeSettings spellCheck (Phase 82)', () => {
  it('preserves a valid spellCheck object', () => {
    const result = normalizeSettings({
      spellCheck: { enabled: false, language: 'en-US' },
    });
    expect(result.spellCheck).toEqual({ enabled: false, language: 'en-US' });
  });

  it('drops a non-object spellCheck', () => {
    for (const bad of ['yes', 42, null, ['en-US']] as unknown[]) {
      const result = normalizeSettings({ spellCheck: bad });
      expect('spellCheck' in result).toBe(false);
    }
  });

  it('coerces a non-boolean enabled to true', () => {
    const result = normalizeSettings({
      spellCheck: { enabled: 'no', language: 'en-US' },
    });
    expect(result.spellCheck).toEqual({ enabled: true, language: 'en-US' });
  });

  it('coerces an unknown language to en-US', () => {
    const result = normalizeSettings({
      spellCheck: { enabled: true, language: 'fr-FR' },
    });
    expect(result.spellCheck).toEqual({ enabled: true, language: 'en-US' });
  });

  it('leaves spellCheck absent when not stored', () => {
    const result = normalizeSettings({});
    expect('spellCheck' in result).toBe(false);
  });
});

// Phase 112 (TFL-986) — RecentFile verified-source metadata + pin flag are
// OPTIONAL and preserve-if-valid; pre-Phase-112 records must keep loading
// unchanged and a malformed new field must drop only itself, never the entry.
describe('Phase 112: RecentFile source metadata normalisation', () => {
  const base = { path: '/a/b.pdf', name: 'b.pdf', openedAt: '2026-01-01T00:00:00.000Z' };

  it('preserves all four new fields when valid', () => {
    const result = normalizeSettings({
      recentFiles: [{
        ...base,
        sourceLabel: 'Word Document',
        sourceKind: 'docx',
        converted: true,
        pinned: true,
        workingFormat: 'pdf',
      }],
    });
    expect(result.recentFiles).toEqual([{
      ...base,
      sourceLabel: 'Word Document',
      sourceKind: 'docx',
      converted: true,
      pinned: true,
      workingFormat: 'pdf',
    }]);
  });

  it('preserves converted:false and pinned:false (false is not the same as absent)', () => {
    const result = normalizeSettings({
      recentFiles: [{ ...base, converted: false, pinned: false }],
    });
    expect(result.recentFiles[0].converted).toBe(false);
    expect(result.recentFiles[0].pinned).toBe(false);
    expect('converted' in result.recentFiles[0]).toBe(true);
    expect('pinned' in result.recentFiles[0]).toBe(true);
  });

  it('drops invalid field shapes without dropping the entry', () => {
    const result = normalizeSettings({
      recentFiles: [{
        ...base,
        sourceLabel: '',
        sourceKind: 7,
        converted: 'yes',
        pinned: 1,
        workingFormat: 'docx',
      }],
    });
    expect(result.recentFiles).toHaveLength(1);
    expect(result.recentFiles[0]).toEqual(base);
    for (const key of ['sourceLabel', 'sourceKind', 'converted', 'pinned', 'workingFormat']) {
      expect(key in result.recentFiles[0]).toBe(false);
    }
  });

  it('keeps a pre-Phase-112 record (only the required fields) unchanged', () => {
    const result = normalizeSettings({ recentFiles: [base] });
    expect(result.recentFiles).toEqual([base]);
  });

  it('still drops an entry missing a required field even when the new fields are valid', () => {
    const result = normalizeSettings({
      recentFiles: [
        { path: '/keep.pdf', name: 'keep.pdf', openedAt: 'x', pinned: true },
        { name: 'no-path.pdf', openedAt: 'x', pinned: true },
        { path: 3, name: 'bad-path.pdf', openedAt: 'x' },
      ],
    });
    expect(result.recentFiles).toHaveLength(1);
    expect(result.recentFiles[0].path).toBe('/keep.pdf');
    expect(result.recentFiles[0].pinned).toBe(true);
  });

  it('save/load round-trips the new fields and addRecentFile keeps them', async () => {
    const svc = new SettingsService(file);
    const entry: RecentFile = {
      path: '/a/imported.docx',
      name: 'imported.docx',
      openedAt: '2026-02-01T00:00:00.000Z',
      sourceLabel: 'Word Document',
      sourceKind: 'docx',
      converted: true,
      pinned: true,
      workingFormat: 'pdf',
    };
    await svc.addRecentFile(entry);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recentFiles).toEqual([entry]);
    }
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk.recentFiles[0]).toEqual(entry);
  });

  it('an on-disk record with a bad new field loads with only that field dropped', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [{
        path: '/a/b.pdf',
        name: 'b.pdf',
        openedAt: '2026-01-01T00:00:00.000Z',
        sourceLabel: 'PDF Document',
        pinned: 'yes',
      }],
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.recentFiles[0]).toEqual({
        path: '/a/b.pdf',
        name: 'b.pdf',
        openedAt: '2026-01-01T00:00:00.000Z',
        sourceLabel: 'PDF Document',
      });
    }
  });

  it('the recents cap still applies with the new fields present', () => {
    const many: unknown[] = [];
    for (let i = 0; i < 14; i++) {
      many.push({ path: `p${i}`, name: `n${i}`, openedAt: '2026-01-01T00:00:00.000Z', pinned: i === 0 });
    }
    const normalized = normalizeSettings({ recentFiles: many });
    expect(normalized.recentFiles).toHaveLength(10);
    expect(normalized.recentFiles[0].pinned).toBe(true);
  });
});

// Phase 112 (TFL-992) — panel geometry + inspector collapse persistence.
// Preserve-if-valid: a width survives only when finite and inside its range,
// the boolean only when a real boolean; absent/invalid leaves the field unset
// so the consumer applies its own default (280 / 280 / false) and the default
// is never stored. An invalid width drops ONLY itself.
describe('Phase 112 (TFL-992): panel geometry + inspector collapse', () => {
  it('keeps an in-range panelLeftWidthPx', () => {
    expect(normalizeSettings({ panelLeftWidthPx: 240 }).panelLeftWidthPx).toBe(240);
    expect(normalizeSettings({ panelLeftWidthPx: 320 }).panelLeftWidthPx).toBe(320);
    expect(normalizeSettings({ panelLeftWidthPx: 275 }).panelLeftWidthPx).toBe(275);
    expect(normalizeSettings({ panelLeftWidthPx: 420 }).panelLeftWidthPx).toBe(420);
  });

  it('keeps an in-range panelRightWidthPx', () => {
    expect(normalizeSettings({ panelRightWidthPx: 260 }).panelRightWidthPx).toBe(260);
    expect(normalizeSettings({ panelRightWidthPx: 280 }).panelRightWidthPx).toBe(280);
    expect(normalizeSettings({ panelRightWidthPx: 380 }).panelRightWidthPx).toBe(380);
    expect(normalizeSettings({ panelRightWidthPx: 333 }).panelRightWidthPx).toBe(333);
  });

  it('drops an out-of-range panelLeftWidthPx (field absent)', () => {
    for (const bad of [239, 421, 0, -1, 1000]) {
      const result = normalizeSettings({ panelLeftWidthPx: bad });
      expect(result.panelLeftWidthPx).toBeUndefined();
      expect('panelLeftWidthPx' in result).toBe(false);
    }
  });

  it('drops an out-of-range panelRightWidthPx (field absent)', () => {
    for (const bad of [259, 381, 0, -1, 1000]) {
      const result = normalizeSettings({ panelRightWidthPx: bad });
      expect(result.panelRightWidthPx).toBeUndefined();
      expect('panelRightWidthPx' in result).toBe(false);
    }
  });

  it('drops non-number / non-finite panel widths (field absent)', () => {
    for (const bad of ['240', true, null, undefined, [240], { value: 240 }, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = normalizeSettings({ panelLeftWidthPx: bad, panelRightWidthPx: bad });
      expect(result.panelLeftWidthPx).toBeUndefined();
      expect(result.panelRightWidthPx).toBeUndefined();
      expect('panelLeftWidthPx' in result).toBe(false);
      expect('panelRightWidthPx' in result).toBe(false);
    }
  });

  it('leaves both widths absent when stored absent (consumer applies defaults 240/280)', () => {
    const result = normalizeSettings({});
    expect(result.panelLeftWidthPx).toBeUndefined();
    expect(result.panelRightWidthPx).toBeUndefined();
    expect('panelLeftWidthPx' in result).toBe(false);
    expect('panelRightWidthPx' in result).toBe(false);
  });

  it('preserves inspectorCollapsed: true and false (false is not absent)', () => {
    const t = normalizeSettings({ inspectorCollapsed: true });
    expect(t.inspectorCollapsed).toBe(true);
    expect('inspectorCollapsed' in t).toBe(true);
    const f = normalizeSettings({ inspectorCollapsed: false });
    expect(f.inspectorCollapsed).toBe(false);
    expect('inspectorCollapsed' in f).toBe(true);
  });

  it('rejects non-boolean inspectorCollapsed (left absent)', () => {
    for (const bad of ['true', 'yes', 1, 0, null, undefined, ['true'], { value: true }]) {
      const result = normalizeSettings({ inspectorCollapsed: bad });
      expect(result.inspectorCollapsed).toBeUndefined();
      expect('inspectorCollapsed' in result).toBe(false);
    }
  });

  it('does not set inspectorCollapsed when absent (consumer applies default false)', () => {
    const result = normalizeSettings({});
    expect(result.inspectorCollapsed).toBeUndefined();
    expect('inspectorCollapsed' in result).toBe(false);
  });

  it('an invalid panel width drops only that field and leaves other settings untouched', () => {
    const result = normalizeSettings({
      theme: 'light',
      pagesPanelCollapsed: true,
      panelLeftWidthPx: 9999,
      panelRightWidthPx: 300,
      inspectorCollapsed: true,
    });
    expect(result.panelLeftWidthPx).toBeUndefined();
    expect('panelLeftWidthPx' in result).toBe(false);
    expect(result.panelRightWidthPx).toBe(300);
    expect(result.inspectorCollapsed).toBe(true);
    expect(result.pagesPanelCollapsed).toBe(true);
    expect(result.theme).toBe('light');
  });

  it('save/load round-trips all three fields without storing defaults', async () => {
    const svc = new SettingsService(file);
    await svc.save({
      ...structuredClone(DEFAULT_SETTINGS),
      panelLeftWidthPx: 300,
      panelRightWidthPx: 360,
      inspectorCollapsed: true,
    });
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.panelLeftWidthPx).toBe(300);
      expect(result.value.panelRightWidthPx).toBe(360);
      expect(result.value.inspectorCollapsed).toBe(true);
    }
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect(onDisk.panelLeftWidthPx).toBe(300);
    expect(onDisk.panelRightWidthPx).toBe(360);
    expect(onDisk.inspectorCollapsed).toBe(true);
  });

  it('a save with absent fields does not persist default widths', async () => {
    const svc = new SettingsService(file);
    await svc.save({ ...structuredClone(DEFAULT_SETTINGS) });
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    expect('panelLeftWidthPx' in onDisk).toBe(false);
    expect('panelRightWidthPx' in onDisk).toBe(false);
    expect('inspectorCollapsed' in onDisk).toBe(false);
  });

  it('invalid persisted values are dropped on load without corrupting other fields', async () => {
    await writeFile(file, JSON.stringify({
      theme: 'light',
      geometry: DEFAULT_SETTINGS.geometry,
      recentFiles: [],
      pagesPanelCollapsed: true,
      panelLeftWidthPx: 10,
      panelRightWidthPx: 'wide',
      inspectorCollapsed: 'yes',
    }), 'utf8');
    const svc = new SettingsService(file);
    const result = await svc.load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.panelLeftWidthPx).toBeUndefined();
      expect(result.value.panelRightWidthPx).toBeUndefined();
      expect('inspectorCollapsed' in result.value).toBe(false);
      expect(result.value.pagesPanelCollapsed).toBe(true);
      expect(result.value.theme).toBe('light');
    }
  });

  it('normalizeBoundedWidth keeps finite in-range values and rejects everything else', () => {
    expect(normalizeBoundedWidth(200, 100, 300)).toBe(200);
    expect(normalizeBoundedWidth(100, 100, 300)).toBe(100);
    expect(normalizeBoundedWidth(300, 100, 300)).toBe(300);
    expect(normalizeBoundedWidth(99, 100, 300)).toBeNull();
    expect(normalizeBoundedWidth(301, 100, 300)).toBeNull();
    expect(normalizeBoundedWidth('200', 100, 300)).toBeNull();
    expect(normalizeBoundedWidth(Number.NaN, 100, 300)).toBeNull();
    expect(normalizeBoundedWidth(Number.POSITIVE_INFINITY, 100, 300)).toBeNull();
    expect(normalizeBoundedWidth(null, 100, 300)).toBeNull();
  });

  it('exports the documented panel width bounds', () => {
    expect(PANEL_LEFT_WIDTH_MIN).toBe(240);
    expect(PANEL_LEFT_WIDTH_MAX).toBe(420);
    expect(PANEL_RIGHT_WIDTH_MIN).toBe(260);
    expect(PANEL_RIGHT_WIDTH_MAX).toBe(380);
  });

  it('keeps a valid navigatorLayout / navigatorSplitRatio and drops invalid ones', () => {
    expect(normalizeSettings({ navigatorLayout: 'split' }).navigatorLayout).toBe('split');
    expect(normalizeSettings({ navigatorLayout: 'stacked' }).navigatorLayout).toBe('stacked');
    expect(normalizeSettings({ navigatorSplitRatio: 0.5 }).navigatorSplitRatio).toBe(0.5);
    expect(normalizeSettings({ navigatorSplitRatio: 0.1 }).navigatorSplitRatio).toBe(0.1);
    expect(normalizeSettings({ navigatorSplitRatio: 0.9 }).navigatorSplitRatio).toBe(0.9);

    const badLayout = normalizeSettings({ navigatorLayout: 'grid' });
    expect(badLayout.navigatorLayout).toBeUndefined();
    expect('navigatorLayout' in badLayout).toBe(false);

    for (const bad of [0.05, 0.95, '0.5', Number.NaN]) {
      const result = normalizeSettings({ navigatorSplitRatio: bad });
      expect(result.navigatorSplitRatio).toBeUndefined();
      expect('navigatorSplitRatio' in result).toBe(false);
    }

    const absent = normalizeSettings({});
    expect(absent.navigatorLayout).toBeUndefined();
    expect(absent.navigatorSplitRatio).toBeUndefined();
    expect('navigatorLayout' in absent).toBe(false);
    expect('navigatorSplitRatio' in absent).toBe(false);
  });
});
