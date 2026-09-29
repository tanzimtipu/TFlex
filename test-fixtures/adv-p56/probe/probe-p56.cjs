// Phase-56 adversary pure-parser probe. Runs the SHIPPED functions from the
// esbuild bundle. No Electron, no product-code changes.
// usage: node probe-p56.cjs <mode> <file>
const fs = require('node:fs');
const M = require('./bundle.cjs');

const file = process.argv[3];
const mode = process.argv[2];
const rss = () => Math.round(process.memoryUsage().rss / (1024 * 1024));
const bytes = file && fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
console.log(`[probe] mode=${mode} file=${file || '-'} size=${bytes ? bytes.length : 0} rss0=${rss()}MB`);
const t0 = Date.now();
const done = (tag, extra = {}) => console.log(`[probe] ${tag} ${JSON.stringify(extra)} after ${Date.now() - t0} ms rss=${rss()}MB`);

function open() {
  try { return M.openZip(bytes); }
  catch (e) { throw Object.assign(new Error(`openZip: ${e.name}: ${e.message}`), { code: e.code }); }
}

void (async () => {
try {
  if (mode === 'epub-parse' || mode === 'epub-print' || mode === 'epub-reading') {
    const arch = open();
    const doc = M.parseEpub(arch);
    done('parseEpub', { title: doc.title, spine: doc.spine.length, images: doc.images.size, degraded: doc.degraded, cover: doc.coverHref || null });
    if (mode === 'epub-print') {
      const html = M.composeEpubBody(doc);
      done('composeEpubBody', { htmlLen: html.length });
    } else if (mode === 'epub-reading') {
      let total = 0;
      for (const it of doc.spine) {
        const frag = M.sanitizeEpubFragment(M.inlineEpubImages(M.chapterFragment(it.xhtml), it.href, doc.images));
        total += frag.length;
      }
      done('readingDocument', { chapters: doc.spine.length, totalFragChars: total });
    }
  } else if (mode === 'mobi' || mode === 'mobi-compose') {
    const doc = M.parseMobi(bytes);
    done('parseMobi', { title: doc.title, markupLen: doc.markup.length, images: doc.images.size, referenced: doc.referenced.length, usedKf8: doc.usedKf8, hasKf8Part: doc.hasKf8Part, notes: doc.notes });
    if (mode === 'mobi-compose') {
      const warnings = [];
      const body = M.composeMobiBody(doc, warnings);
      done('composeMobiBody', { bodyLen: body.length, warnings: warnings.length });
    }
  } else if (mode === 'lz77') {
    const db = M.parsePalmDb(bytes);
    const hdr = M.parsePalmDocHeader(db.bytes.subarray(db.records[0].offset, db.records[0].offset + db.records[0].length));
    done('header', hdr);
    const rec = db.bytes.subarray(db.records[1].offset, db.records[1].offset + db.records[1].length);
    const out = M.decompressPalmDoc(rec, M.MAX_MOBI_TEXT_BYTES);
    done('decompressPalmDoc', { outLen: out.length });
  } else if (mode === 'padb') {
    const db = M.parsePalmDb(bytes);
    done('parsePalmDb', { name: db.name, records: db.records.length, r0: db.records[0] });
  } else if (mode === 'tar') {
    const entries = M.readTar(bytes);
    done('readTar', { entries: entries.length, first: entries[0] ? entries[0].name : null, totalBytes: entries.reduce((s, e) => s + e.bytes.length, 0) });
  } else if (mode === 'cbt' || mode === 'cbz') {
    const factory = mode === 'cbt' ? M.createCbtAdapter : M.createCbzAdapter;
    const stub = async (html) => ({ ok: true, value: { bytes: new Uint8Array([37, 80, 68, 70, 45]), pageCount: 1, blockedUrls: [] } });
    const adapter = factory(stub);
    const res = await adapter.convert({ path: file, options: M.resolveConvertOptions({}), head: bytes.subarray(0, 4096) });
    done('adapter', { pageCount: res.pageCount, warnings: res.warnings.map((w) => w.code), title: res.title });
  } else if (mode === 'mobi-amp-synth') {
    const k = Number(process.argv[4]);
    const ib = Number(process.argv[5] || 1048576);
    const img = (() => {
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdr = Buffer.alloc(25);
      ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1');
      ihdr.writeUInt32BE(1, 8); ihdr.writeUInt32BE(1, 12);
      ihdr[16] = 8; ihdr[17] = 6;
      const b = Buffer.alloc(ib, 0x41); sig.copy(b, 0); ihdr.copy(b, 8);
      return new Uint8Array(b);
    })();
    const markup = '<img recindex="1"/>'.repeat(k);
    const doc = { title: '', markup, images: new Map([[1, img]]), referenced: [1], usedKf8: false, hasKf8Part: false, notes: [] };
    console.log(`[amp] k=${k} imgBytes=${ib} markupLen=${markup.length}`);
    const hb = setInterval(() => console.log(`[amp] t=${Date.now() - t0}ms rss=${rss()}MB`), 5000);
    const warnings = [];
    const out = M.inlineMobiImages(markup, doc, warnings);
    clearInterval(hb);
    done('inline', { outLen: out.length });
  } else if (mode === 'scrub') {
    const cases = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    for (const c of cases) {
      let out;
      try { out = M.sanitizeEpubFragment(c.in); } catch (e) { out = `THREW ${e.name}: ${e.message}`; }
      console.log(`[scrub] ${c.id} OUT=${JSON.stringify(out.slice(0, 400))}`);
    }
    done('scrub');
  } else if (mode === 'href') {
    const cases = [
      ['OEBPS', '../evil.xhtml'], ['OEBPS', 'http://evil/x.xhtml'], ['OEBPS', 'file:///C:/win.ini'],
      ['OEBPS', '%2e%2e%2f%2e%2e%2fevil.xhtml'], ['OEBPS', '/abs.xhtml'], ['OEBPS', 'data:text/html,<b>x</b>'],
      ['OEBPS', 'pic.png'], ['', 'a/../b.png'], ['OEBPS', 'C:\\Windows\\win.ini'],
    ];
    for (const [base, href] of cases) console.log(`[href] base=${JSON.stringify(base)} href=${JSON.stringify(href)} => ${JSON.stringify(M.resolveEpubHref(base, href))}`);
    done('href');
  } else {
    console.log(`[probe] unknown mode ${mode}`);
  }
} catch (e) {
  done('THREW', { name: e.name, message: e.message, code: e.code || null });
  process.exitCode = 0;
}
console.log('[probe] COMPLETE');
})();
