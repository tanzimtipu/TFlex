// qa analysis for the DEF-183 + DEF-188 FINAL verification.
// Reads the two OS composited grabs (qa-comparison-actual-desktop{,-dark}.png,
// captured by e2e/qa_reference_compare.spec.cjs) and the text-element rects +
// computed CSS inks collected by e2e/retests/def183_188_final_probe.spec.cjs
// (screenshots/def183-188-final-rects.json), then measures, per text element
// and per backdrop:
//   - glass luma      = median luma inside the text rect (glass dominates)
//   - ink core (0.5%) = mean RGB of the darkest 0.5% pixels — the least
//                       antialias-contaminated rendered glyph cores
//   - spreadMock      = median - p5, qa's ORIGINAL spread methodology
//                       (apples-to-apples with the mock's 57)
//   - spread          = glass median - ink-core luma (BT.601 luma)
//   - wcag            = WCAG 2.x ratio, rendered ink core vs measured glass
//   - wcagCssInk      = WCAG ratio, the CSS ink vs the MEASURED glass
//                       composite (the nominal rendered ratio)
// Readability bar (DEF-188 verify checklist): spread >= 57 (the reference
// mock's description spread) OR WCAG >= 4.5:1.
// Window origin: grab px == DIP, window bounds 560,266 1440x860
// (verified identical in qa-comparison-grabmeta{,-dark}.json).
const path = require('node:path');
const fs = require('node:fs');
const PNG = require('pngjs').PNG;
const { loadPng } = require('./glass_probe.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const WIN = { x: 560, y: 266 };

const rects = JSON.parse(fs.readFileSync(path.join(SHOTS, 'def183-188-final-rects.json'), 'utf8'));
const grabs = {
  aurora: loadPng(path.join(SHOTS, 'qa-comparison-actual-desktop.png')),
  dark: loadPng(path.join(SHOTS, 'qa-comparison-actual-desktop-dark.png')),
};

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function wcagLuminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcagContrast(a, b) {
  const hi = Math.max(wcagLuminance(a), wcagLuminance(b));
  const lo = Math.min(wcagLuminance(a), wcagLuminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

function measure(png, rect, cssInk) {
  const px = [];
  for (let y = WIN.y + rect.y - 1; y < WIN.y + rect.y + rect.h + 1; y += 1) {
    for (let x = WIN.x + rect.x - 1; x < WIN.x + rect.x + rect.w + 1; x += 1) {
      const i = (y * png.width + x) * 4;
      px.push([png.data[i], png.data[i + 1], png.data[i + 2]]);
    }
  }
  const lumas = px.map(([r, g, b]) => lum(r, g, b)).sort((a, b) => a - b);
  const q = (p) => lumas[Math.min(lumas.length - 1, Math.floor((lumas.length - 1) * p))];
  const glassLuma = q(0.5);
  const mean = (arr) => arr.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0])
    .map((s) => s / arr.length);
  const inkCount = Math.max(2, Math.floor(px.length * 0.005));
  const inkCore = mean(px.filter(([r, g, b]) => lum(r, g, b) <= q(0.005)).slice(0, inkCount * 2));
  const glassPx = px.filter(([r, g, b]) => lum(r, g, b) >= glassLuma);
  const glass = mean(glassPx);
  return {
    rect,
    inkCoreLuma: Number(lum(inkCore[0], inkCore[1], inkCore[2]).toFixed(1)),
    glassMedianLuma: Math.round(glassLuma),
    glass: glass.map((v) => Number(v.toFixed(1))),
    spreadMock: Math.round(glassLuma - q(0.05)),
    spread: Math.round(glassLuma - lum(inkCore[0], inkCore[1], inkCore[2])),
    wcag: Number(wcagContrast(inkCore, glass).toFixed(2)),
    cssInk: cssInk || null,
    wcagCssInk: cssInk ? Number(wcagContrast(cssInk, glass).toFixed(2)) : null,
  };
}

const inks = {};
for (const [k, v] of Object.entries(rects.inks || {})) {
  const m = /rgba?\(([^)]+)\)/.exec(v.color);
  if (m) inks[k] = m[1].split(',').slice(0, 3).map((s) => parseFloat(s.trim()));
}
const INK_BY_ELEMENT = {
  entryTitle: inks.entryTitle,
  entryDesc: inks.entryDesc,
  groupLabel: inks.groupLabel,
  railTitle: inks.railTitle,
  undoRow: inks.undoRow,
};

const out = { win: WIN, bar: 'spread >= 57 (mock description) OR WCAG >= 4.5:1', elements: {} };
for (const name of ['entryTitle', 'entryDesc', 'groupLabel', 'railTitle', 'undoRow']) {
  const rect = rects.rects[name];
  if (!rect) continue;
  out.elements[name] = {
    text: rects[`${name}Text`] || undefined,
    aurora: measure(grabs.aurora, rect, INK_BY_ELEMENT[name]),
    dark: measure(grabs.dark, rect, INK_BY_ELEMENT[name]),
  };
}

// Pass = EITHER the mock's 57 spread OR WCAG 4.5:1, on EITHER methodology
// (rendered core is conservative, CSS-ink is nominal). Disabled controls are
// WCAG-exempt (1.4.3 exception) — noted, not applied, in the verdict.
out.verdict = {};
for (const [name, v] of Object.entries(out.elements)) {
  const ok = (m) => m.spreadMock >= 57 || m.spread >= 57 || m.wcag >= 4.5 || (m.wcagCssInk !== null && m.wcagCssInk >= 4.5);
  out.verdict[name] = { aurora: ok(v.aurora) ? 'PASS' : 'FAIL', dark: ok(v.dark) ? 'PASS' : 'FAIL' };
}

fs.writeFileSync(path.join(SHOTS, 'def183-188-final-metrics.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
