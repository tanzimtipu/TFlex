/**
 * Does the orchestrator's ROSTER still match the routes baked into the preset?
 *
 * The roster is the table the orchestrator reads when it announces a dispatch
 * (`-> backend-dev  [local-ninfer / qwen3.8-27b]  ...`). It lives in the charter,
 * `.dsh/ORCHESTRATOR-CHARTER.md`, while the ground truth lives in each dispatch
 * row's `agentOptions` inside `agent.cordis.yml`. Nothing in the harness compares
 * them, and they are edited at different times by different means (the charter is
 * live, the rows need a new session), so they can drift silently - and a wrong
 * route in an announcement is a lie about which model did the work.
 *
 * Run it after touching either file:
 *
 *   node .dsh/roster-check.mjs
 *
 * Exits non-zero on any mismatch, so it can gate a change.
 */

import { readFileSync } from 'node:fs'

const PRESET = 'C:\\Users\\tanzi\\.dsh\\.agent-presets\\tflex-orchestrator\\agent.cordis.yml'
const CHARTER = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex\\.dsh\\ORCHESTRATOR-CHARTER.md'

/** Rows that carry a route: toolName, backgroundMode, agentOptions provider/model. */
function bakedRoutes(text) {
  const rows = new Map()
  const rowRe = /toolName:\s*(dispatch_\w+)[\s\S]{0,400}?backgroundMode:\s*(\S+)[\s\S]{0,300}?agentOptions:\s*\n\s+provider:\s*(\S+)\s*\n\s+model:\s*(\S+)/g
  let match
  while ((match = rowRe.exec(text)) !== null) {
    rows.set(match[1], { mode: match[2], route: `${match[3]} / ${match[4]}` })
  }
  return rows
}

/** Roster lines: `dispatch_x  role-name  provider / model`. */
function rosterRoutes(text) {
  const rows = new Map()
  const rosterRe = /^\s+(dispatch_\w+)\s+([\w-]+)\s+([\w.-]+)\s*\/\s*([\w.:/-]+)/gm
  let match
  while ((match = rosterRe.exec(text)) !== null) rows.set(match[1], `${match[3]} / ${match[4]}`)
  return rows
}

const baked = bakedRoutes(readFileSync(PRESET, 'utf8'))
const roster = rosterRoutes(readFileSync(CHARTER, 'utf8'))

if (baked.size === 0) throw new Error(`roster-check: no dispatch rows parsed from ${PRESET}`)
if (roster.size === 0) throw new Error(`roster-check: no roster lines parsed from ${CHARTER}`)

let failures = 0
for (const [name, row] of baked) {
  const claimed = roster.get(name)
  const ok = claimed === row.route
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(24)}${row.mode.padEnd(12)}${row.route}`
    + (ok ? '' : `   charter says: ${claimed ?? 'NOT LISTED'}`))
}
for (const name of roster.keys()) {
  if (!baked.has(name)) {
    failures += 1
    console.log(`FAIL  ${name} is in the charter roster but has no dispatch row`)
  }
}

console.log(failures === 0
  ? `\nROSTER MATCHES ALL ${baked.size} BAKED ROUTES`
  : `\n${failures} MISMATCH(ES) - fix the charter roster, or the row`)
if (failures !== 0) process.exit(1)
