// ADV Phase 31 - direct probe of the pure modules.
// Bundles the REAL src/shared/whatsNew.ts and src/main/services/update-service.ts
// with esbuild, stubbing `electron` / `electron-updater` so the pure functions
// (whatsNewFor / whatsNewHistory / normalizeReleaseNotes) can be exercised in
// isolation. No product code is modified.
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, '_build');
fs.mkdirSync(OUT, { recursive: true });

function stubSource(pkg) {
  if (pkg === 'electron') {
    return 'const app={getAppPath:()=>process.cwd(),getVersion:()=>"0.0.0",getPath:()=>process.cwd()};\nmodule.exports={app,ipcMain:{},BrowserWindow:{}};\n';
  }
  return 'const autoUpdater={on(){},setFeedURL(){},checkForUpdates:()=>Promise.resolve(),downloadUpdate:()=>Promise.resolve(),quitAndInstall(){}};\nmodule.exports={autoUpdater};\n';
}

async function bundle(entry, outfile) {
  await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile,
    logLevel: 'silent',
    plugins: [{
      name: 'adv-stub',
      setup(build) {
        build.onResolve({ filter: /^(electron|electron-updater)$/ }, (a) => ({ path: a.path, namespace: 'advstub' }));
        build.onLoad({ filter: /.*/, namespace: 'advstub' }, (a) => ({ contents: stubSource(a.path), loader: 'js' }));
      },
    }],
  });
}

async function main() {
bundle('src/shared/whatsNew.ts', path.join(OUT, 'whatsNew.cjs'));
bundle('src/main/services/update-service.ts', path.join(OUT, 'update-service.cjs'));
await bundle('src/shared/whatsNew.ts', path.join(OUT, 'whatsNew.cjs'));
await bundle('src/main/services/update-service.ts', path.join(OUT, 'update-service.cjs'));

const wn = require(path.join(OUT, 'whatsNew.cjs'));
const us = require(path.join(OUT, 'update-service.cjs'));

const out = [];
const say = (s) => { out.push(s); console.log(s); };

say('==== whatsNewFor (exact match) ====');
const cases = [
  '1.23.1', '1.23.0', '1.23', '1.23.0.1', 'v1.23.0', '1.23.0 ',
  ' 1.23.1', '1.2', '1.2.3', '', '1.23.1\n', '1.23.10', '1.23.01',
];
for (const c of cases) {
  const r = wn.whatsNewFor(c);
  say(`whatsNewFor(${JSON.stringify(c)}) -> ${r ? `"${r.version}"` : 'null'}`);
}
say(`whatsNewFor(undefined) -> ${(() => { try { const r = wn.whatsNewFor(undefined); return r ? r.version : 'null'; } catch (e) { return 'THREW ' + e.message; } })()}`);
say(`whatsNewFor(null) -> ${(() => { try { const r = wn.whatsNewFor(null); return r ? r.version : 'null'; } catch (e) { return 'THREW ' + e.message; } })()}`);

say('');
say('==== prefix-collision probe ====');
say(`WHAT_NEW versions: ${wn.WHATS_NEW.map((e) => e.version).join(', ')}`);
say(`does '1.2' prefix-match '1.23.1'? ${wn.whatsNewFor('1.2') ? 'YES (BAD)' : 'no (exact only)'}`);

say('');
say('==== whatsNewHistory ====');
const histCases = [undefined, 0, -1, -0.5, 1, 2, 3, 4, 100, 1e9, NaN, Infinity, -Infinity, 1.9, 0.5];
for (const c of histCases) {
  let r;
  try { r = wn.whatsNewHistory(c); } catch (e) { say(`whatsNewHistory(${c}) THREW ${e.message}`); continue; }
  say(`whatsNewHistory(${c}) -> len=${r.length} [${r.map((e) => e.version).join(', ')}]`);
}
for (const c of ['2', 'x', null, {}]) {
  try { const r = wn.whatsNewHistory(c); say(`whatsNewHistory(${JSON.stringify(c)}) -> len=${r.length} [${r.map((e) => e.version).join(', ')}]`); }
  catch (e) { say(`whatsNewHistory(${JSON.stringify(c)}) THREW ${e.message}`); }
}

say('');
say('==== normalizeReleaseNotes ====');
const noteCases = [
  ['undefined', undefined],
  ['null', null],
  ['empty string', ''],
  ['whitespace only', '   \n\t  \n  '],
  ['plain', 'Hello\nWorld'],
  ['blank lines', 'a\n\n\n b '],
  ['CRLF', 'a\r\nb'],
  ['lone CR', 'a\rb'],
  ['number', 123],
  ['object', {}],
  ['array of strings', ['one', 'two']],
  ['array of {version,note}', [{ version: '1.0', note: 'alpha' }, { version: '1.0', note: 'beta' }]],
  ['array with null note', [{ version: '1.0', note: null }]],
  ['array with number note', [{ version: '1.0', note: 42 }]],
  ['array with object note', [{ version: '1.0', note: { a: 1 } }]],
  ['array with undefined entry', [undefined, null, { note: 'kept' }]],
  ['nested array', [[{ note: 'x' }]]],
  ['array of {version} no note', [{ version: '1.0' }]],
  ['html notes', '<script>alert(1)</script>\n<b>bold</b>'],
  ['javascript url', 'javascript:alert(1)'],
  ['100k single line', 'A'.repeat(100000)],
  ['5000 lines', Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')],
];
for (const [label, input] of noteCases) {
  let r;
  try { r = us.normalizeReleaseNotes(input); } catch (e) { say(`normalize(${label}) THREW ${e.message}`); continue; }
  const desc = r === undefined ? 'undefined' : `array(len=${r.length}) first=${JSON.stringify(r[0] === undefined ? null : String(r[0]).slice(0, 40))} last=${JSON.stringify(r.length ? String(r[r.length - 1]).slice(0, 40) : null)}`;
  say(`normalize(${label}) -> ${desc}`);
  if (Array.isArray(r)) {
    const bad = r.findIndex((x) => typeof x !== 'string');
    if (bad >= 0) say(`  !! non-string element at ${bad}: ${JSON.stringify(r[bad])}`);
    const undef = r.filter((x) => x === undefined || /^undefined$/i.test(String(x)));
    if (undef.length) say(`  !! ${undef.length} undefined-ish entries`);
  }
}

// A hostile-but-typed releaseNotes that a compromised/buggy feed could hand us.
const hostileObj = { note: 'shallow note' };
say(`normalize(object with note) -> ${JSON.stringify(us.normalizeReleaseNotes(hostileObj))}`);

say('');
say('==== release gate ====');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const running = String(pkg.version);
const entry = wn.whatsNewFor(running);
say(`package.json version = ${JSON.stringify(running)}`);
say(`whatsNewFor(running) = ${entry ? entry.version : 'null'}`);
say(`WHATS_NEW[0].version = ${wn.WHATS_NEW[0].version}`);
say(`running === WHATS_NEW[0].version ? ${running === wn.WHATS_NEW[0].version}`);
say(`every WHATS_NEW version is valid semver-looking ? ${wn.WHATS_NEW.every((e) => /^\d+\.\d+\.\d+$/.test(e.version))}`);

fs.writeFileSync(path.join(OUT, 'report.txt'), out.join('\n'));
}

main().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });