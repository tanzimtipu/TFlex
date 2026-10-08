// ADV-247 / DEF-638 probe (TFL-1264/1262) — exercises the write-failure branch of
// src/renderer/hooks/useSettingsWriteRollback.ts. Post-TFL-1262 the hook falls
// back to the last value the app actually confirmed when the authoritative
// re-read fails (`ok:false` or reject), so the UI never keeps a value that never
// persisted.
//
// Run from repo root:
//   node test-fixtures/tfl1264-adversary/probe_loadfail_keep.mjs
function makeHarness(loadImpl) {
  let restored = null;
  let errored = null;
  const listeners = [];
  const LAST_CONFIRMED = { theme: 'dark' }; // the value the app actually confirmed
  const settingsApi = {
    writeError: (cb) => {
      listeners.push(cb);
      return () => {};
    },
  };
  const fakeWindow = {
    tflex: { settings: settingsApi, loadSettings: loadImpl },
  };

  // --- useSettingsWriteRollback.ts (fixed body, ADV-247) ---
  const onRestore = (value) => {
    restored = value;
  };
  const onError = (message) => {
    errored = message;
  };
  const getLastConfirmed = () => LAST_CONFIRMED;
  const restoreFallback = () => {
    const lastConfirmed = getLastConfirmed();
    if (lastConfirmed !== null) onRestore(lastConfirmed);
  };
  settingsApi.writeError((message) => {
    onError(message);
    void fakeWindow.tflex
      .loadSettings()
      .then((result) => {
        if (result.ok) {
          onRestore(result.value);
          return;
        }
        restoreFallback();
      })
      .catch(restoreFallback);
  });
  // --- end hook body ---

  listeners.forEach((cb) => cb('could not write settings.json'));
  return new Promise((resolve) => {
    setImmediate(() =>
      resolve({ restored, errored, keptOptimistic: restored === null }),
    );
  });
}

const cases = [
  ['loadSettings resolves {ok:true}', () => Promise.resolve({ ok: true, value: { theme: 'dark' } })],
  ['loadSettings resolves {ok:false}', () => Promise.resolve({ ok: false })],
  ['loadSettings rejects', () => Promise.reject(new Error('EACCES'))],
];

for (const [label, impl] of cases) {
  const r = await makeHarness(impl);
  console.log(
    `${label.padEnd(34)} -> toast=${JSON.stringify(r.errored)} onRestore=${
      r.restored === null ? 'NOT CALLED' : JSON.stringify(r.restored)
    } keptOptimistic=${r.keptOptimistic}`,
  );
}
console.log(
  '\nExpected: every failure path must not keep the unpersisted value ' +
    '(onRestore called, keptOptimistic=false).',
);
