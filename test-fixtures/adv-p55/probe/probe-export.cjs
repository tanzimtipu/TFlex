// Adversary probe: exercise the SHIPPED export writers (buildXlsx, buildPptx)
// under hostile page counts / sizes.
const M = require('./bundle.cjs');
const { unzipSync } = require('fflate');
const mode = process.argv[2];
function rss() { return Math.round(process.memoryUsage().rss / (1024 * 1024)); }

(async () => {
  const t0 = Date.now();
  try {
    if (mode === 'xlsx-pages') {
      const n = Number(process.argv[3]);
      const pages = Array.from({ length: n }, (_, i) => ({ pageIndex: i + 1, text: `Page ${i + 1}\ncell1   cell2\nvalue   other` }));
      console.log(`[probe] buildXlsx pages=${n} rss0=${rss()}MB`);
      const build = M.buildXlsx({ pages, includeImages: false, images: [] });
      console.log(`[probe] buildXlsx OK in ${Date.now() - t0} ms; bytes=${build.bytes.length}; rss=${rss()}MB`);
      const files = unzipSync(new Uint8Array(build.bytes));
      const sheets = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
      console.log(`[probe] re-parsed produced workbook: sheets=${sheets.length}; bytes=${build.bytes.length}; rss=${rss()}MB`);
    } else if (mode === 'xlsx-huge-text') {
      const mb = Number(process.argv[3]);
      const pages = [{ pageIndex: 1, text: 'A'.repeat(mb * 1024 * 1024) }];
      console.log(`[probe] buildXlsx huge-text ${mb}MB rss0=${rss()}MB`);
      const build = M.buildXlsx({ pages, includeImages: false, images: [] });
      console.log(`[probe] buildXlsx OK in ${Date.now() - t0} ms; bytes=${build.bytes.length}; rss=${rss()}MB`);
    } else if (mode === 'xlsx-huge-image') {
      const dim = Number(process.argv[3]);
      const png = Buffer.alloc(1024 * 1024, 7); // 1 MiB fake png -> base64 ~1.4MB > 30k cap
      const pages = [{ pageIndex: 1, text: 'x' }];
      const build = M.buildXlsx({ pages, includeImages: true, images: [{ pageNumber: 1, width: dim, height: dim, pageWidth: 612, pageHeight: 792, pngBuffer: new Uint8Array(png) }] });
      console.log(`[probe] buildXlsx huge-image dim=${dim} OK in ${Date.now() - t0} ms; bytes=${build.bytes.length}; rss=${rss()}MB`);
      const files = unzipSync(new Uint8Array(build.bytes));
      const imgSheet = Object.keys(files).find((k) => /sheet\d+\.xml$/.test(k));
      console.log(`[probe] sheets=${Object.keys(files).filter((k) => /worksheets/.test(k)).length}`);
    } else if (mode === 'pptx-pages') {
      const n = Number(process.argv[3]);
      const pages = Array.from({ length: n }, (_, i) => ({ pageIndex: i + 1, text: `Page ${i + 1} body text` }));
      console.log(`[probe] buildPptx pages=${n} rss0=${rss()}MB`);
      const build = await M.buildPptx({ pages, includeImages: false, entries: [] });
      console.log(`[probe] buildPptx OK in ${Date.now() - t0} ms; bytes=${build.bytes.length}; rss=${rss()}MB`);
      const files = unzipSync(new Uint8Array(build.bytes));
      const slides = Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
      console.log(`[probe] re-parsed produced deck: slides=${slides.length}; rss=${rss()}MB`);
    } else if (mode === 'empty') {
      const x = M.buildXlsx({ pages: [], includeImages: false, images: [] });
      console.log(`[probe] buildXlsx zero pages -> bytes=${x.bytes.length}`);
      const p = await M.buildPptx({ pages: [], includeImages: false, entries: [] });
      console.log(`[probe] buildPptx zero pages -> bytes=${p.bytes.length}`);
    } else if (mode === 'blank') {
      const pages = Array.from({ length: 3 }, (_, i) => ({ pageIndex: i + 1, text: '' }));
      const x = M.buildXlsx({ pages, includeImages: false, images: [] });
      console.log(`[probe] buildXlsx all-blank -> bytes=${x.bytes.length} pagesWithoutText=${JSON.stringify(x.pagesWithoutText)}`);
      const p = await M.buildPptx({ pages, includeImages: false, entries: [] });
      console.log(`[probe] buildPptx all-blank -> bytes=${p.bytes.length} pagesWithoutText=${JSON.stringify(p.pagesWithoutText)}`);
    }
  } catch (e) {
    console.log(`[probe] THREW name=${e.name} msg=${e.message} after ${Date.now() - t0} ms; rss=${rss()}MB`);
  }
  console.log('[probe] COMPLETE');
})();
