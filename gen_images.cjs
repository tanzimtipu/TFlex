const fs = require('fs');
const { PNG } = require('pngjs');
const path = require('path');

function createPng(filePath, width, height, color) {
  const png = new PNG({ width, height });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      png.data[idx] = color.r;
      png.data[idx + 1] = color.g;
      png.data[idx + 2] = color.b;
      png.data[idx + 3] = 255;
    }
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

const fixturesDir = path.join(__dirname, 'test-fixtures');
if (!fs.existsSync(fixturesDir)) fs.mkdirSync(fixturesDir);

createPng(path.join(fixturesDir, 'red.png'), 100, 100, { r: 255, g: 0, b: 0 });
createPng(path.join(fixturesDir, 'green.png'), 100, 100, { r: 0, g: 255, b: 0 });
createPng(path.join(fixturesDir, 'blue.png'), 100, 100, { r: 0, g: 0, b: 255 });

console.log('Created red.png, green.png, blue.png in test-fixtures/');
