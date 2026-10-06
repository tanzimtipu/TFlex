// Phase 7 — settings.changed echo filter (DEF-037, DEF-072).
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
//
// DEF-072 — every AppSettings field MUST participate in the
// content comparison. The previous version missed four Phase 9/10
// fields (`exportImageFormat`, `exportImageDpi`,
// `createImageQuality`, `editDefaultFont`), so a rapid change to
// one of those followed by a second persisted write would let a
// stale echo from the FIRST write pass the filter and silently
// clobber the second write's value. Every optional AppSettings
// field now has a comparison line in `sameSettings` and
// `differsOnlyInRecentFiles`; new fields added in future phases
// must add their own lines here.
//
// DEF-599 — the Phase 82 motion booleans (`homeMotionPaused`,
// `animationsEnabled`) now participate as well: all three
// comparators (`sameSettings`, `differsOnlyInRecentFiles`,
// `differsOnlyInGeometry`) guard on them, so a stale echo carrying
// an older motion state cannot revert the Home pause.

import type {
  AnnotationColorPreset,
  AnnotationColors,
  AppSettings,
  ExportImageFormat,
  RecentFile,
  SpellCheckSettings,
  WindowGeometry,
} from '../../shared/types';

/** Compare two AppSettings objects for echo-filter purposes. Returns
 *  true when they represent the same persisted state — same theme,
 *  geometry, recents, prefs, and palette hexes. AnnotationColors
 *  preset ids and object/array shape are normalised away (the
 *  backend persists `string[]`, the renderer writes
 *  `AnnotationColorPreset[]`; functionally identical).
 *
 *  DEF-072 — must cover EVERY optional AppSettings field. A
 *  rapid two-write race on a field this comparator misses would
 *  let a stale echo silently clobber the newer local value. */
export function sameSettings(a: AppSettings, b: AppSettings): boolean {
  if (a.theme !== b.theme) return false;
  if (a.themeDefault !== b.themeDefault) return false;
  if (a.recentsCap !== b.recentsCap) return false;
  if (a.toolsPaletteLayout !== b.toolsPaletteLayout) return false;
  if (a.optimizePreset !== b.optimizePreset) return false;
  if (a.exportImageFormat !== b.exportImageFormat) return false;
  if (a.exportImageDpi !== b.exportImageDpi) return false;
  if (a.createImageQuality !== b.createImageQuality) return false;
  if (a.editDefaultFont !== b.editDefaultFont) return false;
  if (a.ocrLanguage !== b.ocrLanguage) return false;
  if (a.ocrDownsample !== b.ocrDownsample) return false;
  if (a.defaultStampId !== b.defaultStampId) return false;
  if (a.saveAsLinearize !== b.saveAsLinearize) return false;
  if (a.homeMotionPaused !== b.homeMotionPaused) return false;
  if (a.animationsEnabled !== b.animationsEnabled) return false;
  // Phase 112 (TFL-1000, DEF-601) — the panel-layout fields participate so a
  // stale echo that disagrees on a just-committed panel width or collapse is
  // recognised as stale and discarded (syncPanelWidth / setInspectorCollapsed
  // consume only accepted echoes).
  if (a.panelLeftWidthPx !== b.panelLeftWidthPx) return false;
  if (a.panelRightWidthPx !== b.panelRightWidthPx) return false;
  if (a.inspectorCollapsed !== b.inspectorCollapsed) return false;
  if (a.pagesPanelCollapsed !== b.pagesPanelCollapsed) return false;
  if (!sameGeometry(a.geometry, b.geometry)) return false;
  if (!sameRecentFiles(a.recentFiles, b.recentFiles)) return false;
  if (!sameSpellCheck(a.spellCheck, b.spellCheck)) return false;
  return sameAnnotationColors(a.annotationColors, b.annotationColors);
}

