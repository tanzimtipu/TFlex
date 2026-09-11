#!/usr/bin/env node
/**
 * TFlex convention gate.
 *
 * These three rules were pure prose in AGENTS.md and enforced by nothing at all:
 * no emoji in product code, no network calls in product code, and no dev files
 * under release/. This script makes them mechanical. It is deliberately
 * dependency-free so it can run in CI without an install step.
 *
 *   node scripts/check-conventions.mjs
 *
 * Exit code 0 = clean, 1 = violations (printed).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const ROOT = process.cwd()
const problems = []
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test-results', '.git', 'release'])

/** Walk a directory, yielding file paths, skipping build and vendor output. */
function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/')

// ── 1. no emoji in src/ ─────────────────────────────────────────────────────
// Wide ranges only, so typographic punctuation and arrows are not flagged.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.css', '.html'])

// ── 2. no network calls in product code ─────────────────────────────────────
const NETWORK_PATTERNS = [
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\baxios\b/, 'axios'],
  [/\bnet\.(connect|createConnection)\s*\(/, 'net.connect()'],
  [/\bdns\.\w+\s*\(/, 'dns lookup'],
  [/require\(\s*['"](node:)?(https?|net|dns)['"]\s*\)/, 'require of a network module'],
  [/from\s+['"](node:)?(https?|net|dns)['"]/, 'import of a network module'],
]
// A CDN literal is the "fonts and icons are bundled" rule; localhost is exempt.
const CDN_LITERAL = /['"`]https?:\/\/(?!localhost|127\.0\.0\.1)[^'"`]*['"`]/

const srcFiles = walk(join(ROOT, 'src'))
let scanned = 0
for (const file of srcFiles) {
  if (!SOURCE_EXT.has(extname(file))) continue
  scanned += 1
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const at = `${rel(file)}:${index + 1}`
    if (EMOJI.test(line)) {
      problems.push(`emoji in source: ${at}  ${line.trim().slice(0, 80)}`)
    }
    for (const [pattern, label] of NETWORK_PATTERNS) {
      if (pattern.test(line)) {
        problems.push(`network call in product code (${label}): ${at}  ${line.trim().slice(0, 80)}`)
      }
    }
    if (rel(file).startsWith('src/renderer/') && CDN_LITERAL.test(line)) {
      problems.push(`CDN URL literal in renderer (bundle it instead): ${at}  ${line.trim().slice(0, 80)}`)
    }
  })
}

// ── 3. release/ holds only user-sharable artifacts ──────────────────────────
// release/ is the ONLY folder for shippable output; everything else is dev-only.
const DEV_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.md', '.log', '.txt', '.map',
  '.snap', '.spec', '.test', '.css', '.scss', '.html',
])
const releaseDir = join(ROOT, 'release')
// electron-builder stages its raw output in `*-unpacked/`, which legitimately
// contains Electron's own LICENSE.electron.txt and LICENSES.chromium.html.
// That is build output, not a hand-placed dev file, so the staging tree is
// skipped and only the published artifacts are checked.
const STAGING = /(^|\/)[^/]*-unpacked\//
try {
  if (statSync(releaseDir).isDirectory()) {
    for (const file of walk(releaseDir)) {
      if (STAGING.test(rel(file))) continue
      if (DEV_EXT.has(extname(file).toLowerCase())) {
        problems.push(`dev file under release/: ${rel(file)}`)
      }
    }
  }
} catch {
  // No release/ yet - nothing to check. Packaging creates it.
}

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log(`conventions: clean (${scanned} source file(s) scanned)`)
  process.exit(0)
}

console.error(`conventions: ${problems.length} violation(s)\n`)
for (const problem of problems) console.error('  ' + problem)
console.error('\nSee the "Repository conventions" section of AGENTS.md.')
process.exit(1)
