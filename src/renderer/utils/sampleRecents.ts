// TFL-1143 (TFL-1116 C7b, R09) — bundled-sample open bookkeeping.
//
// A bundled sample open (from the Home "Explore" grid, or from a stale Recent
// row whose stored path is `samples/<name>`) must NOT pollute the user's real
// MRU in a production build: those rows would point at a fixture the user never
// opened and cannot resolve outside the app. The record is therefore written
// ONLY in a development build; production opens still work, they just leave no
// Recent entry.
//
// Pure over an injected bridge so the rule is unit-testable without Electron.

import type { RecentFile } from "../../shared/types";
import { isDevelopmentBuild } from "./devEnvironment";

/** The slice of the `tflex` bridge this module needs; structural so a test can
 *  pass a stub without constructing the whole bridge. */
export interface SampleRecentBridge {
  addRecentFile(entry: RecentFile): Promise<unknown>;
}

/** True when a bundled-sample open may be recorded in the Recent list. */
export function sampleRecentsEnabled(isDev: boolean = isDevelopmentBuild()): boolean {
  return isDev;
}

/**
 * Record a bundled-sample open in the MRU, but ONLY in a development build.
 * Returns true when a record was written, false when the production gate
 * suppressed it. Never throws on a bridge rejection; a failed write is a
 * non-fatal bookkeeping miss.
 */
export async function recordSampleRecent(
  name: string,
  bridge: SampleRecentBridge,
  isDev: boolean = isDevelopmentBuild(),
  now: () => string = () => new Date().toISOString(),
): Promise<boolean> {
  if (!sampleRecentsEnabled(isDev)) return false;
  const entry: RecentFile = { path: `samples/${name}`, name, openedAt: now() };
  try {
    await bridge.addRecentFile(entry);
  } catch {
    return false;
  }
  return true;
}
