// TFL-546 Phase 95-D adversarial probe — can the recurrence guard be defeated?
//
// This is a READ-ONLY static probe: it loads the shipped src/renderer/styles.css,
// replicates the EXACT parsing helpers of
// test/unit/renderer/phase95_dockMinusContainment.test.ts (ruleBody / allBodies /
// decl), and then feeds the real sheet PLUS a set of hostile mutations through the
// guard's own predicates. It edits nothing under src/, test/ or e2e/.
//
// Purpose: answer the task's attack item 4 — "a later CSS rule that re-introduces a
// negative offset, or an override that the source-scan-style guard would miss.
// State plainly whether the guard would catch it; a weak guard is a finding."
//
// Run:  node test-fixtures/phase95-adversary/adv546_guard_defeat.cjs
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const CSS_PATH = path.resolve(__dirname, "..", "..", "src", "renderer", "styles.css");
const RAW = fs.readFileSync(CSS_PATH, "utf8");
const scrub = (s) => s.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");

// --- exact copies of the guard's helpers (phase95_dockMinusContainment.test.ts) ---
function ruleBody(CSS, selector) {
  const start = CSS.indexOf(selector);
  if (start < 0) return null;
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}
function allBodies(CSS, selector) {
  return [...CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => (m[1] ?? "").split(",").some((s) => s.trim() === selector))
    .map((m) => m[2] ?? "");
}
function decl(body, prop) {
  const m = body.match(new RegExp(`(?:^|[\\s;])${prop}\\s*:\\s*([^;]+);`));
  return m ? (m[1] ?? "").trim() : null;
}

// The four guard tests, reduced to pass/fail booleans against a CSS string.
function runGuard(CSS) {
  const results = {};

  // Test 1 — no negative top/right on the (first) .action-dock-minus rule.
  {
    const minus = ruleBody(CSS, ".action-dock-minus {");
    let pass = minus !== null && /position:\s*absolute/.test(minus);
    const top = minus === null ? null : decl(minus, "top");
    const right = minus === null ? null : decl(minus, "right");
    if (top === null || right === null) pass = false;
    else pass = pass && Number.parseFloat(top) >= 0 && Number.parseFloat(right) >= 0;
    results["T1 no negative badge inset (first rule)"] = { pass, top, right };
  }

  // Test 2 — verb is position:relative and does not clip.
  {
    const verb = ruleBody(CSS, ".action-dock-verb {");
    let pass = verb !== null && /position:\s*relative/.test(verb) && !/overflow\s*:\s*(?:hidden|clip)/.test(verb);
    results["T2 verb relative + non-clipping (first rule)"] = { pass };
  }

  // Test 3 — dock root non-clipping; no EDIT-scoped verb rule clips.
  {
    const dock = ruleBody(CSS, ".action-dock {");
    let pass = dock !== null && !/overflow\s*:\s*(?:hidden|clip)/.test(dock);
    for (const body of allBodies(CSS, ".action-dock[data-dock-edit='true'] .action-dock-verb")) {
      if (/overflow\s*:\s*(?:hidden|clip|auto|scroll)/.test(body)) pass = false;
    }
    results["T3 dock root + EDIT-scoped verb non-clipping"] = { pass };
  }

  // Test 4 — lane scroller still owns the clip.
  {
    const lane = ruleBody(CSS, ".action-dock[data-dock-arrows-lane='true'] .action-dock-scroll {");
    const item = ruleBody(CSS, ".action-dock[data-dock-arrows-lane='true'] .action-dock-scroll > * {");
    const pass =
      lane !== null && /overflow-x:\s*auto/.test(lane) &&
      /justify-content:\s*flex-start/.test(lane) &&
      item !== null && /flex:\s*0 0 auto/.test(item);
    results["T4 lane scroller owns the clip"] = { pass };
  }

  return results;
}

const mutations = {
  "BASELINE (shipped styles.css)": null,
  "M1 append duplicate unscoped rule { top:-5px; right:-5px }":
    ".action-dock-minus {\n  top: -5px;\n  right: -5px;\n}\n",
  "M2 append EDIT-scoped override (higher specificity)":
    ".action-dock[data-dock-edit='true'] .action-dock-minus {\n  top: -5px;\n  right: -5px;\n}\n",
  "M3 append later rule using the `inset` shorthand":
    ".action-dock-minus {\n  inset: -5px -5px auto auto;\n}\n",
  "M4 append later rule with !important negative offset":
    ".action-dock-minus {\n  top: -5px !important;\n  right: -5px !important;\n}\n",
  "M5 append later rule using a negative custom property":
    ":root { --adv-badge-overhang: -5px; }\n.action-dock-minus {\n  top: var(--adv-badge-overhang);\n}\n",
};

const label = (r) => Object.entries(r).map(([k, v]) => `${v.pass ? "PASS" : "FAIL"} ${k}`).join("\n      ");

console.log("== TFL-546 guard-defeat static probe ==");
console.log("CSS:", CSS_PATH);
const base = scrub(RAW);
console.log("\n[baseline] shipped sheet:\n      " + label(runGuard(base)));

for (const [name, suffix] of Object.entries(mutations)) {
  if (suffix === null) continue;
  const mutated = scrub(RAW + "\n" + suffix);
  const r = runGuard(mutated);
  const caught = Object.values(r).some((v) => !v.pass);
  // Independently compute the effective (last-wins) badge top/right the cascade
  // would apply for a plain `.action-dock-minus` rule, to prove the overhang is
  // really re-introduced while the guard still reports pass.
  const bodies = allBodies(mutated, ".action-dock-minus");
  let effTop = null, effRight = null;
  for (const b of bodies) {
    const t = decl(b, "top"); if (t !== null) effTop = t;
    const rr = decl(b, "right"); if (rr !== null) effRight = rr;
  }
  console.log(`\n[${name}]`);
  console.log("      guard: " + (caught ? "CATCHES (at least one test fails)" : "MISSES (all tests pass)"));
  console.log("      effective cascade .action-dock-minus top=" + JSON.stringify(effTop) + " right=" + JSON.stringify(effRight));
  console.log("      " + label(r));
}

// ADVERSARIAL_REVIEW ledger high-water mark.
const adv = fs.readFileSync(path.resolve(__dirname, "..", "..", "ADVERSARIAL_REVIEW.md"), "utf8");
const nums = [...adv.matchAll(/^## ADV-(\d+)/gm)].map((m) => Number(m[1]));
console.log("\n== ADVERSARIAL_REVIEW.md ==");
console.log("max ADV-NNN:", nums.length ? Math.max(...nums) : "(none)");
