import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Phase 35 — config guard. The `.pdf` file association is the only thing
// that makes TFlex appear in Explorer's "Open with" list; it lives in
// electron-builder.yml, which nothing else asserts. This pins the entry and
// its ProgID so a future config edit cannot silently drop it.

const YAML_PATH = resolve(process.cwd(), 'electron-builder.yml');
const text = readFileSync(YAML_PATH, 'utf8');
const lines = text.split(/\r?\n/);

describe('Phase 35 — electron-builder.yml .pdf association', () => {
  it('declares a fileAssociations block under win', () => {
    const winIdx = lines.findIndex((l) => /^win:\s*$/.test(l));
    const faIdx = lines.findIndex((l) => /^ {2}fileAssociations:\s*$/.test(l));
    expect(winIdx).toBeGreaterThanOrEqual(0);
    expect(faIdx).toBeGreaterThan(winIdx);
    // Not a top-level block (it must be the Windows platform option).
    expect(lines.some((l) => /^fileAssociations:/.test(l))).toBe(false);
  });

  it('registers the .pdf extension with the TFlex.pdf ProgID', () => {
    expect(text).toMatch(/fileAssociations:[\s\S]*?-\s*ext:\s*pdf\b/);
    expect(text).toMatch(/name:\s*TFlex\.pdf\b/);
    expect(text).toMatch(/description:\s*PDF Document\b/);
  });

  it('declares exactly one pdf association', () => {
    const matches = text.match(/\bext:\s*pdf\b/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
