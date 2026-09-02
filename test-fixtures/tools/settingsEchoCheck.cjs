/**
 * Mirror of the settings echo filter for node-based testing.
 * Extracted from src/renderer/state/settingsEcho.ts to verify
 * that sameSettings() and differsOnlyInRecentFiles() catch ALL
 * AppSettings fields defined in the shared types.
 */

const SAME_SETTINGS_CHECKED_FIELDS = [
  'theme',
  'themeDefault',
  'recentsCap',
  'toolsPaletteLayout',
  'optimizePreset',
  'ocrLanguage',
  'ocrDownsample',
  'defaultStampId',
  'geometry',
  'recentFiles',
  'annotationColors',
  'exportImageFormat',
  'exportImageDpi',
  'createImageQuality',
  'editDefaultFont',
];

const APPSETTINGS_ALL_FIELDS = [
  'theme',
  'geometry',
  'recentFiles',
  'themeDefault',
  'recentsCap',
  'toolsPaletteLayout',
  'annotationColors',
  'optimizePreset',
  'exportImageFormat',
  'exportImageDpi',
  'createImageQuality',
  'editDefaultFont',
  'ocrLanguage',
  'ocrDownsample',
  'defaultStampId',
];

function sameGeometry(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.maximized === b.maximized;
}

function sameRecentFiles(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (!x || !y) return false;
    if (x.path !== y.path || x.name !== y.name || x.openedAt !== y.openedAt) return false;
  }
  return true;
}

function canonicalHexes(colors) {
  const light = (colors?.light ?? []).map(toHex).sort();
  const dark = (colors?.dark ?? []).map(toHex).sort();
  return [`L:${light.join(',')}`, `D:${dark.join(',')}`];
}

function toHex(entry) {
  return typeof entry === 'string' ? entry : entry.hex;
}

function sameAnnotationColors(a, b) {
  const aHexes = canonicalHexes(a);
  const bHexes = canonicalHexes(b);
  if (aHexes.length !== bHexes.length) return false;
  for (let i = 0; i < aHexes.length; i++) {
    if (aHexes[i] !== bHexes[i]) return false;
  }
  return true;
}

function sameSettings(a, b) {
  if (a.theme !== b.theme) return false;
  if (a.themeDefault !== b.themeDefault) return false;
  if (a.recentsCap !== b.recentsCap) return false;
  if (a.toolsPaletteLayout !== b.toolsPaletteLayout) return false;
  if (a.optimizePreset !== b.optimizePreset) return false;
  if (a.ocrLanguage !== b.ocrLanguage) return false;
  if (a.ocrDownsample !== b.ocrDownsample) return false;
  if (a.defaultStampId !== b.defaultStampId) return false;
  if (a.exportImageFormat !== b.exportImageFormat) return false;
  if (a.exportImageDpi !== b.exportImageDpi) return false;
  if (a.createImageQuality !== b.createImageQuality) return false;
  if (a.editDefaultFont !== b.editDefaultFont) return false;
  if (!sameGeometry(a.geometry, b.geometry)) return false;
  if (!sameRecentFiles(a.recentFiles, b.recentFiles)) return false;
  return sameAnnotationColors(a.annotationColors, b.annotationColors);
}

function differsOnlyInRecentFiles(a, b) {
  if (a.theme !== b.theme) return false;
  if (a.themeDefault !== b.themeDefault) return false;
  if (a.recentsCap !== b.recentsCap) return false;
  if (a.toolsPaletteLayout !== b.toolsPaletteLayout) return false;
  if (a.optimizePreset !== b.optimizePreset) return false;
  if (a.ocrLanguage !== b.ocrLanguage) return false;
  if (a.ocrDownsample !== b.ocrDownsample) return false;
  if (a.defaultStampId !== b.defaultStampId) return false;
  if (a.exportImageFormat !== b.exportImageFormat) return false;
  if (a.exportImageDpi !== b.exportImageDpi) return false;
  if (a.createImageQuality !== b.createImageQuality) return false;
  if (a.editDefaultFont !== b.editDefaultFont) return false;
  if (!sameGeometry(a.geometry, b.geometry)) return false;
  if (!sameAnnotationColors(a.annotationColors, b.annotationColors)) return false;
  return !sameRecentFiles(a.recentFiles, b.recentFiles);
}

function shouldApplyEcho(echo, writeSeq, persisted) {
  if (writeSeq === 0) return true;
  if (persisted === null) return true;
  if (sameSettings(echo, persisted)) return true;
  if (differsOnlyInRecentFiles(echo, persisted)) return true;
  return false;
}

module.exports = { sameSettings, differsOnlyInRecentFiles, shouldApplyEcho, SAME_SETTINGS_CHECKED_FIELDS, APPSETTINGS_ALL_FIELDS };