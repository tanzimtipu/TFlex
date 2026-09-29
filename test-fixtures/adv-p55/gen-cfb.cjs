// OLE/CFB hostile fixtures for the Phase-55 legacy .doc/.ppt walker.
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.resolve(__dirname);
const F = (n) => path.join(OUT, n);

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const SEC = 512;

// Build an OLE/CFB with one FAT sector (0), one directory sector (1), and a
// data sector (2). `mutate` can override header/FAT/directory fields.
function buildCfb({ mutate } = {}) {
  const total = 3; // sectors 0,1,2
  const buf = Buffer.alloc((total + 1) * SEC, 0);
  // Header
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(buf, 0);
  buf.writeUInt16LE(0x003e, 0x18); // minor
  buf.writeUInt16LE(0x0003, 0x1a); // major (v3)
  buf.writeUInt16LE(0xfffe, 0x1c); // byte order
  buf.writeUInt16LE(9, 0x1e); // sector shift -> 512
  buf.writeUInt16LE(6, 0x20); // mini sector shift -> 64
  buf.writeUInt32LE(0, 0x28); // num dir sectors (v3 => 0)
  buf.writeUInt32LE(1, 0x2c); // num FAT sectors
  buf.writeUInt32LE(1, 0x30); // first directory sector
  buf.writeUInt32LE(0, 0x34); // transaction
  buf.writeUInt32LE(0, 0x38); // mini stream cutoff (0 -> all FAT, simplifies)
  buf.writeUInt32LE(ENDOFCHAIN, 0x3c); // first miniFAT
  buf.writeUInt32LE(0, 0x40); // num miniFAT
  buf.writeUInt32LE(ENDOFCHAIN, 0x44); // first DIFAT
  buf.writeUInt32LE(0, 0x48); // num DIFAT
  for (let i = 0; i < 109; i += 1) buf.writeUInt32LE(i === 0 ? 0 : FREESECT, 0x4c + i * 4);

  // FAT sector 0
  const fatOff = SEC; // sector 0
  for (let i = 0; i < 128; i += 1) buf.writeUInt32LE(FREESECT, fatOff + i * 4);
  buf.writeUInt32LE(ENDOFCHAIN, fatOff + 0 * 4); // FAT sector itself
  buf.writeUInt32LE(ENDOFCHAIN, fatOff + 1 * 4); // directory chain
  buf.writeUInt32LE(ENDOFCHAIN, fatOff + 2 * 4); // WordDocument chain

  // Directory sector 1
  const dirOff = 2 * SEC;
  function entry(index, name, type, start, sizeLow, sizeHigh) {
    const o = dirOff + index * 128;
    const nm = Buffer.from(name, 'utf16le');
    nm.copy(buf, o, 0, Math.min(nm.length, 62));
    buf.writeUInt16LE(Math.min(nm.length + 2, 64), o + 64);
    buf[o + 66] = type;
    buf[o + 67] = 1; // black
    buf.writeUInt32LE(FREESECT, o + 68); // left
    buf.writeUInt32LE(FREESECT, o + 72); // right
    buf.writeUInt32LE(FREESECT, o + 76); // child
    buf.writeUInt32LE(start, o + 116);
    buf.writeUInt32LE(sizeLow, o + 120);
    buf.writeUInt32LE(sizeHigh, o + 124);
  }
  entry(0, 'Root Entry', 5, ENDOFCHAIN, 0);
  entry(1, 'WordDocument', 2, 2, 64);
  // WordDocument stream content at sector 2
  const wdOff = 3 * SEC;
  buf.writeUInt16LE(0xa5ec, wdOff + 0); // FIB magic
  buf.writeUInt16LE(0x0000, wdOff + 0x0a); // flags: not complex/encrypted
  buf.writeUInt32LE(0x20, wdOff + 0x18); // fcMin
  buf.writeUInt32LE(0x40, wdOff + 0x1c); // fcMac
  Buffer.from('HELLO FROM A LEGACY DOC', 'latin1').copy(buf, wdOff + 0x20);
  if (mutate) mutate({ buf, fatOff, dirOff, entry });
  return buf;
}