/** True when the only difference between two AppSettings is the
 *  recentFiles list. The renderer does NOT write recentFiles
 *  directly; it goes through `tflex.addRecentFile`, which is a
 *  backend-authoritative write that always echoes back the
 *  canonical list. Echos that change ONLY recentFiles are
 *  legitimate, regardless of what `settingsPersistedRef` says.
 *
 *  DEF-072 — must cover EVERY optional AppSettings field except
 *  recentFiles, so a recent-files-only delta detector can correctly
 *  recognise the canonical reflection of `addRecentFile` without
 *  also accepting echos that drifted one of the OTHER fields. */
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
  if (a.exportImageFormat !== b.exportImageFormat) return false;
  if (a.exportImageDpi !== b.exportImageDpi) return false;
  if (a.createImageQuality !== b.createImageQuality) return false;
  if (a.editDefaultFont !== b.editDefaultFont) return false;
  if (a.ocrLanguage !== b.ocrLanguage) return false;
  if (a.ocrDownsample !== b.ocrDownsample) return false;
  if (a.defaultStampId !== b.defaultStampId) return false;
  if (a.saveAsLinearize !== b.saveAsLinearize) return false;
  if (a.homeMotionPaused !== b.homeMotionPaused) return false;
  if (a.animationsEnabled !== b.animationsEnabled) return false;
  // Phase 112 (TFL-1000, DEF-601) — a panel-layout drift also disqualifies a
  // recents-only delta, so a stale width/collapse echo is never mistaken for
  // the canonical addRecentFile reflection.
  if (a.panelLeftWidthPx !== b.panelLeftWidthPx) return false;
  if (a.panelRightWidthPx !== b.panelRightWidthPx) return false;
  if (a.inspectorCollapsed !== b.inspectorCollapsed) return false;
  if (a.pagesPanelCollapsed !== b.pagesPanelCollapsed) return false;
  if (!sameGeometry(a.geometry, b.geometry)) return false;
  if (!sameAnnotationColors(a.annotationColors, b.annotationColors)) return false;
  if (!sameSpellCheck(a.spellCheck, b.spellCheck)) return false;
  // All other fields agree; recentFiles must ACTUALLY differ for
  // this branch to apply. (sameRecentFiles returning true means
  // the recents are identical — in which case sameSettings above
  // would have caught it; we're here because sameSettings
  // returned false, so recents MUST differ.)
  if (sameRecentFiles(a.recentFiles, b.recentFiles)) return false;
  // DEF-603 — only trust the delta as the canonical backend
  // `addRecentFile` reflection when the C6a metadata of every recents entry
  // present in BOTH lists agrees. `addRecentFile` inserts/refreshes an entry
  // (path / name / openedAt); it never rewrites a pin or a verified source
  // label the renderer wrote on its own local path. A stale local-write echo
  // that reverted one of those fields therefore fails here and is discarded.
  return sameRecentMetadata(a.recentFiles, b.recentFiles);
}

/** Suppress an "unused import" lint check while documenting the
 *  canonical ExportImageFormat allowlist the comparator relies on.
 *  The renderer's prefs reducer (preferences.ts) already enforces
 *  the same allowlist on writes; this import is here so future
 *  readers see the contract without diving into shared/types.ts. */
export type { ExportImageFormat };

function sameGeometry(a: WindowGeometry, b: WindowGeometry): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.maximized === b.maximized
  );
}

/** Compare two optional spell-check settings blocks. `undefined` is
 *  treated consistently on both sides: both absent match, but an
 *  absent-vs-present pair is a real difference (a write that dropped
 *  the field must not be mistaken for one that changed preference). */
function sameSpellCheck(
  a: SpellCheckSettings | undefined,
  b: SpellCheckSettings | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.enabled === b.enabled && a.language === b.language;
}

/** TFL-990 (Phase 112 C6b) — the recents comparator covers the C6a optional
 *  fields (sourceLabel / sourceKind / converted / pinned / workingFormat).
 *  Without them a stale settings echo carrying an older recents list would
 *  still compare equal and silently revert a pin, a verified source label or a
 *  converted marker — the same DEF-599 class of clobber for the new fields. */
function sameRecentFiles(a: RecentFile[], b: RecentFile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.path !== y.path || x.name !== y.name || x.openedAt !== y.openedAt) return false;
    if (x.sourceLabel !== y.sourceLabel) return false;
    if (x.sourceKind !== y.sourceKind) return false;
    if (x.converted !== y.converted) return false;
    if (x.pinned !== y.pinned) return false;
    if (x.workingFormat !== y.workingFormat) return false;
  }
  return true;
}

