// Phase 106 (chunk A) — task framing for the bundled samples.
//
// The Home samples are presented as tasks ("Read and navigate", "Try form
// fields", "Explore recognition"), not identical sparkle tiles. The mapping is
// keyed on the REAL sample name, so it stays honest when the bundled set
// changes; an unknown sample falls back to a general "open and explore" task.
//
// Pure: only the QuietIconId type is imported — no React, no electron.

import type { QuietIconId } from "../icons/quietPrecision";

export type SampleTaskId = "forms" | "recognition" | "reading" | "general";

export interface SampleTask {
  id: SampleTaskId;
  /** Short imperative task label shown on the card. */
  label: string;
  /** One-line description of what the sample demonstrates. */
  description: string;
  /** A real registry glyph that distinguishes the task (never a sparkle). */
  icon: QuietIconId;
}

const TASKS: Readonly<Record<SampleTaskId, Omit<SampleTask, "id">>> = {
  forms: {
    label: "Try form fields",
    description: "Fill and edit interactive fields on a copy",
    icon: "forms",
  },
  recognition: {
    label: "Explore recognition",
    description: "Run text recognition on a scanned page",
    icon: "recognizeText",
  },
  reading: {
    label: "Read and navigate",
    description: "Jump between pages in a long document",
    icon: "find",
  },
  general: {
    label: "Open and explore",
    description: "Open a copy and explore the tools",
    icon: "openSample",
  },
};

/** Classify a sample by its real basename. */
export function sampleTaskId(name: string): SampleTaskId {
  const lower = name.toLowerCase();
  if (lower.includes("form")) return "forms";
  if (lower.includes("scan")) return "recognition";
  if (lower.includes("long") || lower.includes("report")) return "reading";
  return "general";
}

/** The full task framing for a sample. */
export function sampleTaskFor(sample: { name: string; path?: string }): SampleTask {
  const id = sampleTaskId(sample.name);
  return { id, ...TASKS[id] };
}