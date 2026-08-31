const { _electron: electron } = require('@playwright/test');
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function launchPackagedApp(executablePath, extraEnv = {}) {
  const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const tempUserData = path.join(os.tmpdir(), `tflex-ota-test-${uniqueId}`);
  if (!fs.existsSync(tempUserData)) fs.mkdirSync(tempUserData, { recursive: true });

  // Get token from system environment
  const token = process.env.TFLEX_GH_TOKEN || 
                process.env.GH_TOKEN || 
                require('child_process').execSync('powershell -Command "$t = [System.Environment]::GetEnvironmentVariable(\'TFLEX_GH_TOKEN\', \'User\'); if (!$t) { $t = [System.Environment]::GetEnvironmentVariable(\'TFLEX_GH_TOKEN\', \'Machine\') }; $t"').toString().trim();

  // Ensure no existing TFlex processes are running to avoid single-instance lock issues
  try {
    require('child_process').execSync('taskkill /F /IM TFlex.exe /T', { stdio: 'ignore' });
  } catch (e) {
    // ignore if process not found
  }

  const electronApp = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      TFLEX_GH_TOKEN: token,
      ELECTRON_ENABLE_LOGGING: '1',
      ...extraEnv
    },
  });

  return { electronApp, tempUserData };
}

test.describe('OTA Update Verification', () => {
  test('NSIS build 1.5.2 detects and downloads 1.5.3 update', async () => {
    const nsisPath = path.resolve(__dirname, '../release/win-unpacked/TFlex.exe');
    if (!fs.existsSync(nsisPath)) {
      throw new Error(`NSIS build not found at ${nsisPath}. Run build first.`);
    }

    const { electronApp } = await launchPackagedApp(nsisPath);
    const window = await electronApp.firstWindow();
    await window.waitForSelector('.welcome:visible', { timeout: 30000 });

    console.log('App launched. Checking version in About dialog...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', { action: 'about' });
    });

    await window.waitForSelector('[data-about-dialog]:visible');
    const versionText = await window.textContent('[data-about-version]');
    expect(versionText).toBe('1.5.2');
    console.log('Current version is 1.5.2.');

    console.log('Waiting for update available status...');
    await expect(async () => {
      const status = await window.evaluate(() => window.tflex.update.getStatus());
      if (status.kind !== 'available') {
        throw new Error(`Update status is ${status.kind}, expected available`);
      }
    }).toPass({ timeout: 60000 });

    const availableStatus = await window.evaluate(() => window.tflex.update.getStatus());
    expect(availableStatus.version).toBe('1.5.3');
    console.log('Update 1.5.3 is available.');

    // Verify About dialog reflects availability
    const updateLabel = await window.textContent('[data-about-update]');
    expect(updateLabel).toContain('Update available: v1.5.3');

    console.log('Triggering download via IPC (UI buttons missing)...');
    await window.evaluate(() => window.tflex.update.download());

    console.log('Waiting for download to complete...');
    await expect(async () => {
      const status = await window.evaluate(() => window.tflex.update.getStatus());
      if (status.kind !== 'downloaded') {
        // Log progress if downloading
        if (status.kind === 'downloading') {
          console.log(`Downloading: ${status.progress}%`);
        }
        throw new Error(`Update status is ${status.kind}, expected downloaded`);
      }
    }).toPass({ timeout: 180000 }); // Large timeout for real download

    console.log('Update downloaded successfully.');

    // Verify About dialog reflects downloaded state
    const readyLabel = await window.textContent('[data-about-update]');
    expect(readyLabel).toContain('Update ready: v1.5.3');

    console.log('Triggering installation via IPC...');
    await window.evaluate(() => window.tflex.update.install());
    
    // App should close
    await new Promise(resolve => electronApp.on('close', resolve));
    console.log('App closed for installation. Success.');
  });

  test('Portable build simulation returns unsupported', async () => {
    // We use the NSIS unpacked build but simulate portable mode by setting 
    // PORTABLE_EXECUTABLE_DIR. This is more reliable for testing than 
    // launching the self-extracting portable EXE.
    const nsisPath = path.resolve(__dirname, '../release/win-unpacked/TFlex.exe');
    
    const { electronApp } = await launchPackagedApp(nsisPath, {
        PORTABLE_EXECUTABLE_DIR: path.join(os.tmpdir(), 'tflex-portable-sim')
    });
    const window = await electronApp.firstWindow();
    await window.waitForSelector('.welcome:visible', { timeout: 30000 });

    console.log('App launched in simulated portable mode. Checking About dialog...');
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', { action: 'about' });
    });

    await window.waitForSelector('[data-about-dialog]:visible');
    
    const status = await window.evaluate(() => window.tflex.update.getStatus());
    expect(status.kind).toBe('unsupported');
    expect(status.reason).toContain('Portable builds do not support automatic updates');
    
    const updateLabel = await window.textContent('[data-about-update]');
    expect(updateLabel).toContain('Portable build');
    
    console.log('Portable build simulation correctly reported as unsupported.');

    await electronApp.close();
  });
});
