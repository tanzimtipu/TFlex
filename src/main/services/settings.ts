import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { err, ok } from '../../shared/result';
import type {
  AppSettings,
  LoadSettingsResult,
  RecentFile,
  WindowGeometry,
} from '../../shared/types';

const RECENT_FILES_CAP = 10;
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
};

function normalizeGeometry(raw: unknown): WindowGeometry {
  const d = DEFAULT_SETTINGS.geometry;
  if (raw === null || typeof raw !== 'object') {
    return { ...d };
  }
  const g = raw as Partial<Record<keyof WindowGeometry, unknown>>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    x: num(g.x, d.x),
    y: num(g.y, d.y),
    width: Math.max(MIN_WINDOW_WIDTH, num(g.width, d.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, num(g.height, d.height)),
    maximized: typeof g.maximized === 'boolean' ? g.maximized : d.maximized,
  };
}

function normalizeRecentFiles(raw: unknown, cap: number = RECENT_FILES_CAP): RecentFile[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const files: RecentFile[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const r = entry as Partial<Record<keyof RecentFile, unknown>>;
    if (
      typeof r.path === 'string' &&
      typeof r.name === 'string' &&
      typeof r.openedAt === 'string'
    ) {
      files.push({ path: r.path, name: r.name, openedAt: r.openedAt });
    }
  }
  const effectiveCap = Math.max(1, Math.min(50, cap));
  return files.slice(0, effectiveCap);
}

export function normalizeSettings(raw: unknown): AppSettings {
  const rawObj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const recentsCap = typeof rawObj.recentsCap === 'number' && Number.isFinite(rawObj.recentsCap) && rawObj.recentsCap >= 1 && rawObj.recentsCap <= 50
    ? rawObj.recentsCap
    : RECENT_FILES_CAP;
  const settings: AppSettings = {
    theme: typeof rawObj.theme === 'string' && (rawObj.theme === 'light' || rawObj.theme === 'dark')
      ? rawObj.theme
      : DEFAULT_SETTINGS.theme,
    geometry: normalizeGeometry(rawObj.geometry),
    recentFiles: normalizeRecentFiles(rawObj.recentFiles, recentsCap),
  };

  // Phase 6: preserve optional settings fields if they are valid
  if (typeof rawObj.toolsPaletteLayout === 'string' && (rawObj.toolsPaletteLayout === 'list' || rawObj.toolsPaletteLayout === 'grid')) {
    settings.toolsPaletteLayout = rawObj.toolsPaletteLayout;
  }
  if (typeof rawObj.themeDefault === 'string' && (rawObj.themeDefault === 'light' || rawObj.themeDefault === 'dark' || rawObj.themeDefault === 'system')) {
    settings.themeDefault = rawObj.themeDefault;
  }
  if (typeof rawObj.recentsCap === 'number' && Number.isFinite(rawObj.recentsCap) && rawObj.recentsCap >= 1 && rawObj.recentsCap <= 50) {
    settings.recentsCap = rawObj.recentsCap;
  }
  if (rawObj.annotationColors !== null && typeof rawObj.annotationColors === 'object') {
    const ac = rawObj.annotationColors as Record<string, unknown>;
    const colors: { light?: string[]; dark?: string[] } = {};
    if (Array.isArray(ac.light)) {
      colors.light = ac.light.filter((c): c is string => typeof c === 'string');
    }
    if (Array.isArray(ac.dark)) {
      colors.dark = ac.dark.filter((c): c is string => typeof c === 'string');
    }
    if (colors.light || colors.dark) {
      settings.annotationColors = colors;
    }
  }

  // Phase 8: preserve optimizePreset if it is a valid enum value
  if (typeof rawObj.optimizePreset === 'string' && (rawObj.optimizePreset === 'none' || rawObj.optimizePreset === 'compact' || rawObj.optimizePreset === 'max')) {
    settings.optimizePreset = rawObj.optimizePreset;
  }

  return settings;
}

export class SettingsService {
  private current: AppSettings = structuredClone(DEFAULT_SETTINGS);
  private _saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly onChange?: (settings: AppSettings) => void,
  ) {}

  getCurrent(): AppSettings {
    return structuredClone(this.current);
  }

  async load(): Promise<LoadSettingsResult> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.current = structuredClone(DEFAULT_SETTINGS);
        return ok(structuredClone(DEFAULT_SETTINGS));
      }
      return err('io', message(e));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return err('corrupt-settings', 'settings.json is not valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object') {
      return err('corrupt-settings', 'settings.json does not contain an object');
    }
    this.current = normalizeSettings(parsed);
    return ok(structuredClone(this.current));
  }

  save(settings: AppSettings): Promise<void> {
    const task = this._saveQueue.then(() => this._doSave(settings));
    this._saveQueue = task.catch(() => {});
    return task;
  }

  private async _doSave(settings: AppSettings): Promise<void> {
    const normalized = normalizeSettings(settings);
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8');
      await rename(tmp, this.filePath);
      this.current = normalized;
      this.onChange?.(structuredClone(normalized));
    } catch (e) {
      try {
        await unlink(tmp);
      } catch {
        // Best-effort tmp cleanup — ignore secondary errors
      }
      throw e;
    }
  }

  async addRecentFile(file: RecentFile): Promise<void> {
    const rest = this.current.recentFiles.filter((f) => f.path !== file.path);
    await this.save({ ...this.current, recentFiles: [file, ...rest] });
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
