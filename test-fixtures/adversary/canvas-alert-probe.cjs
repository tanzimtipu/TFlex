// Adversarial probe for CanvasAlertNotice consolidation (TFL-1536)
// Session: phase-1529 gate

const { _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

async function main() {
  const projectRoot = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
  const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const tempUserData = path.join(os.tmpdir(), `tflex-adversary-${uniqueId}`);
  fs.mkdirSync(tempUserData, { recursive: true });

  const mainPath = path.join(projectRoot, 'dist', 'main', 'index.js');
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Missing build: ${mainPath}`);
  }

  const electronApp = await electron.launch({
    args: [projectRoot, `--user-data-dir=${tempUserData}`],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });

  electronApp.on('window', window => {
    window.on('console', msg => {
      process.stdout.write(`[ELECTRON] ${msg.text()}\n`);
    });
    window.on('pageerror', err => {
      process.stdout.write(`[ELECTRON-ERROR] ${err.message}\n`);
    });
  });

  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  
  // Wait for app to fully initialize
  await window.waitForFunction(() => {
    const root = document.querySelector('#root');
    return root && root.children.length > 0;
  }, { timeout: 10000 });

  console.log('App launched successfully');

  // Probe 1: Trigger a warning by attempting tear-out on empty tab
  console.log('\n=== PROBE 1: Trigger warning on empty tab ===');
  await window.click('[data-home-open-file]');
  await window.waitForTimeout(1000);
  
  // Check for canvas alert notice
  const alertNotice = await window.locator('[data-canvas-alert-notice]').count();
  const alertIcon = await window.locator('[data-canvas-alert-icon]').count();
  console.log(`Alert notices: ${alertNotice}, Alert icons: ${alertIcon}`);

  // Probe 2: DOM query - must never exceed 1
  console.log('\n=== PROBE 2: DOM uniqueness ===');
  const iconCount = await window.evaluate(() => {
    return document.querySelectorAll('[data-canvas-alert-icon]').length;
  });
  const noticeCount = await window.evaluate(() => {
    return document.querySelectorAll('[data-canvas-alert-notice]').length;
  });
  console.log(`Icon count: ${iconCount}, Notice count: ${noticeCount}`);
  
  if (iconCount > 1) {
    console.error('FINDING: Multiple alert icons detected!');
    await window.screenshot({ path: `test-fixtures/adversary/multiple-icons-${uniqueId}.png` });
  }
  
  if (noticeCount > 1) {
    console.error('FINDING: Multiple alert notices detected!');
    await window.screenshot({ path: `test-fixtures/adversary/multiple-notices-${uniqueId}.png` });
  }

  // Probe 3: Collapse/expand cycle
  console.log('\n=== PROBE 3: Collapse/expand cycle ===');
  if (alertIcon === 1) {
    await window.click('[data-canvas-alert-icon]');
    await window.waitForTimeout(500);
    const expandedState = await window.locator('[data-canvas-alert-state="expanded"]').count();
    console.log(`Expanded after click: ${expandedState}`);
    
    // Collapse it
    await window.click('[data-canvas-alert-collapse]');
    await window.waitForTimeout(500);
    const collapsedState = await window.locator('[data-canvas-alert-notice-state="collapsed"]').count();
    console.log(`Collapsed after click: ${collapsedState}`);
  }

  // Probe 4: Add warning while collapsed
  console.log('\n=== PROBE 4: Add warning while collapsed ===');
  // Trigger another warning (e.g., try to save without document)
  await window.keyboard.press('Control+S');
  await window.waitForTimeout(500);
  
  // Probe 5: prefers-reduced-motion check
  console.log('\n=== PROBE 5: Reduced motion path ===');
  const reducedMotion = await window.evaluate(() => {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  console.log(`Reduced motion active: ${reducedMotion}`);

  // Probe 6: Blast radius - other notices
  console.log('\n=== PROBE 6: Other notices (ProtectionNotice, etc.) ===');
  const protectionNotices = await window.locator('[data-protection-notice]').count();
  const conversionNotices = await window.locator('[data-conversion-notice]').count();
  const pdf3dNotices = await window.locator('[data-pdf3d-notice]').count();
  console.log(`Protection: ${protectionNotices}, Conversion: ${conversionNotices}, PDF3D: ${pdf3dNotices}`);

  // Final screenshot
  await window.screenshot({ path: `test-fixtures/adversary/final-state-${uniqueId}.png` });
  
  console.log('\n=== ADVERSARIAL PROBE COMPLETE ===');
  
  // Cleanup
  await electronApp.close();
  fs.rmSync(tempUserData, { recursive: true, force: true });
  
  process.exit(0);
}

main().catch(err => {
  console.error('Probe failed:', err);
  process.exit(1);
});
