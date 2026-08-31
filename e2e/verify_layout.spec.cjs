const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test('Verify Layout and Grid', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  
  const layout = await window.evaluate(() => {
    const app = document.querySelector('.app');
    const titlebar = document.querySelector('.titlebar');
    const appMain = document.querySelector('.app-main');
    
    const appStyle = getComputedStyle(app);
    const titlebarRect = titlebar.getBoundingClientRect();
    const appMainRect = appMain.getBoundingClientRect();
    
    return {
      appGridRows: appStyle.gridTemplateRows,
      appChildren: Array.from(app.children).map(c => ({
        className: c.className,
        tagName: c.tagName,
        rect: c.getBoundingClientRect()
      })),
      titlebarHeight: titlebarRect.height,
      appMainHeight: appMainRect.height,
      windowHeight: window.innerHeight
    };
  });
  
  console.log('Layout:', JSON.stringify(layout, null, 2));
  
  // If appMainHeight + titlebarHeight < windowHeight * 0.9, then it's likely collapsed
  if (layout.appMainHeight + layout.titlebarHeight < layout.windowHeight - 100) {
      console.log('DETECTED: app-main does not fill the screen!');
  }

  await electronApp.close();
});
