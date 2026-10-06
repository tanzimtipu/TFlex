// Phase 112 (TFL-997) adversary probe 2 — the page-range the real export
// dialogs actually hand to the engine. Imports the REAL shipped parser
// (`src/renderer/engine/types.ts`, the "actual parser" the phase requires),
// then applies the dialog's own [first,last] -> engine-range transform
// (ExportDialog.tsx:165-172, OfficeExportDialog.tsx:210-212,
// DocxExportDialog.tsx:187-190). The engine payload contract is a CONTINUOUS
// 1-based inclusive [start,end] (src/shared/types.ts:373-379), so this collapses
// any non-contiguous selection.
import { parsePageRange } from '../../src/renderer/engine/types.ts';

const TOTAL = 10;
const cases = ['1,3', '1,3,5', '2,4-6', '1-2,4', '3', '1-3', ''];

let widened = 0;
for (const expr of cases) {
  const parsed = parsePageRange(expr, TOTAL);
  const start = parsed && parsed.length > 0 ? parsed[0] : 1;
  const end = parsed && parsed.length > 0 ? parsed[parsed.length - 1] : TOTAL;
  const requestedCount = parsed ? parsed.length : 0;
  const engineCount = parsed && parsed.length > 0 ? end - start + 1 : 0;
  const bad = engineCount !== requestedCount;
  if (bad) widened += 1;
  console.log(
    `expr=${JSON.stringify(expr).padEnd(9)} parsed=${JSON.stringify(parsed)} ` +
      `engineRange=[${start},${end}] requested=${requestedCount} ` +
      `enginePages=${engineCount} ${bad ? '<-- SILENT WIDENING' : ''}`,
  );
}

// The Inspector's own round-trip: a parsed set -> seed text -> dialog re-parse.
// exportRangeExpression([1,3,5]) === "1,3,5" (exportConfig.ts:219-238).
const inspector = [1, 3, 5];
const seedText = '1,3,5';
const reParsed = parsePageRange(seedText, TOTAL);
const start = reParsed ? reParsed[0] : 1;
const end = reParsed ? reParsed[reParsed.length - 1] : TOTAL;
console.log(
  `\nInspector set ${JSON.stringify(inspector)} -> seed ${JSON.stringify(seedText)} -> ` +
    `re-parse ${JSON.stringify(reParsed)} -> engineRange [${start},${end}] exports ` +
    `${end - start + 1} pages (${inspector.length} requested)`,
);
console.log(`\nCases silently widened: ${widened} of ${cases.length - 1} non-empty expressions`);
