// Canonical TFlex app launcher for e2e. All Electron launches in this repo go
// through this module - never improvise a launch, never pass executablePath to a
// .cmd/.ps1 shim, never hand-concatenate file:// URLs. The working pattern here was
// proven by e2e/smoke.spec.cjs. CommonJS module so .cjs specs can require it.

const { _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

async function launchApp(extraArgs = [], userDataDir = null) {
  const projectRoot = path.resolve(__dirname, '../..');
  const mainPath = path.join(projectRoot, 'dist', 'main', 'index.js');
  if (!fs.existsSync(mainPath)) {
    throw new Error(
      `TFlex e2e launch: ${path.relative(projectRoot, mainPath)} missing.\n` +
      `Run the build first (npm.cmd run build) before any spec/harness that imports this launcher.`
    );
  }
  
  const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const tempUserData = userDataDir || path.join(os.tmpdir(), `tflex-test-userData-${uniqueId}`);
  if (!fs.existsSync(tempUserData)) fs.mkdirSync(tempUserData, { recursive: true });

  const args = [projectRoot, `--user-data-dir=${tempUserData}`].concat(extraArgs);
  const electronApp = await electron.launch({
    args,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
      ELECTRON_RENDERER_URL: pathToFileURL(
        path.join(projectRoot, 'dist', 'renderer', 'index.html')
      ).href,
    },
  });

  electronApp.on('window', window => {
    window.on('console', msg => {
      const text = msg.text();
      // Forward everything to stdout so we see it in the build terminal
      process.stdout.write(`[ELECTRON-WINDOW] ${text}\n`);
    });
    window.on('pageerror', err => {
      process.stdout.write(`[ELECTRON-ERROR] ${err.message}\n`);
    });
  });

  return electronApp;
}

/**
 * Returns a path to a temporary copy of a bundled sample PDF.
 * Use this for any test that performs mutations or saves.
 */
function getSamplePath(sampleName) {
  const projectRoot = path.resolve(__dirname, '../..');
  const sourcePath = path.join(projectRoot, 'assets', 'samples', sampleName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Sample not found: ${sourcePath}`);
  }
  const tempDir = path.join(os.tmpdir(), 'tflex-e2e-samples');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const targetPath = path.join(tempDir, `${Date.now()}-${sampleName}`);
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

module.exports = { launchApp, getSamplePath };
