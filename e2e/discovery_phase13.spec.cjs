const { test } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('path');

test('Phase 13 discovery screenshot', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.waitForTimeout(2000); // Wait for animations
  
  const screenshotPath = path.join(__dirname, '../screenshots/phase13-discovery.png');
  await window.screenshot({ path: screenshotPath });
  console.log(`Saved screenshot: ${screenshotPath}`);
  
  // List elements with aria-labels or data attributes
  const elements = await window.evaluate(() => {
    const elts = Array.from(document.querySelectorAll('button, [aria-label], [data-testid], [data-title-bar], .title-bar, [data-window-control]'));
    return elts.map(el => ({
      tagName: el.tagName,
      ariaLabel: el.getAttribute('aria-label'),
      dataTestId: el.getAttribute('data-testid'),
      className: el.className,
      text: el.innerText.substring(0, 20),
      rect: el.getBoundingClientRect()
    }));
  });
  console.log('Discovery elements:', JSON.stringify(elements, null, 2));

  await electronApp.close();
});
