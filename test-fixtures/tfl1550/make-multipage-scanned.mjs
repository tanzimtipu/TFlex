// TFL-1550 QA fixture generator.
//
// The ActivityAlertNotice auto-collapse check needs a long-running operation
// that stays active for well over the 10 s notice dwell. The 6-page scanned
// sample's recognition window is marginal, so this builds a longer scanned
// document by repeating the source pages. Deterministic and re-runnable; never
// mutate the source sample.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from '@cantoo/pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const source = path.join(root, 'assets', 'samples', 'scanned.pdf');
const target = path.join(here, 'scanned-12.pdf');
const COPIES = 2;

const src = await PDFDocument.load(readFileSync(source));
const pageCount = src.getPageCount();
const out = await PDFDocument.create();
for (let copy = 0; copy < COPIES; copy += 1) {
  const copied = await out.copyPages(src, src.getPageIndices());
  for (const page of copied) out.addPage(page);
}
writeFileSync(target, await out.save());
console.log(`wrote ${target} (${pageCount} x ${COPIES} = ${out.getPageCount()} pages)`);
