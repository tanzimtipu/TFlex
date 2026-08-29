import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { loadPdfFile } from '../../../src/main/services/pdf-file';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-pdf-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function fixture(name: string, content: Buffer | Uint8Array | string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

describe('loadPdfFile', () => {
  it('returns io for a nonexistent path', async () => {
    const result = await loadPdfFile(join(dir, 'missing.pdf'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('io');
    }
  });

  it('returns not-pdf for ASCII text with random bytes', async () => {
    const junk = Buffer.from('This is plain ASCII text.\n\x89\xab\xcd\xef more junk bytes \x00\x01\x02');
    const result = await loadPdfFile(await fixture('junk.bin', junk));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-pdf');
    }
  });

  it('returns corrupt for a %PDF- prefix with garbage after it', async () => {
    const junk = Buffer.from('%PDF-1.7\n' + 'x'.repeat(500) + '\n no trailer here');
    const result = await loadPdfFile(await fixture('broken.pdf', junk));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('corrupt');
    }
  });

  it('returns corrupt for a zero-byte file', async () => {
    const result = await loadPdfFile(await fixture('empty.pdf', Buffer.alloc(0)));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('corrupt');
    }
  });

  it('returns encrypted when an /Encrypt marker is present', async () => {
    const content = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\ntrailer\nstartxref\n42\n%%EOF',
    );
    const result = await loadPdfFile(await fixture('enc.pdf', content));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('encrypted');
    }
  });

  it('returns ok with bytes for a real well-formed PDF built by pdf-lib', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText('TFlex round-trip', { x: 72, y: 700 });
    const bytes = await doc.save();
    const path = await fixture('real.pdf', Buffer.from(bytes));

    const result = await loadPdfFile(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.byteLength).toBe(bytes.length);
      const reparsed = await PDFDocument.load(result.value);
      expect(reparsed.getPageCount()).toBe(1);
    }
  });
});
