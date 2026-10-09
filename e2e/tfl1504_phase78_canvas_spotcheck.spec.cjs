// TFL-1504 — Phase 78 canvas-notice spot-check (Phase 126 chunk C-reverify).
//
// DEF-669 broke the `canvasNotices` prop forwarding for ALL notice kinds, so
// the pre-existing Phase 78 Protection / Conversion / 3D notices also failed to
// re-parent into the canvas. This spot-check stages the cheapest reachable one —
// the 3D-content notice from a plain PDF that carries a /Subtype /3D annotation
// (the same shape phase67/phase78 use) — through the CURRENT generic Open
// (Intake) path and proves `.canvas-top-right .canvas-notices` now mounts the
// `[data-pdf3d-notice]` box inside `[data-canvas-overlay]`.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFString, rgb } = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const FIXDIR = path.join(os.tmpdir(), 'tflex-tfl1504-phase78');

test.setTimeout(300000);

// 2-page PDF whose page 2 carries one synthetic /Subtype /3D annotation named
// Turbine (the phase57a / phase67 / phase78 fixture shape).
async function build3dPdf(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const p2 = doc.addPage([400, 400]);
  p2.drawRectangle({ x: 80, y: 80, width: 240, height: 240, color: rgb(0.15, 0.45, 0.25) });
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: '3D',
    NM: PDFString.of('Turbine'),
    Rect: [0, 0, 10, 10],
  });
  p2.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  fs.writeFileSync(file, await doc.save());
  return file;
}

test('TFL-1504: pre-existing Phase 78 3D notice mounts inside the canvas', async () => {
  const fixture = await build3dPdf(path.join(FIXDIR, 'tfl1504-3d.pdf'));
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, fixture);
    await win.waitForSelector('.workspace', { timeout: 30000 });

    // The pre-existing 3D notice must now render INSIDE the canvas notice layer.
    const inCanvas = '.canvas-top-right .canvas-notices [data-pdf3d-notice]';
    await win.waitForSelector(inCanvas, { state: 'visible', timeout: 30000 });
    const probe = await win.evaluate(() => {
      const active = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
      const layer = active.querySelector('.canvas-top-right .canvas-notices');
      return {
        canvasNotices: active.querySelectorAll('.canvas-top-right .canvas-notices').length,
        pdf3dNotice: layer ? layer.querySelectorAll('[data-pdf3d-notice]').length : 0,
        insideOverlay: layer !== null && layer.closest('[data-canvas-overlay]') !== null,
      };
    });
    console.log('TFL1504_PHASE78_SPOT ' + JSON.stringify(probe));
    await expect(win.locator(inCanvas)).toContainText('Turbine');
    await win.screenshot({ path: path.join(SHOTS, 'tfl1504-phase78-3d-in-canvas.png') });

    expect(probe.canvasNotices, 'canvas notice layer mounted').toBeGreaterThan(0);
    expect(probe.pdf3dNotice, '3D notice inside the canvas layer').toBeGreaterThan(0);
    expect(probe.insideOverlay, 'the notice layer sits inside [data-canvas-overlay]').toBe(true);
  } finally {
    await hardClose(app, 'tfl1504-phase78-spot');
  }
});
