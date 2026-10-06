// Phase 112 (TFL-997) adversary probe — settingsEcho stale-echo filter vs the
// new panel-layout fields. Imports the REAL renderer comparator module and
// exercises the exact `shouldApplyEcho` decision the App's settings.changed
// listener makes. Runs under `node --experimental-strip-types`.
import { shouldApplyEcho, sameSettings, differsOnlyInRecentFiles } from '../../src/renderer/state/settingsEcho.ts';

function mk(over) {
  return {
    theme: 'dark',
    themeDefault: 'graphite',
    recentsCap: 10,
    toolsPaletteLayout: 'grid',
    optimizePreset: 'balanced',
    exportImageFormat: 'png',
    exportImageDpi: 150,
    createImageQuality: 90,
    editDefaultFont: 'Helvetica',
    ocrLanguage: 'eng',
    ocrDownsample: 300,
    defaultStampId: 'APPROVED',
    saveAsLinearize: false,
    homeMotionPaused: false,
    animationsEnabled: true,
    geometry: { x: 0, y: 0, width: 1200, height: 800, maximized: false },
    recentFiles: [],
    spellCheck: { enabled: false, language: 'en' },
    annotationColors: { light: [], dark: [] },
    ...over,
  };
}

const results = [];
function check(name, actual, expectedForFinding) {
  results.push({ name, actual, expectedForFinding });
  console.log(`${name}: actual=${actual} (a correct filter would be ${expectedForFinding})`);
}

// --- Stale panel-width echo ------------------------------------------------
// Sequence: renderer wrote panelLeftWidthPx=320 (persisted snapshot), an older
// in-flight write is still echoing panelLeftWidthPx=300. The newer local state
// (320) must survive, so shouldApplyEcho must return false for the stale echo.
{
  const persisted = mk({ panelLeftWidthPx: 320 });
  const staleEcho = mk({ panelLeftWidthPx: 300 });
  check('left-width stale echo applied?', shouldApplyEcho(staleEcho, 1, persisted), false);
  check('sameSettings(stale,persisted) (width differs)', sameSettings(staleEcho, persisted), false);
}

{
  const persisted = mk({ panelRightWidthPx: 380 });
  const staleEcho = mk({ panelRightWidthPx: 300 });
  check('right-width stale echo applied?', shouldApplyEcho(staleEcho, 1, persisted), false);
}

{
  const persisted = mk({ inspectorCollapsed: true });
  const staleEcho = mk({ inspectorCollapsed: false });
  check('inspectorCollapsed stale echo applied?', shouldApplyEcho(staleEcho, 1, persisted), false);
}

{
  const persisted = mk({ pagesPanelCollapsed: true });
  const staleEcho = mk({ pagesPanelCollapsed: false });
  check('pagesPanelCollapsed stale echo applied?', shouldApplyEcho(staleEcho, 1, persisted), false);
}

// --- Recents-only stale echo (pin revert) ----------------------------------
// A stale echo whose ONLY difference from the latest local write is the
// recent-files list is trusted by `differsOnlyInRecentFiles`; the new pin
// fields are compared inside sameRecentFiles, but that branch is bypassed.
{
  const persisted = mk({ recentFiles: [{ path: 'C:/a.pdf', name: 'a.pdf', openedAt: 1, pinned: true }] });
  const staleEcho = mk({ recentFiles: [{ path: 'C:/a.pdf', name: 'a.pdf', openedAt: 1, pinned: false }] });
  check('pinned recents-only stale echo applied?', shouldApplyEcho(staleEcho, 1, persisted), false);
  check('sameRecentFiles via sameSettings (pin differs)', sameSettings(staleEcho, persisted), false);
  check('differsOnlyInRecentFiles(stale,persisted)', differsOnlyInRecentFiles(staleEcho, persisted), false);
}

console.log('\nJSON=' + JSON.stringify(results));
