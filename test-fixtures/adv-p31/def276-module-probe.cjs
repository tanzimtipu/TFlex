// QA retest of DEF-276 - direct probe of the REAL src/shared/whatsNew.ts
// bundled with esbuild (same stub-free technique as module-probe.cjs; this
// module has no electron imports). Prints the returned history versions.
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, '_build');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/shared/whatsNew.ts')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node24',
    outfile: path.join(OUT, 'def276-whatsNew.cjs'), logLevel: 'silent',
  });
  const wn = require(path.join(OUT, 'def276-whatsNew.cjs'));
  console.log(`WHATS_NEW versions (newest first): ${wn.WHATS_NEW.map((e) => e.version).join(', ')}`);
  const cases = [["'1.2'", '1.2'], ["'1.22.0', 2", '1.22.0', 2], ["'9.9.9'", '9.9.9']];
  for (const [label, version, limit] of cases) {
    const r = wn.whatsNewHistory(version, limit);
    console.log(`whatsNewHistory(${label}) -> [${r.map((e) => e.version).join(', ')}]`);
  }
  const running = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  console.log(`whatsNewHistory(${JSON.stringify(running)}) -> [${wn.whatsNewHistory(running).map((e) => e.version).join(', ')}]`);
  console.log(`whatsNewHistory(${JSON.stringify(running)}, 3) -> [${wn.whatsNewHistory(running, 3).map((e) => e.version).join(', ')}]`);
})().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });
