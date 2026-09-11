// Pin down the reference mock's exact window + panel edges before defining
// the comparison sample regions. Prints color runs along probe lines.
const path = require('node:path');
const { loadPng, rowStrip, colStrip, runs } = require('./glass_probe.cjs');

const REF = path.resolve(__dirname, '..', '..', 'screenshots', 'qa-reference-source.png');
const png = loadPng(REF);
console.log(`reference ${png.width}x${png.height}`);

const show = (label, strip) => {
  console.log(`\n-- ${label}`);
  for (const r of runs(strip)) {
    console.log(`  ${String(r.from).padStart(4)}..${String(r.to).padStart(4)} n=${String(r.n).padStart(4)} rgb=${r.rgb.join(',')}`);
  }
};

// Window left/right edges at mid height (wallpaper is saturated, glass lighter)
show('row y=470 x=0..140 (left edge)', rowStrip(png, 470, 0, 140));
show('row y=470 x=1560..1680 (right edge)', rowStrip(png, 470, 1560, 1680));
// Window top/bottom edges at mid x
show('col x=840 y=0..70 (top edge)', colStrip(png, 840, 0, 70));
show('col x=840 y=880..935 (bottom edge)', colStrip(png, 840, 880, 935));
// Pages panel: top edge and bottom edge at x=140
show('col x=140 y=120..200 (pages panel top edge)', colStrip(png, 140, 120, 200));
show('col x=140 y=880..935 (pages panel bottom edge)', colStrip(png, 140, 880, 935));
// Pages panel left edge at y=470 (between thumbnails? no - thumb row spans; pick y=470 thumb area is white page; use y=650 thumb white too; use x scan at y=690 gap between thumbs)
show('row y=690 x=40..120 (pages panel left edge, gap row)', rowStrip(png, 690, 40, 120));
// Tools panel: left edge at y=470, right edge, top/bottom at x=1500
show('row y=700 x=1360..1420 (tools panel left edge)', rowStrip(png, 700, 1360, 1420));
show('row y=700 x=1580..1681 (tools panel right edge)', rowStrip(png, 700, 1580, 1680));
show('col x=1500 y=120..200 (tools panel top edge)', colStrip(png, 1500, 120, 200));
show('col x=1500 y=880..935 (tools panel bottom edge)', colStrip(png, 1500, 880, 935));