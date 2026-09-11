// Second reference probe: window right edge, gutters, corner radii evidence.
const path = require('node:path');
const { loadPng, rowStrip, colStrip, runs, patchMean } = require('./glass_probe.cjs');

const REF = path.resolve(__dirname, '..', '..', 'screenshots', 'qa-reference-source.png');
const png = loadPng(REF);

const show = (label, strip) => {
  console.log(`\n-- ${label}`);
  for (const r of runs(strip)) {
    console.log(`  ${String(r.from).padStart(4)}..${String(r.to).padStart(4)} n=${String(r.n).padStart(4)} rgb=${r.rgb.join(',')}`);
  }
};

// Window right edge near the titlebar (glass band vs wallpaper)
show('row y=40 x=1590..1681 (titlebar right edge)', rowStrip(png, 40, 1590, 1680));
show('row y=60 x=1590..1681', rowStrip(png, 60, 1590, 1680));
// Window top edge near right corner
show('col x=1600 y=0..60 (top edge near right)', colStrip(png, 1600, 0, 60));
show('col x=1660 y=0..120 (outside window? top-right)', colStrip(png, 1660, 0, 120));
// Pages panel right edge at gap row y=690
show('row y=690 x=220..280 (pages panel right edge)', rowStrip(png, 690, 220, 280));
// Gutter width check: window left gutter at titlebar height
show('row y=40 x=30..110 (window left edge at titlebar)', rowStrip(png, 40, 30, 110));
// Window bottom-left corner scan
show('col x=70 y=895..935 (bottom-left corner region)', colStrip(png, 70, 895, 935));
// Top-left window corner
show('col x=60 y=0..60', colStrip(png, 60, 0, 60));
show('row y=25 x=40..90', rowStrip(png, 25, 40, 90));
// patches: free titlebar glass columns (for consistency measurement)
console.log('\n-- titlebar free-glass patches (y 32..58):');
for (const x of [490, 560, 630, 700, 770, 840, 910, 980, 1050, 1120]) {
  const m = patchMean(png, x - 6, 32, 12, 26);
  console.log(`  x=${x}: ${m.r.toFixed(0)},${m.g.toFixed(0)},${m.b.toFixed(0)}`);
}
console.log('-- toolbar free-glass patches (y 78..115):');
for (const x of [350, 460, 550, 640, 745, 1115, 1160, 1370, 1580, 1600]) {
  const m = patchMean(png, x - 6, 78, 12, 36);
  console.log(`  x=${x}: ${m.r.toFixed(0)},${m.g.toFixed(0)},${m.b.toFixed(0)}`);
}
console.log('-- wallpaper margins:');
for (const [x, y] of [[15, 470], [35, 200], [1660, 300], [1670, 700], [400, 6], [800, 6], [300, 930], [900, 930]]) {
  const m = patchMean(png, x - 6, y - 6, 12, 12);
  console.log(`  (${x},${y}): ${m.r.toFixed(0)},${m.g.toFixed(0)},${m.b.toFixed(0)}`);
}
console.log('-- pages panel interior strips (left/right of thumbs):');
for (const x of [76, 84, 210, 225, 238]) {
  const m = patchMean(png, x - 3, 200, 6, 600);
  console.log(`  x=${x} (y200-800): ${m.r.toFixed(0)},${m.g.toFixed(0)},${m.b.toFixed(0)}`);
}
console.log('-- tools panel interior strip (x 1590..1606):');
const m2 = patchMean(png, 1588, 180, 18, 700);
console.log(`  ${m2.r.toFixed(0)},${m2.g.toFixed(0)},${m2.b.toFixed(0)}`);
console.log('-- canvas page interior:');
const m3 = patchMean(png, 700, 400, 200, 200);
console.log(`  ${m3.r.toFixed(0)},${m3.g.toFixed(0)},${m3.b.toFixed(0)}`);