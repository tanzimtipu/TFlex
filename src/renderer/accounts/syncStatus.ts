// Phase 44 — sync-status presentation.
//
// Pure mapping from the shared `SyncReport`/`SyncPhase` to the label the
// account surface shows. `unavailable` and `idle` carry NO error, so they are
// reported as neutral states, never as failures. Kept out of the component so
// every phase is unit-tested directly.

import type { SyncPhase, SyncReport } from "../../shared/accounts";

export interface SyncStatusView {
  phase: SyncPhase;
  /** Short status word shown beside the Sync now action. */
  label: string;
  /** Secondary detail (counts / timestamp / error), or null. */
  detail: string | null;
  tone: "neutral" | "positive" | "warning" | "error";
}

/** Format an ISO timestamp for display; malformed input degrades to null. */
export function formatSyncTime(at: string | undefined): string | null {
  if (at === undefined || at.length === 0) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function countsDetail(report: SyncReport): string | null {
  const pushed = report.pushed;
  const pulled = report.pulled;
  if (pushed === undefined && pulled === undefined) return null;
  const parts: string[] = [];
  if (pulled !== undefined && pulled > 0) parts.push(`${pulled} pulled`);
  if (pushed !== undefined && pushed > 0) parts.push(`${pushed} pushed`);
  if (parts.length === 0) return "Everything is up to date";
  return parts.join(", ");
}

export function describeSyncReport(report: SyncReport | null): SyncStatusView {
  if (report === null) {
    return { phase: "idle", label: "Not synced yet", detail: null, tone: "neutral" };
  }
  switch (report.phase) {
    case "idle":
      return { phase: "idle", label: "Not synced yet", detail: null, tone: "neutral" };
    case "syncing":
      return { phase: "syncing", label: "Syncing", detail: null, tone: "neutral" };
    case "synced": {
      const time = formatSyncTime(report.at);
      const detail = countsDetail(report);
      const withTime = time !== null ? (detail !== null ? `${detail} at ${time}` : `at ${time}`) : detail;
      return { phase: "synced", label: "Synced", detail: withTime, tone: "positive" };
    }
    case "unavailable":
      return {
        phase: "unavailable",
        label: "Sync is not configured on this install",
        detail: "Your account works; cloud sync will be enabled in a later release.",
        tone: "warning",
      };
    case "offline":
      return {
        phase: "offline",
        label: "Offline",
        detail: "Sync will retry automatically when you are back online.",
        tone: "warning",
      };
    case "error":
      return {
        phase: "error",
        label: "Sync failed",
        detail: report.error?.message ?? "Try again in a moment.",
        tone: "error",
      };
  }
}
