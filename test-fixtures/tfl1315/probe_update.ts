// TFL-1315 class-4 update-mapping edge driver. Exercises the REAL pure mapper
// (updateStateAction) and the REAL store reducer, with and without App's
// same-kind key guard, and prints the resulting rows.
import {
  updateStateAction,
  reduceActivityShelf,
  initialActivityShelfState,
  UPDATE_OPERATION_ID,
  type ActivityShelfState,
} from '../../src/renderer/state/activityShelf';
import type { UpdateState } from '../../src/shared/types';

function rows(st: ActivityShelfState) {
  return st.operations.map((o) => ({ id: o.id, state: o.state.kind }));
}

function drive(label: string, states: (UpdateState | null)[], useGuard: boolean) {
  let st = initialActivityShelfState;
  let lastKey: string | null = null;
  const log: unknown[] = [];
  for (const s of states) {
    const key = s === null ? 'null' : s.kind;
    let skipped = false;
    if (useGuard) {
      if (lastKey === key) skipped = true; else lastKey = key;
    }
    const current = st.operations.find((o) => o.id === UPDATE_OPERATION_ID);
    const action = skipped ? null : updateStateAction(current, s);
    if (action !== null) st = reduceActivityShelf(st, action);
    log.push({ in: s === null ? null : s.kind, skipped, action: action ? action.type : null, rows: rows(st) });
  }
  return { label, useGuard, log };
}

const out = [
  drive('downloaded-no-prior', [{ kind: 'downloaded', version: '9' }], true),
  drive('error-then-retry-downloading-without-checking', [
    { kind: 'available', version: '9' },
    { kind: 'error', message: 'network down' },
    { kind: 'downloading', progress: 10 },
    { kind: 'downloaded', version: '9' },
  ], true),
  drive('unsupported-clears', [
    { kind: 'available', version: '9' },
    { kind: 'unsupported', reason: 'no channel' },
  ], true),
  drive('repeat-same-kind-then-complete', [
    { kind: 'available', version: '9' },
    { kind: 'available', version: '9' },
    { kind: 'downloading', progress: 1 },
    { kind: 'downloading', progress: 2 },
    { kind: 'downloaded', version: '9' },
  ], true),
  drive('completed-then-new-cycle', [
    { kind: 'downloading', progress: 1 },
    { kind: 'downloaded', version: '9' },
    { kind: 'available', version: '10' },
    { kind: 'downloading', progress: 5 },
    { kind: 'downloaded', version: '10' },
  ], true),
  drive('error-then-checking-clears', [
    { kind: 'available', version: '9' },
    { kind: 'error', message: 'x' },
    { kind: 'checking' },
  ], true),
];

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
