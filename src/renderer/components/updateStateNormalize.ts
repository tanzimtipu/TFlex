// OTA — DEF-275: IPC-boundary hardening for `update:statusChanged`.
//
// `UpdateState` arrives over IPC and is rendered as text by two
// always-mounted surfaces:
//   - UpdatePromptDialog (`v{state.version}`)
//   - UpdateIndicator   (`Update v{view.version}`)
// A payload whose `version` is not a primitive (e.g. `{a:1}`) or whose
// `notes` is not a `string[]` throws during render (React error #31 /
// `notes.map is not a function`) and React unmounts the whole root —
// the window goes blank and only a relaunch recovers.
//
// The main process already guarantees the shipped shape, but the
// renderer must not trust it: App.tsx routes every incoming state (the
// initial `getStatus()` result, its failure branch, and the
// `onStatusChanged` push) through this single normaliser, so no
// consumer can ever receive a non-string version or malformed notes.
//
// Pure and exported: unit tests call it directly.

import type { UpdateState } from "../../shared/types";

/** Coerce an untrusted value to a string the way the About label
 *  already does (`String(...)`), so an object/number/null version,
 *  message or reason renders as text instead of throwing. */
function coerceString(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** Coerce an untrusted download progress to a finite number in 0..100.
 *  A non-number or non-finite value (NaN / Infinity) becomes 0, and an
 *  in-range number is clamped: `Math.min(100, Math.max(0, value))`. No
 *  NaN percentage can ever reach a render. */
function coerceProgress(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Normalise untrusted notes to `string[] | undefined`: a non-array
 *  becomes `undefined` (the empty state), and non-string entries are
 *  dropped — the same rule the main process applies defensively. */
function normalizeNotes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((line): line is string => typeof line === "string");
}

/** Normalise an untrusted UpdateState received over IPC. Every kind
 *  that carries a `version` gets a string one; `available` /
 *  `downloaded` get a `string[] | undefined` notes list. `error` gets a
 *  string `message`, `unsupported` a string `reason`, and `downloading`
 *  a finite `progress` in 0..100. A kind whose values are already valid
 *  is returned by reference. A payload that is not an object with a
 *  known `kind` normalises to `null` (the state clears) rather than
 *  reaching a consumer. */
export function normalizeUpdateState(state: unknown): UpdateState | null {
  if (state === null || state === undefined || typeof state !== "object") {
    return null;
  }
  const raw = state as { kind?: unknown };
  switch (raw.kind) {
    case "checking":
      return { kind: "checking" };
    case "error": {
      const message = (state as { message?: unknown }).message;
      if (typeof message === "string") {
        return state as Extract<UpdateState, { kind: "error" }>;
      }
      return { kind: "error", message: coerceString(message) };
    }
    case "unsupported": {
      const reason = (state as { reason?: unknown }).reason;
      if (typeof reason === "string") {
        return state as Extract<UpdateState, { kind: "unsupported" }>;
      }
      return { kind: "unsupported", reason: coerceString(reason) };
    }
    case "downloading": {
      const progress = (state as { progress?: unknown }).progress;
      const clamped = coerceProgress(progress);
      if (clamped === progress) {
        return state as Extract<UpdateState, { kind: "downloading" }>;
      }
      return { kind: "downloading", progress: clamped };
    }
    case "up-to-date":
      return {
        kind: "up-to-date",
        version: coerceString((state as { version?: unknown }).version),
      };
    case "available": {
      const source = state as {
        version?: unknown;
        releaseDate?: unknown;
        notes?: unknown;
      };
      const releaseDate =
        typeof source.releaseDate === "string" ? source.releaseDate : undefined;
      const notes = normalizeNotes(source.notes);
      return {
        kind: "available",
        version: coerceString(source.version),
        ...(releaseDate !== undefined ? { releaseDate } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
    }
    case "downloaded": {
      const source = state as { version?: unknown; notes?: unknown };
      const notes = normalizeNotes(source.notes);
      return {
        kind: "downloaded",
        version: coerceString(source.version),
        ...(notes !== undefined ? { notes } : {}),
      };
    }
    default:
      return null;
  }
}