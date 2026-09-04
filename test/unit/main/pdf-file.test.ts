import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { loadPdfFile, loadFdfFile, sniff, sniffFdf } from '../../../src/main/services/pdf-file';
import { exportFdf } from '../../../src/main/services/fdf';

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

describe('loadFdfFile', () => {
  it('returns io for a nonexistent path', async () => {
    const result = await loadFdfFile(join(dir, 'missing.fdf'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('io');
    }
  });

  it('returns corrupt for a zero-byte file', async () => {
    const result = await loadFdfFile(await fixture('empty.fdf', Buffer.alloc(0)));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('corrupt');
    }
  });

  it('returns not-fdf for plain ASCII text', async () => {
    const junk = Buffer.from('This is plain text, not an FDF file.\n');
    const result = await loadFdfFile(await fixture('text.fdf', junk));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-fdf');
    }
  });

  it('returns not-fdf for a bare %FDF token without the version dash', async () => {
    // The sniff requires "%FDF-" (with the dash), matching the documented
    // FDF header signature. A stray "%FDF" without "-1.2" is not a file we
    // want to feed to the parser.
    const junk = Buffer.from('%FDF no version here\n');
    const result = await loadFdfFile(await fixture('weird.fdf', junk));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not-fdf');
    }
  });

  it('returns ok with bytes for a real FDF produced by exportFdf', async () => {
    const anns: import('../../../src/shared/types').AnnModel[][] = [[
      {
        id: 'a1', kind: 'text-box', page: 1,
        rects: [{ x: 10, y: 20, width: 100, height: 30 }],
        color: 'red', content: 'Hello FDF',
      },
    ]];
    const bytes = exportFdf(anns, [0], [792]);
    const path = await fixture('real.fdf', Buffer.from(bytes));

    const result = await loadFdfFile(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.byteLength).toBe(bytes.byteLength);
      const text = new TextDecoder('latin1').decode(new Uint8Array(result.value));
      expect(text.startsWith('%FDF-1.2')).toBe(true);
      expect(text).toContain('(Hello FDF)');
    }
  });
});

// DEF-053 regression guard: the two sniffs must stay independent. An FDF
// file (starts with %FDF-) must be rejected by the PDF sniff, and a PDF
// file (starts with %PDF-) must be rejected by the FDF sniff. The bug was
// that FDF import shared loadPdfFile's %PDF- check and was bounced.
describe('sniff / sniffFdf independence (DEF-053 regression)', () => {
  it('the PDF sniff rejects an FDF file as not-pdf', () => {
    const fdf = Buffer.from('%FDF-1.2\n1 0 obj\n<< /FDF << /Annots [] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    const r = sniff(fdf, 'x.fdf');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-pdf');
  });

  it('the FDF sniff rejects a PDF file as not-fdf', () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF');
    const r = sniffFdf(pdf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-fdf');
  });

  it('the FDF sniff accepts an FDF file that the PDF sniff rejects', () => {
    const fdf = Buffer.from('%FDF-1.2\n1 0 obj\n<< /FDF << >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    expect(sniff(fdf, 'x.fdf').ok).toBe(false);
    expect(sniffFdf(fdf).ok).toBe(true);
  });
});
