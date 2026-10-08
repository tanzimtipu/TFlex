// ADV-248 probe (TFL-1264) — exercises the REAL SettingsService queue.
//
// Committed HEAD (5347365) save() reads this.current at queue-execution time:
//   save(s) { this.current = normalizeSettings(s);
//             const task = this._saveQueue.then(() => this._doSave(this.current)); ... }
// so a failed write's rollback (current = persisted) makes the next queued
// write persist the rolled-back value, silently dropping the newer change.
//
// The working tree already carries the TFL-1263 snapshot-at-call-time fix
// (uncommitted), so this probe runs BOTH semantics for contrast.
//
// Bundle + run from repo root:
//   npx esbuild test-fixtures/tfl1264-adversary/probe_queued_write_drop.mjs \
//     --bundle --platform=node --format=esm --target=node24 \
//     --outfile=test-fixtures/tfl1264-adversary/probe_queued_write_drop.bundle.mjs
//   node test-fixtures/tfl1264-adversary/probe_queued_write_drop.bundle.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  SettingsService,
  normalizeSettings,
} from '../../src/main/services/settings.ts';

const P = { ...DEFAULT_SETTINGS, theme: 'dark' }; // last value persisted to disk
const X = { ...DEFAULT_SETTINGS, theme: 'frosted' }; // write #1 (fails)
const Z = { ...DEFAULT_SETTINGS, theme: 'light' }; // write #2 (the user's newer change)

// Exact committed-HEAD save(): reads this.current when the queued task runs.
function installHeadSave(svc) {
  svc.save = function headSave(settings) {
    this.current = normalizeSettings(settings);
    const task = this._saveQueue.then(() => this._doSave(this.current));
    this._saveQueue = task.catch(() => {});
    return task;
  };
}

async function run(label, headSemantics) {
  const dir = mkdtempSync(join(tmpdir(), 'adv248-'));
  const filePath = join(dir, 'settings.json');
  const tmpPath = `${filePath}.tmp`;
  const echoes = [];
  const errors = [];
  const svc = new SettingsService(
    filePath,
    (s) => echoes.push(s.theme),
    (m) => {
      errors.push(m);
      // Clear write #1's block as soon as #1 fails, so write #2 can land and
      // reveal WHAT value it lands (rolled-back P vs the newer Z).
      try {
        rmSync(tmpPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  );
  if (headSemantics) installHeadSave(svc);

  await svc.save(P); // establish persisted = P on disk
  await svc.load(); // persisted = P
  mkdirSync(tmpPath, { recursive: true }); // make write #1 fail (writeFile -> EISDIR)

  const p1 = svc.save(X); // write #1 (will fail)
  const p2 = svc.save(Z); // write #2 queued behind #1, before #1 settles
  await Promise.allSettled([p1, p2]);

  const disk = JSON.parse(readFileSync(filePath, 'utf8'));
  const dropped = disk.theme !== 'light';
  console.log(`\n[${label}]`);
  console.log('  write errors observed :', errors.length);
  console.log('  echo themes           :', echoes.join(',') || '(none)');
  console.log('  disk theme after settle:', disk.theme);
  console.log(
    '  verdict               :',
    dropped
      ? `DEF-639 REPRODUCED - newer Z (light) DROPPED, rolled-back P (${disk.theme}) persisted`
      : 'no defect - newer Z (light) persisted',
  );
  rmSync(dir, { recursive: true, force: true });
  return dropped;
}

const headDropped = await run('committed HEAD 5347365 save() semantics', true);
const treeDropped = await run('working tree save() semantics (TFL-1263 fix present)', false);

console.log('\nExpectation: HEAD drops Z (defect); working tree keeps Z (fixed).');
console.log('HEAD dropped:', headDropped, '| working tree dropped:', treeDropped);
