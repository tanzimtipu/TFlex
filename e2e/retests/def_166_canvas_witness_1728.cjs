// Third-party canvas witness for DEF-166 (qa, v1.7.28 retest).
//
// Renders page 4 of (a) the SAVED round-trip file and (b) the PRISTINE sample
// with plain pdfjs-dist at EXACTLY the TFlex page-canvas scale, then measures
// the same page-local regions TFlex's own canvas was measured at:
//   - darkFrac: fraction of dark (lum < 150) pixels in the region
//   - maxSelfOverlap: how much of the dark mask survives a small (1..6 px)
//     self-shift - the mechanical DOUBLING detector. Single-rendered text
//     decorrelates fast under a 2-4px shift; two offset copies overlap
//     strongly at their offset.
// TFlex reopened canvas vs (a) must match (single render); (b) is the
// text-free baseline used for the "does the canvas paint the text at all"
// delta. Also writes control crop PNGs for visual judgement.
//
// usage: node def_166_canvas_witness_1728.cjs <saved.pdf> <baseline.pdf> <scale> <regionsJson> <shotsDir>
//   regionsJson: JSON array [{ name, x, y, w, h }] in page-local px (scale 1)

const fs = require('node:fs');
const path = require('node:path');
const napi = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..', '..');
const FONTS = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;

globalThis.DOMMatrix = globalThis.DOMMatrix || napi.DOMMatrix;
globalThis.Path2D = globalThis.Path2D || napi.Path2D;
globalThis.ImageData = globalThis.ImageData || napi.ImageData;

class CanvasFactory {
  create(w, h) {
    const c = napi.createCanvas(Math.max(w, 1), Math.max(h, 1));
    return { canvas: c, context: c.getContext('2d') };
  }
  reset(cc, w, h) {
    cc.canvas.width = w;
    cc.canvas.height = h;
  }
  destroy(cc) {
    cc.canvas = null;
    cc.context = null;
  }
}

async function renderAt(file, scale) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl: FONTS,
    canvasFactory: new CanvasFactory(),
  }).promise;
  const page = await doc.getPage(4);
  const vp = page.getViewport({ scale });
  const f = new CanvasFactory();
  const cc = f.create(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory: f }).promise;
  const img = cc.context.getImageData(0, 0, cc.canvas.width, cc.canvas.height);
  return { canvas: cc.canvas, w: cc.canvas.width, h: cc.canvas.height, data: img.data };
}

// dark mask + self-overlap under small shifts, identical math to the in-page
// probe in the spec (same thresholds, same shift set) so numbers are comparable
function analyzeRegion(data, imgW, x0, y0, w, h) {
  const dark = new Uint8Array(w * h);
  let darkCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * imgW + (x0 + x)) * 4;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (l < 150) { dark[y * w + x] = 1; darkCount++; }
    }
  }
  const shifts = [];
  let maxOv = 0, arg = null;
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      if (!dx && !dy) continue;
      let inter = 0;
      for (let y = 0; y < h; y++) {
        const sy = y + dy;
        if (sy < 0 || sy >= h) continue;
        for (let x = 0; x < w; x++) {
          const sx = x + dx;
          if (sx < 0 || sx >= w) continue;
          if (dark[y * w + x] && dark[sy * w + sx]) inter++;
        }
      }
      const ov = darkCount ? inter / darkCount : 0;
      shifts.push({ dx, dy, ov: +ov.toFixed(3) });
      if (ov > maxOv) { maxOv = ov; arg = { dx, dy }; }
    }
  }
  shifts.sort((a, b) => b.ov - a.ov);
  return {
    w, h,
    darkCount,
    darkFrac: +(darkCount / (w * h)).toFixed(4),
    maxSelfOverlap: +maxOv.toFixed(3),
    argShift: arg,
    topShifts: shifts.slice(0, 5),
  };
}

async function main() {
  const [savedFile, baselineFile, scaleArg, regionsJson, shotsDir] = process.argv.slice(2);
  if (!savedFile || !baselineFile || !scaleArg || !regionsJson || !shotsDir) {
    throw new Error('usage: node def_166_canvas_witness_1728.cjs <saved.pdf> <baseline.pdf> <scale> <regionsJson> <shotsDir>');
  }
  const scale = Number(scaleArg);
  const regions = JSON.parse(regionsJson);
  fs.mkdirSync(shotsDir, { recursive: true });

  const saved = await renderAt(savedFile, scale);
  const base = await renderAt(baselineFile, scale);

  const out = { scale, regions: {} };
  for (const r of regions) {
    const x0 = Math.round(r.x * scale), y0 = Math.round(r.y * scale);
    const w = Math.max(2, Math.round(r.w * scale)), h = Math.max(2, Math.round(r.h * scale));
    const savedM = analyzeRegion(saved.data, saved.w, x0, y0, w, h);
    const baseM = analyzeRegion(base.data, base.w, x0, y0, w, h);

    const crop = napi.createCanvas(w, h);
    crop.getContext('2d').drawImage(saved.canvas, x0, y0, w, h, 0, 0, w, h);
    fs.writeFileSync(path.join(shotsDir, `def-166-1728-pdfjs-control-${r.name}.png`), crop.toBuffer('image/png'));

    out.regions[r.name] = { saved: savedM, base: baseM };
    process.stdout.write(`[WITNESS] ${r.name}: saved darkFrac=${savedM.darkFrac} maxSelfOverlap=${savedM.maxSelfOverlap} argShift=${JSON.stringify(savedM.argShift)} | base darkFrac=${baseM.darkFrac} maxSelfOverlap=${baseM.maxSelfOverlap}\n`);
  }

  fs.writeFileSync(path.join(shotsDir, 'def-166-1728-pdfjs-control-p4.png'), saved.canvas.toBuffer('image/png'));
  process.stdout.write(`[TP-JSON] ${JSON.stringify(out)}\n`);
}

main().catch((e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(1); });
