import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { EngineService, PDF_PRODUCER } from '../../../src/main/services/engine';
import { PRINT_WINDOW_TITLE } from '../../../src/main/print-window';
import {
  LEGACY_USERDATA_DIRNAME,
  LEGACY_STATE_FILES,
} from '../../../src/main/services/userdata-migration';

// Phase 49 — Jovrel rebrand guards: the electron-builder config, the PDF
// metadata the engine stamps, and the main-process title constants.

const YAML = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8');

describe('Phase 49 — electron-builder.yml branding', () => {
  it('sets productName Jovrel but keeps the internal appId', () => {
    expect(YAML).toMatch(/^appId:\s*com\.tflex\.app\s*$/m);
    expect(YAML).toMatch(/^productName:\s*Jovrel\s*$/m);
  });

  it('uses the Jovrel app icon for the window and the installer icons', () => {
    expect(YAML).toMatch(/^win:[\s\S]*?^\s{2}icon:\s*assets\/brand\/jovrel\.ico\s*$/m);
    expect(YAML).toMatch(/^\s{2}installerIcon:\s*assets\/brand\/jovrel\.ico\s*$/m);
    expect(YAML).toMatch(/^\s{2}uninstallerIcon:\s*assets\/brand\/jovrel\.ico\s*$/m);
  });

  it('renames both artifact patterns to Jovrel', () => {
    expect(YAML).toMatch(/artifactName:\s*Jovrel-Setup-\$\{version\}-\$\{arch\}\.\$\{ext\}\s*$/m);
    expect(YAML).toMatch(/artifactName:\s*Jovrel-\$\{version\}-portable-\$\{arch\}\.\$\{ext\}\s*$/m);
    expect(YAML).not.toContain('TFlex-Setup');
    expect(YAML).not.toContain('TFlex-${version}');
  });

  it('keeps the public releases repo unchanged', () => {
    expect(YAML).toMatch(/^\s{2}repo:\s*tflex-releases\s*$/m);
  });

  it('ships the brand assets via the assets/** files rule', () => {
    expect(YAML).toMatch(/^\s*-\s*assets\/\*\*\s*$/m);
    expect(existsSync(join(process.cwd(), 'assets', 'brand', 'jovrel.ico'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'assets', 'brand', 'jovrel-pdf.ico'))).toBe(true);
  });
});

describe('Phase 49 — main-process title constants', () => {
  it('names the print window Jovrel', () => {
    expect(PRINT_WINDOW_TITLE).toBe('Print - Jovrel');
  });

  it('names the legacy userData directory tflex', () => {
    expect(LEGACY_USERDATA_DIRNAME).toBe('tflex');
    expect(LEGACY_STATE_FILES).toContain('settings.json');
    expect(LEGACY_STATE_FILES).toContain('signatures.json');
    expect(LEGACY_STATE_FILES).toContain('accounts-session.bin');
  });
});

describe('Phase 49 — engine PDF metadata', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tflex-phase49-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function loadTwoPageDoc(): Promise<EngineService> {
    const src = await PDFDocument.create();
    src.addPage([612, 792]);
    src.addPage([612, 792]);
    const bytes = await src.save();
    const path = join(dir, 'src.pdf');
    await writeFile(path, Buffer.from(bytes));
    const engine = new EngineService();
    const loaded = await engine.loadDocument('doc-1', path);
    expect(loaded.ok).toBe(true);
    return engine;
  }

  /** Reparse without updateMetadata so the assertion reads what was written. */
  async function readInfo(bytes: ArrayBuffer): Promise<{ producer?: string; creator?: string }> {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return { producer: doc.getProducer(), creator: doc.getCreator() };
  }

  it('stamps Producer and Creator as Jovrel on a normal save', async () => {
    expect(PDF_PRODUCER).toBe('Jovrel');
    const engine = await loadTwoPageDoc();
    await engine.applyOp('doc-1', { kind: 'rotate-cw', page: 0 });

    const saved = await engine.getDocumentBytes('doc-1');
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      const info = await readInfo(saved.value);
      expect(info.producer).toBe('Jovrel');
      expect(info.creator).toBe('Jovrel');
    }
  });

  it('stamps Producer and Creator as Jovrel on the exportPages path', async () => {
    const engine = await loadTwoPageDoc();
    const exported = await engine.exportPages('doc-1', { range: [1, 1], format: 'png', dpi: 96 });
    expect(exported.ok).toBe(true);
    if (exported.ok) {
      const buf = exported.value[0].buffer;
      const info = await readInfo(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
      expect(info.producer).toBe('Jovrel');
      expect(info.creator).toBe('Jovrel');
    }
  });
});
