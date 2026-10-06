const path = require('node:path');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
delete process.env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await sleep(400);
  const out = {};
  for (const theme of ['light', 'frosted']) {
    await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await sleep(350);
    out[theme] = await win.evaluate(() => {
      const el = document.querySelector('.welcome-sub');
      const chain = [];
      let n = el;
      while (n) {
        const cs = getComputedStyle(n);
        chain.push({
          tag: n.tagName,
          cls: String(n.className).slice(0, 50),
          bgColor: cs.backgroundColor,
          bgImage: cs.backgroundImage.slice(0, 40),
        });
        n = n.parentElement;
      }
      return chain;
    });
  }
  console.log(JSON.stringify(out, null, 2));
  await hardClose(app, 'adv-p110-surface');
})().catch((e) => { console.error(e); process.exit(1); });