/** TFL-1000 (Phase 112, DEF-603) — true when every recents entry that appears
 *  in BOTH lists agrees on the five C6a metadata fields. A genuine backend
 *  `addRecentFile` echo only inserts or refreshes an entry (path / name /
 *  openedAt); it never rewrites a pin, source label, source kind, converted
 *  marker or working format the renderer wrote on its own local path. A stale
 *  local-write echo that reverted one of those fields fails here, so the
 *  recents-only branch no longer trusts it as the canonical backend list. */
function sameRecentMetadata(a: RecentFile[], b: RecentFile[]): boolean {
  const byPath = new Map<string, RecentFile>();
  for (const entry of b) byPath.set(entry.path, entry);
  for (const x of a) {
    const y = byPath.get(x.path);
    if (y === undefined) continue;
    if (x.sourceLabel !== y.sourceLabel) return false;
    if (x.sourceKind !== y.sourceKind) return false;
    if (x.converted !== y.converted) return false;
    if (x.pinned !== y.pinned) return false;
    if (x.workingFormat !== y.workingFormat) return false;
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

/** True when the only difference between two AppSettings is the
 *  geometry block. DEF-202 — main owns the geometry: the window
 *  bounds + `maximized` flag are reported by the OS window and
 *  re-persisted on every maximize / unmaximize / move / resize (the
 *  debounced report in `src/main/window.ts`). The renderer NEVER
 *  writes geometry, so a geometry-only delta between an echo and our
 *  latest write snapshot can only be main's live window state, never
 *  a stale reflection of a local write. Such echoes are applied so
 *  `settings.geometry` stays fresh (the maximize caption itself reads
 *  the dedicated mirror that updates from EVERY echo — see App.tsx
 *  DEF-202 — because an echo that ALSO carries a stale non-geometry
 *  field from a race must still refresh the caption while the filter
 *  rejects the rest). */
export function differsOnlyInGeometry(a: AppSettings, b: AppSettings): boolean {
  // Every field EXCEPT geometry must match.
  if (a.theme !== b.theme) return false;
  if (a.themeDefault !== b.themeDefault) return false;
  if (a.recentsCap !== b.recentsCap) return false;
  if (a.toolsPaletteLayout !== b.toolsPaletteLayout) return false;
  if (a.optimizePreset !== b.optimizePreset) return false;
  if (a.exportImageFormat !== b.exportImageFormat) return false;
  if (a.exportImageDpi !== b.exportImageDpi) return false;
  if (a.createImageQuality !== b.createImageQuality) return false;
  if (a.editDefaultFont !== b.editDefaultFont) return false;
  if (a.ocrLanguage !== b.ocrLanguage) return false;
  if (a.ocrDownsample !== b.ocrDownsample) return false;
  if (a.defaultStampId !== b.defaultStampId) return false;
  if (a.saveAsLinearize !== b.saveAsLinearize) return false;
  if (a.homeMotionPaused !== b.homeMotionPaused) return false;
  if (a.animationsEnabled !== b.animationsEnabled) return false;
  // Phase 112 (TFL-1000, DEF-601) — a panel-layout drift disqualifies the
  // geometry-only delta as well, so an echo that carries a stale width or
  // collapse alongside live window geometry is never applied wholesale.
  if (a.panelLeftWidthPx !== b.panelLeftWidthPx) return false;
  if (a.panelRightWidthPx !== b.panelRightWidthPx) return false;
  if (a.inspectorCollapsed !== b.inspectorCollapsed) return false;
  if (a.pagesPanelCollapsed !== b.pagesPanelCollapsed) return false;
  if (!sameRecentFiles(a.recentFiles, b.recentFiles)) return false;
  if (!sameAnnotationColors(a.annotationColors, b.annotationColors)) return false;
  if (!sameSpellCheck(a.spellCheck, b.spellCheck)) return false;
  // All other fields agree; geometry must ACTUALLY differ for this
  // branch to apply (sameSettings would have caught identical
  // geometry — we're here because sameSettings returned false).
  return !sameGeometry(a.geometry, b.geometry);
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
  // DEF-202 — echoes that change ONLY the geometry are main's live
  // window state (maximize / unmaximize / move / resize report);
  // the renderer never writes geometry, so these can never clobber
  // fresher local state — apply.
  if (differsOnlyInGeometry(echo, persisted)) return true;
  // Content mismatch AND we've written at least once. The echo
  // is older than our most-recent local write — discard so the
  // fresher local state survives.
  return false;
}
