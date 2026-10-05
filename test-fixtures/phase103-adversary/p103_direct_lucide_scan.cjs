// Phase 103 adversary — find any direct Lucide JSX render (a bypass of <Icon>).
// A direct render with no size prop renders at Lucide's default 24px/2px stroke
// and EVADES both phase94 guard rules (they only catch size={...} in listed files).
const fs = require('node:fs');
const path = require('node:path');
const RENDERER = path.resolve('src/renderer');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}
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

const hits = [];
for (const f of walk(RENDERER)) {
  const rel = path.relative(RENDERER, f).replace(/\\/g, '/');
  if (rel === 'icons/quietPrecision.tsx') continue; // the registry itself holds the metaphors
  const text = fs.readFileSync(f, 'utf8');
  for (const name of importedLucide(text)) {
    // A direct JSX render: `<Name` followed by a tag boundary. `icon={Name}` and
    // `<Icon icon={Name}` are NOT direct renders.
    const re = new RegExp(`<${name}(?![A-Za-z0-9])([^>]*)>`, 'gs');
    let m;
    while ((m = re.exec(text)) !== null) {
      const attrs = m[1];
      const hasSize = /size=\{/.test(attrs);
      const line = text.slice(0, m.index).split(/\r?\n/).length;
      hits.push({ rel, name, line, hasSize });
    }
  }
}
console.log(`direct Lucide JSX renders found: ${hits.length}`);
for (const h of hits) {
  console.log(`  ${h.hasSize ? 'SIZED  ' : 'NOSIZE '} ${h.rel}:${h.line} <${h.name}>` + (h.hasSize ? '  (caught by phase94 rule b)' : '  (EVADES the phase94 size scan)'));
}
process.exit(0);
