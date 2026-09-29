// ZIP-layer hostile fixtures for Phase 55. Writes under test-fixtures/adv-p55.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { zipSync, strToU8, unzipSync, strFromU8 } = require('fflate');

const OUT = path.resolve(__dirname);
const F = (n) => path.join(OUT, n);

// A minimal but valid ODT-like package around content.xml.
function odtEntries(contentXml) {
  return {
    'mimetype': strToU8('application/vnd.oasis.opendocument.text'),
    'content.xml': strToU8(contentXml),
    'styles.xml': strToU8('<?xml version="1.0"?><office:document-styles/>'),
    'META-INF/manifest.xml': strToU8('<?xml version="1.0"?><manifest/>'),
  };
}

// --- 1. Declared 4 GiB uncompressed size on one entry, tiny compressed data --
{
  const entries = odtEntries('<?xml version="1.0"?><office:document-content/>');
  const z = Buffer.from(zipSync(entries, { level: 6 }));
  // Walk the local file headers and patch the uncompressed-size field (offset 22)
  // to 0xFFFFFF00 for the largest entry, and the matching central-directory entry.
  let patched = 0;
  for (let i = 0; i + 30 <= z.length; i += 1) {
    if (z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 0x03 && z[i + 3] === 0x04) {
      const comp = z.readUInt32LE(i + 18);
      const nameLen = z.readUInt16LE(i + 26);
      const extraLen = z.readUInt16LE(i + 28);
      if (comp > 20) {
        z.writeUInt32LE(0xffffff00, i + 22);
        patched += 1;
      }
      i += 30 + nameLen + extraLen + comp - 1;
    }
  }
  for (let i = 0; i + 46 <= z.length; i += 1) {
    if (z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 0x01 && z[i + 3] === 0x02) {
      const comp = z.readUInt32LE(i + 20);
      const nameLen = z.readUInt16LE(i + 28);
      const extraLen = z.readUInt16LE(i + 30);
      const commentLen = z.readUInt16LE(i + 32);
      if (comp > 20) z.writeUInt32LE(0xffffff00, i + 24);
      i += 46 + nameLen + extraLen + commentLen - 1;
    }
  }
  fs.writeFileSync(F('zip-declared-4gb.odt'), z);
  console.log(`zip-declared-4gb.odt: patched ${patched} local headers, size=${z.length}`);
}

// --- 2. A genuinely huge entry whose header lies about its size --------------
{
  const big = new Uint8Array(300 * 1024 * 1024); // 300 MiB of zeros, compresses tiny
  const z = Buffer.from(zipSync({ 'content.xml': big }, { level: 6 }));
  const declaredSmall = 1024;
  for (let i = 0; i + 30 <= z.length; i += 1) {
    if (z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 0x03 && z[i + 3] === 0x04) {
      z.writeUInt32LE(declaredSmall, i + 22);
      const comp = z.readUInt32LE(i + 18);
      const nameLen = z.readUInt16LE(i + 26);
      const extraLen = z.readUInt16LE(i + 28);
      i += 30 + nameLen + extraLen + comp - 1;
    }
  }
  for (let i = 0; i + 46 <= z.length; i += 1) {
    if (z[i] === 0x50 && z[i + 1] === 0x4b && z[i + 2] === 0x01 && z[i + 3] === 0x02) {
      z.writeUInt32LE(declaredSmall, i + 24);
      const nameLen = z.readUInt16LE(i + 28);
      const extraLen = z.readUInt16LE(i + 30);
      const commentLen = z.readUInt16LE(i + 32);
      i += 46 + nameLen + extraLen + commentLen - 1;
    }
  }
  fs.writeFileSync(F('zip-lying-header.odt'), z);
  console.log(`zip-lying-header.odt: compressedSize=${z.length} actual=300MiB declared=${declaredSmall}`);
}

