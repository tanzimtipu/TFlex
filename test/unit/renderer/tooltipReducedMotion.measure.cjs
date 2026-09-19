// DEF-234 measurement harness — NOT a unit test (vitest only collects
// `*.test.ts`, so this file is never run by `npm run test:unit`).
//
// Run manually from the repo root:
//   node test/unit/renderer/tooltipReducedMotion.measure.cjs
//
// Loads the REAL stylesheets into Chromium and hovers the tooltip anchor
// under `prefers-reduced-motion: reduce`, recording the ::after computed
// transform / opacity / visibility:
//   (a) at the SHIPPED collapsed duration (0.01ms) — first sample taken as
//       fast as possible after the hover, then after the animation settles;
//   (b) with the reduced durations stretched to 500ms (an injected override,
//       same `!important` shape as the catch-all) so the keyframe trajectory
//       is observable: a reduced path with travel would interpolate, a
//       zero-travel path stays pinned at one transform.
//   (c) with `no-preference` at the same 500ms stretch for the designed
//       (non-reduced) end pose, so the reduced pose can be compared.
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..", "..");
const { chromium } = require(path.join(REPO, "node_modules", "playwright"));

/** Playwright's own chromium download may not match the cached build in
 *  this offline environment, so drive the cached full Chromium directly
 *  (no network install is ever attempted). */
function cachedChromium() {
  const root = path.join(process.env.USERPROFILE ?? "", "AppData", "Local", "ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root)) {
    if (!dir.startsWith("chromium-")) continue;
    const exe = path.join(root, dir, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const css = ["src/renderer/styles.css", "src/renderer/styles/animations.css"]
  .map((p) => fs.readFileSync(path.join(REPO, p), "utf8"))
  .join("\n")
  .replace(/@import[^;]+;/g, "");

const html =
  '<!doctype html><html><head><meta charset="utf-8"><style>' +
  css +
  "</style></head><body style=\"margin:60px\">" +
  '<div class="tooltip-anchor"><button id="anchor" data-tooltip="Tooltip text">Hover me</button></div>' +
  "</body></html>";

/** Stretch the reduced-motion durations so the keyframe trajectory is
 *  observable — same shape as the catch-all rule it overrides. */
const STRETCH_CSS =
  "@media (prefers-reduced-motion: reduce) { *, *::before, *::after " +
  "{ animation-duration: 500ms !important; transition-duration: 500ms !important; } }";

const sample = () => {
  const s = getComputedStyle(document.getElementById("anchor"), "::after");
  return {
    reducedQuery: matchMedia("(prefers-reduced-motion: reduce)").matches,
    animationName: s.animationName,
    animationDuration: s.animationDuration,
    animationDelay: s.animationDelay,
    animationFillMode: s.animationFillMode,
    transform: s.transform,
    opacity: s.opacity,
    visibility: s.visibility,
  };
};

const runningAnimations = () => {
  const el = document.getElementById("anchor");
  return el.getAnimations().map((a) => ({
    name: a.animationName,
    pseudo: a.effect.pseudoElement,
    currentTime: a.currentTime,
    duration: a.effect.getComputedTiming().duration,
    fill: a.effect.getTiming().fill,
  }));
};

async function run(reducedMotion, stretch) {
  const browser = await chromium.launch({ executablePath: cachedChromium() });
  const ctx = await browser.newContext({ reducedMotion });
  const page = await ctx.newPage();
  await page.setContent(html);
  if (stretch) await page.addStyleTag({ content: STRETCH_CSS });

  const before = await page.evaluate(sample);
  await page.hover("#anchor");
  const first = await page.evaluate(sample); // as fast as possible after hover
  const animations = await page.evaluate(runningAnimations);
  await page.waitForTimeout(250);
  const mid = await page.evaluate(sample);
  await page.waitForTimeout(600);
  const settled = await page.evaluate(sample);
  await browser.close();
  return { reducedMotion, stretched: stretch, before, first, animations, mid, settled };
}

(async () => {
  const results = [
    await run("reduce", false),
    await run("reduce", true),
    await run("no-preference", true),
  ];
  console.log(JSON.stringify(results, null, 2));
})();
