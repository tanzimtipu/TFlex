// Adversary probe: exercise the SHIPPED CFB walker + legacy text recovery.
const fs = require('node:fs');
const M = require('./bundle.cjs');
const file = process.argv[2];
function rss() { return Math.round(process.memoryUsage().rss / (1024 * 1024)); }
const bytes = new Uint8Array(fs.readFileSync(file));
console.log(`[probe] file=${file} size=${bytes.length} rss0=${rss()}MB`);
const t0 = Date.now();
try {
  const doc = new M.CompoundFile(bytes);
  console.log(`[probe] CompoundFile OK in ${Date.now() - t0} ms; rss=${rss()}MB`);
  const rec = M.recoverDocText(doc);
  console.log(`[probe] recoverDocText => ${rec === null ? 'null' : JSON.stringify(rec).slice(0, 160)}; rss=${rss()}MB`);
} catch (e) {
  console.log(`[probe] THREW name=${e.name} msg=${e.message} after ${Date.now() - t0} ms; rss=${rss()}MB`);
}
console.log('[probe] COMPLETE');
