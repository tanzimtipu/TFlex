// Path identity — one comparison key for "is this the same file?".
//
// Phase 32 / DEF-279. Both the open dedupe and the same-file pane guard
// compared RAW path strings, so on Windows a case-variant path named the
// same on-disk file twice: two tabs for one document, and a save from the
// second pane silently overwrote the first pane's saved edit. Every
// same-file decision must go through this key instead of `===`.
//
// Platform assumption (documented non-goal): Windows and macOS file
// systems are case-INSENSITIVE, so the key always case-folds. A
// case-sensitive platform would need a variant of this key that preserves
// case; that is deliberately out of scope.
//
// Rule, applied to the path string only (the renderer has no `fs`):
//   1. trim surrounding whitespace;
//   2. drop a Windows extended-length prefix (`\\?\` or `//?/`); a
//      `\\?\UNC\server\share` remainder is folded back to `//server/share`;
//   3. treat `\` and `/` identically (replace every `\` with `/`);
//   4. strip trailing separators (but never the root separator itself);
//   5. case-fold.
//
// Examples (all four are the same key):
//   `C:\Docs\Report.PDF`  `c:/docs/report.pdf`  `c:\Docs\Report.pdf\`
//   `\\?\C:\Docs\Report.pdf`
// Two genuinely different paths keep different keys.

/** Return the comparison key for a file path. Pure: no I/O. */
export function pathComparisonKey(filePath: string): string {
  let value = filePath.trim();
  if (value === "") return "";

  // Windows extended-length / device prefix. `\\?\UNC\server\share\x`
  // means the same file as `\\server\share\x`.
  if (value.startsWith("\\\\?\\")) {
    value = value.slice(4);
    if (/^UNC[\\/]/i.test(value)) value = `\\\\${value.slice(4)}`;
  } else if (value.startsWith("//?/")) {
    value = value.slice(4);
    if (/^UNC[\\/]/i.test(value)) value = `//${value.slice(4)}`;
  }

  // One separator spelling for everyone.
  value = value.replace(/\\/g, "/");

  // Strip trailing separator(s); keep a lone root slash.
  while (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }

  return value.toLowerCase();
}

/** True when two paths name the same location under the key's rule. */
export function isSamePath(a: string, b: string): boolean {
  return pathComparisonKey(a) === pathComparisonKey(b);
}