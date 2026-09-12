// One-off composite builder for the Phase 14.1 comparison deliverable (qa).
// Reads the captured reference + actual screenshots, renders an annotated
// side-by-side page in headless Chromium, and saves it as
// screenshots/phase141-comparison-side-by-side.png.
// Not a product test - an evidence-assembly harness, launched through
// Playwright's own chromium (NOT the app; system Edge channel).
const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const REF = path.join(SHOTS, 'phase141-comparison-reference.png');
const ACT = path.join(SHOTS, 'phase141-comparison-actual.png');
const OUT = path.join(SHOTS, 'phase141-comparison-side-by-side.png');

function b64(p) {
  return fs.readFileSync(p).toString('base64');
}

(async () => {
  const refB64 = b64(REF);
  const actB64 = b64(ACT);

  // Regions as PERCENTAGES of each image (resolution-independent).
  // [name, left%, top%, w%, h%, color]
  const ref = [
    ['Title bar', 1.2, 2.0, 97.3, 5.2, '#e11d48'],
    ['Command bar (groups)', 3.4, 7.6, 93.0, 6.2, '#f59e0b'],
    ['Open (accent)', 7.7, 8.2, 4.8, 4.6, '#2563eb'],
    ['Pages card', 4.1, 14.7, 10.2, 84.0, '#059669'],
    ['Tools card', 81.9, 14.7, 14.0, 84.0, '#7c3aed'],
    ['PDF opaque', 15.2, 15.3, 65.8, 83.5, '#0ea5e9'],
  ];
  const act = [
    ['Title bar 44px', 0.1, 0.1, 99.7, 4.9, '#e11d48'],
    ['Command bar 53px (groups)', 0.1, 5.0, 99.7, 6.1, '#f59e0b'],
    ['Open (accent)', 1.6, 5.8, 5.7, 4.2, '#2563eb'],
    ['Pages card', 1.0, 12.5, 15.4, 86.0, '#059669'],
    ['Tools card', 74.9, 12.5, 24.1, 86.0, '#7c3aed'],
    ['PDF opaque', 18.4, 21.5, 80.0, 77.0, '#0ea5e9'],
  ];

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1b1f27; padding: 16px 18px; }
  h1 { color: #fff; font-size: 19px; margin-bottom: 4px; }
  .sub { color: #9aa7bd; font-size: 12px; margin-bottom: 12px; }
  .row { display: flex; gap: 16px; align-items: flex-start; }
  .col { width: 900px; }
  .wrap { position: relative; }
  .wrap img { display: block; width: 900px; border-radius: 8px; border: 1px solid #3a4356; }
  .tag { position: absolute; font-size: 10.5px; font-weight: 600; padding: 2px 7px;
         border-radius: 6px; color: #fff; letter-spacing: .02em; white-space: nowrap;
         z-index: 5; box-shadow: 0 1px 4px rgba(0,0,0,.55); }
  .box { position: absolute; border-radius: 6px; pointer-events: none; z-index: 4; }
  .cap { color: #cbd5e5; font-size: 13px; font-weight: 700; margin: 0 0 6px 2px;
         letter-spacing: .06em; }
  .legend { color: #8ea0b8; font-size: 11px; margin-top: 10px; }
</style></head><body>
  <h1>Phase 14.1 Liquid Glass correction — reference vs actual (dev build, frosted, 2026-09-13)</h1>
  <div class="sub">Left: reference mock (1681×936). Right: TFlex actual window 1440×900 @1.5x (report.pdf, Tools palette open).</div>
  <div class="row">
    <div class="col">
      <div class="cap">REFERENCE</div>
      <div class="wrap" id="refcol"><img src="data:image/png;base64,${refB64}" /></div>
    </div>
    <div class="col">
      <div class="cap">ACTUAL</div>
      <div class="wrap" id="actcol"><img src="data:image/png;base64,${actB64}" /></div>
    </div>
  </div>
  <div class="legend">Callouts: red = title bar · orange = command bar · blue = Open accent · green = Pages card · violet = Tools card · cyan = PDF canvas.</div>
  <script>
    const REG = { refcol: ${JSON.stringify(ref)}, actcol: ${JSON.stringify(act)} };
    for (const [colSel, regions] of Object.entries(REG)) {
      const wrap = document.getElementById(colSel);
      for (const [name, l, t, w, h, color] of regions) {
        const box = document.createElement('div');
        box.className = 'box';
        box.style.cssText = 'border:2px solid ' + color + ';background:' + color + '1c;left:'
          + l + '%;top:' + t + '%;width:' + w + '%;height:' + h + '%;';
        wrap.appendChild(box);
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.style.cssText = 'background:' + color + ';left:calc(' + l + '% + 5px);top:calc('
          + t + '% + 5px);';
        tag.textContent = name;
        wrap.appendChild(tag);
      }
    }
  </script>
</body></html>`;

  const tmpHtml = path.join(SHOTS, '.phase141-composite.html');
  fs.writeFileSync(tmpHtml, html);

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1880, height: 720 } });
  await page.goto('file:///' + tmpHtml.replace(/\\/g, '/'));
  await page.waitForTimeout(700);
  const body = await page.locator('body');
  await body.screenshot({ path: OUT });
  await browser.close();
  fs.unlinkSync(tmpHtml);
  console.log('[composite] saved:', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
