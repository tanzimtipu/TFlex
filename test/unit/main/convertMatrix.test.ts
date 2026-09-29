import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';

/**
 * The HTML-print adapters (markdown/html/csv/office/e-book/comic) render through
 * a real offscreen Chromium window, which cannot exist in a node unit test. Every
 * adapter test fakes that seam; the matrix needs the same fake so the 28 real
 * adapters are actually exercised. The fake returns a one-page PDF; the recording
 * engine still re-parses whatever the adapter produced, so a broken adapter is
 * not masked by the fake.
 */
vi.mock('../../../src/main/services/convert/html-print', () => ({
  printHtmlToPdf: async () => {
    const { PDFDocument: Pdf } = await import('@cantoo/pdf-lib');
    const doc = await Pdf.create();
    doc.addPage();
    const bytes = await doc.save();
    return { ok: true as const, value: { bytes, pageCount: 1, blockedUrls: [] } };
  },
  blockedResourceWarnings: () => [],
}));
import { err, ok } from '../../../src/shared/result';
import type { ConvertFormatId } from '../../../src/shared/convert';
import {
  DocumentConversionService,
  type ConvertEnginePort,
} from '../../../src/main/services/convert';
import { createDefaultRegistry } from '../../../src/main/services/convert/registry';
import { CONVERT_ERROR_MESSAGES } from '../../../src/main/services/convert/errors';

/**
 * Phase 57 feature C - the conversion matrix regression suite.
 *
 * One case per advertised extension, driven from convertMatrix.manifest.json.
 * The manifest is the contract: test 1 fails the moment a newly registered
 * adapter has no matrix case, so a format can never ship untested.
 */

interface MatrixCase {
  extension: string;
  adapter: ConvertFormatId;
  fixture: string;
}

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'test/unit/main/convertMatrix.manifest.json'), 'utf8'),
) as { cases: MatrixCase[] };
const cases = manifest.cases;

const FIDELITIES = ['native', 'layout', 'degraded'] as const;

let dir: string;
let recorded: { byteLength: number; pageCount: number } | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-convert-'));
  recorded = null;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A recording engine port: it parses the produced PDF with pdf-lib, records the
 * byte length and page count, and only then reports success. A non-parseable
 * PDF becomes err(...) so the service's `toDocument` fails - the engine is the
 * validator, not a rubber stamp.
 */
const recordingEngine: ConvertEnginePort = {
  async loadDocumentBytes(_docId, bytes) {
    try {
      const doc = await PDFDocument.load(bytes);
      recorded = { byteLength: bytes.byteLength, pageCount: doc.getPageCount() };
      return ok(bytes.buffer as ArrayBuffer);
    } catch (thrown) {
      return err(String(thrown));
    }
  },
};

function service(): DocumentConversionService {
  return new DocumentConversionService({ engine: recordingEngine });
}

async function awaitOrFail<T>(promise: Promise<T>, label: string): Promise<T> {
  try {
    return await promise;
  } catch (thrown) {
    throw new Error(`${label} threw: ${String(thrown)}`);
  }
}

describe('phase57 conversion matrix manifest', () => {
  it('manifest enumerates every advertised extension', () => {
    const advertised = new Set<string>();
    for (const registration of createDefaultRegistry().listRegistrations()) {
      for (const extension of registration.extensions) {
        advertised.add(extension.replace(/^\./, '').toLowerCase());
      }
    }
    const manifestExtensions = new Set(
      cases.map((entry) => entry.extension.replace(/^\./, '').toLowerCase()),
    );
    expect(manifestExtensions).toEqual(advertised);
    expect(cases.length).toBe(28);
  });
});

describe('phase57 conversion matrix (valid fixtures)', () => {
  it.each(cases)('converts $extension via $adapter', async (entry) => {
    const copied = join(dir, `case${entry.extension}`);
    await copyFile(join(process.cwd(), entry.fixture), copied);

    const info = await awaitOrFail(service().sourceInfo(copied), `sourceInfo ${entry.extension}`);
    expect(info.ok).toBe(true);
    if (info.ok) {
      expect(info.value.format).toBe(entry.adapter);
      expect(FIDELITIES).toContain(info.value.fidelity);
      expect(info.value.label.trim().length).toBeGreaterThan(0);
    }

    const opened = await awaitOrFail(
      service().toDocument(`matrix-${entry.extension}`, copied),
      `toDocument ${entry.extension}`,
    );
    expect(opened.ok).toBe(true);
    expect(recorded).not.toBeNull();
    expect(recorded!.byteLength).toBeGreaterThan(0);
    expect(recorded!.pageCount).toBeGreaterThanOrEqual(1);
  });
});

describe('phase57 conversion matrix (garbage leg)', () => {
  it.each(cases)('settles a typed Result for garbage $extension', async (entry) => {
    const garbage = join(dir, `case${entry.extension}`);
    await writeFile(garbage, Buffer.alloc(256, 0xff));

    const info = await awaitOrFail(service().sourceInfo(garbage), `sourceInfo ${entry.extension}`);
    const opened = await awaitOrFail(
      service().toDocument(`garbage-${entry.extension}`, garbage),
      `toDocument ${entry.extension}`,
    );

    expect(info.ok).toBeTypeOf('boolean');
    expect(opened.ok).toBeTypeOf('boolean');

    if (!info.ok) {
      expect(Object.keys(CONVERT_ERROR_MESSAGES)).toContain(info.error.code);
      expect(info.error.message.trim().length).toBeGreaterThan(0);
    }

    if (!opened.ok) {
      expect(Object.keys(CONVERT_ERROR_MESSAGES)).toContain(opened.error.code);
      expect(opened.error.message.trim().length).toBeGreaterThan(0);
    } else {
      expect(recorded).not.toBeNull();
      expect(recorded!.byteLength).toBeGreaterThan(0);
    }
  });
});