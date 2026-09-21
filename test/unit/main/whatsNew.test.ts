import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WHATS_NEW, whatsNewFor, whatsNewHistory, type WhatsNewEntry } from '../../../src/shared/whatsNew';

/** Numeric semver-ish compare, good enough for TFlex's plain X.Y.Z versions. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function runningVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  return String(pkg.version ?? '');
}

describe('WHATS_NEW', () => {
  it('is ordered newest first', () => {
    for (let i = 1; i < WHATS_NEW.length; i += 1) {
      expect(
        compareVersions(WHATS_NEW[i - 1].version, WHATS_NEW[i].version),
      ).toBeGreaterThan(0);
    }
  });

  it('has no duplicate versions', () => {
    const versions = WHATS_NEW.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('gives every entry at least one highlight and no blank lines', () => {
    for (const entry of WHATS_NEW) {
      expect(entry.highlights.length).toBeGreaterThan(0);
      for (const line of entry.highlights) {
        expect(line.trim()).not.toBe('');
      }
    }
  });

  it('covers the already-released versions', () => {
    for (const version of ['1.23.1', '1.23.0', '1.22.0', '1.21.0', '1.20.0']) {
      expect(whatsNewFor(version), `missing changelog entry for ${version}`).not.toBeNull();
    }
  });
});

describe('whatsNewFor', () => {
  it('returns the entry for an exact version match', () => {
    const entry = whatsNewFor('1.23.0');
    expect(entry).not.toBeNull();
    expect(entry?.version).toBe('1.23.0');
    expect(entry?.highlights.length).toBeGreaterThan(0);
  });

  it('returns null for an unknown version', () => {
    expect(whatsNewFor('9.9.9')).toBeNull();
  });

  it('does not fuzz on prefix, suffix or whitespace', () => {
    expect(whatsNewFor('1.23')).toBeNull();
    expect(whatsNewFor('1.23.0.1')).toBeNull();
    expect(whatsNewFor('v1.23.0')).toBeNull();
    expect(whatsNewFor('1.23.0 ')).toBeNull();
  });
});

describe('whatsNewHistory', () => {
  it('returns the entries older than the newest running version, newest first', () => {
    const history = whatsNewHistory(WHATS_NEW[0].version);
    expect(history).toEqual(WHATS_NEW.slice(1));
    for (let i = 1; i < history.length; i += 1) {
      expect(compareVersions(history[i - 1].version, history[i].version)).toBeGreaterThan(0);
    }
  });

  it('returns only entries older than a running version in the middle of the list', () => {
    const index = WHATS_NEW.findIndex((e) => e.version === '1.22.0');
    expect(index).toBeGreaterThan(0);
    const history = whatsNewHistory('1.22.0');
    expect(history).toEqual(WHATS_NEW.slice(index + 1));
    // Every returned entry is strictly older than the running version.
    for (const entry of history) {
      expect(compareVersions(entry.version, '1.22.0')).toBeLessThan(0);
    }
    // No entry newer than (or equal to) the running version leaks in.
    expect(history.some((e) => compareVersions(e.version, '1.22.0') >= 0)).toBe(false);
  });

  it('caps the middle-list result with limit, keeping the newest-first order', () => {
    const index = WHATS_NEW.findIndex((e) => e.version === '1.22.0');
    const limited = whatsNewHistory('1.22.0', 1);
    expect(limited).toHaveLength(1);
    expect(limited).toEqual(WHATS_NEW.slice(index + 1, index + 2));
  });

  it('returns an empty list when the running version has no entry', () => {
    expect(whatsNewHistory('9.9.9')).toEqual([]);
    expect(whatsNewHistory('1.23', 3)).toEqual([]);
    expect(whatsNewHistory('1.23.0 ')).toEqual([]);
  });

  it('returns an empty list for limit 0 or below', () => {
    expect(whatsNewHistory('1.23.1', 0)).toEqual([]);
    expect(whatsNewHistory('1.23.1', -1)).toEqual([]);
  });

  it('returns the full older list for a huge limit', () => {
    const index = WHATS_NEW.findIndex((e) => e.version === '1.23.1');
    expect(index).toBeGreaterThan(0);
    const history = whatsNewHistory('1.23.1', 100000);
    expect(history).toEqual(WHATS_NEW.slice(index + 1));
    // Newest-first order preserved, and every entry strictly older than the version.
    for (let i = 1; i < history.length; i += 1) {
      expect(compareVersions(history[i - 1].version, history[i].version)).toBeGreaterThan(0);
    }
    for (const entry of history) {
      expect(compareVersions(entry.version, '1.23.1')).toBeLessThan(0);
    }
    expect(history.some((e) => compareVersions(e.version, '1.23.1') >= 0)).toBe(false);
  });
});

describe('release gate', () => {
  /**
   * Mirrors the release gate's top-entry rule as a callable predicate so the
   * failure path can be exercised against a constructed list without editing
   * package.json.
   */
  function assertTopEntryPinned(entries: WhatsNewEntry[], pkgVersion: string): void {
    if (entries.length === 0) {
      throw new Error('Bundled changelog is empty; the running version must have an entry.');
    }
    if (entries[0].version !== pkgVersion) {
      throw new Error(
        `Bundled changelog's newest entry is ${entries[0].version} but the running version is ${pkgVersion}. `
        + 'The top entry must be the running version (newest first); a changelog newer than the app '
        + 'would mislabel newer releases as "Earlier releases".',
      );
    }
  }

  it('has a changelog entry for the package.json version', () => {
    const version = runningVersion();
    const entry = whatsNewFor(version);
    if (!entry) {
      throw new Error(
        `Bundled changelog is missing an entry for the running version ${version} from package.json. `
        + 'Add it to WHATS_NEW (newest first) before releasing; a release must not ship without its notes.',
      );
    }
    expect(entry.version).toBe(version);
  });

  it('pins the newest changelog entry to the package.json version', () => {
    const version = runningVersion();
    assertTopEntryPinned(WHATS_NEW, version);
    expect(WHATS_NEW[0].version).toBe(version);
  });

  it('fails the gate when the top entry is newer than the running version', () => {
    const version = runningVersion();
    const newerTop: WhatsNewEntry[] = [
      { version: '9.9.9', highlights: ['constructed newer entry'] },
      ...WHATS_NEW,
    ];
    expect(() => assertTopEntryPinned(newerTop, version)).toThrow(/newest entry is 9\.9\.9/);
  });

  it('fails the gate when the changelog is empty', () => {
    expect(() => assertTopEntryPinned([], runningVersion())).toThrow(/empty/);
  });
});