// --- 3. 10,000 entries ------------------------------------------------------
{
  const entries = {};
  for (let i = 0; i < 10000; i += 1) entries[`f${i}.txt`] = strToU8('x');
  fs.writeFileSync(F('zip-many-10000.odt'), Buffer.from(zipSync(entries, { level: 0 })));
  console.log('zip-many-10000.odt written');
}

// --- 4. Duplicate content.xml with different contents -----------------------
{
  const dup = Buffer.from(
    zipSync(
      {
        'mimetype': strToU8('application/vnd.oasis.opendocument.text'),
        'content.xml': strToU8('<?xml version="1.0"?><office:document-content><office:body><office:text><text:p>FIRST</text:p></office:text></office:body></office:document-content>'),
      },
      { level: 0 },
    ),
  );
  const second = Buffer.from(
    zipSync(
      { 'content.xml': strToU8('<?xml version="1.0"?><office:document-content><office:body><office:text><text:p>SECOND</text:p></office:text></office:body></office:document-content>') },
      { level: 0 },
    ),
  );
  // Splice: dup without its EOCD + second's full zip body minus its local part.
  // Simplest reliable duplicate: build a zip then append a second copy of the
  // last local-file-header+data and its central-directory record is not needed
  // because fflate reads the central directory; instead use fflate's ability to
  // accept an array? Not available. Rebuild with two central records by hand:
  // use zipSync result and append the second file's local record, then patch
  // the EOCD entry count and add a central record. Keep it simple: concatenate
  // two zips (fflate reads the LAST central directory, so FIRST may vanish).
  fs.writeFileSync(F('zip-dup-marker.odt'), Buffer.concat([dup, second]));
  console.log('zip-dup-marker.odt written (concatenated two ODT zips)');
}

// --- 5. Path traversal / absolute entry names -------------------------------
{
  const entries = odtEntries('<?xml version="1.0"?><office:document-content/>');
  entries['../../evil.xml'] = strToU8('<evil>dotdot</evil>');
  entries['..\\evil2.xml'] = strToU8('<evil>backslash</evil>');
  entries['C:\\evil3.xml'] = strToU8('<evil>absolute</evil>');
  fs.writeFileSync(F('zip-traversal.odt'), Buffer.from(zipSync(entries, { level: 6 })));
  console.log('zip-traversal.odt written');
}

// --- 6. Nested zip + central directory pointing past EOF --------------------
{
  const inner = Buffer.from(zipSync({ 'content.xml': strToU8('<inner/>') }, { level: 0 }));
  const entries = odtEntries('<?xml version="1.0"?><office:document-content/>');
  entries['inner.zip'] = new Uint8Array(inner);
  fs.writeFileSync(F('zip-nested.odt'), Buffer.from(zipSync(entries, { level: 6 })));

  const normal = Buffer.from(zipSync(odtEntries('<?xml version="1.0"?><office:document-content/>'), { level: 0 }));
  // Patch EOCD central-directory offset to point far past EOF.
  const eocd = normal.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  normal.writeUInt32LE(0x7ffffff0, eocd + 16);
  fs.writeFileSync(F('zip-cd-past-end.odt'), normal);
  console.log('zip-nested.odt, zip-cd-past-end.odt written');
}

// --- 7. Truncations of each format at several offsets -----------------------
{
  const formats = {
    odt: Buffer.from(zipSync(odtEntries('<?xml version="1.0"?><office:document-content><office:body><office:text><text:p>hello world</text:p></office:text></office:body></office:document-content>'), { level: 6 })),
  };
  for (const [name, buf] of Object.entries(formats)) {
    for (const frac of [0.25, 0.5, 0.75, 0.95]) {
      const cut = Math.max(1, Math.floor(buf.length * frac));
      fs.writeFileSync(F(`trunc-${name}-${Math.round(frac * 100)}.${name}`), buf.subarray(0, cut));
    }
  }
  console.log('trunc-odt-* written');
}

console.log('done');
