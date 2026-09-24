// ADV phase-36 probe 7c: definitive paint/visibility check for the duplicate
// [data-action-dock] elements (single mode with 2 tabs, and Multi Mode).
'use strict';
const { boot, openSample, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

async function openAnother(app, window, name) {
  const fsx = require('node:fs');
  const src = path.join(process.cwd(), 'assets', 'samples', name);
  const dst = path.join(__dirname, 'samples', `p7c-${Date.now()}-${name}`);
  fsx.mkdirSync(path.dirname(dst), { recursive: true });
  fsx.copyFileSync(src, dst);
  await app.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, dst);
  await window.locator('[data-toolbar-open]').first().click();
  await sleep(2500);
}

const dump = (window) => window.evaluate(() => {
  const out = [];
  for (const d of document.querySelectorAll('[data-action-dock]')) {
    const r = d.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    let hiddenBy = null;
    for (let el = d; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || el.getAttribute('aria-hidden') === 'true') {
        hiddenBy = { tag: el.tagName, cls: el.className, visibility: cs.visibility, display: cs.display, ariaHidden: el.getAttribute('aria-hidden') };
        break;
      }
    }
    out.push({
      checkVisibility: typeof d.checkVisibility === 'function' ? d.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : null,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) },
      hitSelf: hit === d,
      hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null,
      hiddenBy,
      inMultiLayer: !!d.closest('[data-multi-dock-layer]'),
      opacity: getComputedStyle(d).opacity,
    });
  }
  return { count: out.length, docks: out };
});

(async () => {
  const out = {};
  const { app, window } = await boot({ profile: 'p7c' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1200);
    out.oneTab = await dump(window);
    await openAnother(app, window, 'long.pdf');
    out.twoTabs = await dump(window);
    await window.locator('[data-header-multi-mode]').first().click();
    await sleep(3000);
    out.multiEnter = await dump(window);
    const pick = window.locator('[data-pane-pick]').first();
    if (await pick.count() > 0) { await pick.click(); await sleep(2000); }
    out.multiFilled = await dump(window);
    await window.locator('[data-header-multi-mode]').first().click();
    await sleep(3000);
    out.afterLeave = await dump(window);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p7c.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    fs.writeFileSync(path.join(__dirname, 'out', 'p7c.error.txt'), String(err && err.stack || err));
  } finally {
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
