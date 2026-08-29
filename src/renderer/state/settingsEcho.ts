// Phase 7 — settings.changed echo filter (DEF-037).
//
// The main process broadcasts every settings write it persists
// back to the renderer via the `settings:changed` IPC event. Most
// of the time the echo is the canonical reflection of our own
// write and applying it is harmless (the payload matches our local
// state). But on rapid theme toggles + palette changes the echoes
// can land out of order with respect to our latest local write —
// the broadcast for write N may arrive AFTER we already issued
// write N+1, and applying it would clobber the newer local state
// (per-theme palette buckets, themeDefault, recentsCap, ...).
//
// The fix is a Lamport-style sequence number tracked entirely on
// the renderer side:
//
//   - Every local settings write (`saveSettings` immediate
//     persist; see DEF-044 fix in App.tsx) bumps `writeSeq` and
//     snapshots the settings object that went out in
//     `persistedRef`.
//   - The `settings.changed` echo callback asks
//     `shouldApplyEcho(...)` whether the incoming payload still
//     represents our most-recent local write.
//     * If `writeSeq === 0` we have not written anything yet
//       (boot-time echo). Always apply — it is the only source of
//       truth we have.
//     * If the echo's content matches the latest snapshot, apply
//       (this is the canonical echo of our last write).
//     * If the echo's content differs ONLY in `recentFiles`, the
//       echo is the canonical reflection of a backend write the
//       renderer initiated through `addRecentFile` — those writes
//       don't go through our local-write snapshot, but they're
//       authoritative for the recent-files list. Apply.
//     * If the echo's content differs in any other field, AND
//       we've advanced past seq=0, the echo is older than our
//       latest local write — discard. Local state already
//       reflects fresher data.
//
// Why a content comparison instead of a per-write seq echoed back
// by main: the wire contract is fixed (see `src/shared/ipc.ts`).
// We can't add a `seq` field to `AppSettings` without changing
// the shared type, which the orchestrator gates. Content matching
// gives the same Lamport guarantee without a contract change.
//
// `sameSettings` is a focused deep-comparator that ignores the
// annotationColors preset-id shape (the backend normalises
// `AnnotationColorPreset[]` down to `string[]` on persist, so the
// echo's annotationColors are hex strings while our local writes
// are objects). We compare the canonical hex-set per theme
// bucket instead.

import type {
  AnnotationColorPreset,
  AnnotationColors,
  AppSettings,
  RecentFile,
  WindowGeometry,
} from '../../shared/types';

/** Compare two AppSettings objects for echo-filter purposes. Returns
 *  true when they represent the same persisted state — same theme,
 *  geometry, recents, prefs, and palette hexes. AnnotationColors
 *  preset ids and object/array shape are normalised away (the
 *  backend persists `string[]`, the renderer writes
 *  `AnnotationColorPreset[]`; functionally identical). */
export function sameSettings(a: AppSettings, b: AppSettings): boolean {
  if (a.theme !== b.theme) return false;
  if (a.themeDefault !== b.themeDefault) return false;
  if (a.recentsCap !== b.recentsCap) return false;
  if (a.toolsPaletteLayout !== b.toolsPaletteLayout) return false;
  if (a.optimizePreset !== b.optimizePreset) return false;
  if (!sameGeometry(a.geometry, b.geometry)) return false;
  if (!sameRecentFiles(a.recentFiles, b.recentFiles)) return false;
  return sameAnnotationColors(a.annotationColors, b.annotationColors);
}

/** True when the only difference between two AppSettings is the
 *  recentFiles list. The renderer does NOT write recentFiles
 *  directly; it goes through `tflex.addRecentFile`, which is a
 *  backend-authoritative write that always echoes back the
 *  canonical list. Echos that change ONLY recentFiles are
 *  legitimate, regardless of what `settingsPersistedRef` says. */
