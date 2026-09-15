// One-off probe (qa): the frosted scroller's real box vs the CSS intent,
// and page-1 top in each theme. Deleted after the spacing fix check.
const { test } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSample } = require('./lib/helpers.cjs');

test('frosted spacing probe: containing-block chain + per-theme page top', async () => {
  test.setTimeout(300000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample(win, electronApp, 'report.pdf');
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);

  async function setThemeViaDropdown(want) {
    await win.click('[data-theme-toggle]');
    await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    await win.click(`[data-theme-option="${want}"]`);
    await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, want);
    await win.waitForTimeout(700);
  }

  async function probe() {
    return win.evaluate(() => {
        const sc = document.querySelector('.document-scroller');
        const p = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
        const ws = document.querySelector('.workspace-main');
        const rows = ['.toolbar', '.ann-toolbar', '.search-bar', '.edit-toolbar'].map((s) => {
          const el = document.querySelector(s);
          if (!el) return { s, present: false };
          const r = el.getBoundingClientRect();
          return { s, present: true, top: r.top, bottom: r.bottom, h: r.height, pos: getComputedStyle(el).position };
        });
        // containing-block chain of the scroller
        const chain = [];
        let el = sc;
        while (el && el !== document.documentElement) {
          const cs = getComputedStyle(el);
          chain.push({
            name:
            el.tagName.toLowerCase() +
            (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
            position: cs.position,
            top: cs.top,
          });
          el = el.parentElement;
        }
        return {
          theme: document.documentElement.getAttribute('data-theme'),
          wsTop: ws ? ws.getBoundingClientRect().top : null,
          wsPosition: ws ? getComputedStyle(ws).position : null,
          scrollerTop: sc.getBoundingClientRect().top,
          pageTop: p ? p.getBoundingClientRect().top : null,
          padTop: getComputedStyle(document.querySelector('.document-content')).paddingTop,
          scrollerPos: getComputedStyle(sc).position,
          scrollerInset: ['top', 'left', 'right', 'bottom'].map(
          (k) => `${k}=${getComputedStyle(sc)[k]}`,
        ).join(' '),
          rows,
          chain,
        };
      });
  }

  const themes = ['frosted'];
  const results = [];
  results.push(['frosted', await probe()]);
  await setThemeViaDropdown('dark');
  results.push(['dark', await probe()]);
  await setThemeViaDropdown('light');
  results.push(['light', await probe()]);
  for (const [t, r] of results) {
    console.log(`\n=== ${t} ===`);
    console.log(JSON.stringify(r, null, 1));
  }
  console.log('PAGE TOPS ->', results.map(([t, r]) => `${t}=${r.pageTop.toFixed ? r.pageTop.toFixed(1) : r.pageTop}`).join('  '));
  await hardClose(electronApp);
});