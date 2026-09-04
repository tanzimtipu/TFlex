const { test } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp } = require('./lib/launch.cjs');

const installedPath = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';

test('Discover selectors', async () => {
    const electronApp = await launchApp([], 'default', installedPath);
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Wait for welcome screen
    await window.waitForSelector('button');

    const buttons = await window.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.innerText,
            ariaLabel: b.getAttribute('aria-label'),
            dataTool: b.getAttribute('data-tool'),
            dataToolId: b.getAttribute('data-tool-id'),
            className: b.className
        }));
    });

    console.log('Buttons:', JSON.stringify(buttons, null, 2));

    // Try to open a PDF to see toolbar
    const samplePath = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex\\assets\\samples\\report.pdf';
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, samplePath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace');

    const toolbarButtons = await window.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).map(b => ({
            text: b.innerText,
            ariaLabel: b.getAttribute('aria-label'),
            dataTool: b.getAttribute('data-tool'),
            dataToolId: b.getAttribute('data-tool-id'),
            className: b.className
        }));
    });

    console.log('Toolbar Buttons:', JSON.stringify(toolbarButtons, null, 2));

    // Try to open tools palette
    const toolsToggle = await window.locator('[data-tools-toggle]').count();
    if (toolsToggle > 0) {
        await window.click('[data-tools-toggle]');
        await window.waitForTimeout(1000);
        const paletteButtons = await window.evaluate(() => {
            return Array.from(document.querySelectorAll('.tools-palette button, .palette button')).map(b => ({
                text: b.innerText,
                ariaLabel: b.getAttribute('aria-label'),
                dataTool: b.getAttribute('data-tool'),
                dataToolId: b.getAttribute('data-tool-id')
            }));
        });
        console.log('Palette Buttons:', JSON.stringify(paletteButtons, null, 2));
    }

    await hardClose(electronApp);
});
