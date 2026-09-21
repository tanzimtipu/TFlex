// QA analysis helper (not a Playwright spec): summarize the text-manip audit
// matrix. Per cell, did the control change any observable live style
// (css / containerCss / lineCss / bandCss) or engine state?
const fs = require('node:fs');
const file = process.argv[2];
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

const STYLE_KEYS = ['fontFamily','fontSize','fontWeight','fontStyle','textDecorationLine','textAlign','lineHeight','letterSpacing','color','backgroundColor','paddingLeft','verticalAlign'];
function styleDiff(a, b) {
  if (!a || !b) return null;
  const out = [];
  for (const k of STYLE_KEYS) if (a[k] !== b[k]) out.push(`${k}:${a[k]}->${b[k]}`);
  return out;
}
function engineDiff(a, b) {
  if (!a || !b) return null;
  const out = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = JSON.stringify(a[k]); const bv = JSON.stringify(b[k]);
    if (av !== bv) out.push(`${k}:${av}->${bv}`);
  }
  return out;
}
const byKey = new Map();
for (const r of rows) byKey.set(`${r.target}|${r.shape}|${r.control}`, r);

const targets = ['editbox','textbox','callout','note','run'];
const shapes = ['single','multi'];
const controls = [...new Set(rows.map(r => r.control))];
const lines = [];
for (const t of targets) {
  for (const s of shapes) {
    const cells = [];
    for (const c of controls) {
      const r = byKey.get(`${t}|${s}|${c}`);
      if (!r) { cells.push(`${c}=?`); continue; }
      const d = [
        ...(styleDiff(r.before && r.before.css, r.after && r.after.css) || []),
        ...(styleDiff(r.before && r.before.containerCss, r.after && r.after.containerCss) || []),
        ...(styleDiff(r.before && r.before.lineCss, r.after && r.after.lineCss) || []),
        ...(styleDiff(r.before && r.before.bandCss, r.after && r.after.bandCss) || []),
      ];
      if (r.before && r.after && r.before.prefixText !== r.after.prefixText) {
        d.push(`prefix:${JSON.stringify(r.before.prefixText)}->${JSON.stringify(r.after.prefixText)}`);
      }
      const e = engineDiff(r.engineBefore, r.engineAfter) || [];
      const live = d.length > 0;
      const eng = e.length > 0;
      cells.push(`${c}=${live ? 'L' : 'N'}${eng ? '' : '(engN)'}`);
    }
    lines.push(`${t}/${s}: ${cells.join(' ')}`);
  }
}
console.log(lines.join('\n'));