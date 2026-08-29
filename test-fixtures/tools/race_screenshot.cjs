// Capture a screenshot of the save-race state for the finding record
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const APP = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const TEMP = process.env.TEMP || APP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const electronApp = await electron.launch({
    args: [APP, '--disable-gpu', '--no-sandbox'],
    env: { ...process.env, ELECTRON_RENDERER_URL: 'file://C:/Users/tanzi/OneDrive/App%20Development/TFlex/dist/renderer/index.html' },
  });
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 20000 });
  const src = path.join(TEMP, 'tflex-race-shot.pdf');
  fs.copyFileSync(path.join(APP, 'assets/samples/report.pdf'), src);
  const r = await win.evaluate(async (p) => {
    const api = window.tflex.engine;
    await api.loadDocument('adv-shot', p);
    await api.merge('adv-shot', [p], 'after');
    const saveP = api.save('adv-shot');
    const dels = [api.applyOp('adv-shot', { kind: 'delete', page: 67 }), api.applyOp('adv-shot', { kind: 'delete', page: 66 }), api.applyOp('adv-shot', { kind: 'delete', page: 65 })];
    const saveRes = await saveP;
    const ds = await Promise.all(dels);
    const st = await api.getState('adv-shot');
    const rl = await api.loadDocument('adv-shot-chk', p);
    const disk = rl.ok ? (await api.getState('adv-shot-chk')).value.pageCount : -1;
    return { memPages: st.value.pageCount, diskPages: disk, modified: st.value.modified, delsOk: ds.every((x) => x.ok), saveOk: saveRes.ok };
  }, src.replace(/\\/g, '/'));
  console.log('race shot:', JSON.stringify(r));
  await win.screenshot({ path: path.join(APP, 'screenshots', 'adv-save-race.png') });
  await electronApp.close().catch(() => {});
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e.message.split('\n')[0]);
  process.exit(1);
});