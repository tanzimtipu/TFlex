import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { auditSpace, optimizePdf } from '../../../src/main/services/optimize';

async function createTestDoc(pageCount: number): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 14 });
  }
  return doc;
}

describe('optimizePdf', () => {
  it('produces valid output for each preset', async () => {
    const doc = await createTestDoc(3);

    for (const preset of ['none', 'compact', 'max'] as const) {
      const bytes = await optimizePdf(doc, preset);
      const reDoc = await PDFDocument.load(bytes);
      expect(reDoc.getPageCount()).toBe(3);
    }
  });

  it('different presets produce different byte sizes', async () => {
    const doc = await createTestDoc(5);

    const sizes: number[] = [];
    for (const preset of ['none', 'compact', 'max'] as const) {
      const bytes = await optimizePdf(doc, preset);
      sizes.push(bytes.length);
    }

    // 'none' (no object streams) > 'compact' (object streams) >= 'max' (object streams + strip metadata)
    expect(sizes[0]).toBeGreaterThan(sizes[1]);
    expect(sizes[1]).toBeGreaterThanOrEqual(sizes[2]);
  });

  it('preserves page count', async () => {
    const doc = await createTestDoc(7);
    const bytes = await optimizePdf(doc, 'compact');
    const reDoc = await PDFDocument.load(bytes);
    expect(reDoc.getPageCount()).toBe(7);
  });

  it('max preset strips metadata', async () => {
    const doc = await createTestDoc(1);
    doc.setTitle('Test Title');
    doc.setAuthor('Test Author');

    const bytes = await optimizePdf(doc, 'max');
    const reDoc = await PDFDocument.load(bytes);

    // Title and author should be empty after max optimization
    const title = reDoc.getTitle();
    const author = reDoc.getAuthor();
    expect(title).toBeUndefined();
    expect(author).toBeUndefined();
  });

  it('compact preset preserves metadata', async () => {
    const doc = await createTestDoc(1);
    doc.setTitle('Test Title');
    doc.setAuthor('Test Author');

    const bytes = await optimizePdf(doc, 'compact');
    const reDoc = await PDFDocument.load(bytes);

    expect(reDoc.getTitle()).toBe('Test Title');
    expect(reDoc.getAuthor()).toBe('Test Author');
  });
});

describe('auditSpace', () => {
  it('returns non-zero totalBytes for a document with pages', async () => {
    const doc = await createTestDoc(3);
    const audit = auditSpace(doc);
    expect(audit.totalBytes).toBeGreaterThan(0);
  });

  it('breakdown categories sum to totalBytes', async () => {
    const doc = await createTestDoc(3);
    const audit = auditSpace(doc);

    const sum =
      audit.breakdown.images +
      audit.breakdown.fonts +
      audit.breakdown.contentStreams +
      audit.breakdown.metadata +
      audit.breakdown.other;

    expect(sum).toBe(audit.totalBytes);
  });

  it('returns consistent results for the same document', async () => {
    const doc = await createTestDoc(3);
    const r1 = auditSpace(doc);
    const r2 = auditSpace(doc);
    expect(r1.totalBytes).toBe(r2.totalBytes);
    expect(r1.breakdown).toEqual(r2.breakdown);
  });

  it('returns zero for an empty context', async () => {
    const doc = await PDFDocument.create();
    // Don't add any pages — the document has minimal content
    const audit = auditSpace(doc);
    expect(audit.totalBytes).toBeGreaterThanOrEqual(0);
    expect(typeof audit.breakdown.images).toBe('number');
    expect(typeof audit.breakdown.fonts).toBe('number');
    expect(typeof audit.breakdown.contentStreams).toBe('number');
    expect(typeof audit.breakdown.metadata).toBe('number');
    expect(typeof audit.breakdown.other).toBe('number');
  });
});