fs.writeFileSync(F('cfb-valid.doc'), buildCfb());

// 5. Cyclic FAT chain on the WordDocument stream (self-referencing sector).
fs.writeFileSync(
  F('cfb-cyclic-fat.doc'),
  buildCfb({
    mutate: ({ buf, fatOff, dirOff }) => {
      buf.writeUInt32LE(2, fatOff + 2 * 4); // FAT[2] = 2 (loop)
      // Bump the stream size so readFatChain follows the chain at least once.
      buf.writeUInt32LE(4096, dirOff + 1 * 128 + 120);
    },
  }),
);

// 6. Self-referencing directory chain (directory sector loops).
fs.writeFileSync(
  F('cfb-selfref-dir.doc'),
  buildCfb({ mutate: ({ buf, fatOff }) => { buf.writeUInt32LE(1, fatOff + 1 * 4); } }),
);

// 6b. Directory chain never terminates in a long non-looping run.
fs.writeFileSync(
  F('cfb-dir-chain-long.doc'),
  buildCfb({
    mutate: ({ buf, fatOff, dirOff }) => {
      // Make FAT[1] -> 2 -> 1 (a 2-cycle) so the loop detector must catch it.
      buf.writeUInt32LE(2, fatOff + 1 * 4);
      buf.writeUInt32LE(1, fatOff + 2 * 4);
      buf.writeUInt32LE(8192, dirOff + 1 * 128 + 120);
    },
  }),
);

// 7. Stream size 0xFFFFFFFF high word (classic OLE overflow).
fs.writeFileSync(
  F('cfb-size-ffffffff.doc'),
  buildCfb({
    mutate: ({ buf, dirOff }) => {
      buf.writeUInt32LE(0xffffffff, dirOff + 1 * 128 + 120); // size low
      buf.writeUInt32LE(0x00000001, dirOff + 1 * 128 + 124); // size high -> MAX_SAFE
    },
  }),
);

// 8. Stream start sector beyond the file.
fs.writeFileSync(
  F('cfb-sector-oob.doc'),
  buildCfb({ mutate: ({ buf, dirOff }) => { buf.writeUInt32LE(0x00ffffff, dirOff + 1 * 128 + 116); } }),
);

// 8b. FAT entry beyond the sector table is not needed (out-of-file already).
fs.writeFileSync(F('cfb-header-only.doc'), buildCfb().subarray(0, 512));
fs.writeFileSync(F('cfb-zero-sectors.doc'), (() => {
  const b = Buffer.alloc(512, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(b, 0);
  return b;
})());

// 9. Valid CFB but no WordDocument stream (rename it "Data").
fs.writeFileSync(
  F('cfb-no-stream.doc'),
  buildCfb({ mutate: ({ buf, dirOff }) => { Buffer.from('Data', 'utf16le').copy(buf, dirOff + 1 * 128, 0); } }),
);

// 10. Legacy .ppt with a cyclic FAT on its PowerPoint Document stream.
fs.writeFileSync(
  F('cfb-ppt-cyclic.ppt'),
  buildCfb({
    mutate: ({ buf, fatOff, dirOff }) => {
      Buffer.from('PowerPoint Document', 'utf16le').copy(buf, dirOff + 1 * 128, 0);
      buf.writeUInt16LE(Buffer.from('PowerPoint Document', 'utf16le').length + 2, dirOff + 1 * 128 + 64);
      buf.writeUInt32LE(2, fatOff + 2 * 4);
      buf.writeUInt32LE(4096, dirOff + 1 * 128 + 120);
    },
  }),
);

console.log('CFB fixtures written');
for (const f of fs.readdirSync(OUT).filter((n) => n.startsWith('cfb-'))) {
  console.log(` - ${f} ${fs.statSync(F(f)).size} bytes`);
}
