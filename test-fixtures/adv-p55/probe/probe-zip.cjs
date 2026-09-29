// Adversary probe: exercise the SHIPPED ZIP guard (inspectZip/openZip) on a
// hostile archive, and separately show what fflate alone does with it.
const fs = require('node:fs');
const { unzipSync } = require('fflate');
const M = require('./bundle.cjs');

const file = process.argv[2];
const mode = process.argv[3] || 'inspect';
function rss() { return Math.round(process.memoryUsage().rss / (1024 * 1024)); }

const bytes = new Uint8Array(fs.readFileSync(file));
console.log(`[probe] file=${file} size=${bytes.length} mode=${mode} rss0=${rss()}MB`);

// Show what fflate reports for each entry's DECLARED original size.
if (process.argv[4] === 'rawfflate') {
  const t0 = Date.now();
  const seen = [];
  const files = unzipSync(bytes, {
    filter(f) { seen.push({ name: f.name, originalSize: f.originalSize, size: f.size }); return seen.length <= 10050; },
  });
  const total = Object.values(files).reduce((n, b) => n + b.length, 0);
  console.log(`[probe] fflate unzipSync OK in ${Date.now() - t0} ms; entries=${Object.keys(files).length}; actualTotal=${total}; rss=${rss()}MB`);
  console.log('[probe] first entries:', JSON.stringify(seen.slice(0, 6)));
  console.log('[probe] COMPLETE');
  process.exit(0);
}

const t0 = Date.now();
try {
  if (mode === 'inspect') {
    M.inspectZip(bytes);
    console.log(`[probe] inspectZip PASSED (no ceiling hit) in ${Date.now() - t0} ms; rss=${rss()}MB`);
  } else {
    const arch = M.openZip(bytes);
    console.log(`[probe] openZip OK in ${Date.now() - t0} ms; names=${arch.names().length}; rss=${rss()}MB`);
    console.log('[probe] names sample:', JSON.stringify(arch.names().slice(0, 8)));
  }
} catch (e) {
  console.log(`[probe] ${mode} THREW name=${e.name} code=${e.code || ''} msg=${e.message} after ${Date.now() - t0} ms; rss=${rss()}MB`);
}
console.log('[probe] COMPLETE');
