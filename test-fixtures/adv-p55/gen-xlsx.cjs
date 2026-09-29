// Phase-55 adversary fixture generator. Writes hostile inputs ONLY under
// test-fixtures/adv-p55. Uses the shipped deps read-only. No product code.
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { zipSync, strToU8, unzipSync, strFromU8 } = require('fflate');

const OUT = path.resolve(__dirname);
const F = (n) => path.join(OUT, n);

function writeZip(name, entries) {
  fs.writeFileSync(F(name), Buffer.from(zipSync(entries, { level: 6 })));
}

function readZipFile(p) {
  return unzipSync(new Uint8Array(fs.readFileSync(p)));
}

function rezipOut(name, files) {
  fs.writeFileSync(F(name), Buffer.from(zipSync(files, { level: 6 })));
}

// ---------------------------------------------------------------------------
// 1. XLSX with a declared dimension of the Excel maximum, almost no data.
// ---------------------------------------------------------------------------
{
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['h1', 'h2'], ['a', 'b']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const files = unzipSync(new Uint8Array(bytes));
  const sheetKey = Object.keys(files).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k));
  let xml = strFromU8(files[sheetKey]);
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, '<dimension ref="A1:XFD1048576"/>');
  files[sheetKey] = strToU8(xml);
  // Keep the workbook small but valid; the declared range is the attack.
  fs.writeFileSync(F('xlsx-maxrange.xlsx'), Buffer.from(zipSync(files, { level: 6 })));
}

// 1b. A merged range far beyond the data, so range.e.c/e.r explode.
{
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['h'], ['a']]);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 1048575, c: 16383 } }];
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const files = unzipSync(new Uint8Array(bytes));
  const sheetKey = Object.keys(files).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k));
  let xml = strFromU8(files[sheetKey]);
  // Ensure the merge survives: SheetJS writes <mergeCells>. Confirm it is there.
  if (!/mergeCell/.test(xml)) {
    xml = xml.replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>');
  } else {
    xml = xml.replace(/<mergeCell ref="[^"]*"\/>/, '<mergeCell ref="A1:XFD1048576"/>');
  }
  files[sheetKey] = strToU8(xml);
  fs.writeFileSync(F('xlsx-merge-huge.xlsx'), Buffer.from(zipSync(files, { level: 6 })));
}

console.log('xlsx fixtures written');
