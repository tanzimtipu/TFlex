// Phase 103 adversary (TFL-838) — guard-detection proof + independent contrast check.
// Copies the exact guard regexes from the two source-scan suites and runs them over
// synthetic offenders, so the detection is shown to be real (not allow-listed away).
// Also computes WCAG contrast for the new icon ink tokens on the final surfaces.

const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.resolve('src/renderer');
let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

console.log('=== Guard 1: phase94_noAdHocIcons SVG regex /<svg[\\s/>]/ ===');
const SVG = /<svg[\s/>]/;
const svgCases = [
  ['inline svg with attrs', '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>', true],
  ['inline svg bare', '<svg>', true],
  ['self-closing svg', '<svg/>', true],
  ['svg split across lines', '<svg\n  width="24" height="24">', true],
  ['component named Svg (not a raw svg)', '<Svg width={24} />', false],
];
for (const [label, text, want] of svgCases) check(label, SVG.test(text), want);

console.log('\n=== Guard 2: raw numeric size on a direct Lucide render ===');
const sizeRe = (name, text) => new RegExp(`<${name}\\b[^>]*size=\\{`, 's').test(text);
const sizeCases = [
  ['direct Lucide size={18}', sizeRe('Pen', '<Pen className="x" size={18} />'), true],
  ['direct Lucide size={px}', sizeRe('Pen', '<Pen size={px} />'), true],
  ['direct Lucide size={18} across lines', sizeRe('Pen', '<Pen\n  size={18}\n/>'), true],
  ['direct Lucide with NO size prop', sizeRe('Pen', '<Pen className="x" />'), false],
  ['spaced "size = {18}" (formatting evasion)', sizeRe('Pen', '<Pen size = {18} />'), false],
];
for (const [label, got, want] of sizeCases) check(label, got, want);

console.log('\n=== Guard 3: un-allow-listed shared command id (phase43) ===');
function importedLucide(text) {
  const names = new Set();
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']lucide-react["']/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && name !== 'LucideIcon') names.add(name);
    }
  }
  return [...names];
}
function usagesIn(file, text) {
  const names = importedLucide(text);
  const out = [];
  text.split(/\r?\n/).forEach((line) => {
    for (const icon of names) {
      if (new RegExp(`<${icon}(?![A-Za-z0-9])`).test(line)
        || new RegExp(`(?:^|[\\s{(])[iI]con:\\s*${icon}\\b`).test(line)
        || new RegExp(`[iI]con=\\{\\s*${icon}\\b`).test(line)) out.push({ file, icon });
    }
  });
  const nameRe = /<Icon\b[^>]*\bname="([^"]+)"/gs;
  let nm;
  while ((nm = nameRe.exec(text)) !== null) out.push({ file, icon: nm[1] });
  return out;
}
const fileA = 'import { X } from "lucide-react";\n<Icon name="cropPages" />\n<X />';
const fileB = 'import { X } from "lucide-react";\n<Icon name="cropPages" />\n<X />';
const usages = [...usagesIn('A.tsx', fileA), ...usagesIn('B.tsx', fileB)];
const ownersOf = (id) => [...new Set(usages.filter((u) => u.icon === id).map((u) => u.file))].sort();
const violation = (id, allow) => ownersOf(id).length > 1 && allow[id] === undefined;
check('cropPages shared by 2 surfaces with empty allow-list => violation', violation('cropPages', {}), true);
check('cropPages shared by 2 surfaces WITH an allow-list reason => no violation', violation('cropPages', { cropPages: 'one command, one glyph' }), false);
check('dynamic name={verb.id} is NOT captured by the static sweep',
  usagesIn('C.tsx', '<Icon name={verb.id as QuietIconId} />').length, 0);

console.log('\n=== Guard 4: current tree — <svg outside the allow-list ===');
const ALLOW = new Set([
  'icons/Icon.tsx', 'components/BrandMark.tsx', 'components/BrandLoader.tsx',
  'components/AccountsDialog.tsx', 'annotations/AnnotationOverlay.tsx',
  'signatures/SignaturesOverlay.tsx', 'signatures/SignatureManagerModal.tsx',
]);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}
const offenders = [];
for (const f of walk(RENDERER)) {
  const rel = path.relative(RENDERER, f).replace(/\\/g, '/');
  if (!ALLOW.has(rel) && SVG.test(fs.readFileSync(f, 'utf8'))) offenders.push(rel);
}
check('no hand-declared <svg> outside the allow-list', offenders.length, 0);
if (offenders.length) console.log('  offenders:', offenders.join(', '));

console.log('\n=== Contrast: icon ink vs final surfaces (WCAG 1.4.11 >= 3:1, labels 1.4.3 >= 4.5:1) ===');
function lin(c) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
function lum(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(fg, bg) {
  const a = lum(fg), b = lum(bg);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}
const themes = [
  ['light', { rest: '#485164', danger: '#B82E43', success: '#25754A', bg: '#fcfdfe' }],
  ['dark', { rest: '#B8C0D0', danger: '#FF9AAD', success: '#85D3A6', bg: '#1d232b' }],
  ['frosted~white', { rest: '#485164', danger: '#be123c', success: '#166534', bg: '#ffffff' }],
];
for (const [name, t] of themes) {
  for (const key of ['rest', 'danger', 'success']) {
    const r = ratio(t[key], t.bg);
    const floor = key === 'rest' ? 4.5 : 3; // rest also carries the 12px label
    const ok = r >= floor;
    if (!ok) failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${key} ${t[key]} on ${t.bg} = ${r.toFixed(2)}:1 (>= ${floor})`);
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASS' : failures + ' CHECK(S) FAILED'}`);
process.exit(0);
