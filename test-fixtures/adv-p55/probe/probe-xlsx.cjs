// Adversary probe: exercise the SHIPPED XLSX grid path (worksheetToGrid with
// the adapter's own maxRows ceiling) against a hostile workbook. Module-level,
// same code the app runs.
const XLSX = require('xlsx');
const M = require('./bundle.cjs');

const file = process.argv[2];
const maxRows = process.argv[3] ? Number(process.argv[3]) : 100000;

function rss() { return Math.round(process.memoryUsage().rss / (1024 * 1024)); }

const bytes = new Uint8Array(require('node:fs').readFileSync(file));
console.log(`[probe] file=${file} size=${bytes.length} rss0=${rss()}MB`);
const t0 = Date.now();
const wb = XLSX.read(bytes, { type: 'buffer', cellText: true, cellNF: true, cellDates: false });
console.log(`[probe] XLSX.read done in ${Date.now() - t0} ms; sheets=${wb.SheetNames.length}; rss=${rss()}MB`);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  console.log(`[probe] sheet "${name}" !ref=${JSON.stringify(ws['!ref'])} merges=${(ws['!merges'] || []).length}; rss=${rss()}MB`);
}
const name = wb.SheetNames[0];
const t1 = Date.now();
const grid = M.worksheetToGrid(name, wb.Sheets[name], maxRows);
console.log(`[probe] worksheetToGrid done in ${Date.now() - t1} ms; rows=${grid.cells.length} cols=${grid.cells[0] ? grid.cells[0].length : 0} sourceRowCount=${grid.sourceRowCount}; rss=${rss()}MB`);
const t2 = Date.now();
const rendered = M.renderWorkbookHtml([grid], {
  gridlines: true, fitToWidth: true, orientation: 'auto', pageSize: 'a4', marginMm: 20,
});
console.log(`[probe] renderWorkbookHtml done in ${Date.now() - t2} ms; htmlLen=${rendered.html.length}; rss=${rss()}MB`);
console.log('[probe] COMPLETE');
