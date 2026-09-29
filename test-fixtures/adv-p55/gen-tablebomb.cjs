// ODF nested repeated-cell bomb: the parsed tree is tiny (well under the node
// cap) but the HTML renderer expands each repeated cell recursively, so output
// cells = repeat^depth. Writes under test-fixtures/adv-p55.
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const OUT = path.resolve(__dirname);
const F = (n) => path.join(OUT, n);

const NS =
  '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">';

function bomb(depth, repeat) {
  let inner = '<text:p>x</text:p>';
  for (let d = 0; d < depth; d += 1) {
    inner =
      `<table:table><table:table-row>` +
      `<table:table-cell table:number-columns-repeated="${repeat}">${inner}</table:table-cell>` +
      `</table:table-row></table:table>`;
  }
  return NS + '<office:body><office:text>' + inner + '</office:text></office:body></office:document-content>';
}

function write(name, xml) {
  fs.writeFileSync(F(name), Buffer.from(zipSync({
    'mimetype': strToU8('application/vnd.oasis.opendocument.text'),
    'content.xml': strToU8(xml),
    'styles.xml': strToU8('<?xml version="1.0"?><office:document-styles/>'),
  }, { level: 6 })));
  console.log(`${name}: ${fs.statSync(F(name)).size} bytes`);
}

for (const d of [2, 3, 4, 6]) {
  write(`odt-table-bomb-d${d}.odt`, bomb(d, 1000));
}
console.log('done');