export function differsOnlyInRecentFiles(
  a: AppSettings,
  b: AppSettings,
): boolean {
  // Every field EXCEPT recentFiles must match. If any other field
  // disagrees, this is not a recent-files-only delta.
  if (a.theme !== b.theme) return false;
  if (a.themeDefault !== b.themeDefault) return false;
  if (a.recentsCap !== b.recentsCap) return false;
  if (a.toolsPaletteLayout !== b.toolsPaletteLayout) return false;
  if (a.optimizePreset !== b.optimizePreset) return false;
  if (!sameGeometry(a.geometry, b.geometry)) return false;
  if (!sameAnnotationColors(a.annotationColors, b.annotationColors)) return false;
  // All other fields agree; recentFiles must ACTUALLY differ for
  // this branch to apply. (sameRecentFiles returning true means
  // the recents are identical — in which case sameSettings above
  // would have caught it; we're here because sameSettings
  // returned false, so recents MUST differ.)
  return !sameRecentFiles(a.recentFiles, b.recentFiles);
}

function sameGeometry(a: WindowGeometry, b: WindowGeometry): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.maximized === b.maximized
  );
}

function sameRecentFiles(a: RecentFile[], b: RecentFile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.path !== y.path || x.name !== y.name || x.openedAt !== y.openedAt) return false;
  }
  return true;
}

/** Canonicalise an annotationColors bucket to a sorted hex list. The
 *  shape mismatch between renderer-writes (`AnnotationColorPreset[]`)
 *  and backend-echoes (`string[]`) is invisible at this layer — the
 *  filter only cares about the visible palette content. */
export function sameAnnotationColors(
  a: AnnotationColors | undefined,
  b: AnnotationColors | undefined,
): boolean {
  const aHexes = canonicalHexes(a);
  const bHexes = canonicalHexes(b);
  if (aHexes.length !== bHexes.length) return false;
  for (let i = 0; i < aHexes.length; i += 1) {
    if (aHexes[i] !== bHexes[i]) return false;
  }
  return true;
}

function canonicalHexes(colors: AnnotationColors | undefined): string[] {
  // Treat undefined as an empty palette on BOTH sides — a write that
  // intentionally dropped the palette (rare; the picker always
  // writes at least `{light:[],dark:[]}`) should match an echo
  // that stripped the field entirely.
  const light = (colors?.light ?? []).map(toHex).sort();
  const dark = (colors?.dark ?? []).map(toHex).sort();
  return [`L:${light.join(',')}`, `D:${dark.join(',')}`];
}

function toHex(entry: AnnotationColorPreset | string): string {
  return typeof entry === 'string' ? entry : entry.hex;
}

/** Decide whether to apply an incoming `settings.changed` echo.
 *  `writeSeq` is the renderer's local write counter (0 before any
 *  local write). `persisted` is the most-recent settings object the
 *  renderer handed to main. Returns `true` when the echo should be
 *  applied (state should be updated) and `false` when it should be
 *  discarded as a stale echo. */
export function shouldApplyEcho(
  echo: AppSettings,
  writeSeq: number,
  persisted: AppSettings | null,
): boolean {
  // Boot-time path: no local writes yet. The echo IS our source of
  // truth — apply it.
  if (writeSeq === 0) return true;
  // Defensive: if `persisted` hasn't been set yet (shouldn't
  // happen — we bump writeSeq at the same time as we set it), err
  // on the side of applying so we don't freeze on stale state.
  if (persisted === null) return true;
  // Local-state has been written at least once. If the echo's
  // content matches our last written snapshot, it's the canonical
  // reflection of our latest write — apply.
  if (sameSettings(echo, persisted)) return true;
  // Echos that change ONLY the recentFiles list are the canonical
  // reflection of a backend `addRecentFile` write — apply, so the
  // local mirror picks up the new entry.
  if (differsOnlyInRecentFiles(echo, persisted)) return true;
  // Content mismatch AND we've written at least once. The echo
  // is older than our most-recent local write — discard so the
  // fresher local state survives.
  return false;
}
